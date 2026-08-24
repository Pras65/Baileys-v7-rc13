const GroupModel = require('../models/GroupModel');
const RoleModel = require('../models/RoleModel');
const otoritasController = require('./otoritas');
const groupController = require('./groupController');
const { menuController } = require('./menuController');
const { clearJid } = require('./utils');

function getText(msg) {
    return (
        msg?.conversation ||
        msg?.extendedTextMessage?.text ||
        msg?.imageMessage?.caption ||
        msg?.videoMessage?.caption ||
        ""
    );
}

async function syncGroupMetadata(sock, jid, sessionId) {
    try {
        const metadata = await sock.groupMetadata(jid);
        const admins = metadata.participants
            .filter(v => v.admin === "admin" || v.admin === "superadmin")
            .map(v => clearJid(v.id));

        const docId = `${sessionId}_${jid}`;
        await GroupModel.findByIdAndUpdate(docId, {
            sessionId,
            jid,
            subject: metadata.subject,
            admins,
            updatedAt: new Date()
        }, { upsert: true, returnDocument: 'after' });

        return metadata;
    } catch (err) {
        return null;
    }
}

module.exports = (sock, sessionId = 'lokal') => {
    if (!sock || typeof sock.ev?.on !== 'function') return;

    console.log(`[ Controller Index (${sessionId}) ] Modular Dispatcher Aktif.`);

    sock.ev.on("messages.upsert", async ({ messages }) => {
        try {
            const m = messages[0];
            if (!m || m.key.fromMe) return;
            await sock.readMessages([m.key]);
            
            const jid = m.key.remoteJid;
            const rawSender = m.key.participant || m.key.remoteJid;
            const cleanSender = clearJid(rawSender);
            const body = getText(m.message);
            const isGroup = jid.endsWith("@g.us");

            if (!body) return;

            const roleDoc = await RoleModel.findOne({
                $or: [
                    { jid: cleanSender },
                    { lid: cleanSender }
                ]
            });

            const isMaster = roleDoc?.role === 'master';
            const isMod = roleDoc?.role === 'mod';
            const hasDeepAuthority = isMaster || isMod;
            
            let isGuest = false;
            if (roleDoc?.role === 'guest') {
                if (roleDoc.expiresAt && new Date() < new Date(roleDoc.expiresAt)) {
                    isGuest = true;
                } else if (roleDoc.expiresAt && new Date() >= new Date(roleDoc.expiresAt)) {
                    await RoleModel.deleteOne({ _id: roleDoc._id });
                }
            }

            let groupData = null;
            let isAdminGroup = false;

            if (isGroup) {
                await syncGroupMetadata(sock, jid, sessionId);
                groupData = await GroupModel.findById(`${sessionId}_${jid}`);
                isAdminGroup = groupData?.admins.includes(cleanSender) || false;

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

            if (body.startsWith(".")) {
                if (isGroup) {
                    const isRegistered = groupData && groupData.registered;

                    if (!isRegistered && !hasDeepAuthority) {
                        await sock.sendMessage(jid, { text: "Grup ini belum terdaftar di sistem, Hubungi master atau moderators." }, { quoted: m });
                        return;
                    }

                    const isHandledByMenu = await menuController(sock, m, { jid, sender: cleanSender, body, isMaster, sessionId });
                    
                    if (!isHandledByMenu) {
                        await groupController(sock, m, { jid, sender: cleanSender, body, groupData, isAdminGroup, isMaster, sessionId });
                    }

                } else {
                    await menuController(sock, m, { jid, sender: cleanSender, body, isMaster, sessionId });
                }
            }

        } catch (err) {
            console.log("Error di Dispatcher Index:", err);
        }
    });

    sock.ev.on("group-participants.update", async ({ id: jid }) => {
        if (jid) await syncGroupMetadata(sock, jid, sessionId);
    });
}
