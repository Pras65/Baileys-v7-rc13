/* ===============================
 * Nayozu bot 
 * Engine : Baileys v7.0.0
 * Environment : Termux / Node.js
 * =============================== */
const { Boom } = require("@hapi/boom")
const { getSock } = require("./index.js")
const SESSION_FOLDER = "./baileys-auth" 
const PREFIX = "."
const GROUPS = new Map()
const MASTER = [
    "6285779306512@s.whatsapp.net",
    "260129140297849@lid"
]
const sock = getSock() 
console.log("[ Groups ] Handler loaded, nunggu sock ready...")
function init() {
    if (!sock) return setTimeout(init, 1000)
    console.log("[ Groups ] Bot connected & Ready!")
    function getSetting(jid) {
        if (!GROUPS.has(jid)) {
            GROUPS.set(jid, { antilink: false, antiapk: false })
        }
        return GROUPS.get(jid)
    }
    const reply = (jid, text, quoted = null) => {
        return sock.sendMessage(jid, { text }, quoted? { quoted } : {})
    }
    function clearJid(jid) {
        if (!jid) return ""
        const parts = jid.split("@")
        const user = parts[0].split(":")[0]
        const domain = parts[1] || "s.whatsapp.net"
        return `${user}@${domain}`
    }
    const isGroup = (jid) => jid?.endsWith("@g.us")
    const isMaster = (jid) => MASTER.includes(clearJid(jid))

    function getText(msg) {
        return (
            msg?.conversation ||
            msg?.extendedTextMessage?.text ||
            msg?.imageMessage?.caption ||
            msg?.videoMessage?.caption ||
            ""
        )
    }
    function getMentioned(msg) {
        return msg?.extendedTextMessage?.contextInfo?.mentionedJid || []
    }
    async function isBotAdmin(jid) {
        try {
            const metadata = await sock.groupMetadata(jid)
            const myId = clearJid(sock.user?.id)
            const myLid = clearJid(sock.user?.lid)
            const botData = metadata.participants.find(v => {
                const pid = clearJid(v.id)
                const plid = v.lid? clearJid(v.lid) : null
                return pid === myId || (myLid && pid === myLid) || (plid && plid === myId) || (myLid && plid && plid === myLid)
            })
            return botData? (botData.admin === "admin" || botData.admin === "superadmin") : false
        } catch (err) {
            console.log(`Gagal cek admin bot di ${jid}:`, err)
            return false
        }
    }
    async function isAdmin(jid, user) {
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

    async function canUseCommand(group, user) {
        if (isMaster(user)) return true
        return await isAdmin(group, user)
    }

    async function getGroupInfo(jid, sender) {
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
            const plid = v.lid? clearJid(v.lid) : null
            return pid === myId || (myLid && pid === myLid) || (plid && plid === myId) || (myLid && plid && plid === myLid)
        })

        return { metadata, admins, isadmin, botadmin }
    }
    async function getTarget(message) {
    const msg = message.message
    const mention = getMentioned(msg)
    if (mention.length) {
        return clearJid(mention[0])
    }
    const quoted = msg?.extendedTextMessage?.contextInfo?.participant
    if (quoted) {
        return clearJid(quoted)
    }
    const text = getText(msg)
    const parts = text.trim().split(/\s+/)
    parts.shift() 
    if (parts.length > 0) {
        let num = parts.join("")
        num = num.replace(/[^0-9]/g, "")
        if (num.startsWith("0")) {
            num = "62" + num.slice(1) 
        } else if (!num.startsWith("62")) {
            num = "62" + num 
        }
        if (num.length >= 11 && num.length <= 15) {
            return clearJid(num + "@s.whatsapp.net")
        }
    }
    return null
}
    sock.ev.on("messages.upsert", async ({ messages }) => {
        try {
            const m = messages[0]
            if (!m || m.key.fromMe) return

            const jid = m.key.remoteJid
            if (!isGroup(jid)) return

            const sender = clearJid(m.key.participant || m.key.remoteJid)
            const body = getText(m.message)

            if (!body) return
            const setting = getSetting(jid)
            if (setting.antilink &&!isMaster(sender) &&!(await isAdmin(jid, sender))) {
                const text = body.toLowerCase()
                const detect = text.includes("chat.whatsapp.com/") || text.includes("wa.me/") || text.includes("https://") || text.includes("http://")
                if (detect && (await isBotAdmin(jid))) {
                    await sock.sendMessage(jid, { delete: m.key })
                }
            }
            if (setting.antiapk &&!isMaster(sender) &&!(await isAdmin(jid, sender))) {
                const doc = m.message?.documentMessage
                if (doc && doc.mimetype === "application/vnd.android.package-archive") {
                    if (await isBotAdmin(jid)) {
                        await sock.sendMessage(jid, { delete: m.key })
                    }
                }
            }
            if (!body.startsWith(PREFIX)) return
            const args = body.slice(PREFIX.length).trim().split(/\s+/)
            const cmd = args.shift().toLowerCase()
            const allow = await canUseCommand(jid, sender)
            if (!allow) {
                return reply(jid, "Command khusus admin group & master.", m)
            }
            switch (cmd) {
                case "kick": {
                    const target = await getTarget(m)
                    if (!target) return reply(jid, "Reply, tag, atau masukkan nomor whatsapp.", m)
                    if (target === sender) return reply(jid, "Tidak bisa kick diri sendiri.", m)
                    if (isMaster(target)) return reply(jid, "Target adalah master.", m)
                    if (await isAdmin(jid, target)) return reply(jid, "Tidak bisa kick admin.", m)
                    if (!(await isBotAdmin(jid))) return reply(jid, "Bot bukan admin.", m)

                    await sock.groupParticipantsUpdate(jid, [target], "remove")
                    return reply(jid, "Member berhasil dikeluarkan.", m)
                }

                case "add": {
                    // FIX: Cek admin 1x biar cepat
                    const botIsAdmin = await isBotAdmin(jid)
                    if (!botIsAdmin) return reply(jid, "Bot bukan admin.", m)
                    const target = await getTarget(m)
                    if (!target) return reply(jid, "Masukkan nomor whatsapp yang benar.", m)
                    if (target === clearJid(sock.user?.id) || target === clearJid(sock.user?.lid)) return reply(jid, "Gak bisa add bot sendiri.", m)
                    await reply(jid, `Prosess add members...`, m)
                    try {
                        const res = await sock.groupParticipantsUpdate(jid, [target], "add")
                        const result = res[0]
                        if (result.status === "200") {
                            return reply(jid, `${target.split('@')[0]} berhasil ditambahkan.`, m)
                        }
                        else if (result.status === "403") {
                            return reply(jid, `Gagal, Nomor ${target.split('@')[0]} aturan privasi akun nya, "Hanya kontak yang dapat menambahkan ke group", Kirim link group saja via perintah {.linkgroup }.`, m)
                        }
                        else if (result.status === "401") {
                            return reply(jid, `Gagal, nomor ${target.split('@')[0]} sudah ada di group atau pernah keluar sendiri.`, m)
                        }
                        else if (result.status === "404") {
                            return reply(jid, `Gagal, nomor ${target.split('@')[0]} tidak terdaftar di WhatsApp.`, m)
                        }
                        else {
                            return reply(jid, `Gagal menambahkan, Kode : ${result.status}`, m)
                        }

                    } catch (e) {
                        console.log("Error add:", e)
                        return reply(jid, `error: ${e.message}`, m)
                    }
                }

                case "promote": {
                    if (!(await isBotAdmin(jid))) return reply(jid, "Bot bukan admin.", m)
                    const target = await getTarget(m)
                    if (!target) return reply(jid, "Target tidak ditemukan.", m)
                    if (await isAdmin(jid, target)) return reply(jid, "User sudah menjadi admin.", m)

                    await sock.groupParticipantsUpdate(jid, [target], "promote")
                    return reply(jid, "Promote berhasil.", m)
                }

                case "demote": {
                    if (!(await isBotAdmin(jid))) return reply(jid, "Bot bukan admin.", m)
                    const target = await getTarget(m)
                    if (!target) return reply(jid, "Target tidak ditemukan.", m)
                    if (isMaster(target)) return reply(jid, "Master tidak bisa di-demote.", m)
                    if (!(await isAdmin(jid, target))) return reply(jid, "Target bukan admin.", m)

                    await sock.groupParticipantsUpdate(jid, [target], "demote")
                    return reply(jid, "Demote berhasil.", m)
                }
                case "delete":
                case "del": {
                    const contextInfo = m.message?.extendedTextMessage?.contextInfo
                    if (!contextInfo?.stanzaId) return reply(jid, "Reply pesan yang ingin dihapus.", m)

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
                    return reply(jid, `*Nayozu command helper*\n\n${PREFIX}help\n${PREFIX}groupinfo\n${PREFIX}members\n\n${PREFIX}kick\n${PREFIX}add\n${PREFIX}promote\n${PREFIX}demote\n${PREFIX}delete\n${PREFIX}antilink on/off\n${PREFIX}antiapk on/off\n${PREFIX}open\n${PREFIX}close\n${PREFIX}linkgroup\n${PREFIX}resetlink`, m)
                }

                case "groupinfo": {
                    const data = await getGroupInfo(jid, sender)
                    const setting = getSetting(jid)
                    const owner = data.metadata.owner || "-"

                    return reply(jid, `*Group info*\n\nNama :\n${data.metadata.subject}\n\nID :\n${jid}\n\n Member :\n${data.metadata.participants.length}\n\nAdmin :\n${data.admins.length}\n\nBot admin :\n${data.botadmin? "Ya" : "Tidak"}\n\nAnti Link :\n${setting.antilink? "ON" : "OFF"}\n\nAnti APK :\n${setting.antiapk? "ON" : "OFF"}`, m)
                }

                case "members": {
                    const data = await getGroupInfo(jid, sender)
                    const total = data.metadata.participants.length
                    const admin = data.admins.length
                    const member = total - admin

                    return reply(jid, `*Member info*\n\nTotal :\n${total}\n\nAdmin :\n${admin}\n\nMember :\n${member}`, m)
                }

                case "antilink": {
                    const opt = args[0]?.toLowerCase()
                    if (opt!= "on" && opt!= "off") return reply(jid, ".antilink on/off", m)

                    const setting = getSetting(jid)
                    setting.antilink = opt === "on"
                    return reply(jid, `Anti Link ${setting.antilink? "diaktifkan" : "dimatikan"}.`, m)
                }
                case "antiapk": {
                    const opt = args[0]?.toLowerCase()
                    if (opt!= "on" && opt!= "off") return reply(jid, ".antiapk on/off", m)
                    const setting = getSetting(jid)
                    setting.antiapk = opt === "on"
                    return reply(jid, `Anti APK ${setting.antiapk? "diaktifkan" : "dimatikan"}.`, m)
                }
                case "open": {
                    if (!(await isBotAdmin(jid))) return reply(jid, "Bot bukan admin.", m)
                    await sock.groupSettingUpdate(jid, "not_announcement")
                    return reply(jid, "Group berhasil dibuka.", m)
                }

                case "close": {
                    if (!(await isBotAdmin(jid))) return reply(jid, "Bot bukan admin.", m)
                    await sock.groupSettingUpdate(jid, "announcement")
                    return reply(jid, "Group berhasil ditutup.", m)
                }
                case "linkgroup": {
                    if (!(await isBotAdmin(jid))) return reply(jid, "Bot bukan admin.", m)
                    const code = await sock.groupInviteCode(jid)
                    return reply(jid, `https://chat.whatsapp.com/${code}`, m)
                }

                case "resetlink": {
                    if (!(await isBotAdmin(jid))) return reply(jid, "Bot bukan admin.", m)
                    const code = await sock.groupRevokeInvite(jid)
                    return reply(jid, `Link baru:\n\nhttps://chat.whatsapp.com/${code}`, m)
                }
                default:
                    break
            }
        } catch (err) {
            console.log("Error in upsert:", err)
        }
    })
}

init()
