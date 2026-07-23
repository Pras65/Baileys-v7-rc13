const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const pino = require('pino')
const express = require ('express')
const QRCode = require('qrcode') 
const fs = require('fs')
const path = require('path')

const SESSION_FOLDER = './baileys-auth' 
const PORT = process.env.PORT || 3000 
let qrImage = ''
let sock = null
let isConnected = false
let groupLoaded = false

const app = express()
app.use(express.json({ limit: '5mb' })) 
app.use(express.static('public')) // serve file css/js/gambar

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER)
    const { version } = await fetchLatestBaileysVersion() 

    sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            qrImage = await QRCode.toDataURL(qr) 
            isConnected = false
            console.log('QR baru generate')
        }

        if (connection === 'open') {
            console.log('Connection successfully')
            qrImage = ''
            isConnected = true

            if (!groupLoaded) {
                groupLoaded = true
                require('./group.js') 
            }
        }

        if (connection === 'close') {
            isConnected = false
            if ((lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut) {
                setTimeout(startBot, 3000) 
            }
        }
    })
}
startBot()

module.exports = { getSock: () => sock }

// API BUAT FRONTEND NGAMBIL STATUS
app.get('/api/status', (req, res) => {
    res.json({ 
        connected: isConnected,
        qr: qrImage,
        session: fs.existsSync(path.join(SESSION_FOLDER, 'creds.json'))
    })
})

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html')); // kirim index.html
});

app.listen(PORT, () => {
    console.log(`Server jalan di http://localhost:${PORT}`)
})
