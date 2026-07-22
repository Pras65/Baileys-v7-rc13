const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require ('express');
const QRCode = require('qrcode'); 

require('./group.js'); // 1. INI AJA. LANGSUNG KE LOAD PAS START

const SESSION_FOLDER = './baileys-auth'; 
const PORT = process.env.PORT || 3000; 
let qrImage = '';
let sock = null;

const app = express();
app.use(express.json({ limit: '5mb' })); 

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
    const { version } = await fetchLatestBaileysVersion(); 

    sock = makeWASocket({
        version, 
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, 
        browser: ['Nayozu SP', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrImage = await QRCode.toDataURL(qr); 
            console.log('QR siap di /baileys-auth');
        }

        if (connection === 'open') {
            console.log('Connection successfully');
            qrImage = '';
            console.log('group.js sudah ikut ke-load'); // buat mastiin aja
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi putus, reconnect:', shouldReconnect);
            qrImage = '';
            if (shouldReconnect) setTimeout(startBot, 3000); 
        }
    });
}
startBot();

app.get('/baileys-auth', (req, res) => {
    if (qrImage) {
        res.send(`
            <body style="text-align:center; background:#0a0a0a; color:#fff; font-family:sans-serif; padding-top:40px">
                <h2>Scan QR untuk Bot WA</h2>
                <img src="${qrImage}" style="width:300px; background:white; padding:20px; border-radius:20px; border:5px solid #25D366"/>
                <p style="color:#aaa">QR expired 20 detik, refresh kalau expired</p>
            </body>
        `);
    } else {
        res.send('<h2 style="text-align:center; padding-top:100px; color:#25D366">Bot terkoneksi dengan baik</h2>');
    }
});

// U
app.get('/ping', (req, res) => {
    res.status(200).send('ok'); 
});

app.get('/', (req, res) => {
    res.send('Bot jalan, buka /baileys-auth untuk scan QR');
});

app.listen(PORT, () => {
    console.log(`Server jalan di port ${PORT}`);
    console.log(`Buka: http://localhost:${PORT}/baileys-auth`);
});
