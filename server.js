require('dotenv').config();

const express = require('express');
const app = new express();

const fs = require('fs');

const path = require('path');

const DATA_DIR = path.join(__dirname, 'output');
const JOB_LOG_FILE = path.join(DATA_DIR, 'jobs.json');

// Ignore favicon.ico requests to prevent 404 errors
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

app.use(express.static('public'));
app.use(express.static('output'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

let maskFileId = null;

const twilio = require('twilio');
const {
    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, OPENAI_API_KEY
} = process.env;


const { OpenAI } = require('openai');
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY
});

function withTimeout(promise, timeoutMs, operationName) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        })
    ]);
}

function ensureJobStorage() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(JOB_LOG_FILE)) {
        fs.writeFileSync(JOB_LOG_FILE, JSON.stringify([], null, 2));
    }
}

function readJobLog() {
    ensureJobStorage();
    try {
        const raw = fs.readFileSync(JOB_LOG_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('Failed to read job log:', error);
        return [];
    }
}

function writeJobLog(entries) {
    ensureJobStorage();
    fs.writeFileSync(JOB_LOG_FILE, JSON.stringify(entries, null, 2));
}

function upsertJob(update) {
    const jobs = readJobLog();
    const index = jobs.findIndex((job) => job.messageSid === update.messageSid);
    if (index >= 0) {
        jobs[index] = {
            ...jobs[index],
            ...update,
            updatedAt: new Date().toISOString()
        };
    } else {
        jobs.push({
            ...update,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }
    writeJobLog(jobs);
}

function toMaskedPhone(phoneNumber = '') {
    const cleaned = String(phoneNumber).trim();
    const digits = cleaned.replace(/\D/g, '');

    if (digits.length < 6) {
        return cleaned;
    }

    const local = digits.length >= 10 ? digits.slice(-10) : digits;
    const country = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : '';
    const areaCode = local.slice(0, 3);
    const lastThree = local.slice(-3);
    return `${country}(${areaCode}) ***-***-${lastThree}`;
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function normalizeRecipient(number) {
    const trimmed = String(number || '').trim();
    if (!trimmed) {
        return '';
    }
    return trimmed.startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`;
}

function getOutboundWhatsappFrom() {
    if (process.env.TWILIO_WHATSAPP_FROM) {
        return normalizeRecipient(process.env.TWILIO_WHATSAPP_FROM);
    }
    if (process.env.WHATSAPP_FROM) {
        return normalizeRecipient(process.env.WHATSAPP_FROM);
    }

    const jobs = readJobLog();
    const recentWithTo = jobs
        .filter((job) => !!job.to)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    return recentWithTo.length > 0 ? recentWithTo[0].to : null;
}

function buildAnimeStats() {
    const jobs = readJobLog().filter((job) => job.messageType === 'image');
    const successfulJobs = jobs.filter((job) => job.status === 'success');
    const failedJobs = jobs.filter((job) => job.status === 'failed');
    const users = unique(jobs.map((job) => job.from));

    const userMap = new Map();
    for (const job of jobs) {
        if (!job.from) continue;

        const current = userMap.get(job.from) || {
            phoneNumber: job.from,
            maskedPhoneNumber: toMaskedPhone(job.from),
            totalAttempts: 0,
            successfulImages: 0,
            failedImages: 0,
            lastSeen: job.updatedAt || job.createdAt
        };

        current.totalAttempts += 1;
        if (job.status === 'success') current.successfulImages += 1;
        if (job.status === 'failed') current.failedImages += 1;

        const currentLastSeen = new Date(current.lastSeen || 0);
        const jobDate = new Date(job.updatedAt || job.createdAt || 0);
        if (jobDate > currentLastSeen) {
            current.lastSeen = job.updatedAt || job.createdAt;
        }

        userMap.set(job.from, current);
    }

    const userStats = [...userMap.values()].sort((a, b) => {
        return new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0);
    });

    return {
        totals: {
            totalImages: successfulJobs.length,
            successfulImages: successfulJobs.length,
            failedImages: failedJobs.length,
            uniqueUsers: users.length,
            totalImageRequests: jobs.length
        },
        users: userStats
    };
}


async function createFile(filePath) {
    const fileContent = fs.createReadStream(filePath);
    const result = await openai.files.create({
      file: fileContent,
      purpose: "vision",
    });
    return result.id;
}

const { downloadTwilioMedia, encodeImage } = require('./utils');
const sharp = require('sharp');

app.post('/message', async (req, res) => {

    const twiml = new twilio.twiml.MessagingResponse();
    console.log('x-forwarded-host', req.headers['x-forwarded-host']);
 
    console.log('body', req.body);

    if (req.body.MessageType == 'image') {

        const messageSid = req.body.SmsMessageSid;
        const mediaUrl = req.body.MediaUrl0 || req.body.MediaUrl;

        upsertJob({
            messageSid,
            from: req.body.From,
            to: req.body.To,
            status: 'processing',
            messageType: req.body.MessageType,
            stage: 'accepted'
        });

        twiml.message('Your image is being processed ⏳. We\'ll send your message when it\'s ready 🎉.');
        res.send(twiml.toString());

        console.log(`[${messageSid}] Image request accepted. Starting media download.`);

        try {
            if (!mediaUrl) {
                throw new Error('Missing MediaUrl0 in webhook payload.');
            }

            upsertJob({
                messageSid,
                status: 'processing',
                stage: 'downloading_media'
            });

            const base64Image = await withTimeout(
                downloadTwilioMedia(mediaUrl),
                30000,
                'Twilio media download'
            );

            if (!base64Image || !base64Image.base64 || !base64Image.contentType) {
                throw new Error('Twilio media download returned empty data.');
            }

            upsertJob({
                messageSid,
                status: 'processing',
                stage: 'generating_with_openai'
            });

            console.log(`[${messageSid}] Sending media to OpenAI image generation.`);

            //Create input_images folder if it doesn't exist
            /* uncomment this section if you want to save the input images
            if (!fs.existsSync('input_images')) {
                fs.mkdirSync('input_images');
            }
            
            // Save the input image
            const inputImagePath = `input_images/${req.body.SmsMessageSid}_input.${base64Image.contentType.split('/')[1]}`;
            fs.writeFileSync(inputImagePath, Buffer.from(base64Image.base64, "base64"));
            console.log('Saved input image:', inputImagePath); */

             // Add your prompt here and tell it what you want.

            const PROMPT = `CHANGE THIS TO YOUR PROMPT. You can be as creative as you like! For example, you could say "Turn this image into a Van Gogh painting" or "Make this look like a Pixar-style character". The more specific you are, the better the results will be.`;

            const response = await withTimeout(
                openai.responses.create({
                    model: "gpt-4o-mini",
                    input: [
                        {
                            role: "user",
                            content: [
                                { type: "input_text", text: PROMPT },
                                {
                                    type: "input_image",
                                    image_url: `data:${base64Image.contentType};base64,${base64Image.base64}`,
                                },
                            ],
                        },
                    ],
                    tools: [{ type: "image_generation" }],
                }),
                180000,
                'OpenAI image generation'
            );

            console.log(`[${messageSid}] OpenAI response received.`);
            const processedPrompts = Array.isArray(response.output)
                ? response.output.flatMap((item) => {
                    const prompts = [];
                    if (typeof item?.revised_prompt === 'string' && item.revised_prompt.trim()) {
                        prompts.push(item.revised_prompt.trim());
                    }
                    if (typeof item?.prompt === 'string' && item.prompt.trim()) {
                        prompts.push(item.prompt.trim());
                    }
                    if (item?.type === 'message' && Array.isArray(item.content)) {
                        for (const contentItem of item.content) {
                            if (contentItem?.type === 'output_text' && typeof contentItem.text === 'string' && contentItem.text.trim()) {
                                prompts.push(contentItem.text.trim());
                            }
                        }
                    }
                    return prompts;
                })
                : [];

            console.log(`[${messageSid}] OpenAI response summary:`, {
                id: response.id,
                status: response.status,
                outputTypes: Array.isArray(response.output) ? response.output.map((item) => item.type) : [],
                imageGenerationCalls: Array.isArray(response.output)
                    ? response.output.filter((item) => item.type === 'image_generation_call').length
                    : 0,
                error: response.error || null
            });
            if (processedPrompts.length > 0) {
                console.log(`[${messageSid}] OpenAI processed prompt(s):`, processedPrompts);
            } else {
                console.log(`[${messageSid}] OpenAI did not return a processed/revised prompt in this response.`);
            }

            const imageData = response.output
                .filter((output) => output.type === "image_generation_call")
                .map((output) => output.result);

            if (imageData.length > 0) {
                const imageBase64 = imageData[0];
                // Create output folder if it doesn't exist
                if (!fs.existsSync('output')) {
                fs.mkdirSync('output');
                }
                
                // Save the generated image first
                const generatedImagePath = `output/${req.body.SmsMessageSid}.png`;
                fs.writeFileSync(generatedImagePath, Buffer.from(imageBase64, "base64"));
                
                // Apply mask to the generated image
                const maskPath = 'input/mask.png';
                const finalImagePath = `output/${req.body.SmsMessageSid}_twilio.png`;
                
                await sharp(generatedImagePath)
                .composite([{ input: maskPath, blend: 'over' }]) // Changed from 'multiply' to 'over' to put mask on top
                .png()
                .toFile(finalImagePath);
                
                // Clean up temporary generated image
                fs.unlinkSync(generatedImagePath);

                // Send whatsapp message with image
                const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
                await twilioClient.messages.create({
                from: req.body.To,
                to: req.body.From, 
                body: `Your new anime-style image is ready. Enjoy 🥳. Feel free to share on socials.`,
                mediaUrl: `https://${req.headers['x-forwarded-host']}/${req.body.SmsMessageSid}_twilio.png`
                });

                console.log(`[${messageSid}] Image generated and delivered successfully.`);

                upsertJob({
                    messageSid,
                    from: req.body.From,
                    to: req.body.To,
                    status: 'success',
                    messageType: req.body.MessageType,
                    outputImageUrl: `/${req.body.SmsMessageSid}_twilio.png`,
                    stage: 'completed'
                });

            } else {
                console.log(response.output.content);
                throw new Error('Image generation returned no image data.');
            }
        } catch (error) {
            console.error('Error processing image:', error);

            upsertJob({
                messageSid,
                from: req.body.From,
                to: req.body.To,
                status: 'failed',
                messageType: req.body.MessageType,
                errorMessage: error?.message || 'Unknown processing error',
                stage: 'failed'
            });

            const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
            await twilioClient.messages.create({
                from: req.body.To,
                to: req.body.From, 
                body: `We're really sorry, there was an error processing your image. Please resend the image, and we'll try again.`
            });
        }

    } else {
        twiml.message('Please send any photo, and we\'ll create a fun anime-style image for you 🎨.');
        res.send(twiml.toString());
    }

});

// API endpoint to get list of all images
app.get('/api/images', async (req, res) => {
    try {
        if (!fs.existsSync('output')) {
            return res.json([]);
        }
        
        const files = fs.readdirSync('output')
            .filter(file => file.toLowerCase().endsWith('.png'))
            .map(file => ({
                name: file,
                url: `/${file}`,
                created: fs.statSync(`output/${file}`).birthtime
            }))
            .sort((a, b) => new Date(b.created) - new Date(a.created)); // Most recent first
        
        res.json(files);
    } catch (error) {
        console.error('Error reading images:', error);
        res.status(500).json({ error: 'Failed to load images' });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const stats = buildAnimeStats();
        res.json(stats);
    } catch (error) {
        console.error('Error building anime stats:', error);
        res.status(500).json({ error: 'Failed to load anime stats' });
    }
});

app.post('/api/outreach/send', async (req, res) => {
    try {
        const recipients = Array.isArray(req.body.recipients) ? req.body.recipients : [];
        const message = String(req.body.message || '').trim();

        if (!recipients.length) {
            return res.status(400).json({ error: 'Please provide at least one recipient.' });
        }

        if (!message) {
            return res.status(400).json({ error: 'Message is required.' });
        }

        const from = getOutboundWhatsappFrom();
        if (!from) {
            return res.status(400).json({ error: 'No outbound WhatsApp sender found. Set TWILIO_WHATSAPP_FROM in .env.' });
        }

        const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        const uniqueRecipients = unique(recipients.map(normalizeRecipient));

        const results = await Promise.allSettled(
            uniqueRecipients.map((to) => twilioClient.messages.create({ from, to, body: message }))
        );

        const successful = results.filter((result) => result.status === 'fulfilled').length;
        const failed = results.length - successful;

        res.json({
            sent: successful,
            failed,
            totalRecipients: uniqueRecipients.length
        });
    } catch (error) {
        console.error('Error sending outreach messages:', error);
        res.status(500).json({ error: 'Failed to send outreach messages' });
    }
});

app.post('/api/outreach/pick-winner', async (req, res) => {
    try {
        const fallbackRecipients = buildAnimeStats().users.map((user) => user.phoneNumber);
        const requestedRecipients = Array.isArray(req.body.recipients) ? req.body.recipients : [];
        const recipientPool = unique((requestedRecipients.length ? requestedRecipients : fallbackRecipients).map(normalizeRecipient));

        if (!recipientPool.length) {
            return res.status(400).json({ error: 'No recipients available to pick a winner.' });
        }

        const winner = recipientPool[Math.floor(Math.random() * recipientPool.length)];
        const message = String(req.body.message || '').trim() || '🎉 Congratulations! You are today\'s winner. Please come by the Twilio booth to claim your prize.';

        const from = getOutboundWhatsappFrom();
        if (!from) {
            return res.status(400).json({ error: 'No outbound WhatsApp sender found. Set TWILIO_WHATSAPP_FROM in .env.' });
        }

        const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        await twilioClient.messages.create({
            from,
            to: winner,
            body: message
        });

        res.json({
            winner,
            maskedWinner: toMaskedPhone(winner),
            message: 'Winner selected and notified successfully.'
        });
    } catch (error) {
        console.error('Error picking winner:', error);
        res.status(500).json({ error: 'Failed to pick and notify winner' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stats', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'stats.html'));
});

const port = parseInt(process.env.PORT || '3001');
console.log('PORT RECEIVED', port)
app.listen(port, async () => {
    
    maskFileId = await createFile('input/mask.png');
    console.log('maskFileId', maskFileId);

    console.log(`Server running on port ${port}`);
});