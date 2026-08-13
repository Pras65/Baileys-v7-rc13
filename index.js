require('dotenv').config()
const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys')
const mongoose = require('mongoose')
const pino = require('pino')
const express = require('express')
const QRCode = require('qrcode')
const path = require('path')
const { exec } = require('child_process')
const RoleModel = require('./models/RoleModel')
const MONGO_URI = process.env.MONGO_URI
if (!MONGO_URI) { console.error('Error: MONGO_URI belum didefinisikan di .env!'); process.exit(1); }

let qrImage = ''
let sock = null
let isConnected = false

const app = express()
app.use(express.json({ limit: '5mb' }))
app.use(express.static('public'))

const sessionSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true }
}, { versionKey: false })

const SessionModel = mongoose.models.Session || mongoose.model('Session', sessionSchema)

// Fungsi Auto-Seed Master Tunggal
async function seedInitialMaster() {
    try {
        const masterExist = await RoleModel.findOne({ role: 'master' })
        if (!masterExist) {
            await RoleModel.create({
                jid: "6285779306512@s.whatsapp.net",
                lid: "260129140297849@lid",
                role: 'master',
                addedBy: 'system-bootstrap',
                addedAt: new Date()
            })
            console.log("[LOKAL] Master tunggal berhasil di-seed otomatis ke database.")
        }
    } catch (err) {
        console.log("Gagal melakukan auto-seed master:", err.message)
    }
}

async function useMongooseAuthState() {
    const sessionId = 'lokal'
    const getDocId = (id) => `${sessionId}_${id}`

    const writeData = async (data, id) => {
        const jsonString = JSON.stringify(data, BufferJSON.replacer)
        const json = JSON.parse(jsonString)
        await SessionModel.findByIdAndUpdate(getDocId(id), { data: json }, { upsert: true, returnDocument: 'after' })
    }

    const readData = async (id) => {
        try {
            const result = await SessionModel.findById(getDocId(id))
            return result ? JSON.parse(JSON.stringify(result.data), BufferJSON.reviver) : null
        } catch { return null }
    }

    const removeData = async (id) => {
        try { await SessionModel.findByIdAndDelete(getDocId(id)) } catch {}
    }

    const creds = (await readData('creds')) || (await initAuthCreds())
    const state = {
        creds,
        keys: {
            get: async (type, ids) => {
                const data = {}
                for (const id of ids) {
                    let value = await readData(`${type}-${id}`)
                    if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value)
                    data[id] = value
                }
                return data
            },
            set: async (data) => {
                const tasks = []
                for (const category of Object.keys(data)) {
                    for (const id of Object.keys(data[category])) {
                        const value = data[category][id]
                        const key = `${category}-${id}`
                        tasks.push(value ? writeData(value, key) : removeData(key))
                    }
                }
                await Promise.all(tasks)
            }
        }
    }
    return { state, saveCreds: () => writeData(state.creds, 'creds') }
}

async function startBot() {
    try {
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(MONGO_URI)
            console.log('[LOKAL] Berhasil terhubung ke MongoDB Atlas!')
        }

        // Jalankan auto-seed master saat koneksi aktif
        await seedInitialMaster()

        const existingCreds = await SessionModel.findById('lokal_creds')
        if (!existingCreds) {
            console.log('[LOKAL] Sesi belum ditemukan. Menyiapkan QR Code...')
        } else {
            console.log('[LOKAL] Sesi ditemukan. Memulihkan sesi...')
        }

        const { state, saveCreds } = await useMongooseAuthState()
        const { version } = await fetchLatestBaileysVersion()

        sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false })

        sock.ev.on('creds.update', saveCreds)

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update

            if (qr) {
                qrImage = await QRCode.toDataURL(qr)
                isConnected = false
                console.log('[LOKAL] QR Code baru digenerate.')
            }

            if (connection === 'open') {
                console.log('[LOKAL] Bot Berhasil Terhubung Sempurna!')
                qrImage = ''
                isConnected = true

                // Menyerahkan sock ke Unified Controller Index
                require('./controller/index.js')(sock, 'lokal')
            }

            if (connection === 'close') {
                isConnected = false
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut
                if (shouldReconnect) {
                    setTimeout(startBot, 3000)
                } else {
                    await SessionModel.deleteMany({ _id: /^lokal_/ })
                    setTimeout(startBot, 3000)
                }
            }
        })
    } catch (error) {
        console.error('[LOKAL] Error:', error.message)
        setTimeout(startBot, 5000)
    }
}

startBot()

app.get('/api/status', async (req, res) => {
    try {
        if (mongoose.connection.readyState === 0) await mongoose.connect(MONGO_URI)
        const credsExist = await SessionModel.findById('lokal_creds')
        res.json({ connected: isConnected, qr: qrImage, session: !!credsExist })
    } catch { res.json({ connected: isConnected, qr: qrImage, session: false }) }
})

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`)
    exec(`am start -a android.intent.action.VIEW -d "http://localhost:${PORT}"`, () => {})
})
