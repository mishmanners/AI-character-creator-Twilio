require('dotenv').config();

const express = require('express');
const app = new express();
const fs = require('fs');
const path = require('path');

const { upsertJob } = require('./jobStorage');
const dashboardRouter = require('./dashboard');

// Ignore favicon.ico requests to prevent 404 errors
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

app.use(express.static('public'));
app.use(express.static('output'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Mount dashboard routes
app.use(dashboardRouter);

let maskFileId = null;

const twilio = require('twilio');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
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

            // Create input_images folder if it doesn't exist
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
                body: `Your new image is ready. Enjoy 🥳. Feel free to share on socials.`,
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = parseInt(process.env.PORT || '3001');
console.log('PORT RECEIVED', port)
app.listen(port, async () => {
    
    maskFileId = await createFile('input/mask.png');
    console.log('maskFileId', maskFileId);

    console.log(`Server running on port ${port}`);
});
