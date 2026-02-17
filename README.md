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

   (Clone the repo and make a new one for each event)

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
   ```

4. **Prepare the mask image**
   
   Make sure you have a `mask.png` file in the `input/` directory. This image is used as a background/mask for the anime transformation.

5. **Start the server**
   ```bash
   # Development mode with auto-reload
   npm run dev
   
   # Or standard mode
   node server.js
   ```

## ⚙️ Configuration

### Twilio Setup

1. Create a Twilio account and get your Account SID and Auth Token
2. Set up WhatsApp sandbox in the Twilio Console
3. Configure your webhook URL to point to `https://your-domain.com/message` and make sure the HTTP method is POST

### OpenAI Setup

1. Get an OpenAI API key from the OpenAI platform
2. Ensure your account has access to GPT-4o-mini and image generation capabilities

## 📱 Usage

1. **Start a conversation** with your configured WhatsApp number
2. **Send a selfie** - The bot will respond that your image is being processed
3. **Wait for processing** - The AI will transform your photo into an anime-style cartoon
4. **Receive the result** - The bot will send back your transformed image

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

Made with ❤️ using Twilio, OpenAI, and Node.js