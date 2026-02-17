# 🎨 Twilio WhatsApp Cartoon Generator

A WhatsApp bot that transforms user selfies into cartoon, using whatever style you specify. This is using Twilio, OpenAI's model, image generation capabilities, and the Sharp library.

## ✨ Features

- 📱 **WhatsApp Integration**: Receive and respond to messages via Twilio
- 🤖 **AI-Powered Image Generation**: Uses OpenAI's GPT-4o-mini with image generation tools
- 🎭 **Cartoon Style Transformation**: Converts user photos into anime-style images
- 🖼️ **Automatic Processing**: Processes images in the background and sends results back
- 📁 **File Management**: Automatically organises generated images

## 🛠️ Tech Stack

- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **Twilio** - WhatsApp messaging API
- **OpenAI** - AI image generation and processing
- **Sharp** - High-performance image processing library
- **Axios** - HTTP client for media downloads
- **dotenv** - Environment variable management

## 📋 Prerequisites

Before running this application, make sure you have:

- Node.js (v14 or higher)
- A Twilio account with WhatsApp sandbox configured (or WhatsApp messaging)
- An OpenAI API key with access to GPT-4o-mini and image generation
- A public URL for webhooks (ngrok, Heroku, etc.)

## 🚀 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd <new-location>
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env` file in the root directory with the following variables:
   ```env
   TWILIO_ACCOUNT_SID=your_twilio_account_sid
   TWILIO_AUTH_TOKEN=your_twilio_auth_token
   OPENAI_API_KEY=your_openai_api_key

   (you can use the '.env.example` file to get you started).
   ```

4. **Prepare the mask image**
   
   Make sure you have a `mask.png` file in the `input/` directory. This image is used as an overlay for the final cartoon image that is created. There is already the file in the directory with the correct dimensions. Ensure this is saved as *.png and is a mostly transparent image.

   Example mask:


   Example of final output:





5. **Start the server**
   ```bash
   # Development mode with auto-reload
   npm run dev
   
   # Or standard mode
   node server.js
   ```

## ⚙️ Configuration

### Twilio Setup

1. Create a [Twilio account](https://twil.io/signup)
2. Find your Account SID and Auth Token on your Dashboard
3. Set up [WhatsApp sandbox in the Twilio Console](https://www.twilio.com/docs/whatsapp/sandbox)
4. Configure your webhook URL to point to `https://your-domain.com/message` and make sure the HTTP method is POST




### OpenAI Setup

1. Create an OpenAI account
2. Create an OpenAI API key from the Dashboard
3. Ensure your account has access to GPT-4o-mini and image generation capabilities

## 📱 Usage

1. **Start a conversation** with your configured WhatsApp number (you can send any message such as "Hi")
2. **Chatbot responds** with a message telling you to send a selfie or photo
3. **Send a selfie** by taking a photo with the camera or uploading any image that's on your device
4. **Chatbo responds** that your image is being processed
3. **Wait for processing** as OpenAI and Sharp transform your photos into a cartoon with an overlay
4. **Receive the image** and download it, upload, share, and enjoy

NOTE: the user should receive an error if the image can't be processed, for example if OpenAI tries to create a square image (even with all the guardrails to generate portrait, this can still happen). If this is the case, send the image again and it should work. Users will also receive the error message if they have sent an image containing highly copywritten material, such as Pikachu or Chewbacca. In these cases, OpenAI has deemed the image (even if you are just wearing a tshirt with a Squirtle on it) "inappropriate" and you won't receive an image back.

NOTE: if you want to save the incoming images (for example if you are using this for a family holiday or day out with friends), you might like to have all the images in one place. In this case, uncomment lines 60-69 in `server.js`. Please consider privacy concerns before using this feature and only do so for friends and family who have given their consent. 

### Configure the bot

You can configure the messaging and image styling in the `server.js` file:

- **Change the style of image generated**: you can specify the type of image you'd like in the `PROMPT` which can be found on line 71
- **Change the initial message received**: you can alter the initial message that users will see from the chatbot by changing the `message` on line 143
- **Change the final message received**: you can alter the final message that comes through with the generated image by changing the `body` on line 124
- **Change the error message received**: you can alter the error message that comes through in the case of an error by OpenAI by changing the `body` on line 138

## 📁 Project Structure

```
twilio_whatsapp_cartoongenerator/
├── input/
│   └── mask.png          # Background mask for anime transformation
├── output/               # Generated cartoon images (auto-created)
├── server.js             # Main application server
├── utils.js              # Utility functions for media handling
├── package.json          # Dependencies and scripts
├── .env                  # Environment variables (create this)
└── README.md             # This file
```

## 🔧 API Endpoints

- `POST /message` - Webhook endpoint for Twilio WhatsApp messages
- `GET /` - Health check endpoint
- `GET /{messageId}.png` - Serves generated cartoon images

## 🎯 How It Works

1. **Message Reception**: Twilio webhook receives WhatsApp messages
2. **Image Processing**: If an image is received, it's downloaded and processed
3. **AI Transformation**: OpenAI GPT-4o-mini generates an anime-style version using the mask image
4. **Image Composition**: Sharp applies the mask overlay to create the final image
5. **Response**: The generated cartoon is saved and sent back via WhatsApp

## 🔒 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TWILIO_ACCOUNT_SID` | Your Twilio Account SID | ✅ |
| `TWILIO_AUTH_TOKEN` | Your Twilio Auth Token | ✅ |
| `OPENAI_API_KEY` | Your OpenAI API Key | ✅ |

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## ⚠️ Important Notes

- Ensure your server is publicly accessible for Twilio webhooks to work
- The `input/mask.png` file is crucial for the anime transformation process
- Generated images are stored in the `output/` directory
- Make sure you have sufficient OpenAI credits for image generation

## 📞 Support

If you encounter any issues or have questions, please open an issue in the repository.

---

Made with ❤️ using Twilio, OpenAI, and Node.js. Huge thanks to [Luís Leão](https://github.com/luisleao) who made the original code for this and created the initial idea.