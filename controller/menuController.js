const { generateWAMessageFromContent, proto } = require('baileys');
const MenuModel = require('../models/MenuModel');
const { sendButtons } = require('@ryuu-reinzz/button-helper');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { uploadToImageKit } = require('./imagekitUploader'); 
const { downloadVideo, deleteFile } = require('./ytdlp.js');
const { generatePdfFromSource } = require('./pdfGenerator');
const Tesseract = require('tesseract.js');
const { translate } = require('google-translate-api-x');
const { convertVideoToAudio } = require('./audioHelper');
const { Sticker } = require('wa-sticker-formatter');
const { createBratSticker } = require('./bratHelper');
const { unwrapMessage, getText} = require('./utils');
const { createVideoSticker } = require('./ffmpeg'); 
const PREFIX = '.'; 

const MENU_ITEMS = [
    { command: 'tr'},
    { command: 'dl'},
    { command: 'sticker'},
    { command: 'brat'},
    { command: 'tourl'},
    { command: 'topdf'},
    { command: 'hd' },
    { command: 'gimg'},
    { command: 'aud'},
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
                await sock.sendMessage(jid, { text: `Command ${PREFIX}${cmd} dinonaktifkan.` }, { quoted: m });
                return true; 
            }
        } catch (err) {}
    }

    if (cmd === "menu" || cmd === "m") {
        try {
            const dbConfigs = await MenuModel.find({});
            const disabledMap = new Map(dbConfigs.map(c => [c.command, c.isActive]));

       let menuMessage = `╭───⟡ [ *Nayozu bot* ] ⟡───\n`;
            menuMessage += `│ *_Hai user_* @${sender.split('@')[0]}\n\n`;

            MENU_ITEMS.forEach((item) => {
                if (disabledMap.get(item.command) !== false) {
                   menuMessage += `├・ ${item.command}\n`;
                }
            });
            menuMessage += `╰────────────────⟡`;

            await sock.sendMessage(jid, { text: menuMessage, mentions: [sender] }, { quoted: m });
            return true;
        } catch (e) {
            return false;
        }
    }

    const matchedMenu = MENU_ITEMS.find(item => item.command === cmd);
    if (matchedMenu || ['s', 'sticker', 'brat', 'txt', 'steks'].includes(cmd)) {
        switch (cmd) {
            case 'tr':
            case 'translate': {
                // 1. Ekstrak argumen: .tr <kode_bahasa> <teks>
                const args = body.trim().split(/\s+/).slice(1);
                
                let targetLang = 'id'; // Default ke Indonesia
                let textToTranslate = '';

                // Cek apakah argumen pertama adalah kode bahasa (maksimal 3 huruf)
                if (args.length > 0 && args[0].length <= 3) {
                    targetLang = args[0].toLowerCase();
                    textToTranslate = args.slice(1).join(' '); // Ambil sisa teksnya
                } else {
                    textToTranslate = args.join(' ');
                }

                // 2. Unwrap pesan untuk mengecek apakah ada reply/quote
                const realMsg = unwrapMessage(m.message);
                if (!realMsg) return;
                
                const msgTypeReal = Object.keys(realMsg)[0];
                const contextInfo = realMsg[msgTypeReal]?.contextInfo;
                const isQuoted = !!contextInfo?.quotedMessage;
                const cleanMsg = unwrapMessage(isQuoted ? contextInfo.quotedMessage : realMsg);

                // 3. Deteksi apakah pesan atau quote berupa GAMBAR
                const isImage = !!cleanMsg?.imageMessage;

                if (isImage) {
                    try {
                        await sock.sendMessage(jid, { text: `Mengekstrak teks...` }, { quoted: m });
                        
                        // Konstruksi objek Baileys untuk download media (sama seperti .aud)
                        const mediaTarget = isQuoted ? {
                            key: { remoteJid: m.key.remoteJid, id: contextInfo.stanzaId },
                            message: contextInfo.quotedMessage
                        } : m;

                        // Download gambar jadi buffer
                        const imageBuffer = await downloadMediaMessage(mediaTarget, 'buffer', {});

                        // Jalankan Tesseract OCR (Mendeteksi bahasa Inggris & Indonesia sebagai dasar)
                        const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng+ind');
                        
                        textToTranslate = text.trim();

                        if (!textToTranslate) {
                            return sock.sendMessage(jid, { text: `Mana teks nya?` }, { quoted: m });
                        }

                    } catch (err) {
                        console.error("[ERROR - OCR]:", err);
                        return sock.sendMessage(jid, { text: `[ Gagal ekstrak ]` }, { quoted: m });
                    }
                } 
                // Jika BUKAN gambar, tapi user me-reply teks
                else if (!textToTranslate && isQuoted) {
                    const quotedMsg = contextInfo.quotedMessage;
                    textToTranslate = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || '';
                }

                // Validasi akhir jika tetap tidak ada teks
                if (!textToTranslate) {
                    return sock.sendMessage(jid, { 
                        text: `Mana teks nya?\nContoh : .tr en Kamu sedang apa` 
                    }, { quoted: m });
                }

                try {
                    if (isImage) {
                        await sock.sendMessage(jid, { text: `Menerjemahkan..` }, { quoted: m });
                    }

                    // 4. Eksekusi penerjemahan murni ke Google Translate
                    const res = await translate(textToTranslate, { to: targetLang });

                    // 5. Kirim MURNI hanya hasil terjemahannya saja
                    await sock.sendMessage(jid, { text: res.text }, { quoted: m });

                } catch (error) {
                    console.error("[ERROR - TRANSLATE CASE]:", error);
                    await sock.sendMessage(jid, { 
                        text: `Gagal menerjemahkan teks, Pastikan kode negara/bahasa valid.` 
                    }, { quoted: m });
                }
                break;
            }


            case "dl": {
    const url = args[0];
    if (!url) return sock.sendMessage(jid, { text: "Format salah, Contoh : .dl <link>" }, { quoted: m });
    if (!/facebook|tiktok|instagram|youtube|youtu\.be/.test(url.toLowerCase())) {
        return sock.sendMessage(jid, { text: "Link tidak didukung." }, { quoted: m });
    }

    await sock.sendMessage(jid, { text: "Diproses, Estimasi 1-5 menit..." }, { quoted: m });
    try {
        const data = await downloadVideo(url);
        
        // 1. Baca file video dari path lokal menjadi Buffer
        const fs = require('fs');
        if (!fs.existsSync(data.path)) {
            throw new Error("File video gagal diunduh atau tidak ditemukan.");
        }
        const videoBuffer = fs.readFileSync(data.path);

        const caption = `[ Berhasil ]\n[ Title ] : ${data.title}\n[ Size ] : ${data.size}`;
        
        // 2. Kirim menggunakan parameter 'video: videoBuffer' bukan 'url'
        await sock.sendMessage(jid, { 
            video: videoBuffer, 
            caption, 
            mimetype: 'video/mp4' 
        }, { quoted: m });

        // 3. Hapus file sisa setelah dikirim
        deleteFile(data.path);
    } catch(e) {
        return sock.sendMessage(jid, { text: `Gagal mengunduh : ${e.message}` }, { quoted: m });
    }
    break;
}


            case 's':
            case 'sticker': {
                try {
                    const realMsg = unwrapMessage(m.message);
                    if (!realMsg) return;
                    
                    const msgTypeReal = Object.keys(realMsg)[0];
                    const contextInfo = realMsg[msgTypeReal]?.contextInfo;
                    const isQuoted = !!contextInfo?.quotedMessage;
                    const cleanMsg = unwrapMessage(isQuoted ? contextInfo.quotedMessage : realMsg);
                    
                    const isImage = !!cleanMsg?.imageMessage;
                    const isVideo = !!cleanMsg?.videoMessage;

                    if (!isImage && !isVideo) {
                        return sock.sendMessage(jid, { text: 'Reply atau kirim gambar/video (maks 14 detik) dengan caption .s/.sticker' }, { quoted: m });
                    }

                    if (isVideo && cleanMsg.videoMessage.seconds > 25) {
                        return sock.sendMessage(jid, { text: 'Kepanjangan, maks 14 detik' }, { quoted: m });
                    }

                    const targetMessageObj = isQuoted ? {
                        key: { remoteJid: jid, id: contextInfo?.stanzaId || m.key.id, participant: contextInfo?.participant },
                        message: cleanMsg
                    } : { key: m.key, message: cleanMsg };

                    if (isVideo) {
                        await sock.sendMessage(jid, { text: 'Diproses, konversi est 1-3 menit.' }, { quoted: m });
                    }

                    const mediaBuffer = await downloadMediaMessage(targetMessageObj, 'buffer', {});
                    if (!mediaBuffer) throw new Error("Gagal mengunduh media dari WhatsApp.");

                    if (mediaBuffer.length > 15 * 1024 * 1024) {
                        return sock.sendMessage(jid, { text: "Ukuran file terlalu besar (Maks 5MB)." }, { quoted: m });
                    }

                    const rawText = body || "";
                    let customAuthor = 'Whatsapp';
                    if (rawText.includes('+')) {
                        const parsed = rawText.substring(rawText.indexOf('+') + 1).trim();
                        if (parsed) customAuthor = parsed;
                    }

                    let stickerBuffer;

                    // EKSEKUSI PEMBUATAN STIKER (SANGAT BERSIH)
                    if (isImage) {
                       
                        const sticker = new Sticker(mediaBuffer, { 
                            
                            author: customAuthor, 
                            type: 'crop', 
                            quality: 10 
                        });
                        stickerBuffer = await sticker.toBuffer();
                    } else if (isVideo) {
                        // Memanggil fungsi dari ffmpeg.js
                        stickerBuffer = await createVideoSticker(mediaBuffer, customAuthor);
                    }

                    // Kirim Stiker ke Chat
                    await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: m });
                    
                } catch (error) {
                    console.error("Error Sticker:", error);
                    await sock.sendMessage(jid, { text: `❌ Gagal memproses stiker.` }, { quoted: m });
                }
                break;
            }

case 'brat': {
    const textQuery = body.split(' ').slice(1).join(' ');
    if (!textQuery) return sock.sendMessage(jid, { text: 'Masukkan teks,.brat Halo' }, { quoted: m });
    
    if (textQuery.replace(/\s/g, '').length > 18) {
        return sock.sendMessage(jid, { text: 'Teks terlalu panjang (Maks 18 karakter bersih).' }, { quoted: m });
    }

    try {
        // Langsung ambil hasil buffer dari fungsi yang kita buat.
        // Hasilnya sudah berupa WebP (stiker siap kirim)!
        const bratStickerBuffer = await createBratSticker(textQuery);
        
        // Kirim langsung buffernya sebagai stiker
        await sock.sendMessage(jid, { sticker: bratStickerBuffer }, { quoted: m });
        
    } catch (error) {
        // Munculkan error di terminal biar kalau gagal lagi, kamu tahu penyebab aslinya
        console.error('Error saat membuat brat:', error);
        
        // Kirim pesan ke user
        await sock.sendMessage(jid, { text: `Gagal membuat brat: ${error.message}` }, { quoted: m });
    }
    break;
}



            
            case 'tourl': {
                try {
                    const realMsg = unwrapMessage(m.message);
                    if (!realMsg) return;
              const msgTypeReal= Object.keys(realMsg)[0];
                    const contextInfo = realMsg[msgTypeReal]?.contextInfo;
                    const isQuoted = !!contextInfo?.quotedMessage;
                    const cleanMsg = unwrapMessage(isQuoted ? contextInfo.quotedMessage : realMsg);
                    const isImage = !!cleanMsg?.imageMessage;
                    const isVideo = !!cleanMsg?.videoMessage;
                    
                    const validTypes = ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'stickerMessage'];
                    const msgType = Object.keys(cleanMsg || {}).find(key => validTypes.includes(key));
                    if (!msgType) {
                        return sock.sendMessage(jid, { text: 'Kirim atau reply media dengan .tourl' }, { quoted: m });
                    }

                    const targetMessageObj = isQuoted ? {
                        key: { remoteJid: jid, id: contextInfo?.stanzaId || m.key.id, participant: contextInfo?.participant },
                        message: cleanMsg
                    } : { key: m.key, message: cleanMsg };

                    const buffer = await downloadMediaMessage(targetMessageObj, 'buffer', {});
                    if (!buffer) throw new Error("Gagal unduh media");

                    if (buffer.length > 25 * 1024 * 1024) {
                        return sock.sendMessage(jid, { text: "File terlalu besar untuk diunggah (Maks 25MB)." }, { quoted: m });
                    }

                    await sock.sendMessage(jid, { text: 'Mengunggah...' }, { quoted: m });
                    const mime = cleanMsg[msgType]?.mimetype || 'application/octet-stream';
                    let ext = mime.split('/')[1]?.split(';')[0] || 'bin';
                    const result = await uploadToImageKit(buffer, `media_${Date.now()}.${ext}`);

                    await sock.sendMessage(jid, { text: `URL: ${result.url}\nSize: ${result.size} MB` }, { quoted: m });
                } catch (error) {
                    await sock.sendMessage(jid, { text: `Gagal mengunggah.` }, { quoted: m });
                }
                break;
            }
case 'topdf': {
                const quotedMessage = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const htmlContent = quotedMessage?.conversation || quotedMessage?.extendedTextMessage?.text;

                if (!htmlContent) {
                    return sock.sendMessage(jid, { text: 'Reply teks html dengan caption .topdf' }, { quoted: m });
                }

                try {
                    await sock.sendMessage(jid, { text: '[ *Memproses HTML ke PDF...* ]' }, { quoted: m });

                    // Panggil fungsi terpusat, kirim sebagai objek HTML
                    const pdfBuffer = await generatePdfFromSource({ html: htmlContent });

                    // Kirim dokumen PDF kembali ke WhatsApp via Baileys
                    await sock.sendMessage(jid, {
                        document: pdfBuffer,
                        mimetype: 'application/pdf',
                        fileName: `document_${Date.now()}.pdf`,
                        caption: '[ *Berhasil* ] PDF berhasil digenerate.'
                    }, { quoted: m });

                } catch (error) {
                    console.error("[ERROR - TOPDF]:", error);
                    await sock.sendMessage(jid, { text: `[ Gagal ] Terjadi kesalahan: ${error.message}` }, { quoted: m });
                }
                break;
            }
            case 'aud': {
                // 1. Logika Substring untuk penanda format (!wav, !mp3)
                const formatIndex = body.indexOf('!');
                const targetFormat = formatIndex !== -1 
                    ? body.substring(formatIndex + 1).split(' ')[0].trim().toLowerCase() 
                    : 'mp3'; // Default tetap ke mp3

                const supportedFormats = ['mp3', 'wav', 'ogg', 'm4a', 'opus'];
                if (!supportedFormats.includes(targetFormat)) {
                    return sock.sendMessage(jid, { 
                        text: `Format tidak didukung,\nFormat tersedia : ${supportedFormats.join(', ')}\nContoh : .aud !wav` 
                    }, { quoted: m });
                }

                // 2. Unwrap bawaan utils lu
                const realMsg = unwrapMessage(m.message);
                if (!realMsg) return;
                
                const msgTypeReal = Object.keys(realMsg)[0];
                const contextInfo = realMsg[msgTypeReal]?.contextInfo;
                const isQuoted = !!contextInfo?.quotedMessage;
                const cleanMsg = unwrapMessage(isQuoted ? contextInfo.quotedMessage : realMsg);
                
                // 3. Cukup pakai cleanMsg (targetMessage udah dibuang)
                const isVideo = !!cleanMsg?.videoMessage;

                if (!isVideo) {
                    return sock.sendMessage(jid, { 
                        text: `Kirim atau reply video\nContoh : .aud atau .aud !wav` 
                    }, { quoted: m });
                }

                try {
                    await sock.sendMessage(jid, { text: ` Convert diproses...` }, { quoted: m });

                    // 4. Konstruksi objek untuk didownload
                    // Baileys butuh stanzaId kalau pesannya hasil reply biar nggak error dekripsi
                    const mediaTarget = isQuoted ? {
                        key: {
                            remoteJid: m.key.remoteJid,
                            id: contextInfo.stanzaId
                        },
                        message: contextInfo.quotedMessage
                    } : m;

                    // 5. Download buffer dari mediaTarget
                    const videoBuffer = await downloadMediaMessage(mediaTarget, 'buffer', {});

                    // 6. Proses konversi FFmpeg
                    const { audioBuffer, mimetype } = await convertVideoToAudio(videoBuffer, targetFormat);

                    // 7. Kirim hasil
                    await sock.sendMessage(jid, { 
                        audio: audioBuffer, 
                        mimetype: mimetype, 
                        ptt: false // Ubah true kalau mau dikirim bentuk VN
                    }, { quoted: m });

                } catch (error) {
                    console.error("[ERROR - AUD CASE]:", error);
                    await sock.sendMessage(jid, { text: `[ Gagal convert ].` }, { quoted: m });
                }
                break;
            }



            case 'sewa':
                await sendButtons(sock, jid, {
                    title: '[ *Sewa bot* ]',
                    text: 'Hubungi moderator untuk informasi lebih lanjut.',
                    footer: 'Nayozu',
                    buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Chat Moderator', url: 'https://wa.me/6285764554290', merchant_url: 'https://wa.me/6285764554290' }) }]
                }, { generateWAMessageFromContent, proto, quoted: m });
                break;
        }
        return true; 
    }
    return false; 
}

module.exports = { menuController };
