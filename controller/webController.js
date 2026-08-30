const RoleModel = require('../models/RoleModel');
const mongoose = require('mongoose');
const { generateWAMessageFromContent, proto } = require('baileys');
const { sendButtons } = require('@ryuu-reinzz/button-helper');

// Memory Storage OTP
const otpStore = new Map();

async function handleSendOTP(req, res, sock, isConnected) {
    try {
        let { phone } = req.body;
        if (!phone) return res.status(400).json({ status: false, message: 'Nomor WhatsApp wajib diisi!' });

        if (!isConnected || !sock) {
            return res.status(503).json({ status: false, message: 'Bot WA sedang offline! QR belum di-scan.' });
        }

        // Clean & Format Nomor ke JID
        phone = phone.replace(/[^0-9]/g, '');
        if (phone.startsWith('0')) phone = '62' + phone.slice(1);
        const targetJid = `${phone}@s.whatsapp.net`;

        // Validasi Role Master di Mongo DB
        const isMaster = await RoleModel.findOne({ jid: targetJid, role: 'master' });
        if (!isMaster) {
            return res.status(403).json({ status: false, message: 'Akses Ditolak! Nomor ini tidak terdaftar sebagai Role Master.' });
        }

        // Generate 6 Digit OTP & Simpan (Expired 5 Menit)
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStore.set(phone, { otp, expires: Date.now() + 5 * 60 * 1000 });

        // Kirim OTP via Interactive Button cta_copy
        await sendButtons(sock, targetJid, {
            title: '[ *VERIFIKASI OTP* ]',
            text: `Kode OTP Panel Anda adalah: *${otp}*\n\n_Jangan berikan kode ini kepada siapapun. Kode berlaku selama 5 menit._`,
            footer: 'Nayozu',
            buttons: [
                {
                    name: 'cta_copy',
                    buttonParamsJson: JSON.stringify({
                        display_text: 'Salin Kode OTP',
                        id: 'copy_otp',
                        copy_code: otp
                    })
                }
            ]
        }, { generateWAMessageFromContent, proto });

        res.json({ status: true, message: 'Kode OTP telah dikirimkan ke WhatsApp Master!' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
}

async function handleVerifyOTP(req, res) {
    let { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ status: false, message: 'Nomor dan OTP wajib diisi!' });

    phone = phone.replace(/[^0-9]/g, '');
    if (phone.startsWith('0')) phone = '62' + phone.slice(1);

    const otpData = otpStore.get(phone);
    if (!otpData) return res.status(400).json({ status: false, message: 'OTP tidak ditemukan atau telah kadaluarsa.' });

    if (Date.now() > otpData.expires) {
        otpStore.delete(phone);
        return res.status(400).json({ status: false, message: 'OTP telah kadaluarsa!' });
    }

    if (otpData.otp !== otp) {
        return res.status(400).json({ status: false, message: 'Kode OTP salah!' });
    }

    otpStore.delete(phone);
    req.session.isMaster = true;
    req.session.userPhone = phone;

    res.json({ status: true, message: 'Autentikasi Master Berhasil!' });
}

function handleLogout(req, res) {
    req.session.destroy();
    res.json({ status: true, message: 'Logout berhasil' });
}

async function getDashboardStats(req, res, isConnected, sessionName) {
    try {
        const totalRoles = await RoleModel.countDocuments();
        const totalMasters = await RoleModel.countDocuments({ role: 'master' });
        const SessionModel = mongoose.models.Session;
        const totalSessionKeys = SessionModel ? await SessionModel.countDocuments({ _id: new RegExp(`^${sessionName}_`) }) : 0;

        res.json({
            status: true,
            data: {
                botConnected: isConnected,
                sessionName: sessionName,
                uptime: process.uptime(),
                totalRoles,
                totalMasters,
                totalSessionKeys,
                dbStatus: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
            }
        });
    } catch (err) {
        res.status(500).json({ status: false, message: err.message });
    }
}

async function getRolesList(req, res) {
    try {
        const roles = await RoleModel.find().sort({ addedAt: -1 });
        res.json({ status: true, data: roles });
    } catch (err) {
        res.status(500).json({ status: false, message: err.message });
    }
}

async function addRole(req, res) {
    try {
        let { phone, role } = req.body;
        if (!phone || !role) return res.status(400).json({ status: false, message: 'Nomor HP & Role wajib diisi!' });

        phone = phone.replace(/[^0-9]/g, '');
        if (phone.startsWith('0')) phone = '62' + phone.slice(1);
        const jid = `${phone}@s.whatsapp.net`;

        const newRole = await RoleModel.create({
            jid,
            role,
            addedBy: req.session.userPhone || 'web-panel',
            addedAt: new Date()
        });

        res.json({ status: true, message: 'Role berhasil ditambahkan!', data: newRole });
    } catch (err) {
        res.status(500).json({ status: false, message: err.message });
    }
}

async function deleteRole(req, res) {
    try {
        const { id } = req.params;
        await RoleModel.findByIdAndDelete(id);
        res.json({ status: true, message: 'Role berhasil dihapus!' });
    } catch (err) {
        res.status(500).json({ status: false, message: err.message });
    }
}

module.exports = {
    handleSendOTP,
    handleVerifyOTP,
    handleLogout,
    getDashboardStats,
    getRolesList,
    addRole,
    deleteRole
};
