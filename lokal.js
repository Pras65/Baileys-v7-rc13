require('dotenv').config()
const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys')
const mongoose = require('mongoose')
const pino = require('pino')
const express = require('express')
const QRCode = require('qrcode') 
const path = require('path')
const { exec } = require('child_process')

const MONGO_URI = process.env.MONGO_URI

if (!MONGO_URI) {
    console.error('Error: MONGO_URI belum didefinisikan di file .env!')
    process.exit(1)
}

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

// Menggunakan Session ID khusus untuk akun LOKAL
async function useMongooseAuthState() {
    const sessionId = 'lokal'
    const getDocId = (id) => `${sessionId}_${id}`

    const writeData = async (data, id) => {
        const jsonString = JSON.stringify(data, BufferJSON.replacer)
        const json = JSON.parse(jsonString)
        await SessionModel.findByIdAndUpdate(
            getDocId(id),
            { data: json },
            { upsert: true, returnDocument: 'after' }
        )
    }

    const readData = async (id) => {
        try {
            const result = await SessionModel.findById(getDocId(id))
            if (result) {
                return JSON.parse(JSON.stringify(result.data), BufferJSON.reviver)
            }
            return null
        } catch (error) {
            return null
        }
    }

    const removeData = async (id) => {
        try {
            await SessionModel.findByIdAndDelete(getDocId(id))
        } catch (error) {}
    }

    const creds = (await readData('creds')) || (await initAuthCreds())

    const state = {
        creds,
        keys: {
            get: async (type, ids) => {
                const data = {}
                for (const id of ids) {
                    let value = await readData(`${type}-${id}`)
                    if (type === 'app-state-sync-key' && value) {
                        value = proto.Message.AppStateSyncKeyData.fromObject(value)
                    }
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
                        if (value) {
                            tasks.push(writeData(value, key))
                        } else {
                            tasks.push(removeData(key))
                        }
                    }
                }
                await Promise.all(tasks)
            }
        }
    }

    return {
        state,
        saveCreds: async () => {
            return await writeData(state.creds, 'creds')
        }
    }
}

async function startBot() {
    try {
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(MONGO_URI)
            console.log('[LOKAL] Berhasil terhubung ke MongoDB via Mongoose!')
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
                console.log('[LOKAL] QR baru generate, silakan cek browser.')
            }

            if (connection === 'open') {
                console.log('[LOKAL] Bot Connected successfully!')
                qrImage = ''
                isConnected = true
                require('./controller/index.js')(sock)
            }

            if (connection === 'close') {
                isConnected = false
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut
                console.log('[LOKAL] Koneksi terputus, mencoba reconnect...', shouldReconnect)
                
                if (shouldReconnect) {
                    setTimeout(startBot, 3000) 
                } else {
                    console.log('[LOKAL] Session terhapus. Menghapus data sesi lokal di database...')
                    await SessionModel.deleteMany({ _id: /^lokal_/ })
                    setTimeout(startBot, 3000)
                }
            }
        })
    } catch (error) {
        console.error('[LOKAL] Gagal menjalankan bot:', error.message)
        setTimeout(startBot, 5000)
    }
}

startBot()

app.get('/api/status', async (req, res) => {
    try {
        if (mongoose.connection.readyState === 0) await mongoose.connect(MONGO_URI)
        const credsExist = await SessionModel.findById('lokal_creds')
        res.json({ connected: isConnected, qr: qrImage, session: !!credsExist })
    } catch (error) {
        res.json({ connected: isConnected, qr: qrImage, session: false })
    }
})

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
})

const PORT = 3000
app.listen(PORT, () => {
    console.log(`Server LOKAL jalan di http://localhost:${PORT}`)
    exec(`am start -a android.intent.action.VIEW -d "http://localhost:${PORT}"`, (err) => {
        if (err) console.log('Gagal buka browser otomatis:', err.message)
    })
})
