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

    // 1. Menu Bantuan Otoritas (-c help) -> UI Cyber Terminal
    if (cmd === "help" || !cmd) {
        const otoritasHelp = `╭── ⫹⫺ [ Management helper ] ⫹⫺
│  *User :* @${sender.split('@')[0]}
│ ️ *Role :* ${isMaster ? 'Master' : 'Moderator️'}
│  *Session:* ${sessionId}
╰───────────── ⧉

╭── ⫹⫺ [ 𝗖𝗢𝗠𝗠𝗔𝗡𝗗 𝗟𝗜𝗦𝗧 ]
│ ⊳ \`-c info\`
│ ⊳ \`-c reg\`
│ ⊳ \`-c addmod & demod\`
│ ⊳ \`-c addguest @user [durasi]\`
│ ⊳ \`-c addme <id_grup>\`
│ ⊳ \`-c rct <id_grup> <pesan>\`
│ ⊳ \`-c bc <pesan>\`
│ ⊳ \`-c listgr / listgs [page]\`
│ ⊳ \`-c gi <id_grup>\`
│ ⊳ \`-c desb & .enb <.cmd>\`
╰───────────── ⧉`;

        await sock.sendMessage(jid, { 
            text: otoritasHelp, 
            mentions: [sender] 
        }, { quoted: m })
        return true
    }

    // 2. Informasi Sistem Bot (-c info) -> UI Cyber Terminal
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
            await sock.sendMessage(jid, { text: ` Gagal memuat info sistem: ${err.message}` }, { quoted: m })
        }
        return true
    }

    // 3. Manajemen Status Menu (-c desb / -c enb) - HANYA MASTER
    if (cmd === "desb" || cmd === "enb") {
        if (!isMaster) {
            await sock.sendMessage(jid, { text: "Perintah ditolak." }, { quoted: m })
            return true
        }

        let targetCommand = args[2]
        if (!targetCommand) {
            await sock.sendMessage(jid, { text: `Format salah,\nGunakan : \`-c desb <.command> <alasan>\` atau \`-c enb <.command>\`` }, { quoted: m })
            return true
        }

        targetCommand = targetCommand.replace(/^\./, '').trim()
        const isActive = (cmd === "enb")
        
        const reasonIndex = args.indexOf(args[2]) + 1
        const reason = args.slice(reasonIndex).join(' ') || "Menu belum tersedia dan masih tahap pengujian."

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
            )

            const statusText = isActive ? 'Diaktifkan' : 'Dinonaktifkan'
      let feedback = `*Otoritas master diterapkan!,*\n\n• **perintah**: \`.${targetCommand}\`\n• **Status**: ${statusText}`
            if (!isActive) feedback += `\n• *reason :*: _${reason}_`

            await sock.sendMessage(jid, { text: feedback }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Gagal memproses otoritas: ${err.message}` }, { quoted: m })
        }
        return true
    }

    // 4. Registrasi Grup (-c reg)
    if (cmd === "reg") {
        let targetRegJid = jid
        if (!isGroup) {
            const targetGroupRaw = args[2]
            if (!targetGroupRaw) {
                await sock.sendMessage(jid, { text: " Format salah, jika dikirim dari privat chat, Contoh : `-c reg 120363123456789012`" }, { quoted: m })
                return true
            }
            targetRegJid = formatGroupJid(targetGroupRaw)
        }

        const docId = `${sessionId}_${targetRegJid}`
        await GroupModel.findByIdAndUpdate(docId, { registered: true }, { upsert: true, returnDocument: 'after' })
        await sock.sendMessage(jid, { text: `Grup \`${targetRegJid.split('@')[0]}\` berhasil didaftarkan di database.` }, { quoted: m })
        return true
    }

    // 5. Add Moderator (-c addmod)
    if (cmd === "addmod") {
        if (!isMaster) {
            await sock.sendMessage(jid, { text: "Hanya master yang berhak" }, { quoted: m })
            return true
        }

        let rawTarget = null
        let targetAlt = null

        const contextInfo = m.message?.extendedTextMessage?.contextInfo ||
                            m.message?.imageMessage?.contextInfo ||
                            m.message?.videoMessage?.contextInfo ||
                            m.message?.documentMessage?.contextInfo ||
                            m.msg?.contextInfo

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
                { upsert: true, new: true }
            )

            await sock.sendMessage(jid, { text: ` *Berhasil menambahkan moderator!*\n\n• *JID* : \`${realJid || "Tidak terdeteksi"}\`\n• *LID* : \`${realLid || "Tidak terdeteksi"}\`` }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Gagal ke database: ${err.message}` }, { quoted: m })
        }
        return true
    }
           
    // 6. Demod (-c demod)
    if (cmd === "demod") {
        if (!isMaster) {
            await sock.sendMessage(jid, { text: "Hanya master yang berhak" }, { quoted: m })
            return true
        }

        let rawTarget = null
        let targetAlt = null

        const contextInfo = m.message?.extendedTextMessage?.contextInfo ||
                            m.message?.imageMessage?.contextInfo ||
                            m.message?.videoMessage?.contextInfo ||
                            m.message?.documentMessage?.contextInfo ||
                            m.msg?.contextInfo

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
            if (Array.isArray(mentions) && mentions.length > 0) rawTarget = mentions[0]
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
            await sock.sendMessage(jid, { text: "Format salah,\nGunakan : Reply pesan target, mention (@tag), atau ketik nomor." }, { quoted: m })
            return true
        }

        let cleanedRaw = clearJid(rawTarget)
        let cleanedAlt = targetAlt ? clearJid(targetAlt) : null

        if (cleanedRaw) cleanedRaw = cleanedRaw.replace(/:[0-9]+/g, '')
        if (cleanedAlt) cleanedAlt = cleanedAlt.replace(/:[0-9]+/g, '')

        let realJid = cleanedRaw.endsWith("@s.whatsapp.net") ? cleanedRaw : (cleanedAlt?.endsWith("@s.whatsapp.net") ? cleanedAlt : "")
        let realLid = cleanedRaw.endsWith("@lid") ? cleanedRaw : (cleanedAlt?.endsWith("@lid") ? cleanedAlt : "")

        try {
            if (realLid && !realJid) {
                const foundJid = await sock.signalRepository.lidMapping.getPNForLID(realLid)
                if (foundJid) realJid = foundJid.replace(/:[0-9]+/g, '')
            } else if (realJid && !realLid) {
                const foundLid = await sock.signalRepository.lidMapping.getLIDForPN(realJid)
                if (foundLid) realLid = foundLid
            }
        } catch (e) {}

        try {
            const identifiers = [...new Set([cleanedRaw, cleanedAlt, realJid, realLid])].filter(Boolean)
            const deleteFilter = { role: "mod", $or: [{ jid: { $in: identifiers } }, { lid: { $in: identifiers } }] }

            const result = await RoleModel.findOneAndDelete(deleteFilter)

            if (!result) {
                await sock.sendMessage(jid, { text: `Target tidak terdaftar sebagai moderator.` }, { quoted: m })
                return true
            }

            await sock.sendMessage(jid, { text: `🗑️ *Berhasil menghapus moderator!*\n\n• *JID* : \`${result.jid || "tidak ada data"}\`\n• *LID* : \`${result.lid || "tidak ada data"}\`\n• *Status* : akses dicabut.` }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Gagal menghapus dari database: ${err.message}` }, { quoted: m })
        }
        return true
    }

    // 7. Tambah Guest Berdurasi (-c addguest)
    if (cmd === "addguest") {
        const durationArg = args[3] || "1h"
        if (!targetJid) {
            await sock.sendMessage(jid, { text: " Format salah, Contoh : `-c addguest @user 2h` atau `1d`" }, { quoted: m })
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
        await sock.sendMessage(jid, { text: `Berhasil memberikan akses Guest kepada ${targetJid} selama ${durationArg}.` }, { quoted: m })
        return true
    }

    // 8. Tarik & Add Master/Mod ke Grup (-c addme <id_grup>)
    if (cmd === "addme") {
        const targetGroupRaw = args[2]
        if (!targetGroupRaw) {
            await sock.sendMessage(jid, { text: " Format salah, Contoh : `-c addme 120363123456789012`" }, { quoted: m })
            return true
        }

        const groupJid = formatGroupJid(targetGroupRaw)

        try {
            const roleRecord = await RoleModel.findOne({ $or: [{ jid: sender }, { lid: sender }] })

            if (!roleRecord || !roleRecord.jid) {
                await sock.sendMessage(jid, { text: ` Gagal : identitas Anda tidak ditemukan di database internal.` }, { quoted: m })
                return true
            }

            let validParticipantJid = roleRecord.jid

            if (validParticipantJid.includes("@lid") || !validParticipantJid.endsWith("@s.whatsapp.net")) {
                await sock.sendMessage(jid, { text: ` Gagal : Akun Anda terdeteksi menggunakan format LID (@lid), Fitur -c addme hanya dapat digunakan oleh akun yang memiliki JID nomor telepon asli (@s.whatsapp.net).` }, { quoted: m })
                return true
            }

            const response = await sock.groupParticipantsUpdate(groupJid, [validParticipantJid], "add")
            const participantResult = response?.[0]

            if (participantResult && participantResult.status !== "200") {
                await sock.sendMessage(jid, { text: ` Gagal menambahkan anda ke gorup, Pastikan bot adalah admin di grup tersebut dan id grup benar. (Status: ${participantResult.status})` }, { quoted: m })
            } else {
                await sock.sendMessage(jid, { text: ` Berhasil menambahkan Anda (\`${validParticipantJid}\`) ke grup ${groupJid}.` }, { quoted: m })
            }
        } catch (err) {
            await sock.sendMessage(jid, { text: `Terjadi kesalahan : ${err.message}, Pastikan bot memiliki hak akses admin di grup tujuan.` }, { quoted: m })
        }
        return true
    }

    // 9. Remote Chat ke Suatu Grup (-c rct <id_grup> <pesan>)
    if (cmd === "rct") {
        const targetGroupRaw = args[2]
        const messageText = args.slice(3).join(" ")

        if (!targetGroupRaw || !messageText) {
            await sock.sendMessage(jid, { text: "Format salah, Contoh : `-c rct 120363123456789012 Halo semua!`" }, { quoted: m })
            return true
        }

        const groupJid = formatGroupJid(targetGroupRaw)

        try {
            await sock.sendMessage(groupJid, { text: messageText })
            await sock.sendMessage(jid, { text: `Pesan berhasil dikirim secara remote ke grup ${groupJid}.` }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Gagal mengirim pesan ke grup: ${err.message}` }, { quoted: m })
        }
        return true
    }

    // 10. Broadcast ke Semua Grup Terdaftar (-c bc <pesan>)
    if (cmd === "bc") {
        const broadcastMessage = args.slice(2).join(" ")

        if (!broadcastMessage) {
            await sock.sendMessage(jid, { text: " Format salah, Contoh : `-c bc Halo, ini pengumuman resmi bot.`" }, { quoted: m })
            return true
        }

        try {
            const registeredGroups = await GroupModel.find({ sessionId, registered: true })

            if (!registeredGroups || registeredGroups.length === 0) {
                await sock.sendMessage(jid, { text: "️ Tidak ada group yang terdaftar (`registered: true`) di sistem untuk dibroadcast." }, { quoted: m })
                return true
            }

            let successCount = 0
            let failCount = 0

            for (const group of registeredGroups) {
                try {
                    await sock.sendMessage(group.jid, { text: `\n\n${broadcastMessage}` })
                    successCount++
                    await new Promise(resolve => setTimeout(resolve, 1000))
                } catch (e) {
                    failCount++
                }
            }

            await sock.sendMessage(jid, { text: ` Broadcast selesai!\n- Berhasil terkirim : ${successCount} group\n- Gagal: ${failCount} group` }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Terjadi kesalahan saat melakukan broadcast: ${err.message}` }, { quoted: m })
        }
        return true
    }

    // 11A. List Group Registered (-c listgr)
    if (cmd === "listgr") {
        const page = parseInt(args[2]) || 1
        const perPage = 25
        const skip = (page - 1) * perPage

        try {
            const totalGroups = await GroupModel.countDocuments({ sessionId, registered: true })
            const totalPages = Math.ceil(totalGroups / perPage) || 1

            if (page > totalPages && totalPages > 0) {
                await sock.sendMessage(jid, { text: `️ Halaman ${page} tidak ditemukan, Total halaman tersedia : ${totalPages}.` }, { quoted: m })
                return true
            }

            const groups = await GroupModel.find({ sessionId, registered: true }).skip(skip).limit(perPage)

            if (groups.length === 0) {
                await sock.sendMessage(jid, { text: " Belum ada group yang terdaftar (`registered: true`) di database." }, { quoted: m })
                return true
            }

            let text = `*Daftar group terverifikasi (Page ${page} of ${totalPages})*\n\n`
            groups.forEach((g, index) => {
                const numericId = g.jid.split('@')[0]
                text += `${skip + index + 1}. \`${numericId}\`\n`
            })
            text += `\n_Gunakan -c listgr [ halaman ] untuk melihat halaman lainnya._`

            await sock.sendMessage(jid, { text }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Gagal mengambil daftar group terverifikasi : ${err.message}` }, { quoted: m })
        }
        return true
    }

    // 11B. List Group Saved / Belum Terdaftar (-c listgs)
    if (cmd === "listgs") {
        const page = parseInt(args[2]) || 1
        const perPage = 25
        const skip = (page - 1) * perPage

        try {
            const totalGroups = await GroupModel.countDocuments({ sessionId, registered: { $ne: true } })
            const totalPages = Math.ceil(totalGroups / perPage) || 1

            if (page > totalPages && totalPages > 0) {
                await sock.sendMessage(jid, { text: `Halaman ${page} tidak ditemukan, Total halaman tersedia : ${totalPages}.` }, { quoted: m })
                return true
            }

            const groups = await GroupModel.find({ sessionId, registered: { $ne: true } }).skip(skip).limit(perPage)

            if (groups.length === 0) {
                await sock.sendMessage(jid, { text: " Tidak ada grup tersimpan yang belum terverifikasi." }, { quoted: m })
                return true
            }

            let text = `*Daftar group belum terverifikasi (Page ${page} of ${totalPages})*\n\n`
            groups.forEach((g, index) => {
                const numericId = g.jid.split('@')[0]
                text += `${skip + index + 1}. \`${numericId}\`\n`
            })
            text += `\n_Gunakan -c listgs [halaman] untuk melihat halaman lainnya._`

            await sock.sendMessage(jid, { text }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: ` Gagal mengambil daftar grup terlantar: ${err.message}` }, { quoted: m })
        }
        return true
    }

    // 12. Informasi Detail Grup (-c gi <id_grup>)
    if (cmd === "gi") {
        const targetGroupRaw = args[2]
        if (!targetGroupRaw) {
            await sock.sendMessage(jid, { text: "Format salah, Contoh : `-c gi 120363123456789012`" }, { quoted: m })
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

            const infoText = `*Group info*\n\n` +
                ` *Nama group:* ${subject}\n` +
                ` *ID group:* \`${groupJid.split('@')[0]}\`\n` +
                ` *Total member:* ${totalMembers}\n` +
                `️ *Jumlah admin:* ${adminCount}\n` +
                ` *Member biasa:* ${regularCount}`

            await sock.sendMessage(jid, { text: infoText }, { quoted: m })
        } catch (err) {
            await sock.sendMessage(jid, { text: `Gagal mengambil informasi grup, Pastikan id benar dan bot berada di dalam grup tersebut. (${err.message})` }, { quoted: m })
        }
        return true
    }

    return false
}
