const GroupModel = require('../models/GroupModel');
const otoritasController = require('./otoritas');
const groupController = require('./groupController');
const { menuController } = require('./menuController');

// Import seluruh fungsi utils ke dalam satu objek untuk mencegah bentrok nama
const utils = require('./utils');

module.exports = (sock, sessionId = 'lokal') => {
    if (!sock || typeof sock.ev?.on !== 'function') return;

    console.log(`[ Controller Index (${sessionId}) ] Modular Dispatcher Aktif.`);

    sock.ev.on("messages.upsert", async ({ messages }) => {
        try {
            const m = messages[0];
            if (!m || m.key.fromMe) return;
            await sock.readMessages([m.key]);
            
            // 1. Ekstrak Data Dasar Pesan via Utils
            const { jid, cleanSender, isGroup } = utils.extractMessageData(m);
            const body = utils.getText(m.message);
            if (!body) return;

            // 2. Ekstrak Otoritas Pengirim (Asinkron / Database + Hardcoded)
            // isMaster di sini adalah Boolean khusus untuk si Pengirim (sender)
            const { isMaster, isMod, hasDeepAuthority, isGuest } = await utils.getUserAuthority(cleanSender);

            let groupData = null;
            let isAdminGroup = false;

            // 3. Manajemen Status Grup
            if (isGroup) {
                await utils.syncGroupMetadata(sock, jid, sessionId);
                groupData = await GroupModel.findById(`${sessionId}_${jid}`);
                isAdminGroup = groupData?.admins?.includes(cleanSender) || false;

                // Auto unreg jika masa aktif grup expired
                if (groupData?.registered && groupData?.expiresAt) {
                    if (new Date() >= new Date(groupData.expiresAt)) {
                        await GroupModel.findByIdAndUpdate(`${sessionId}_${jid}`, {
                            registered: false,
                            expiresAt: null,
                            addedByRole: null,
                            addedByJid: null,
                            addedByLid: null
                        });
                        await sock.sendMessage(jid, { 
                            text: "⚠️ Masa aktif pendaftaran grup ini telah habis. Status registrasi otomatis dicabut oleh sistem." 
                        });
                        groupData.registered = false;
                    }
                }
            }

            // 4. Dispatcher Rute (Arahkan pesan ke controller yang tepat)
            if (body.startsWith("-c")) {
                if (!hasDeepAuthority) return;
                const handled = await otoritasController(sock, m, { jid, sender: cleanSender, body, sessionId, isMaster, isMod, isGroup });
                if (handled) return;
            }

            if (isGuest && !hasDeepAuthority) {
                if (body.startsWith(".")) {
                    await menuController(sock, m, { jid, sender: cleanSender, body, isMaster, sessionId });
                }
                return;
            }

if (isGroup) {
                const isRegistered = groupData && groupData.registered;

                if (!isRegistered && !hasDeepAuthority && body.startsWith(".")) {
                    await sock.sendMessage(jid, { text: "Grup ini belum terdaftar di sistem. Hubungi master atau moderator." }, { quoted: m });
                    return;
                }

                // Cek apakah ini perintah menu (.help, .sticker, dll)
                let isHandledByMenu = false;
                if (body.startsWith(".")) {
                    isHandledByMenu = await menuController(sock, m, { jid, sender: cleanSender, body, isMaster, sessionId });
                }
                
                // Selalu panggil groupController untuk SEMUA pesan di grup
                // Supaya Anti-Link & Anti-APK bisa membaca pesan yang TIDAK diawali titik (.)
                if (!isHandledByMenu) {
                    await groupController(sock, m, { jid, sender: cleanSender, body, groupData, isAdminGroup, isMaster, sessionId });
            } else if (body.startsWith(".")) {
                // Jalankan menu jika pesan di PM (Private Message) dan diawali titik
                await menuController(sock, m, { jid, sender: cleanSender, body, isMaster, sessionId });
            }
          }

        } catch (err) {
            console.error("Error di Dispatcher Index:", err);
        }
    });

    sock.ev.on("group-participants.update", async ({ id: jid }) => {
        if (jid) await utils.syncGroupMetadata(sock, jid, sessionId);
    });
}
