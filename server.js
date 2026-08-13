require('dotenv').config()
const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys')
const mongoose = require('mongoose')
const pino = require('pino')
const express = require('express')
const QRCode = require('qrcode') 
const path = require('path')

const MONGO_URI = process.env.MONGO_URI
if (!MONGO_URI) { console.error('Error: MONGO_URI belum ada di .env!'); process.exit(1); }

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

// Auth State khusus SERVER
async function useMongooseAuthState() {
    const sessionId = 'server'
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
            console.log('[SERVER] Terhubung ke MongoDB Atlas!')
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
                console.log('[SERVER] QR Code baru digenerate.')
            }
            if (connection === 'open') {
                console.log('[SERVER] Bot Berhasil Terhubung!')
                qrImage = ''
                isConnected = true
                // Masuk ke pusat controller yang sama
                require('./controller')(sock)
            }
            if (connection === 'close') {
                isConnected = false
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut
                if (shouldReconnect) setTimeout(startBot, 3000)
                else {
                    await SessionModel.deleteMany({ _id: /^server_/ })
                    setTimeout(startBot, 3000)
                }
            }
        })
    } catch (error) {
        console.error('[SERVER] Error:', error.message)
        setTimeout(startBot, 5000)
    }
}

startBot()

app.get('/api/status', async (req, res) => {
    try {
        if (mongoose.connection.readyState === 0) await mongoose.connect(MONGO_URI)
        const credsExist = await SessionModel.findById('server_creds')
        res.json({ connected: isConnected, qr: qrImage, session: !!credsExist })
    } catch { res.json({ connected: isConnected, qr: qrImage, session: false }) }
})

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')))

const PORT = 3001
app.listen(PORT, () => {
    console.log(`Server Server: http://localhost:${PORT}`)
})
