const mongoose = require('mongoose');

const MenuSchema = new mongoose.Schema({
    command: { type: String, required: true, unique: true }, // Contoh: 'dl', 'joinorg'
    isActive: { type: Boolean, default: true },
    disabledReason: { type: String, default: 'Menu sedang dalam perbaikan atau tahap pengujian.' },
    updatedAt: { type: Date, default: Date.now },
    updatedBy: { type: String } // JID Master yang mengubah status
});

module.exports = mongoose.model('MenuConfig', MenuSchema);
