require('dotenv').config();

const express = require('express');
const app = new express();

const fs = require('fs');

const path = require('path');

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

        twiml.message('Your image is being processed ⏳. We\'ll send your message when it\'s ready 🎉.');
        res.send(twiml.toString());
        try {
            const base64Image = await downloadTwilioMedia(req.body.MediaUrl0);

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

            const PROMPT = `CHANGE THIS TO YOUR PROMPT. You can be as creative as you like! For example, you could say "Turn this image into a Van Gogh painting" or "Make this look like a Pixar-style character". The more specific you are, the better the results will be.`;'`;

            const response = await openai.responses.create({
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
            });

            console.log('response', response);

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
                body: `Your new anime-style image is ready. Enjoy 🥳. Feel free to share on socials with the event tag: #DDDMelb.`,
                mediaUrl: `https://${req.headers['x-forwarded-host']}/${req.body.SmsMessageSid}_twilio.png`
                })

            } else {
                console.log(response.output.content);
                throw new Error('Image generation returned no image data.');
            }
        } catch (error) {
            console.error('Error processing image:', error);
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