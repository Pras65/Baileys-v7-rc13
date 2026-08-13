const GROUPS = new Map()
const PREFIX = "."
const MASTER = [
    "6285779306512@s.whatsapp.net",
    "260129140297849@lid"
]

function getSetting(jid) {
    if (!GROUPS.has(jid)) {
        GROUPS.set(jid, { antilink: false, antiapk: false })
    }
    return GROUPS.get(jid)
}

function clearJid(jid) {
    if (!jid) return ""
    const parts = jid.split("@")
    const user = parts[0].split(":")[0]
    const domain = parts[1] || "s.whatsapp.net"
    return `${user}@${domain}`
}

const isMaster = (jid) => MASTER.includes(clearJid(jid))

function getMentioned(msg) {
    return msg?.extendedTextMessage?.contextInfo?.mentionedJid || []
}

async function isBotAdmin(sock, jid) {
    try {
        const metadata = await sock.groupMetadata(jid)
        const myId = clearJid(sock.user?.id)
        const myLid = clearJid(sock.user?.lid)
        const botData = metadata.participants.find(v => {
            const pid = clearJid(v.id)
            const plid = v.lid ? clearJid(v.lid) : null
            return pid === myId || (myLid && pid === myLid) || (plid && pid === myId) || (myLid && plid && plid === myLid)
        })
        return botData ? (botData.admin === "admin" || botData.admin === "superadmin") : false
    } catch (err) {
        return false
    }
}

async function isAdmin(sock, jid, user) {
    try {
        const metadata = await sock.groupMetadata(jid)
        const cleanUser = clearJid(user)
        return metadata.participants.some(v =>
            (v.admin === "admin" || v.admin === "superadmin") &&
            (clearJid(v.id) === cleanUser || (v.lid && clearJid(v.lid) === cleanUser))
        )
    } catch (err) {
        return false
    }
}

async function getGroupInfo(sock, jid, sender) {
    const metadata = await sock.groupMetadata(jid)
    const cleanSender = clearJid(sender)
    const myId = clearJid(sock.user?.id)
    const myLid = clearJid(sock.user?.lid)

    const admins = metadata.participants.filter(v => v.admin === "admin" || v.admin === "superadmin")
    const isadmin = admins.some(v =>
        clearJid(v.id) === cleanSender || (v.lid && clearJid(v.lid) === cleanSender)
    )
    const botadmin = admins.some(v => {
        const pid = clearJid(v.id)
        const plid = v.lid ? clearJid(v.lid) : null
        return pid === myId || (myLid && pid === myLid) || (plid && pid === myId) || (myLid && plid && plid === myLid)
    })

    return { metadata, admins, isadmin, botadmin }
}

async function getTarget(message) {
    const msg = message.message
    const mention = getMentioned(msg)
    if (mention.length) return clearJid(mention[0])

    const quoted = msg?.extendedTextMessage?.contextInfo?.participant
    if (quoted) return clearJid(quoted)

    const text = msg?.conversation || msg?.extendedTextMessage?.text || ""
    const parts = text.trim().split(/\s+/)
    parts.shift() 
    if (parts.length > 0) {
        let num = parts.join("").replace(/[^0-9]/g, "")
        if (num.startsWith("0")) num = "62" + num.slice(1)
        else if (!num.startsWith("62")) num = "62" + num
        if (num.length >= 11 && num.length <= 15) return clearJid(num + "@s.whatsapp.net")
    }
    return null
}

module.exports = async (sock, m, { jid, sender, body }) => {
    try {
        const reply = (text, quoted = m) => sock.sendMessage(jid, { text }, { quoted })
        const setting = getSetting(jid)

        // 1. Anti-link
        if (setting.antilink && !isMaster(sender) && !(await isAdmin(sock, jid, sender))) {
            const text = body.toLowerCase()
            const detect = text.includes("chat.whatsapp.com/") || text.includes("wa.me/") || text.includes("https://") || text.includes("http://")
            if (detect && (await isBotAdmin(sock, jid))) {
                await sock.sendMessage(jid, { delete: m.key })
            }
        }

        // 2. Anti-APK
        if (setting.antiapk && !isMaster(sender) && !(await isAdmin(sock, jid, sender))) {
            const doc = m.message?.documentMessage
            if (doc && doc.mimetype === "application/vnd.android.package-archive") {
                if (await isBotAdmin(sock, jid)) {
                    await sock.sendMessage(jid, { delete: m.key })
                }
            }
        }

        if (!body.startsWith(PREFIX)) return
        const args = body.slice(PREFIX.length).trim().split(/\s+/)
        const cmd = args.shift().toLowerCase()

        const allow = isMaster(sender) || (await isAdmin(sock, jid, sender))
        if (!allow) return reply("Command khusus admin group & master.", m)

        switch (cmd) {
            case "kick": {
                const target = await getTarget(m)
                if (!target) return reply("Reply, tag, atau masukkan nomor whatsapp.", m)
                if (target === sender) return reply("Tidak bisa kick diri sendiri.", m)
                if (isMaster(target)) return reply("Target adalah master.", m)
                if (await isAdmin(sock, jid, target)) return reply("Tidak bisa kick admin.", m)
                if (!(await isBotAdmin(sock, jid))) return reply("Bot bukan admin.", m)

                await sock.groupParticipantsUpdate(jid, [target], "remove")
                return reply("Member berhasil dikeluarkan.", m)
            }

            case "add": {
                if (!(await isBotAdmin(sock, jid))) return reply("Bot bukan admin.", m)
                const target = await getTarget(m)
                if (!target) return reply("Masukkan nomor whatsapp yang benar.", m)
                if (target === clearJid(sock.user?.id) || target === clearJid(sock.user?.lid)) return reply("Gak bisa add bot sendiri.", m)
                
                await reply(`Prosess add members...`, m)
                try {
                    const res = await sock.groupParticipantsUpdate(jid, [target], "add")
                    const result = res[0]
                    if (result.status === "200") return reply(`${target.split('@')[0]} berhasil ditambahkan.`, m)
                    if (result.status === "403") return reply(`Gagal, privasi akun membatasi penambahan otomatis. Kirim link group saja via {.linkgroup}.`, m)
                    if (result.status === "401") return reply(`Gagal, nomor sudah ada di group atau pernah keluar sendiri.`, m)
                    if (result.status === "404") return reply(`Gagal, nomor tidak terdaftar di WhatsApp.`, m)
                    return reply(`Gagal menambahkan, Kode : ${result.status}`, m)
                } catch (e) {
                    return reply(`error: ${e.message}`, m)
                }
            }

            case "promote": {
                if (!(await isBotAdmin(sock, jid))) return reply("Bot bukan admin.", m)
                const target = await getTarget(m)
                if (!target) return reply("Target tidak ditemukan.", m)
                if (await isAdmin(sock, jid, target)) return reply("User sudah menjadi admin.", m)

                await sock.groupParticipantsUpdate(jid, [target], "promote")
                return reply("Promote berhasil.", m)
            }

            case "demote": {
                if (!(await isBotAdmin(sock, jid))) return reply("Bot bukan admin.", m)
                const target = await getTarget(m)
                if (!target) return reply("Target tidak ditemukan.", m)
                if (isMaster(target)) return reply("Master tidak bisa di-demote.", m)
                if (!(await isAdmin(sock, jid, target))) return reply("Target bukan admin.", m)

                await sock.groupParticipantsUpdate(jid, [target], "demote")
                return reply("Demote berhasil.", m)
            }

            case "delete":
            case "del": {
                const contextInfo = m.message?.extendedTextMessage?.contextInfo
                if (!contextInfo?.stanzaId) return reply("Reply pesan yang ingin dihapus.", m)

                const participant = contextInfo.participant
                const isBotMessage = clearJid(participant) === clearJid(sock.user?.id)

                await sock.sendMessage(jid, {
                    delete: {
                        remoteJid: jid,
                        fromMe: isBotMessage,
                        id: contextInfo.stanzaId,
                        participant: participant
                    }
                })
                return
            }

            case "help": {
                return reply(`*Nayozu command helper*\n\n${PREFIX}help\n${PREFIX}groupinfo\n${PREFIX}members\n\n${PREFIX}kick\n${PREFIX}add\n${PREFIX}promote\n${PREFIX}demote\n${PREFIX}delete\n${PREFIX}antilink on/off\n${PREFIX}antiapk on/off\n${PREFIX}open\n${PREFIX}close\n${PREFIX}linkgroup\n${PREFIX}resetlink`, m)
            }

            case "groupinfo": {
                const data = await getGroupInfo(sock, jid, sender)
                return reply(`*Group info*\n\nNama :\n${data.metadata.subject}\n\nID :\n${jid}\n\nMember :\n${data.metadata.participants.length}\n\nAdmin :\n${data.admins.length}\n\nBot admin :\n${data.botadmin ? "Ya" : "Tidak"}\n\nAnti Link :\n${setting.antilink ? "ON" : "OFF"}\n\nAnti APK :\n${setting.antiapk ? "ON" : "OFF"}`, m)
            }

            case "members": {
                const data = await getGroupInfo(sock, jid, sender)
                const total = data.metadata.participants.length
                const admin = data.admins.length
                const member = total - admin
                return reply(`*Member info*\n\nTotal :\n${total}\n\nAdmin :\n${admin}\n\nMember :\n${member}`, m)
            }

            case "antilink": {
                const opt = args[0]?.toLowerCase()
                if (opt !== "on" && opt !== "off") return reply(".antilink on/off", m)
                setting.antilink = opt === "on"
                return reply(`Anti Link ${setting.antilink ? "diaktifkan" : "dimatikan"}.`, m)
            }

            case "antiapk": {
                const opt = args[0]?.toLowerCase()
                if (opt !== "on" && opt !== "off") return reply(".antiapk on/off", m)
                setting.antiapk = opt === "on"
                return reply(`Anti APK ${setting.antiapk ? "diaktifkan" : "dimatikan"}.`, m)
            }

            case "open": {
                if (!(await isBotAdmin(sock, jid))) return reply("Bot bukan admin.", m)
                await sock.groupSettingUpdate(jid, "not_announcement")
                return reply("Group berhasil dibuka.", m)
            }

            case "close": {
                if (!(await isBotAdmin(sock, jid))) return reply("Bot bukan admin.", m)
                await sock.groupSettingUpdate(jid, "announcement")
                return reply("Group berhasil ditutup.", m)
            }

            case "linkgroup": {
                if (!(await isBotAdmin(sock, jid))) return reply("Bot bukan admin.", m)
                const code = await sock.groupInviteCode(jid)
                return reply(`https://chat.whatsapp.com/${code}`, m)
            }

            case "resetlink": {
                if (!(await isBotAdmin(sock, jid))) return reply("Bot bukan admin.", m)
                const code = await sock.groupRevokeInvite(jid)
                return reply(`Link baru:\n\nhttps://chat.whatsapp.com/${code}`, m)
            }

            default:
                break
        }
    } catch (err) {
        console.log("Error in groupController execution:", err)
    }
}
