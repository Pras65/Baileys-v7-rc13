require('dotenv').config()
const mongoose = require('mongoose')
const RdModel = require('./models/RdModel')

async function setupCredential() {
    try {
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI
        if (!mongoUri) {
            console.error("[Error] URI MongoDB tidak ditemukan di file .env!")
            process.exit(1)
        }

        console.log("[Setup] Menghubungkan ke MongoDB...")
        await mongoose.connect(mongoUri)
        console.log("[Setup] Berhasil terhubung ke MongoDB!")

        const credentials = [
            { key: 'IMAGEKIT_PRIVAT_KEY', value: 'private_IHDLv3xzmw00visZZizzyZHuo+M=' },
            { key: 'IMAGEKIT_PUBLIC_KEY', value: 'public_vuOV2FYcFdgsCdHDSCteacPIOEk=' }
        ]

        for (const item of credentials) {
            await RdModel.findOneAndUpdate(
                { key: item.key },
                { value: item.value },
                { upsert: true, new: true }
            )
            console.log(`[Setup] Berhasil menyimpan: ${item.key}`)
        }

        console.log("\n[Sukses] Semua kredensial berhasil disimpan ke database!")
        process.exit(0)
    } catch (err) {
        console.error("[Setup] Gagal menyimpan:", err.message)
        process.exit(1)
    }
}

setupCredential()
