// Panggil seluruh utils sebagai satu objek utuh
const utils = require('./utils');
const GROUPS = new Map(); 
const PREFIX = ".";

function getSetting(jid) {
    if (!GROUPS.has(jid)) {
        GROUPS.set(jid, { antilink: false, antiapk: false });
    }
    return GROUPS.get(jid);
}

module.exports = async (sock, m, context) => {
    try {
        // isMaster di sini adalah BOOLEAN (true/false) bawaan pengirim dari index.js
        const { jid, sender, body, groupData, isAdminGroup, isMaster } = context;
        const reply = (text, quoted = m) => sock.sendMessage(jid, { text }, { quoted });
        const setting = getSetting(jid);

        const isAuthorized = isMaster || isAdminGroup;

        // 1. Anti-link

        // 1. Anti-link (Deteksi domain & URL dinamis secara universal)
        if (setting.antilink && !isAuthorized) {
            const text = body.toLowerCase();
            const linkRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(\/[^\s]*)?)/i;
            
            const detect = linkRegex.test(text);

            if (detect) {
                if (await utils.isBotAdmin(sock, jid)) {
                    try {
                        await sock.sendMessage(jid, { delete: m.key });
                    } catch (err) {
                        console.log(`[Anti-Link] Gagal menghapus pesan: ${err.message}`);
                    }
                }
                return; // Berhenti agar pesan link tidak diproses lanjut
            }
        }


        // 2. Anti-APK
        if (setting.antiapk && !isAuthorized) {
            const doc = m.message?.documentMessage;
            if (doc && doc.mimetype === "application/vnd.android.package-archive") {
                if (await utils.isBotAdmin(sock, jid)) {
                    try {
                        await sock.sendMessage(jid, { delete: m.key });
                    } catch (err) {
                        console.log(`[Anti-APK] Gagal menghapus APK di ${jid}: ${err.message}`);
                    }
                }
                return; // Stop eksekusi
            }
        }
        

        if (!body.startsWith(PREFIX)) return;
        const args = body.slice(PREFIX.length).trim().split(/\s+/);
        const cmd = args.shift().toLowerCase();

        if (!isAuthorized) return;

        switch (cmd) {
            
            case "kick": {
                const target = await utils.getTarget(m);
                if (!target) return reply("Reply, tag, atau masukkan nomor whatsapp.", m);
                if (target === sender) return reply("Tidak bisa kick diri sendiri.", m);
                
                // Cek status target murni pakai library utils
                if (utils.isMaster(target)) return reply("Target adalah master sistem, tindakan ditolak.", m);
                
                // Cek status pengirim pakai boolean isMaster dari context
                if (groupData?.admins?.includes(target) && !isMaster) return reply("Tidak bisa menendang sesama admin.", m);
                
                if (!(await utils.isBotAdmin(sock, jid))) return reply("Bot bukan admin.", m);

                await sock.groupParticipantsUpdate(jid, [target], "remove");
                return reply("Member berhasil dikeluarkan.", m);
            }

            case "add": {
                if (!(await utils.isBotAdmin(sock, jid))) return reply("Bot bukan admin.", m);
                const target = await utils.getTarget(m);
                if (!target) return reply("Masukkan nomor whatsapp yang benar.", m);
                
                if (target === utils.clearJid(sock.user?.id) || target === utils.clearJid(sock.user?.lid)) {
                    return reply("Gak bisa add bot sendiri.", m);
                }
                
                await reply(`Proses add members...`, m);
                try {
                    const res = await sock.groupParticipantsUpdate(jid, [target], "add");
                    const result = res[0];
                    if (result.status === "200") return reply(`${target.split('@')[0]} berhasil ditambahkan.`, m);
                    if (result.status === "403") return reply(`Gagal, privasi akun membatasi penambahan otomatis.`, m);
                    if (result.status === "401") return reply(`Gagal, nomor sudah ada di group.`, m);
                    return reply(`Gagal menambahkan, Kode : ${result.status}`, m);
                } catch (e) {
                    return reply(`error: ${e.message}`, m);
                }
            }

            case "promote": {
                if (!(await utils.isBotAdmin(sock, jid))) return reply("Bot bukan admin.", m);
                const target = await utils.getTarget(m);
                if (!target) return reply("Target tidak ditemukan.", m);
                if (await utils.isAdmin(sock, jid, target)) return reply("User sudah menjadi admin.", m);

                await sock.groupParticipantsUpdate(jid, [target], "promote");
                return reply("Promote berhasil.", m);
            }

            case "demote": {
                if (!(await utils.isBotAdmin(sock, jid))) return reply("Bot bukan admin.", m);
                const target = await utils.getTarget(m);
                if (!target) return reply("Target tidak ditemukan.", m);
                
                // Cek target pakai library utils, tanpa await karena sinkron
                if (utils.isMaster(target)) return reply("Master tidak bisa di-demote.", m);
                
                if (!(await utils.isAdmin(sock, jid, target))) return reply("Target bukan admin.", m);

                await sock.groupParticipantsUpdate(jid, [target], "demote");
                return reply("Demote berhasil.", m);
            }

            case "delete":
            case "del": {
                const contextInfo = m.message?.extendedTextMessage?.contextInfo;
                if (!contextInfo?.stanzaId) return reply("Reply pesan yang ingin dihapus.", m);

                const participant = contextInfo.participant;
                const isBotMessage = utils.clearJid(participant) === utils.clearJid(sock.user?.id);

                await sock.sendMessage(jid, {
                    delete: {
                        remoteJid: jid,
                        fromMe: isBotMessage,
                        id: contextInfo.stanzaId,
                        participant: participant
                    }
                });
                return;
            }

            case "help": {
                return reply(`*Nayozu command helper*\n\n${PREFIX}groupinfo\n${PREFIX}members\n${PREFIX}kick\n${PREFIX}add\n${PREFIX}promote\n${PREFIX}demote\n${PREFIX}delete\n${PREFIX}antilink on/off\n${PREFIX}antiapk on/off\n${PREFIX}open\n${PREFIX}close\n${PREFIX}linkgroup\n${PREFIX}resetlink`, m);
            }

            case "groupinfo": {
                const data = await utils.getGroupInfo(sock, jid, sender);
                return reply(`*Group info*\n\nNama :\n${data.metadata.subject}\n\nID :\n${jid}\n\nAnti Link :\n${setting.antilink ? "ON" : "OFF"}\n\nAnti APK :\n${setting.antiapk ? "ON" : "OFF"}`, m);
            }

            case "members": {
                const data = await utils.getGroupInfo(sock, jid, sender);
                const total = data.metadata.participants.length;
                const admin = data.admins.length;
                const member = total - admin;
                return reply(`*Member info*\n\nTotal :\n${total}\n\nAdmin :\n${admin}\n\nMember :\n${member}`, m);
            }

            case "antilink": {
                const opt = args[0]?.toLowerCase();
                if (opt !== "on" && opt !== "off") return reply(".antilink on/off", m);
                setting.antilink = opt === "on";
                return reply(`Anti Link ${setting.antilink ? "diaktifkan" : "dimatikan"}.`, m);
            }

            case "antiapk": {
                const opt = args[0]?.toLowerCase();
                if (opt !== "on" && opt !== "off") return reply(".antiapk on/off", m);
                setting.antiapk = opt === "on";
                return reply(`Anti APK ${setting.antiapk ? "diaktifkan" : "dimatikan"}.`, m);
            }

            case "open": {
                if (!(await utils.isBotAdmin(sock, jid))) return reply("Bot bukan admin.", m);
                await sock.groupSettingUpdate(jid, "not_announcement");
                return reply("Group berhasil dibuka.", m);
            }

            case "close": {
                if (!(await utils.isBotAdmin(sock, jid))) return reply("Bot bukan admin.", m);
                await sock.groupSettingUpdate(jid, "announcement");
                return reply("Group berhasil ditutup.", m);
            }

            case "linkgroup": {
                if (!(await utils.isBotAdmin(sock, jid))) return reply("Bot bukan admin.", m);
                const code = await sock.groupInviteCode(jid);
                return reply(`https://chat.whatsapp.com/${code}`, m);
            }

            case "resetlink": {
                if (!(await utils.isBotAdmin(sock, jid))) return reply("Bot bukan admin.", m);
                const code = await sock.groupRevokeInvite(jid);
                return reply(`Link baru:\n\nhttps://chat.whatsapp.com/${code}`, m);
            }
        }
    } catch (err) {
        console.log("Error in groupController execution:", err);
    }
};
