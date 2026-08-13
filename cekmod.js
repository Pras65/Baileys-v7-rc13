require('dotenv').config()
const mongoose = require('mongoose')
const RoleModel = require('./models/RoleModel')

async function cekDataMod() {
    try {
        const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI
        
        if (!MONGO_URI) {
            console.error("❌ Error: MONGO_URI tidak ditemukan di file .env")
            return
        }

        console.log("Menghubungkan ke database...")
        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 15000
        })
        console.log(" Berhasil terhubung!")

        const mods = await RoleModel.find({ role: 'mod' }).lean()
        console.log("\n Daftar moderator di database:")
        console.log(JSON.stringify(mods, null, 2))

        await mongoose.disconnect()
    } catch (err) {
        console.error("❌ Error:", err.message)
    }
}

cekDataMod()
