const { generateWAMessageFromContent, proto } = require('baileys');
const MenuModel = require('../models/MenuModel');
const RdModel = require ('../models/RdModel');
const { sendButtons } = require('@ryuu-reinzz/button-helper');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { uploadToImageKit } = require('./imagekitUploader'); 
const { createBlackWhiteText } = require('./textMaker');

const util = require('util');
const axios = require('axios');
const FormData = require('form-data');
const { downloadVideo, deleteFile, getInfo } = require('./ytdlp.js');
const fs = require('fs');
const PREFIX = '.'; 

// Metadata menu umum grup Anda
const MENU_ITEMS = [
    { command: 'dl', description: 'Download video/audio dari platform', category: 'Utility' },
    { command: 'sticker', description: 'Ubah gambar/video menjadi stiker', category: 'Media' },
    { command: 'tourl', description: 'Ubah file/media menjadi link URL', category: 'Utility' },
    { command: 'hd', description: 'Tingkatkan kualitas resolusi gambar', category: 'Media' },
    { command: 'creimg', description: 'Generate gambar menggunakan AI', category: 'AI' },
    { command: 'sewa', description: 'Informasi harga sewa bot untuk grup', category: 'Sewa & Join' },
    { command: 'joinorg', description: 'Kirim undangan grup agar bot bergabung', category: 'Sewa & Join' }
];



 
async function menuController(sock, m, { jid, sender, body, isMaster }) {
    // 1. PARSING DATA REALTIME (Mengekstrak Command dan Args)
    const textStr = body.trim();
    if (!textStr.startsWith(PREFIX)) return false; // Abaikan jika tidak diawali titik "."

    const parts = textStr.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase(); // Mengambil nama command murni (misal: "dl", "menu")
    const args = parts.slice(1); // Mengambil sisa argumen teks

    // === 2. PENCEGAT DATABASE REALTIME ===
    // Memeriksa apakah menu utama atau sub-menu yang diketik sedang dinonaktifkan
    if (cmd === "menu" || cmd === "m" || MENU_ITEMS.some(item => item.command === cmd)) {
        try {
            const menuConfig = await MenuModel.findOne({ command: cmd });
            
            // HAK ISTIMEWA: Jika status off (isActive: false) DAN yang akses BUKAN Master -> Blokir!
            // (Artinya Master tetap bisa pakai fitur yang mati untuk keperluan testing)
            if (menuConfig && !menuConfig.isActive && !isMaster) {
                await sock.sendMessage(jid, { 
                    text: ` [ *Menu nonaktif* ]\n\nMaaf, perintah \`${PREFIX}${cmd}\` saat ini sedang dinonaktifkan.\n\n *Reason :* ${menuConfig.disabledReason}` 
                }, { quoted: m });
                return true; // Menghentikan eksekusi (Blokir)
            }
        } catch (err) {
            console.error("Gagal cek realtime database:", err);
        }
    }

    // === 3. LOGIKA TAMPILAN UTAMA LIST MENU (.menu ATAU .m) ===
    if (cmd === "menu" || cmd === "m") {
        try {
            // Tarik seluruh data konfigurasi secara realtime dari DB untuk mendeteksi menu yang nonaktif
            const dbConfigs = await MenuModel.find({});
            const disabledMap = new Map(dbConfigs.map(c => [c.command, c.isActive]));

            // Mengelompokkan menu berdasarkan Kategori
            const categorizedMenu = {};
            MENU_ITEMS.forEach(item => {
                if (!categorizedMenu[item.category]) categorizedMenu[item.category] = [];
                categorizedMenu[item.category].push(item);
            });

            // Menyusun UI Teks Elegant Minimalist
            let menuMessage = `❖ ─── ⌈ *Nayozu bot* ⌋ ─── ❖\n\n`;
            menuMessage += `Halo, @${sender.split('@')[0]}! \nBerikut daftar fitur yang tampil:\n\n`;

            for (const category in categorizedMenu) {
                menuMessage += `┌ ◦ *${category.toUpperCase()}*\n`;
                
                categorizedMenu[category].forEach((item, index, array) => {
                    const isItemActive = disabledMap.get(item.command) !== false; // Default true jika tidak ada di DB
                    const isLast = index === array.length - 1; // Deteksi apakah ini menu terakhir di kategori tersebut
                    
                    // Format Garis Penghubung Siku
                    const linePrefix = isLast ? '└' : '│';
                    const itemSymbol = isLast ? '➭' : '├';
                    const descPrefix = isLast ? ' ' : '│'; // Ruang kosong jika di akhir, garis vertikal jika belum akhir

                    if (isItemActive) {
                        menuMessage += `${linePrefix} ${itemSymbol} \`${PREFIX}${item.command}\`\n`;
                        menuMessage += `${descPrefix}    _└ ${item.description}_\n`;
                    } else {
                        // Tampilan coret jika dinonaktifkan secara global di DB
                        menuMessage += `${linePrefix} ${itemSymbol} ~${PREFIX}${item.command}~ _(Off)_\n`;
                        menuMessage += `${descPrefix}    _└ ${item.description}_\n`;
                    }
                });
                menuMessage += '\n'; // Jarak antar kategori
            }

            // Kirim pesan dengan parameter 'mentions' agar nomor user berubah jadi tag biru yang bisa diklik
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

    // === 4. LOGIKA INTEGRASI SUB-MENU (.dl, .sticker, DLL) ===
    const matchedMenu = MENU_ITEMS.find(item => item.command === cmd);
    if (matchedMenu) {
        // Pengecekan DB dilewati karena sudah divalidasi di Langkah 2 tadi.
        switch (cmd) {
        case "dl": {
            const url = args[0]
            if (!url) {
                return sock.sendMessage(jid, { text: "Contoh : .dl <link youtube/tiktok/ig/fb>" }, { quoted: m });
            }
            if (!/facebook|tiktok|instagram|youtube|youtu\.be/.test(url.toLowerCase())) {
                return sock.sendMessage(jid, { text: "Link tidak didukung." }, { quoted: m });
            }

            await sock.sendMessage(jid, { text: "Prosess download, estimasi 1-5 menit...." }, { quoted: m });

            try {
                const data = await downloadVideo(url) // Memanggil fungsi Murni Javascript API
                
                const footerText = `> Downloaded by nayozu bot`
                
                // Caption digabung langsung dengan footer di baris paling akhir
                const caption = `🎬 *${data.title}*\n\n` +
                    `[ *Uploader* ] : ${data.uploader}\n`+
                    `[ *Durasi* ] : ${data.duration}\n` +
                    `[ *Resolusi* ] : ${data.resolution}\n` +
                    `[ *Size* ] : ${data.size}\n` +
                    `━━━━━━━━━━━━━━━\n` +
                    `${footerText}` 

                // PENGIRIMAN RAM-FRIENDLY (ANTI OOM/CRASH)
                await sock.sendMessage(jid, {
                    video: { url: data.path }, 
                    caption: caption, // Cukup panggil caption saja, otomatis footernya ikut di bawah
                    mimetype: 'video/mp4'
                }, { quoted: m })

                deleteFile(data.path) // hapus file tmp biar gak numpuk memori internal

            } catch(e) {
                console.log("Error :", e.message)
                return sock.sendMessage(jid, { text: `❌ [ Gagal download ]\nError: ${e.message}` }, { quoted: m });
            }
            break;
        }

case 's':
case 'sticker': {
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

        // Validasi: Pastikan berupa Gambar
        const isImage = !!cleanMsg.imageMessage;
        if (!isImage) {
            return sock.sendMessage(m.key.remoteJid, { 
                text: ' Kirim atau reply gambar dengan caption *.sticker*' 
            }, { quoted: m });
        }

        await sock.sendMessage(m.key.remoteJid, { text: '⏳ Diprosess...' }, { quoted: m });

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

        // 1. Download dari WA
        const mediaBuffer = await downloadMediaMessage(targetMessageObj, 'buffer', {});
        if (!mediaBuffer) throw new Error("Gagal mengunduh media dari whatsapp.");

        // 2. Upload ke ImageKit (Cepat karena ini cloud)
        const fileName = `stk_${Date.now()}.jpg`;
        const uploadRes = await uploadToImageKit(mediaBuffer, fileName);

        // 3. PERBAIKAN: Gunakan parameter "?tr=" di akhir URL. (Pasti jalan walau folder beda)
        const transformedStickerUrl = uploadRes.url + "?tr=w-512,h-512,fo-auto,f-webp";

        // 4. PERBAIKAN: Panggil axios secara langsung di sini
        const axios = require('axios');
        const webpResponse = await axios.get(transformedStickerUrl, { responseType: 'arraybuffer' });
        const stickerBuffer = Buffer.from(webpResponse.data);

        // 5. Kirim Stiker Kotak Sempurna ke WA
        await sock.sendMessage(m.key.remoteJid, { sticker: stickerBuffer }, { quoted: m });

    } catch (error) {
        const fs = require('fs');
        const util = require('util');
        const errorLog = `[${new Date().toLocaleString('id-ID')}] Error pada .s:\n` + util.inspect(error, { depth: null });
        fs.writeFileSync('r.txt', errorLog, 'utf8');

        console.log(`[!] Error terjadi pada .s, log: r.txt`);

        await sock.sendMessage(m.key.remoteJid, { 
            text: ` Gagal membuat stiker, Coba gunakan gambar lain.` 
        }, { quoted: m });
    }
    break;
}


case 'tourl': {
    try {
        // --- LOGIKA BONGKAR PESAN WHATSAPP ---
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

        // Ekstrak contextInfo secara dinamis (Tahan banting baik itu teks, gambar, atau stiker)
        const msgTypeReal = Object.keys(realMsg)[0];
        const contextInfo = realMsg[msgTypeReal]?.contextInfo;

        // Cek target pesan (apakah ada quotedMessage atau tidak)
        const isQuoted = !!contextInfo?.quotedMessage;
        const rawTargetMsg = isQuoted ? contextInfo.quotedMessage : realMsg;
        
        // Unwrap lagi siapa tahu media yang direply adalah View Once
        const cleanMsg = unwrap(rawTargetMsg);
        if (!cleanMsg) return;

        // Validasi tipe media
        const validMediaTypes = ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'stickerMessage', 'ptvMessage'];
        const msgType = Object.keys(cleanMsg).find(key => validMediaTypes.includes(key));

        if (!msgType) {
            return sock.sendMessage(m.key.remoteJid, { 
                text: 'Kirim media dengan caption *.tourl*, atau reply media dengan pesan *.tourl*' 
            }, { quoted: m });
        }

        await sock.sendMessage(m.key.remoteJid, { text: '⏳ Memprosess...' }, { quoted: m });

        // --- LOGIKA DOWNLOAD MEDIA AMAN ---
        // Menggunakan optional chaining (?.) agar terhindar dari error null reference
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
        if (!buffer) throw new Error("Gagal mengunduh media dari anda.");

        // --- PENYIAPAN NAMA FILE & LEMPAR KE API ---
        const mime = cleanMsg[msgType]?.mimetype || 'application/octet-stream';
        let ext = mime.split('/')[1]?.split(';')[0] || 'bin';
        if (msgType === 'stickerMessage') ext = 'webp';
        
        const fileName = `media_${Date.now()}.${ext}`;

        // Lempar buffer dan filename murni ke file fungsi terpisah
        const result = await uploadToImageKit(buffer, fileName);

        // --- HASIL ---
        await sock.sendMessage(m.key.remoteJid, { 
            text: ` *[ Berhasil diunggah! ]*\n\n *URL:* ${result.url}\n *Size :* ${result.size} MB` 
        }, { quoted: m });

    } catch (error) {
        const errorLog = `[${new Date().toLocaleString('id-ID')}] Error pada .tourl:\n` + util.inspect(error, { depth: null });
        fs.writeFileSync('r.txt', errorLog, 'utf8');

        console.log(`[!] Error terjadi pada fitur, Laporkan error tersebut ke moderator nayozu.`);

        await sock.sendMessage(m.key.remoteJid, { 
            text: `[ *Gagal mengunggah!* ]\n[!] Error terjadi pada fitur, Laporkan error tersebut ke moderator nayozu.` 
        }, { quoted: m });
    }
    break;
}

case 'brat': {
    const rawText = m.message?.conversation || m.message?.extendedTextMessage?.text || "";
    const textQuery = rawText.split(' ').slice(1).join(' ');

    if (!textQuery) {
        return sock.sendMessage(m.key.remoteJid, { 
            text: ' Teksnya mana?\n*Contoh :* .brat Hari ini capek banget' 
        }, { quoted: m });
    }

    try {
        
        // 1. Gambar teks jadi PNG lokal pakai Jimp (Cepat & Tanpa Python)
        // Pastikan path ke textMaker sudah benar
        const { createBlackWhiteText } = require('../lib/textMaker'); 
        const imageBuffer = await createBlackWhiteText(textQuery);

        // 2. Lemparkan PNG ke ImageKit (Ini pengganti fungsi FFmpeg!)
        // Pastikan path ke uploader ImageKit kamu sudah benar
        const { uploadToImageKit } = require('./imagekitUploader'); 
        const fileName = `txt_${Date.now()}.png`;
        const uploadRes = await uploadToImageKit(imageBuffer, fileName);

        // 3. Sulap URL jadi bentuk Stiker (WebP 512x512)
        const transformedStickerUrl = uploadRes.url + "?tr=w-512,h-512,f-webp";

        // 4. Download hasil WebP dari ImageKit
        const axios = require('axios');
        const webpResponse = await axios.get(transformedStickerUrl, { responseType: 'arraybuffer' });
        const stickerBuffer = Buffer.from(webpResponse.data);

        // 5. Kirim stiker teks elegan ke user!
        await sock.sendMessage(m.key.remoteJid, { sticker: stickerBuffer }, { quoted: m });

    } catch (error) {
        const fs = require('fs');
        const util = require('util');
        const errorLog = `[${new Date().toLocaleString('id-ID')}] Error pada .steks:\n` + util.inspect(error, { depth: null });
        fs.writeFileSync('r.txt', errorLog, 'utf8');

        console.log(`[!] Error terjadi pada pembuat stiker teks. Cek r.txt`);
        await sock.sendMessage(m.key.remoteJid, { 
            text: `Gagal membuat stiker brat, Terjadi kesalahan sistem.` 
        }, { quoted: m });
    }
    break;
}



            case 'hd':
                break;
            case 'creimg':
                break;
                   case 'sewa':
    await sendButtons(sock, jid, {
                title: '*[ Sewa bot nayozu ]*',
                text: 'Dapatkan diskon jika tersedia.',
                footer: 'Nayozu moderator',
                buttons: [
                    { 
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: 'Chat moderators',
                            url: 'https://wa.me/6285764554290', // nomor langsung
                            merchant_url: 'https://wa.me/6285764554290' // wajib 2
                        })
                    }
                ]
            }, { // <- INI OPTIONS KE 4
                generateWAMessageFromContent, // suntik
                proto, // suntik
                quoted: m
            });
            break;
       case 'joinorg':
                break;
        }
        return true; // Menandakan command berhasil ditangani sepenuhnya oleh menuController
    }

    return false; // Mengembalikan false agar dilempar estafet ke groupController (di index.js)
}

module.exports = { menuController };