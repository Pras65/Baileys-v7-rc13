const { generateWAMessageFromContent, proto } = require('baileys');
const MenuModel = require('../models/MenuModel');
const RdModel = require ('../models/RdModel');
const { sendButtons } = require('@ryuu-reinzz/button-helper');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { uploadToImageKit } = require('./imagekitUploader'); 
const { createBlackWhiteText } = require('./textMaker');
const { Sticker } = require('wa-sticker-formatter');
const util = require('util');
const axios = require('axios');
const FormData = require('form-data');
const { downloadVideo, deleteFile, getInfo } = require('./ytdlp.js');
const fs = require('fs');
const PREFIX = '.'; 

// Daftar command dasar (Tanpa deskripsi, bersih)
const MENU_ITEMS = [
    { command: 'dl'},
    { command: 'sticker'},
    { command: 'brat'},
    { command: 'tourl'},
    { command: 'hd' },
    { command: 'creimg'},
    { command: 'sewa'},
    { command: 'joinorg'}
];

async function menuController(sock, m, { jid, sender, body, isMaster }) {
    const textStr = body.trim();
    if (!textStr.startsWith(PREFIX)) return false; 

    const parts = textStr.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase(); 
    const args = parts.slice(1); 

    if (cmd === "menu" || cmd === "m" || MENU_ITEMS.some(item => item.command === cmd)) {
        try {
            const menuConfig = await MenuModel.findOne({ command: cmd });
            if (menuConfig && !menuConfig.isActive && !isMaster) {
                await sock.sendMessage(jid, { 
                    text: `Command ${PREFIX}${cmd} dinonaktifkan.` 
                }, { quoted: m });
                return true; 
            }
        } catch (err) {
            console.error("Gagal cek realtime database:", err);
        }
    }

    // === TAMPILAN MENU BERSIH & MINIMALIS (Tanpa Kategori, Emoji, & Tanpa Deskripsi) ===
    if (cmd === "menu" || cmd === "m") {
        try {
            const dbConfigs = await MenuModel.find({});
            const disabledMap = new Map(dbConfigs.map(c => [c.command, c.isActive]));

            let menuMessage = `[ Nayozu bot ]\n\n`;
            menuMessage += `User: @${sender.split('@')[0]}\n\n`;

            MENU_ITEMS.forEach((item) => {
                const isItemActive = disabledMap.get(item.command) !== false; 
                if (isItemActive) {
                    menuMessage += `> ${PREFIX}${item.command}\n`;
                }
            });

            await sock.sendMessage(jid, { 
                text: menuMessage.trim(), 
                mentions: [sender] 
            }, { quoted: m });
            
            return true;
        } catch (e) {
            console.error("Gagal memuat menu:", e);
            return false;
        }
    }

    // === EKSEKUSI SUB-MENU ===
    const matchedMenu = MENU_ITEMS.find(item => item.command === cmd);
    
    // Membuka akses untuk command utama dan aliasnya (s, brat, txt, steks)
    if (matchedMenu || ['s', 'sticker', 'brat', 'txt', 'steks'].includes(cmd)) {
        switch (cmd) {
        case "dl": {
            const url = args[0]
            if (!url) {
                return sock.sendMessage(jid, { text: "Format salah, Contoh : .dl <link>" }, { quoted: m });
            }
            if (!/facebook|tiktok|instagram|youtube|youtu\.be/.test(url.toLowerCase())) {
                return sock.sendMessage(jid, { text: "Link tidak didukung." }, { quoted: m });
            }

            await sock.sendMessage(jid, { text: "Diproses, Estimasi 1-5 menit..." }, { quoted: m });

            try {
                const data = await downloadVideo(url) 
                
                const caption = `[ Berhasil ]\n` +
                    `[ Title ] : ${data.title}\n\n`+
                    `[ Uploader ] : ${data.uploader}\n` +
                    `[ Durasi ] : ${data.duration}\n` +
                    `[ Resolusi ] : ${data.resolution}\n` +
                    `[ Size ] : ${data.size}` 

                await sock.sendMessage(jid, {
                    video: { url: data.path }, 
                    caption: caption,
                    mimetype: 'video/mp4'
                }, { quoted: m })

                deleteFile(data.path) 

            } catch(e) {
                console.log("Error :", e.message)
                return sock.sendMessage(jid, { text: `Gagal mengunduh : ${e.message}` }, { quoted: m });
            }
            break;
        }

        case 's':
        case 'sticker': {
            try {
                // --- 1. AMBIL TEKS / CAPTION UNTUK CUSTOM AUTHOR ---
                const rawText = m.message?.conversation || 
                                m.message?.imageMessage?.caption || 
                                m.message?.extendedTextMessage?.text || 
                                "";
                
                let customAuthor = 'Whatsapp'; // Default author

                // Jika di teks ada tanda '+', ambil kata setelahnya
                if (rawText.includes('+')) {
                    const parsedText = rawText.substring(rawText.indexOf('+') + 1).trim();
                    if (parsedText) {
                        customAuthor = parsedText; // Timpa default author dengan teks user
                    }
                }

                // --- 2. LOGIKA EKSTRAK PESAN MEDIA ---
                const unwrap = (msg) => {
                    if (!msg) return null;
                    if (msg.ephemeralMessage) return unwrap(msg.ephemeralMessage.message);
                    if (msg.viewOnceMessageV2) return unwrap(msg.viewOnceMessageV2.message);
                    if (msg.viewOnceMessageV2Extension) return unwrap(msg.viewOnceMessageV2Extension.message);
                    if (msg.viewOnceMessage) return unwrap(msg.viewOnceMessage.message);
                    if (msg.documentWithCaptionMessage) return unwrap(msg.documentWithCaptionMessage.message);
                    return msg;
                };

                const realMsg = unwrap(m.message);
                if (!realMsg) return;

                const msgTypeReal = Object.keys(realMsg)[0];
                const contextInfo = realMsg[msgTypeReal]?.contextInfo;
                const isQuoted = !!contextInfo?.quotedMessage;
                const rawTargetMsg = isQuoted ? contextInfo.quotedMessage : realMsg;
                const cleanMsg = unwrap(rawTargetMsg);

                if (!cleanMsg) return;

                const isImage = !!cleanMsg.imageMessage;
                if (!isImage) {
                    return sock.sendMessage(m.key.remoteJid, { 
                        text: 'Reply atau kirim gambar dengan caption .sticker' 
                    }, { quoted: m });
                }

                const targetMessageObj = isQuoted ? {
                    key: {
                        remoteJid: m.key.remoteJid,
                        id: contextInfo?.stanzaId || m.key.id,
                        participant: contextInfo?.participant || m.key.participant
                    },
                    message: cleanMsg
                } : {
                    key: m.key,
                    message: cleanMsg
                };

                const mediaBuffer = await downloadMediaMessage(targetMessageObj, 'buffer', {});
                if (!mediaBuffer) throw new Error("[ Gagal ]");

                // --- 3. PROSES PEMBUATAN STIKER LOKAL ---
                const { Sticker } = require('wa-sticker-formatter');
                const sticker = new Sticker(mediaBuffer, {
                    pack: '',
                    author: customAuthor, 
                    type: 'crop',
                    categories: ['☆'],
                    id: '12345',
                    quality: 50
                });

                const stickerBuffer = await sticker.toBuffer();

                await sock.sendMessage(m.key.remoteJid, { sticker: stickerBuffer }, { quoted: m });

            } catch (error) {
                const errorLog = `[${new Date().toLocaleString('id-ID')}] Error pada .s:\n` + util.inspect(error, { depth: null });
                fs.writeFileSync('r.txt', errorLog, 'utf8');
                await sock.sendMessage(m.key.remoteJid, { text: `Gagal membuat stiker.` }, { quoted: m });
            }
            break;
        }

        case 'tourl': {
            try {
                const unwrap = (msg) => {
                    if (!msg) return null;
                    if (msg.ephemeralMessage) return unwrap(msg.ephemeralMessage.message);
                    if (msg.viewOnceMessageV2) return unwrap(msg.viewOnceMessageV2.message);
                    if (msg.viewOnceMessageV2Extension) return unwrap(msg.viewOnceMessageV2Extension.message);
                    if (msg.viewOnceMessage) return unwrap(msg.viewOnceMessage.message);
                    if (msg.documentWithCaptionMessage) return unwrap(msg.documentWithCaptionMessage.message);
                    return msg;
                };

                const realMsg = unwrap(m.message);
                if (!realMsg) return;

                const msgTypeReal = Object.keys(realMsg)[0];
                const contextInfo = realMsg[msgTypeReal]?.contextInfo;
                const isQuoted = !!contextInfo?.quotedMessage;
                const rawTargetMsg = isQuoted ? contextInfo.quotedMessage : realMsg;
                const cleanMsg = unwrap(rawTargetMsg);
                if (!cleanMsg) return;

                const validMediaTypes = ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'stickerMessage', 'ptvMessage'];
                const msgType = Object.keys(cleanMsg).find(key => validMediaTypes.includes(key));

                if (!msgType) {
                    return sock.sendMessage(m.key.remoteJid, { text: 'Kirim atau reply media dengan .tourl' }, { quoted: m });
                }

                await sock.sendMessage(m.key.remoteJid, { text: 'Mengunggah...' }, { quoted: m });

                const targetMessageObj = isQuoted ? {
                    key: {
                        remoteJid: m.key.remoteJid,
                        id: contextInfo?.stanzaId || m.key.id,
                        participant: contextInfo?.participant || m.key.participant
                    },
                    message: cleanMsg
                } : {
                    key: m.key,
                    message: cleanMsg
                };

                const buffer = await downloadMediaMessage(targetMessageObj, 'buffer', {});
                if (!buffer) throw new Error("Gagal mengunduh media.");

                const mime = cleanMsg[msgType]?.mimetype || 'application/octet-stream';
                let ext = mime.split('/')[1]?.split(';')[0] || 'bin';
                if (msgType === 'stickerMessage') ext = 'webp';
                
                const fileName = `media_${Date.now()}.${ext}`;
                const result = await uploadToImageKit(buffer, fileName);

                await sock.sendMessage(m.key.remoteJid, { 
                    text: `URL: ${result.url}\nSize: ${result.size} MB` 
                }, { quoted: m });

            } catch (error) {
                const errorLog = `[${new Date().toLocaleString('id-ID')}] Error pada .tourl:\n` + util.inspect(error, { depth: null });
                fs.writeFileSync('r.txt', errorLog, 'utf8');
                await sock.sendMessage(m.key.remoteJid, { text: `Gagal mengunggah.` }, { quoted: m });
            }
            break;
        }

        case 'brat': {
            const rawText = m.message?.conversation || m.message?.extendedTextMessage?.text || "";
            const textQuery = rawText.split(' ').slice(1).join(' ');

            if (!textQuery) {
                return sock.sendMessage(m.key.remoteJid, { text: 'Masukkan teks, .brat Halo' }, { quoted: m });
            }

            // Validasi: Maksimal 18 karakter (Spasi tidak dihitung)
            const textWithoutSpaces = textQuery.replace(/\s/g, '');
            if (textWithoutSpaces.length > 18) {
                return sock.sendMessage(m.key.remoteJid, { text: 'Teks terlalu panjang, Maks 18 karakter (spasi tidak dihitung).' }, { quoted: m });
            }

            try {
                // 1. Buat gambar teks jadi buffer PNG pakai Jimp lokal
                const pngBuffer = await createBlackWhiteText(textQuery);

                // 2. Konversi buffer PNG ke WebP Stiker menggunakan wa-sticker-formatter
                // (Catatan: Pastikan require ini sudah ada di paling atas file menuController.js ya)
                const { Sticker } = require('wa-sticker-formatter'); 
                const sticker = new Sticker(pngBuffer, {
                    pack: 'Nayozu bot',
                    author: 'Whatsapp',
                    type: 'full', // atau 'crop'
                    categories: ['☆'],
                    id: '12345',
                    quality: 50
                });

                const stickerBuffer = await sticker.toBuffer();

                // 3. Kirim ke WhatsApp
                await sock.sendMessage(m.key.remoteJid, { sticker: stickerBuffer }, { quoted: m });

            } catch (error) {
                const errorLog = `[${new Date().toLocaleString('id-ID')}] Error pada .brat:\n` + util.inspect(error, { depth: null });
                fs.writeFileSync('r.txt', errorLog, 'utf8');
                await sock.sendMessage(m.key.remoteJid, { text: `Gagal membuat brat.` }, { quoted: m });
            }
            break;
        }




        case 'hd':
            break;
        case 'creimg':
            break;
            
        case 'sewa':
            await sendButtons(sock, jid, {
                title: '[ *Sewa bot* ]',
                text: 'Hubungi moderator untuk informasi lebih lanjut.',
                footer: 'Nayozu',
                buttons: [
                    { 
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: 'Chat Moderator',
                            url: 'https://wa.me/6285764554290',
                            merchant_url: 'https://wa.me/6285764554290'
                        })
                    }
                ]
            }, { 
                generateWAMessageFromContent, 
                proto, 
                quoted: m 
            });
            break;

        case 'joinorg':
            break;
        }
        return true; 
    }

    return false; 
}

module.exports = { menuController };
