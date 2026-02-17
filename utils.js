const fs = require('fs');

exports.downloadTwilioMedia = async (mediaUrl) => {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
    const axios = require('axios');

    return await axios
        .get(mediaUrl, {
            responseType: 'arraybuffer',
            auth: {
                username: TWILIO_ACCOUNT_SID,
                password: TWILIO_AUTH_TOKEN
            }
        })
        .then(response => {
            const result = {
                contentType: response.headers['content-type'],
                base64: Buffer.from(response.data, 'binary').toString('base64')
            }
            return result;
        }).catch(e => {
            console.error('ERROR!', e);
            return null;
        });
}

exports.encodeImage = async (filePath) => {
    const base64Image = fs.readFileSync(filePath, "base64");
    return base64Image;
  }