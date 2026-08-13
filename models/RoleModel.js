const mongoose = require('mongoose')

const roleSchema = new mongoose.Schema({
    jid: { type: String, default: "" },       // Contoh: "628xxx@s.whatsapp.net"
    lid: { type: String, default: "" },       // Contoh: "260xxx@lid"
    role: { type: String, enum: ['master', 'mod', 'guest'], required: true },
    expiresAt: { type: Date, default: null }, // Kedaluwarsa (Khusus guest)
    addedBy: { type: String, default: 'system' },
    addedAt: { type: Date, default: Date.now }
}, { versionKey: false })

module.exports = mongoose.models.Role || mongoose.model('Role', roleSchema)
