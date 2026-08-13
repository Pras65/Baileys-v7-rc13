const axios = require('axios');
const FormData = require('form-data'); 
const RdModel = require('../models/RdModel'); 
async function uploadToImageKit(buffer, fileName) {
    const keyDoc = await RdModel.findOne({ key: 'IMAGEKIT_PRIVAT_KEY' });
    if (!keyDoc || !keyDoc.value) {
        throw new Error("IMAGEKIT_PRIVAT_KEY belum terdaftar di database.");
    }
    const privateKey = keyDoc.value;

    // 2. Persiapan FormData murni
    const form = new FormData();
    form.append('file', buffer, { filename: fileName });
    form.append('fileName', fileName);
    form.append('useUniqueFileName', 'true');
    form.append('folder', '/whatsapp_bot_media/');

    // 3. Request ke API ImageKit
    const response = await axios.post('https://upload.imagekit.io/api/v1/files/upload', form, {
        headers: {
            ...form.getHeaders(),
            'Accept': 'application/json',
            'Authorization': `Basic ${Buffer.from(privateKey + ':').toString('base64')}`
        },
        timeout: 60000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    });

    if (!response.data || !response.data.url) {
        throw new Error("Gagal mendapatkan URL dari respons ImageKit.");
    }

    return {
        url: response.data.url,
        size: (buffer.length / 1024 / 1024).toFixed(2),
        filename: fileName
    };
}

module.exports = { uploadToImageKit };
