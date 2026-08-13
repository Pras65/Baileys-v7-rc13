const RoleModel = require('../models/RoleModel')
const GroupModel = require('../models/GroupModel')
const MenuModel = require('../models/MenuModel')
function clearJid(jid) {
    if (!jid) return ""
    if (jid.includes("@lid")) {
        const parts = jid.split("@")
        const user = parts[0].split(":")[0]
        return `${user}@lid`
    }
    const parts = jid.split("@")
    const user = parts[0].split(":")[0]
    const domain = parts[1] || "s.whatsapp.net"
    return `${user}@${domain}`
}

function formatGroupJid(id) {
    let clean = id.trim()
    if (!clean.endsWith("@g.us")) {
        clean = `${clean}@g.us`
    }
    return clean
}

module.exports = async (sock, m, context) => {
    const { jid, sender, body, sessionId, isMaster, isMod, isGroup } = context
    const args = body.trim().split(/\s+/)
    const cmd = args[1]?.toLowerCase()

    let targetJid = ""
    if (m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
        targetJid = clearJid(m.message.extendedTextMessage.contextInfo.mentionedJid[0])
    } else if (args[2] && !args[2].includes("@g.us")) {
        let cleanNum = args[2].replace(/[^0-9]/g, "")
        if (cleanNum) targetJid = `${cleanNum}@s.whatsapp.net`
    }

    if (cmd === "help" || !cmd) {
        let helpText = `🛡️ *NAYOZU BOT - ADMINISTRATOR HELP*\n\n` +
            `> *Daftar Perintah Pengelolaan & Kontrol Bot*\n\n` +
            `*   \`-c info\` - Menampilkan informasi status sistem bot.\n` +
            `*   \`-c reg\` - Mendaftarkan grup ke sistem database (di dalam grup atau via \`-c reg <id_grup>\`).\n` +
            `*   \`-c addguest @user [durasi]\` - Memberikan akses guest sementara (cth: \`2h\` atau \`1d\`).\n` +
            `*   \`-c addme <id_grup>\` - Menarik & menambahkan diri Anda ke grup tujuan.\n` +
            `*   \`-c rct <id_grup> <pesan>\` - Mengirim pesan remote secara langsung ke suatu grup.\n` +
            `*   \`-c bc <pesan>\` - Melakukan siaran/broadcast ke seluruh grup terdaftar.\n` +
            `*   \`-c listgr [page]\` - Melihat daftar ID grup yang sudah *Registered*.\n` +
            `*   \`-c listgs [page]\` - Melihat daftar ID grup *Saved* (belum terdaftar).\n` +
            `*   \`-c gi <id_grup>\` - Melihat informasi detail suatu grup.\n`

        await sock.sendMessage(jid, { text: helpText }, { quoted: m })
        return true
    }

    // 2. Informasi Sistem Bot (-c info) - Master & Mod
    if (cmd === "info") {
        try {
            const totalGroups = await GroupModel.countDocuments({ sessionId })
            const regGroups = await GroupModel.countDocuments({ sessionId, registered: true })
            const modsCount = await RoleModel.countDocuments({ role: 'mod' })
            const guestsCount = await RoleModel.countDocuments({ role: 'guest' })

            const infoText = `🤖 *NAYOZU BOT - SYSTEM INFO*\n\n` +
                `📦 *Session ID:* ${sessionId}\n` +
                `📊 *Total Grup Tersimpan:* ${totalGroups}\n` +
                `✅ *Grup Terdaftar (Registered):* ${regGroups}\n` +
                `🛡️ *Total Moderator:* ${modsCount}\n` +
                `⏱️ *Total Guest Aktif:* ${guestsCount}\n` +
                `👑 *Akses Peran Anda:* ${isMaster ? 'Master' : 'Moderator'}`

            await sock.sendMessage(jid, { text: infoText }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `❌ Gagal memuat info sistem: ${err.message}` }, { quoted: m })
        }
        return true
    }
if (cmd !== "desb" && cmd !== "enb") return false;

    // Pastikan args[2] ada (nama command yang mau di-manage)
    // Contoh input: args[2] = ".dl" atau "dl"
    let targetCommand = args[2];
    if (!targetCommand) {
        await sock.sendMessage(jid, { text: `⚠️ Format salah.\nGunakan: \`-c desb <.command> <alasan>\` atau \`-c enb <.command>\`` }, { quoted: m });
        return true;
    }

    // Bersihkan prefix "." jika Master mengetik dengan titik (misal: .dl -> dl)
    targetCommand = targetCommand.replace(/^\./, '').trim();

    const isActive = (cmd === "enb");
    
    // Mengambil alasan penonaktifan jika ada (menggabungkan argumen setelah nama command)
    // Misal: -c desb .dl menu belum siap -> args[3] dan seterusnya adalah alasannya
    const reasonIndex = args.indexOf(args[2]) + 1;
    const reason = args.slice(reasonIndex).join(' ') || "Menu belum tersedia dan masih tahap pengujian.";

    try {
        await MenuModel.findOneAndUpdate(
            { command: targetCommand },
            { 
                command: targetCommand, 
                isActive: isActive, 
                disabledReason: isActive ? '' : reason, 
                updatedAt: new Date(), 
                updatedBy: sender 
            },
            { upsert: true, new: true }
        );

        const statusText = isActive ? 'Diaktifkan' : 'Dinonaktifkan';
        let feedback = `**Otoritas master diterapkan!**\n\n• **Command**: \`.${targetCommand}\`\n• **Status**: ${statusText}`;
        if (!isActive) feedback += `\n• **Alasan**: _${reason}_`;

        await sock.sendMessage(jid, { text: feedback }, { quoted: m });
        return true;
    } catch (err) {
        await sock.sendMessage(jid, { text: ` Gagal memproses otoritas: ${err.message}` }, { quoted: m });
        return true;
    }
    // 3. Registrasi Grup (-c reg) - Bisa dari dalam grup atau lewat privat chat (-c reg <id_grup>)
    if (cmd === "reg") {
        let targetRegJid = jid
        if (!isGroup) {
            const targetGroupRaw = args[2]
            if (!targetGroupRaw) {
                await sock.sendMessage(jid, { text: "⚠️ Format salah jika dikirim di privat chat. Contoh: `-c reg 120363123456789012`" }, { quoted: m })
                return true
            }
            targetRegJid = formatGroupJid(targetGroupRaw)
        }

        const docId = `${sessionId}_${targetRegJid}`
        await GroupModel.findByIdAndUpdate(docId, { registered: true }, { upsert: true, returnDocument: 'after' })
        await sock.sendMessage(jid, { text: `✅ Grup \`${targetRegJid.split('@')[0]}\` berhasil didaftarkan secara permanen di sistem.` }, { quoted: m })
        return true
    }

    if (cmd === "addmod") {
      if (!isMaster) {
            await sock.sendMessage(jid, { text: "Hanya master yang berhak" }, { quoted: m })
            return true
        }
    let rawTarget = null;
    let targetAlt = null;
    // 1. Ekstraksi langsung dari payload contextInfo Baileys
    const contextInfo = m.message?.extendedTextMessage?.contextInfo ||
                        m.message?.imageMessage?.contextInfo ||
                        m.message?.videoMessage?.contextInfo ||
                        m.message?.documentMessage?.contextInfo ||
                        m.msg?.contextInfo;

    if (contextInfo && contextInfo.participant) {
        rawTarget = contextInfo.participant;
        if (contextInfo.participantAlt) {
            targetAlt = contextInfo.participantAlt;
        }
    }

    // 2. Fallback ke m.quoted jika wrapper Anda menyediakannya
    if (!rawTarget && m.quoted) {
        rawTarget = m.quoted.sender || m.quoted.participant || m.quoted.key?.participant;
        if (m.quoted.key?.participantAlt) targetAlt = m.quoted.key.participantAlt;
    }

    // 3. Fallback ke mention (@tag)
    if (!rawTarget) {
        const mentions = m.mentionedJid || contextInfo?.mentionedJid || m.msg?.mentionedJid;
        if (Array.isArray(mentions) && mentions.length > 0) {
            rawTarget = mentions[0];
        }
    }

    // 4. Fallback ke input manual nomor/JID/LID
    if (!rawTarget && args && args) {
        const inputArg = args.trim();
        if (inputArg.includes("@")) {
            rawTarget = inputArg;
        } else {
            const cleanNum = inputArg.replace(/[^0-9]/g, "");
            if (cleanNum.length >= 5) rawTarget = cleanNum + "@s.whatsapp.net";
        }
    }

    if (!rawTarget) {
        await sock.sendMessage(jid, { 
            text: "⚠️ Format salah.\nGunakan: Reply pesan target, mention (@tag), atau ketik nomor." 
        }, { quoted: m });
        return true;
    }

    // Bersihkan format dasar via clearJid
    let cleanedRaw = clearJid(rawTarget);
    let cleanedAlt = targetAlt ? clearJid(targetAlt) : null;

    // === FIX DEVICE ID: Potong (:0, :1, dll) jika terselip di string ===
    if (cleanedRaw) cleanedRaw = cleanedRaw.replace(/:[0-9]+/g, '');
    if (cleanedAlt) cleanedAlt = cleanedAlt.replace(/:[0-9]+/g, '');

    let realJid = "";
    let realLid = "";

    // Petakan data awal berdasarkan tipe suffix ID yang bersih
    if (cleanedRaw.endsWith("@s.whatsapp.net")) realJid = cleanedRaw;
    if (cleanedRaw.endsWith("@lid")) realLid = cleanedRaw;
    
    if (cleanedAlt) {
        if (cleanedAlt.endsWith("@s.whatsapp.net")) realJid = cleanedAlt;
        if (cleanedAlt.endsWith("@lid")) realLid = cleanedAlt;
    }

    // Mekanisme Agresif 1: Sinkronisasi via Sesi Cache Internal Baileys v7
    try {
        if (realLid && !realJid) {
            const foundJid = await sock.signalRepository.lidMapping.getPNForLID(realLid);
            if (foundJid) realJid = foundJid.replace(/:[0-9]+/g, ''); // Amankan dari device id
        } else if (realJid && !realLid) {
            const foundLid = await sock.signalRepository.lidMapping.getLIDForPN(realJid);
            if (foundLid) realLid = foundLid;
        }
    } catch (e) {
        console.error("Gagal reverse-mapping via signalRepository:", e);
    }

    // Mekanisme Agresif 2: Cross-reference metadata grup
    if ((!realJid || !realLid) && jid.endsWith("@g.us")) {
        try {
            const groupMeta = await sock.groupMetadata(jid);
            if (groupMeta && groupMeta.participants) {
                const participant = groupMeta.participants.find(p => 
                    p.id?.replace(/:[0-9]+/g, '') === realJid || 
                    p.lid === realLid || 
                    p.id?.replace(/:[0-9]+/g, '') === cleanedRaw || 
                    p.lid === cleanedRaw
                );

                if (participant) {
                    if (participant.id) realJid = participant.id.replace(/:[0-9]+/g, '');
                    if (participant.lid) realLid = participant.lid;
                }
            }
        } catch (e) {}
    }

    // Validasi Akhir sebelum ke DB Mongoose
    if (!realJid && !realLid) {
        await sock.sendMessage(jid, { text: `⚠️ Gagal mengenali identitas target (\`${rawTarget}\`).` }, { quoted: m });
        return true;
    }

    try {
        // Gabungkan seluruh pengenal unik tanpa duplikat untuk filter pencarian database
        const identifiers = [...new Set([cleanedRaw, cleanedAlt, realJid, realLid])].filter(Boolean);

        const queryFilter = {
            $or: [
                { jid: { $in: identifiers } },
                { lid: { $in: identifiers } }
            ]
        };

        // Simpan JID (bersih) & LID secara aman
        await RoleModel.findOneAndUpdate(
            queryFilter,
            { 
                jid: realJid || "",
                lid: realLid || "",
                role: "mod",
                addedAt: new Date(),
                addedBy: sender
            },
            { upsert: true, new: true }
        );

        await sock.sendMessage(jid, { 
            text: `✅ **Berhasil menyimpan Moderator!**\n\n• **JID**: \`${realJid || "Tidak Terdeteksi"}\`\n• **LID**: \`${realLid || "Tidak Terdeteksi"}\`` 
        }, { quoted: m });

    } catch (err) {
        await sock.sendMessage(jid, { text: `❌ Gagal ke database: ${err.message}` }, { quoted: m });
    }

    return true;
}
           
    if (cmd === "demod") {
      if (!isMaster) {
            await sock.sendMessage(jid, { text: "Hanya master yang berhak" }, { quoted: m })
            return true
        }
    let rawTarget = null;
    let targetAlt = null;

    // 1. Ekstraksi dari payload contextInfo (Reply)
    const contextInfo = m.message?.extendedTextMessage?.contextInfo ||
                        m.message?.imageMessage?.contextInfo ||
                        m.message?.videoMessage?.contextInfo ||
                        m.message?.documentMessage?.contextInfo ||
                        m.msg?.contextInfo;

    if (contextInfo && contextInfo.participant) {
        rawTarget = contextInfo.participant;
        if (contextInfo.participantAlt) targetAlt = contextInfo.participantAlt;
    }

    // 2. Fallback ke m.quoted
    if (!rawTarget && m.quoted) {
        rawTarget = m.quoted.sender || m.quoted.participant || m.quoted.key?.participant;
        if (m.quoted.key?.participantAlt) targetAlt = m.quoted.key.participantAlt;
    }

    // 3. Fallback ke mention (@tag)
    if (!rawTarget) {
        const mentions = m.mentionedJid || contextInfo?.mentionedJid || m.msg?.mentionedJid;
        if (Array.isArray(mentions) && mentions.length > 0) rawTarget = mentions[0];
    }

    // 4. Fallback ke input manual nomor/JID/LID
    if (!rawTarget && args && args) {
        const inputArg = args.trim();
        if (inputArg.includes("@")) {
            rawTarget = inputArg;
        } else {
            const cleanNum = inputArg.replace(/[^0-9]/g, "");
            if (cleanNum.length >= 5) rawTarget = cleanNum + "@s.whatsapp.net";
        }
    }

    if (!rawTarget) {
        await sock.sendMessage(jid, { 
            text: "⚠️ Format salah.\nGunakan: Reply pesan target, mention (@tag), atau ketik nomor." 
        }, { quoted: m });
        return true;
    }

    // Bersihkan format dasar via clearJid
    let cleanedRaw = clearJid(rawTarget);
    let cleanedAlt = targetAlt ? clearJid(targetAlt) : null;

    // === FIX DEVICE ID: Bersihkan data input agar serasi dengan isi database ===
    if (cleanedRaw) cleanedRaw = cleanedRaw.replace(/:[0-9]+/g, '');
    if (cleanedAlt) cleanedAlt = cleanedAlt.replace(/:[0-9]+/g, '');

    let realJid = cleanedRaw.endsWith("@s.whatsapp.net") ? cleanedRaw : (cleanedAlt?.endsWith("@s.whatsapp.net") ? cleanedAlt : "");
    let realLid = cleanedRaw.endsWith("@lid") ? cleanedRaw : (cleanedAlt?.endsWith("@lid") ? cleanedAlt : "");

    // Ambil data pemetaan jika ada yang kosong
    try {
        if (realLid && !realJid) {
            const foundJid = await sock.signalRepository.lidMapping.getPNForLID(realLid);
            if (foundJid) realJid = foundJid.replace(/:[0-9]+/g, '');
        } else if (realJid && !realLid) {
            const foundLid = await sock.signalRepository.lidMapping.getLIDForPN(realJid);
            if (foundLid) realLid = foundLid;
        }
    } catch (e) {}

    try {
        // Satukan semua identifier bersih ke dalam array query Mongoose
        const identifiers = [...new Set([cleanedRaw, cleanedAlt, realJid, realLid])].filter(Boolean);

        const deleteFilter = {
            role: "mod",
            $or: [
                { jid: { $in: identifiers } },
                { lid: { $in: identifiers } }
            ]
        };

        // Eksekusi hapus data
        const result = await RoleModel.findOneAndDelete(deleteFilter);

        if (!result) {
            await sock.sendMessage(jid, { 
                text: `⚠️ Target tidak terdaftar sebagai Moderator.` 
            }, { quoted: m });
            return true;
        }

        await sock.sendMessage(jid, { 
            text: `🗑️ **Berhasil Menghapus Moderator!**\n\n• **JID**: \`${result.jid || "Tidak ada data"}\`\n• **LID**: \`${result.lid || "Tidak ada data"}\`\n• **Status**: Akses dicabut.` 
        }, { quoted: m });

    } catch (err) {
        await sock.sendMessage(jid, { text: `❌ Gagal menghapus dari database: ${err.message}` }, { quoted: m });
    }

    return true;
}


    

    // 6. Tambah Guest Berdurasi (-c addguest) - Master & Mod
    if (cmd === "addguest") {
        const durationArg = args[3] || "1h"
        if (!targetJid) {
            await sock.sendMessage(jid, { text: "⚠️ Format salah. Contoh: `-c addguest @user 2h` atau `1d`" }, { quoted: m })
            return true
        }

        let ms = 60 * 60 * 1000
        if (durationArg.endsWith('h')) {
            ms = parseInt(durationArg) * 60 * 60 * 1000
        } else if (durationArg.endsWith('d')) {
            ms = parseInt(durationArg) * 24 * 60 * 60 * 1000
        }

        const expiresAt = new Date(Date.now() + ms)

        await RoleModel.findOneAndUpdate(
            { $or: [{ jid: targetJid }, { lid: targetJid }] },
            { jid: targetJid, role: 'guest', addedBy: sender, addedAt: new Date(), expiresAt },
            { upsert: true, returnDocument: 'after' }
        )
        await sock.sendMessage(jid, { text: `✅ Berhasil memberikan akses Guest kepada ${targetJid} selama ${durationArg}.` }, { quoted: m })
        return true
  }

    // 7. Tarik & Add Master/Mod ke Grup (-c addme <id_grup>) - Master & Mod
    if (cmd === "addme") {
        const targetGroupRaw = args[2]
        if (!targetGroupRaw) {
            await sock.sendMessage(jid, { text: "⚠️ Format salah. Contoh: `-c addme 120363123456789012`" }, { quoted: m })
            return true
        }

        const groupJid = formatGroupJid(targetGroupRaw)

        try {
            const roleRecord = await RoleModel.findOne({
                $or: [
                    { jid: sender },
                    { lid: sender }
                ]
            })

            if (!roleRecord || !roleRecord.jid) {
                await sock.sendMessage(jid, { text: `⚠️ Gagal: Identitas Anda tidak ditemukan di database RoleModel.` }, { quoted: m })
                return true
            }

            let validParticipantJid = roleRecord.jid

            // PENGAMANAN: Blokir JID berbasis LID (@lid) atau format non-nomor telepon 
            // agar tidak mengirim payload rusak ke WhatsApp yang dapat memicu penangguhan grup (Group Suspension).
            if (validParticipantJid.includes("@lid") || !validParticipantJid.endsWith("@s.whatsapp.net")) {
                await sock.sendMessage(jid, { text: `⚠️ Gagal: Akun Anda terdeteksi menggunakan format LID (@lid). Fitur -c addme hanya dapat digunakan oleh akun yang memiliki JID nomor telepon asli (@s.whatsapp.net).` }, { quoted: m })
                return true
            }

            const response = await sock.groupParticipantsUpdate(groupJid, [validParticipantJid], "add")
            const participantResult = response?.[0]

            if (participantResult && participantResult.status !== "200") {
                await sock.sendMessage(jid, { text: `⚠️ Gagal menambahkan Anda ke grup. Pastikan bot adalah Admin di grup tersebut dan ID grup benar. (Status: ${participantResult.status})` }, { quoted: m })
            } else {
                await sock.sendMessage(jid, { text: `✅ Berhasil menambahkan Anda (\`${validParticipantJid}\`) ke grup ${groupJid}.` }, { quoted: m })
            }
        } catch (err) {
            await sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${err.message}. Pastikan bot memiliki hak akses Admin di grup tujuan.` }, { quoted: m })
        }
        return true
    }


    // 8. Remote Chat ke Suatu Grup (-c rct <id_grup> <pesan>) - Master & Mod
    if (cmd === "rct") {
        const targetGroupRaw = args[2]
        const messageText = args.slice(3).join(" ")

        if (!targetGroupRaw || !messageText) {
            await sock.sendMessage(jid, { text: "⚠️ Format salah. Contoh: `-c rct 120363123456789012 Halo semua!`" }, { quoted: m })
            return true
        }

        const groupJid = formatGroupJid(targetGroupRaw)

        try {
            await sock.sendMessage(groupJid, { text: messageText })
            await sock.sendMessage(jid, { text: `✅ Pesan berhasil dikirim secara remote ke grup ${groupJid}.` }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `❌ Gagal mengirim pesan ke grup: ${err.message}` }, { quoted: m })
        }
        return true
    }

    // 9. Broadcast ke Semua Grup Terdaftar (-c bc <pesan>) - Master & Mod
    if (cmd === "bc") {
        const broadcastMessage = args.slice(2).join(" ")

        if (!broadcastMessage) {
            await sock.sendMessage(jid, { text: "⚠️ Format salah. Contoh: `-c bc Halo, ini pengumuman resmi bot.`" }, { quoted: m })
            return true
        }

        try {
            const registeredGroups = await GroupModel.find({ sessionId, registered: true })

            if (!registeredGroups || registeredGroups.length === 0) {
                await sock.sendMessage(jid, { text: "⚠️ Tidak ada grup yang terdaftar (`registered: true`) di sistem untuk dibroadcast." }, { quoted: m })
                return true
            }

            let successCount = 0
            let failCount = 0

            for (const group of registeredGroups) {
                try {
                    await sock.sendMessage(group.jid, { text: ` 📢 *PESAN SIARAN (BROADCAST)*\n\n${broadcastMessage}` })
                    successCount++
                    await new Promise(resolve => setTimeout(resolve, 1000))
                } catch (e) {
                    failCount++
                }
            }

            await sock.sendMessage(jid, { text: `✅ Broadcast selesai!\n- Berhasil terkirim: ${successCount} grup\n- Gagal: ${failCount} grup` }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat melakukan broadcast: ${err.message}` }, { quoted: m })
        }
        return true
    }

    // 10A. List Group Registered (-c listgr [page]) - Master & Mod
    if (cmd === "listgr") {
        const page = parseInt(args[2]) || 1
        const perPage = 25
        const skip = (page - 1) * perPage

        try {
            const totalGroups = await GroupModel.countDocuments({ sessionId, registered: true })
            const totalPages = Math.ceil(totalGroups / perPage) || 1

            if (page > totalPages && totalPages > 0) {
                await sock.sendMessage(jid, { text: `⚠️ Halaman ${page} tidak ditemukan. Total halaman tersedia: ${totalPages}.` }, { quoted: m })
                return true
            }

            const groups = await GroupModel.find({ sessionId, registered: true }).skip(skip).limit(perPage)

            if (groups.length === 0) {
                await sock.sendMessage(jid, { text: "⚠️ Belum ada grup yang terdaftar (`registered: true`) di database." }, { quoted: m })
                return true
            }

            let text = `📋 *DAFTAR GRUP TERDAFTAR (Page ${page} of ${totalPages})*\n\n`
            groups.forEach((g, index) => {
                const numericId = g.jid.split('@')[0]
                text += `${skip + index + 1}. \`${numericId}\`\n`
            })
            text += `\n_Gunakan -c listgr [halaman] untuk melihat halaman lainnya._`

            await sock.sendMessage(jid, { text }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `❌ Gagal mengambil daftar grup terdaftar: ${err.message}` }, { quoted: m })
        }
        return true
    }

    // 10B. List Group Saved / Belum Terdaftar (-c listgs [page]) - Master & Mod
    if (cmd === "listgs") {
        const page = parseInt(args[2]) || 1
        const perPage = 25
        const skip = (page - 1) * perPage

        try {
            const totalGroups = await GroupModel.countDocuments({ sessionId, registered: { $ne: true } })
            const totalPages = Math.ceil(totalGroups / perPage) || 1

            if (page > totalPages && totalPages > 0) {
                await sock.sendMessage(jid, { text: `⚠️ Halaman ${page} tidak ditemukan. Total halaman tersedia: ${totalPages}.` }, { quoted: m })
                return true
            }

            const groups = await GroupModel.find({ sessionId, registered: { $ne: true } }).skip(skip).limit(perPage)

            if (groups.length === 0) {
                await sock.sendMessage(jid, { text: "⚠️ Tidak ada grup tersimpan yang belum terdaftar." }, { quoted: m })
                return true
            }

            let text = `📋 *DAFTAR GRUP TERHIMPUN / SAVED (Page ${page} of ${totalPages})*\n\n`
            groups.forEach((g, index) => {
                const numericId = g.jid.split('@')[0]
                text += `${skip + index + 1}. \`${numericId}\`\n`
            })
            text += `\n_Gunakan -c listgs [halaman] untuk melihat halaman lainnya._`

            await sock.sendMessage(jid, { text }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `❌ Gagal mengambil daftar grup saved: ${err.message}` }, { quoted: m })
        }
        return true
    }

    // 11. Informasi Detail Grup (-c gi <id_grup>) - Master & Mod
    if (cmd === "gi") {
        const targetGroupRaw = args[2]
        if (!targetGroupRaw) {
            await sock.sendMessage(jid, { text: "⚠️ Format salah. Contoh: `-c gi 120363123456789012`" }, { quoted: m })
            return true
        }

        const groupJid = formatGroupJid(targetGroupRaw)

        try {
            const metadata = await sock.groupMetadata(groupJid)
            const subject = metadata.subject
            const totalMembers = metadata.participants.length
            const admins = metadata.participants.filter(v => v.admin === "admin" || v.admin === "superadmin")
            const adminCount = admins.length
            const regularCount = totalMembers - adminCount

            const infoText = `📊 *INFORMASI DETAIL GRUP*\n\n` +
                `📌 *Nama Grup:* ${subject}\n` +
                `🆔 *ID Grup:* \`${groupJid.split('@')[0]}\`\n` +
                `👥 *Total Member:* ${totalMembers}\n` +
                `🛡️ *Jumlah Admin:* ${adminCount}\n` +
                `👤 *Member Biasa:* ${regularCount}`

            await sock.sendMessage(jid, { text: infoText }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `❌ Gagal mengambil informasi grup. Pastikan ID benar dan bot berada di dalam grup tersebut. (${err.message})` }, { quoted: m })
        }
        return true
    }

    return false
}
