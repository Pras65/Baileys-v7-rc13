const RoleModel = require('../models/RoleModel')
const GroupModel = require('../models/GroupModel')
const MenuModel = require('../models/MenuModel')
const { clearJid, formatGroupJid, extractTarget } = require('./utils')

module.exports = async (sock, m, context) => {
    const { jid, sender, body, sessionId, isMaster, isMod, isGroup } = context
    const args = body.trim().split(/\s+/)
    const cmd = args[1]?.toLowerCase()

    if (cmd === "help" || !cmd) {
        const otoritasHelp = `╭── ⫹⫺ [ Management helper ] ⫹⫺
│  *User :* @${sender.split('@')[0]}
│  *Role :* ${isMaster ? 'Master' : 'Moderator'}
│  *Session:* ${sessionId}
╰───────────── ⧉

╭── ⫹⫺ [ 𝗖𝗢𝗠𝗠𝗔𝗡𝗗 𝗟𝗜𝗦𝗧 ]
│ ⊳ \`-c info\`
│ ⊳ \`-c reg\`
│ ⊳ \`-c gr [durasi] <id_grup>\`
│ ⊳ \`-c ugr <id_grup>\`
│ ⊳ \`-c addmod & demod\`
│ ⊳ \`-c addguest @user / reply [durasi]\`
│ ⊳ \`-c deguest @user / reply\`
│ ⊳ \`-c addme <id_grup>\`
│ ⊳ \`-c rct <id_grup> <pesan>\`
│ ⊳ \`-c bc <pesan>\`
│ ⊳ \`-c listgr / listgs [page]\`
│ ⊳ \`-c gi <id_grup>\`
│ ⊳ \`-c desb & .enb <.cmd>\`
╰───────────── ⧉`;

        await sock.sendMessage(jid, { text: otoritasHelp, mentions: [sender] }, { quoted: m })
        return true
    }

    if (cmd === "info") {
        try {
            const totalGroups = await GroupModel.countDocuments({ sessionId })
            const regGroups = await GroupModel.countDocuments({ sessionId, registered: true })
            const modsCount = await RoleModel.countDocuments({ role: 'mod' })
            const guestsCount = await RoleModel.countDocuments({ role: 'guest' })

            const infoText = `╭── ⫹⫺ [ 𝗦𝗬𝗦𝗧𝗘𝗠 𝗜𝗡𝗙𝗢 ] ⫹⫺
│ *Session :* ${sessionId}
│ *Role anda :* ${isMaster ? 'Master' : 'Moderator'}
╰───────────── ⧉

╭── ⫹⫺ [ 𝗗𝗔𝗧𝗔𝗕𝗔𝗦𝗘 𝗦𝗧𝗔𝗧𝗦 ]
│ *Group total :* ${totalGroups}
│ *Group terdaftar :* ${regGroups}
│ *Moderator :* ${modsCount}
│ *Guest :* ${guestsCount}
╰───────────── ⧉`;

            await sock.sendMessage(jid, { text: infoText }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Gagal memuat info sistem: ${err.message}` }, { quoted: m })
        }
        return true
    }

    if (cmd === "desb" || cmd === "enb") {
        if (!isMaster) {
            await sock.sendMessage(jid, { text: "Perintah ditolak." }, { quoted: m })
            return true
        }

        let targetCommand = args[2]
        if (!targetCommand) {
            await sock.sendMessage(jid, { text: `Format salah,\nGunakan : \`-c desb <.command>\` atau \`-c enb <.command>\`` }, { quoted: m })
            return true
        }

        targetCommand = targetCommand.replace(/^\./, '').trim()
        const isActive = (cmd === "enb")

        try {
            await MenuModel.findOneAndUpdate(
                { command: targetCommand },
                { 
                    command: targetCommand, 
                    isActive: isActive, 
                    disabledReason: isActive ? '' : 'Dinonaktifkan oleh master.', 
                    updatedAt: new Date(), 
                    updatedBy: sender 
                },
                { upsert: true, new: true }
            )

            const statusText = isActive ? 'Diaktifkan' : 'Dinonaktifkan'
            await sock.sendMessage(jid, { text: `*Otoritas master diterapkan!*\n\n• *Perintah*: \`.${targetCommand}\`\n• *Status*: ${statusText}` }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Gagal memproses otoritas: ${err.message}` }, { quoted: m })
        }
        return true
    }

    if (cmd === "reg") {
        let targetRegJid = jid
        if (!isGroup) {
            const targetGroupRaw = args[2]
            if (!targetGroupRaw) {
                await sock.sendMessage(jid, { text: "Format salah, Contoh : `-c reg 120363123456789012`" }, { quoted: m })
                return true
            }
            targetRegJid = formatGroupJid(targetGroupRaw)
        }

        const docId = `${sessionId}_${targetRegJid}`
        await GroupModel.findByIdAndUpdate(docId, { registered: true }, { upsert: true, returnDocument: 'after' })
        await sock.sendMessage(jid, { text: `Grup \`${targetRegJid.split('@')[0]}\` berhasil didaftarkan di database.` }, { quoted: m })
        return true
    }

    // Registrasi Grup Berdurasi dengan JID, LID, dan Role Penambah (-c gr)
    if (cmd === "gr") {
        let targetRegJid = jid;
        let durationArg = "7d";

        const arg2 = args[2];
        const arg3 = args[3];

        if (arg2) {
            if (arg2.endsWith('h') || arg2.endsWith('d') || arg2.endsWith('m')) {
                durationArg = arg2;
                if (arg3 && !isGroup) targetRegJid = formatGroupJid(arg3);
            } else if (!isGroup) {
                targetRegJid = formatGroupJid(arg2);
                if (arg3 && (arg3.endsWith('h') || arg3.endsWith('d') || arg3.endsWith('m'))) {
                    durationArg = arg3;
                }
            }
        }

        if (!isGroup && !args[2]) {
            await sock.sendMessage(jid, { text: "Format salah, Contoh (di privat chat): `-c gr 120363... 7d` atau di dalam grup cukup `-c gr 30d`" }, { quoted: m });
            return true;
        }

        let ms = 7 * 24 * 60 * 60 * 1000;
        if (durationArg.endsWith('h')) ms = parseInt(durationArg) * 60 * 60 * 1000;
        else if (durationArg.endsWith('d')) ms = parseInt(durationArg) * 24 * 60 * 60 * 1000;
        else if (durationArg.endsWith('m')) ms = parseInt(durationArg) * 30 * 24 * 60 * 60 * 1000;

        const expiresAt = new Date(Date.now() + ms);

        const roleRecord = await RoleModel.findOne({ $or: [{ jid: sender }, { lid: sender }] });
        const addedByRole = roleRecord?.role || (isMaster ? 'master' : 'mod');
        const addedByJid = roleRecord?.jid || sender;
        const addedByLid = roleRecord?.lid || "Tidak ada LID";

        const docId = `${sessionId}_${targetRegJid}`;
        await GroupModel.findByIdAndUpdate(docId, {
            sessionId,
            jid: targetRegJid,
            registered: true,
            expiresAt,
            addedByRole,
            addedByJid,
            addedByLid,
            updatedAt: new Date()
        }, { upsert: true, returnDocument: 'after' });

        const successText = `✅ *Grup Berhasil Diregistrasi!*\n\n` +
            `• *Grup JID*: \`${targetRegJid.split('@')[0]}\`\n` +
            `• *Durasi*: ${durationArg} (Expired: ${expiresAt.toLocaleString('id-ID')})\n` +
            `• *Ditambahkan oleh*:\n` +
            `  - Role: \`${addedByRole}\`\n` +
            `  - JID: \`${addedByJid}\`\n` +
            `  - LID: \`${addedByLid}\``;

        await sock.sendMessage(jid, { text: successText }, { quoted: m });
        return true;
    }

    // Unregister Grup Paksa (-c ugr)
    if (cmd === "ugr") {
        let targetUnregJid = jid;
        const targetGroupRaw = args[2];

        if (!isGroup) {
            if (!targetGroupRaw) {
                await sock.sendMessage(jid, { text: "Format salah, Contoh (di privat chat): `-c ugr 120363...`" }, { quoted: m });
                return true;
            }
            targetUnregJid = formatGroupJid(targetGroupRaw);
        }

        const docId = `${sessionId}_${targetUnregJid}`;
        const updated = await GroupModel.findByIdAndUpdate(docId, {
            registered: false,
            expiresAt: null,
            addedByRole: null,
            addedByJid: null,
            addedByLid: null
        });

        if (!updated) {
            await sock.sendMessage(jid, { text: `Grup \`${targetUnregJid.split('@')[0]}\` tidak ditemukan di database.` }, { quoted: m });
            return true;
        }

        await sock.sendMessage(jid, { text: `🗑️ *Registrasi Grup Dicabut!*\nGrup \`${targetUnregJid.split('@')[0]}\` kini berstatus tidak terdaftar.` }, { quoted: m });
        return true;
    }

    if (cmd === "addmod") {
        if (!isMaster) {
            await sock.sendMessage(jid, { text: "Hanya master yang berhak" }, { quoted: m })
            return true
        }
let rawTarget = null
let targetAlt = null

const contextInfo = m.message?.extendedTextMessage?.contextInfo || m.msg?.contextInfo

        if (contextInfo && contextInfo.participant) {
            rawTarget = contextInfo.participant
            if (contextInfo.participantAlt) targetAlt = contextInfo.participantAlt
        }

        if (!rawTarget && m.quoted) {
            rawTarget = m.quoted.sender || m.quoted.participant || m.quoted.key?.participant
            if (m.quoted.key?.participantAlt) targetAlt = m.quoted.key.participantAlt
        }

        if (!rawTarget) {
            const mentions = m.mentionedJid || contextInfo?.mentionedJid || m.msg?.mentionedJid
            if (Array.isArray(mentions) && mentions.length > 0) {
                rawTarget = mentions[0]
            }
        }

        if (!rawTarget && args && args[2]) {
            const inputArg = args[2].trim()
            if (inputArg.includes("@")) {
                rawTarget = inputArg
            } else {
                const cleanNum = inputArg.replace(/[^0-9]/g, "")
                if (cleanNum.length >= 5) rawTarget = cleanNum + "@s.whatsapp.net"
            }
        }

        if (!rawTarget) {
            await sock.sendMessage(jid, { text: "Format salah,\nGunakan : reply pesan target, mention (@tag), atau ketik nomor." }, { quoted: m })
            return true
        }

        let cleanedRaw = clearJid(rawTarget)
        let cleanedAlt = targetAlt ? clearJid(targetAlt) : null

        if (cleanedRaw) cleanedRaw = cleanedRaw.replace(/:[0-9]+/g, '')
        if (cleanedAlt) cleanedAlt = cleanedAlt.replace(/:[0-9]+/g, '')

        let realJid = ""
        let realLid = ""

        if (cleanedRaw.endsWith("@s.whatsapp.net")) realJid = cleanedRaw
        if (cleanedRaw.endsWith("@lid")) realLid = cleanedRaw
        
        if (cleanedAlt) {
            if (cleanedAlt.endsWith("@s.whatsapp.net")) realJid = cleanedAlt
            if (cleanedAlt.endsWith("@lid")) realLid = cleanedAlt
        }
        try {
            if (realLid && !realJid) {
                const foundJid = await sock.signalRepository.lidMapping.getPNForLID(realLid)
                if (foundJid) realJid = foundJid.replace(/:[0-9]+/g, '')
            } else if (realJid && !realLid) {
                const foundLid = await sock.signalRepository.lidMapping.getLIDForPN(realJid)
                if (foundLid) realLid = foundLid
            }
        } catch (e) {}
if ((!realJid || !realLid) && jid.endsWith("@g.us")) {
            try {
                const groupMeta = await sock.groupMetadata(jid)
                if (groupMeta && groupMeta.participants) {
                    const participant = groupMeta.participants.find(p => 
                        p.id?.replace(/:[0-9]+/g, '') === realJid || 
                        p.lid === realLid || 
                        p.id?.replace(/:[0-9]+/g, '') === cleanedRaw || 
                        p.lid === cleanedRaw
                    )

                    if (participant) {
                        if (participant.id) realJid = participant.id.replace(/:[0-9]+/g, '')
                        if (participant.lid) realLid = participant.lid
                    }
                }
            } catch (e) {}
        }

        if (!realJid && !realLid) {
            await sock.sendMessage(jid, { text: `Gagal mengenali identitas target (\`${rawTarget}\`).` }, { quoted: m })
            return true
        }

        try {
            const identifiers = [...new Set([cleanedRaw, cleanedAlt, realJid, realLid])].filter(Boolean)
            const queryFilter = { $or: [{ jid: { $in: identifiers } }, { lid: { $in: identifiers } }] }

            await RoleModel.findOneAndUpdate(
                queryFilter,
                { jid: realJid || "", lid: realLid || "", role: "mod", addedAt: new Date(), addedBy: sender },
                { upsert: true, returnDocument: 'after' }
            )

            await sock.sendMessage(jid, { text: ` [ *Berhasil add moderators!* ]\n\n *JID* : \`${realJid || "Tidak terdeteksi"}\`\n *LID* : \`${realLid || "Tidak terdeteksi"}\`` }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Gagal ke database: ${err.message}` }, { quoted: m })
        }
        return true
    }
           
    if (cmd === "demod") {
        if (!isMaster) {
            await sock.sendMessage(jid, { text: "Hanya master yang berhak" }, { quoted: m })
            return true
        }

        const cleanTarget = extractTarget(m, args, 2)
        if (!cleanTarget) {
            await sock.sendMessage(jid, { text: "Format salah, gunakan reply, mention, atau nomor." }, { quoted: m })
            return true
        }

        try {
            const result = await RoleModel.findOneAndDelete({ role: "mod", $or: [{ jid: cleanTarget }, { lid: cleanTarget }] })
            if (!result) {
                await sock.sendMessage(jid, { text: `Target tidak terdaftar sebagai moderator.` }, { quoted: m })
                return true
            }
            await sock.sendMessage(jid, { text: `[ *Berhasil delete moderators!* ]\n` }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Gagal menghapus dari database: ${err.message}` }, { quoted: m })
        }
        return true
    }

    if (cmd === "addguest") {

        const durationArg = args.slice(2).find(a => /^\d+[hd]$/i.test(a))
        if (!durationArg) {
            await sock.sendMessage(jid, { text: 'Format durasi salah. Gunakan contoh: `2h` (jam) atau `1d` (hari).' }, { quoted: m })
            return true
        }

        const match = durationArg.match(/^(\d+)([hd])$/i)
        const amount = parseInt(match[1], 10)
        const unit = match[2].toLowerCase()
        if (!amount || amount <= 0) {
            await sock.sendMessage(jid, { text: 'Durasi harus lebih dari 0.' }, { quoted: m })
            return true
        }
        const ms = unit === 'h' ? amount * 60 * 60 * 1000 : amount * 24 * 60 * 60 * 1000
        const expiresAt = new Date(Date.now() + ms)
let rawTarget = null
        let targetAlt = null

        const contextInfo = m.message?.extendedTextMessage?.contextInfo || m.msg?.contextInfo

        if (contextInfo && contextInfo.participant) {
            rawTarget = contextInfo.participant
            if (contextInfo.participantAlt) targetAlt = contextInfo.participantAlt
        }

        if (!rawTarget && m.quoted) {
            rawTarget = m.quoted.sender || m.quoted.participant || m.quoted.key?.participant
            if (m.quoted.key?.participantAlt) targetAlt = m.quoted.key.participantAlt
        }

        if (!rawTarget) {
            const mentions = m.mentionedJid || contextInfo?.mentionedJid || m.msg?.mentionedJid
            if (Array.isArray(mentions) && mentions.length > 0) {
                rawTarget = mentions[0]
            }
        }

        if (!rawTarget && args && args[2]) {
            const inputArg = args[2].trim()
            if (inputArg.includes("@")) {
                rawTarget = inputArg
            } else {
                const cleanNum = inputArg.replace(/[^0-9]/g, "")
                if (cleanNum.length >= 5) rawTarget = cleanNum + "@s.whatsapp.net"
            }
        }

        if (!rawTarget) {
            await sock.sendMessage(jid, { text: "Format salah,\nGunakan : reply pesan target, mention (@tag), atau ketik nomor." }, { quoted: m })
            return true
        }

        let cleanedRaw = clearJid(rawTarget)
        let cleanedAlt = targetAlt ? clearJid(targetAlt) : null

        if (cleanedRaw) cleanedRaw = cleanedRaw.replace(/:[0-9]+/g, '')
        if (cleanedAlt) cleanedAlt = cleanedAlt.replace(/:[0-9]+/g, '')

        let realJid = ""
        let realLid = ""

        if (cleanedRaw.endsWith("@s.whatsapp.net")) realJid = cleanedRaw
        if (cleanedRaw.endsWith("@lid")) realLid = cleanedRaw
        
        if (cleanedAlt) {
            if (cleanedAlt.endsWith("@s.whatsapp.net")) realJid = cleanedAlt
            if (cleanedAlt.endsWith("@lid")) realLid = cleanedAlt
        }
        try {
            if (realLid && !realJid) {
                const foundJid = await sock.signalRepository.lidMapping.getPNForLID(realLid)
                if (foundJid) realJid = foundJid.replace(/:[0-9]+/g, '')
            } else if (realJid && !realLid) {
                const foundLid = await sock.signalRepository.lidMapping.getLIDForPN(realJid)
                if (foundLid) realLid = foundLid
            }
        } catch (e) {}
if ((!realJid || !realLid) && jid.endsWith("@g.us")) {
            try {
                const groupMeta = await sock.groupMetadata(jid)
                if (groupMeta && groupMeta.participants) {
                    const participant = groupMeta.participants.find(p => 
                        p.id?.replace(/:[0-9]+/g, '') === realJid || 
                        p.lid === realLid || 
                        p.id?.replace(/:[0-9]+/g, '') === cleanedRaw || 
                        p.lid === cleanedRaw
                    )

                    if (participant) {
                        if (participant.id) realJid = participant.id.replace(/:[0-9]+/g, '')
                        if (participant.lid) realLid = participant.lid
                    }
                }
            } catch (e) {}
        }

        if (!realJid && !realLid) {
            await sock.sendMessage(jid, { text: `Gagal mengenali identitas target (\`${rawTarget}\`).` }, { quoted: m })
            return true
        }

        try {
            const identifiers = [...new Set([cleanedRaw, cleanedAlt, realJid, realLid])].filter(Boolean)
            const queryFilter = { $or: [{ jid: { $in: identifiers } }, { lid: { $in: identifiers } }] }

            await RoleModel.findOneAndUpdate(
                queryFilter,
                { jid: realJid || "", lid: realLid || "", role: "guest", addedAt: new Date(), addedBy: sender, expiresAt },
                { upsert: true, returnDocument: 'after' }
            )

            await sock.sendMessage(jid, { text: ` [ *Berhasil add guest!* ]\n\n *JID* : \`${realJid || "Tidak terdeteksi"}\`\n *LID* : \`${realLid || "Tidak terdeteksi"}\`` }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Gagal ke database: ${err.message}` }, { quoted: m })
        }
        return true
    }
        
    if (cmd === "deguest") {
        const cleanTarget = extractTarget(m, args, 2)
        if (!cleanTarget) {
            await sock.sendMessage(jid, { text: "Format salah, gunakan reply, mention, atau ketik nomor untuk mencabut akses guest." }, { quoted: m })
            return true
        }

        try {
            const result = await RoleModel.findOneAndDelete({ role: "guest", $or: [{ jid: cleanTarget }, { lid: cleanTarget }] })
            if (!result) {
                await sock.sendMessage(jid, { text: `Target tidak terdaftar sebagai guest aktif.` }, { quoted: m })
                return true
            }
            await sock.sendMessage(jid, { text: `🗑️ *Berhasil mencabut akses guest dari target!*` }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Gagal menghapus dari database: ${err.message}` }, { quoted: m })
        }
        return true
    }

    if (cmd === "addme") {
        const targetGroupRaw = args[2]
        if (!targetGroupRaw) {
            await sock.sendMessage(jid, { text: "Format salah, Contoh : `-c addme 120363...`" }, { quoted: m })
            return true
        }

        const groupJid = formatGroupJid(targetGroupRaw)
        try {
            const roleRecord = await RoleModel.findOne({ $or: [{ jid: sender }, { lid: sender }] })
            if (!roleRecord || !roleRecord.jid || roleRecord.jid.includes("@lid")) {
                await sock.sendMessage(jid, { text: `Gagal: Identitas JID nomor telepon asli tidak ditemukan.` }, { quoted: m })
                return true
            }

            const response = await sock.groupParticipantsUpdate(groupJid, [roleRecord.jid], "add")
            if (response?.[0]?.status !== "200") {
                await sock.sendMessage(jid, { text: `Gagal menambahkan Anda ke grup.` }, { quoted: m })
            } else {
                await sock.sendMessage(jid, { text: `Berhasil menambahkan Anda ke grup.` }, { quoted: m })
            }
        } catch (err) {
            await sock.sendMessage(jid, { text: `Terjadi kesalahan: ${err.message}` }, { quoted: m })
        }
        return true
    }

    if (cmd === "rct") {
        const targetGroupRaw = args[2]
        const messageText = args.slice(3).join(" ")
        if (!targetGroupRaw || !messageText) {
            await sock.sendMessage(jid, { text: "Format salah, Contoh : `-c rct <id_grup> <pesan>`" }, { quoted: m })
            return true
        }
        const groupJid = formatGroupJid(targetGroupRaw)
        try {
            await sock.sendMessage(groupJid, { text: messageText })
            await sock.sendMessage(jid, { text: `Pesan remote terkirim.` }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Gagal: ${err.message}` }, { quoted: m })
        }
        return true
    }

    if (cmd === "bc") {
        const broadcastMessage = args.slice(2).join(" ")
        if (!broadcastMessage) {
            await sock.sendMessage(jid, { text: "Format salah, Contoh : `-c bc <pesan>`" }, { quoted: m })
            return true
        }
        try {
            const registeredGroups = await GroupModel.find({ sessionId, registered: true })
            if (!registeredGroups.length) {
                await sock.sendMessage(jid, { text: "Tidak ada grup terdaftar." }, { quoted: m })
                return true
            }

            let success = 0
            for (const group of registeredGroups) {
                try {
                    await sock.sendMessage(group.jid, { text: `\n\n${broadcastMessage}` })
                    success++
                    await new Promise(resolve => setTimeout(resolve, 1000))
                } catch (e) {}
            }
            await sock.sendMessage(jid, { text: `Broadcast selesai! Terkirim ke ${success} grup.` }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Error: ${err.message}` }, { quoted: m })
        }
        return true
    }

    if (cmd === "listgr" || cmd === "listgs") {
        const isReg = cmd === "listgr"
        const page = parseInt(args[2]) || 1
        const perPage = 25
        const skip = (page - 1) * perPage

        try {
            const filter = { sessionId, registered: isReg ? true : { $ne: true } }
            const total = await GroupModel.countDocuments(filter)
            const totalPages = Math.ceil(total / perPage) || 1
            const groups = await GroupModel.find(filter).skip(skip).limit(perPage)

            if (!groups.length) {
                await sock.sendMessage(jid, { text: "Tidak ada data grup." }, { quoted: m })
                return true
            }

            let text = `*Daftar Grup (${page}/${totalPages})*\n\n`
            groups.forEach((g, idx) => {
                text += `${skip + idx + 1}. \`${g.jid.split('@')[0]}\`\n`
            })
            await sock.sendMessage(jid, { text }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Error: ${err.message}` }, { quoted: m })
        }
        return true
    }

    if (cmd === "gi") {
        const targetGroupRaw = args[2]
        if (!targetGroupRaw) {
            await sock.sendMessage(jid, { text: "Format salah, Contoh : `-c gi <id_grup>`" }, { quoted: m })
            return true
        }
        const groupJid = formatGroupJid(targetGroupRaw)
        try {
            const metadata = await sock.groupMetadata(groupJid)
            const total = metadata.participants.length
            const admins = metadata.participants.filter(v => v.admin).length
            await sock.sendMessage(jid, { text: `*Info Grup*\nNama: ${metadata.subject}\nTotal: ${total}\nAdmin: ${admins}` }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Gagal mengambil info: ${err.message}` }, { quoted: m })
        }
        return true
    }

    return false
}
