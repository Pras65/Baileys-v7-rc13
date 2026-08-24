// file: ./imagekitUploader.js
const ImageKit = require("imagekit");
const RdModel = require('../models/RdModel'); 

async function uploadToImageKit(buffer, fileName) {
    // 1. Ambil Kunci Privat dari Database MongoDB Anda
    const keyDoc = await RdModel.findOne({ key: 'IMAGEKIT_PRIVAT_KEY' });
    if (!keyDoc || !keyDoc.value) {
        throw new Error("IMAGEKIT_PRIVAT_KEY belum terdaftar di database.");
    }
    const privateKey = keyDoc.value;

    // 2. Inisialisasi SDK Resmi (Aman dari filter CSRF Cloudflare)
    const imagekit = new ImageKit({
        publicKey: "public_bukan_masalah_kosongkan_saja", // Diisi bebas karena proses autentikasi utama menggunakan privateKey
        privateKey: privateKey,
        urlEndpoint: "https://imagekit.io" 
    });

    try {
        // 3. SOLUSI FIX 400: Kirim 'buffer' biner asli langsung ke SDK ImageKit
        // SDK resmi ImageKit secara internal akan otomatis menyusun dan mengunggah buffer Node.js dengan benar
        const response = await imagekit.upload({
            file: buffer, 
            fileName: fileName,
            useUniqueFileName: true,
            folder: '/whatsapp_bot_media/'
        });

        if (!response || !response.url) {
            throw new Error("Gagal mendapatkan URL dari respons ImageKit.");
        }

        return {
            url: response.url,
            size: (buffer.length / 1024 / 1024).toFixed(2),
            filename: fileName
        };
    } catch (error) {
        console.error("=== DETAIL ERROR SDK IMAGEKIT ===");
        console.error(error);
        console.error("=================================");
        throw new Error(`SDK ImageKit Error: ${error.message || JSON.stringify(error)}`);
    }
}

module.exports = { uploadToImageKit };
