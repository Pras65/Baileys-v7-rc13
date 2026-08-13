const mongoose = require('mongoose')

const groupSchema = new mongoose.Schema({
    _id: { type: String, required: true },       // Format: "sessionId_groupJid" (Contoh: "lokal_12345@g.us")
    sessionId: { type: String, required: true },   // "lokal" atau "server"
    jid: { type: String, required: true },         // "12345@g.us"
    subject: { type: String, default: "" },        // Nama Grup
    registered: { type: Boolean, default: false }, // Status apakah grup diizinkan pakai bot
    registeredBy: { type: String, default: "" },   // JID Master/Mod yang meregister
    admins: { type: Array, default: [] },          // Daftar JID admin grup yang disinkronkan
    settings: {
        antilink: { type: Boolean, default: false },
        antiapk: { type: Boolean, default: false }
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { versionKey: false })

module.exports = mongoose.models.Group || mongoose.model('Group', groupSchema)
