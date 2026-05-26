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
app.use(express.static('output', {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
    }
}));
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
const { toFile } = require('openai/uploads');
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

            const PROMPT = `'add your prompt here'`;
         
            if (!fs.existsSync('output')) {
                fs.mkdirSync('output');
            }

            const normalizedContentType = String(base64Image.contentType || '').split(';')[0].trim().toLowerCase() === 'image/jpg'
                ? 'image/jpeg'
                : String(base64Image.contentType || '').split(';')[0].trim().toLowerCase();

            const supportedContentTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
            if (!supportedContentTypes.has(normalizedContentType)) {
                throw new Error(`Unsupported inbound media type from Twilio: ${base64Image.contentType}`);
            }

            const extensionByMimeType = {
                'image/jpeg': 'jpg',
                'image/png': 'png',
                'image/webp': 'webp'
            };

            const sourceImageFile = await toFile(
                Buffer.from(base64Image.base64, 'base64'),
                `${messageSid}_source.${extensionByMimeType[normalizedContentType]}`,
                { type: normalizedContentType }
            );

            const response = await withTimeout(
                openai.images.edit({
                    model: 'gpt-image-1.5',
                    prompt: PROMPT,
                    image: sourceImageFile,
                    size: '1024x1536'
                }),
                180000,
                'OpenAI image generation'
            );

            const firstImage = Array.isArray(response?.data) ? response.data[0] : null;

            if (firstImage?.b64_json) {
                const imageBase64 = firstImage.b64_json;
                // Create output folder if it doesn't exist
                if (!fs.existsSync('output')) {
                fs.mkdirSync('output');
                }
                
                // Save the generated image first
                const generatedImagePath = `output/${messageSid}.png`;
                fs.writeFileSync(generatedImagePath, Buffer.from(imageBase64, "base64"));
                
                // Apply mask to the generated image
                const maskPath = 'input/mask.png';
                const finalImagePath = `output/${messageSid}_twilio.png`;
                
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
                body: `[add body message here.`,
                mediaUrl: `https://${req.headers['x-forwarded-host']}/${messageSid}_twilio.png`
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
                console.log(response);
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
                body: `We're really sorry, there was an error processing your image. Please resend the image, and we'll try again. Find Mish if you're having issues, and she'll try to help.`
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
