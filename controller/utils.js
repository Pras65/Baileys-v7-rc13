const fs = require('fs');
const path = require('path');
const GroupModel = require('../models/GroupModel'); // Pastikan path ini sesuai
const RoleModel = require('../models/RoleModel');   // Pastikan path ini sesuai

// ============================================================
// 1. LOGGER SYSTEM
// ============================================================
const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function currentLogFile() {
    const date = new Date().toISOString().slice(0, 10);
    return path.join(LOG_DIR, `${date}.log`);
}

function writeLine(level, scope, payload) {
    const line = JSON.stringify({
        time: new Date().toISOString(),
        level,
        scope,
        ...payload
    }) + '\n';

    fs.appendFile(currentLogFile(), line, (err) => {
        if (err) console.error('[logger] Gagal menulis log ke disk:', err.message);
    });

    if (level === 'error') console.error(`[${scope}]`, payload.message || '');
}

const logger = {
    error(scope, err, extra = {}) { writeLine('error', scope, { message: err?.message, stack: err?.stack, ...extra }); },
    info(scope, message, extra = {}) { writeLine('info', scope, { message, ...extra }); },
    audit(scope, message, extra = {}) { writeLine('audit', scope, { message, ...extra }); }
};

// ============================================================
// 2. JID & IDENTIFIER HELPERS
// ============================================================
function clearJid(jid) {
    if (!jid) return '';
    if (jid.includes('@lid')) {
        const parts = jid.split('@');
        const user = parts[0].split(':')[0];
        return `${user}@lid`;
    }
    const parts = jid.split('@');
    const user = parts[0].split(':')[0];
    const domain = parts[1] || 's.whatsapp.net';
    return `${user}@${domain}`;
}

function formatGroupJid(id) {
    let clean = String(id).trim();
    if (!clean.endsWith('@g.us')) clean = `${clean}@g.us`;
    return clean;
}

// ============================================================
// 3. MESSAGE EXTRACTOR & UNWRAP
// ============================================================
function unwrapMessage(message) {
    if (!message) return message;
    if (message.ephemeralMessage) return unwrapMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessageV2) return unwrapMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension) return unwrapMessage(message.viewOnceMessageV2Extension.message);
    if (message.viewOnceMessage) return unwrapMessage(message.viewOnceMessage.message);
    if (message.documentWithCaptionMessage) return unwrapMessage(message.documentWithCaptionMessage.message);
    return message;
}

function getText(msg) {
    const real = unwrapMessage(msg) || {};
    return (
        real.conversation ||
        real.extendedTextMessage?.text ||
        real.imageMessage?.caption ||
        real.videoMessage?.caption ||
        real.buttonsResponseMessage?.selectedButtonId ||
        real.listResponseMessage?.singleSelectReply?.selectedRowId ||
        real.templateButtonReplyMessage?.selectedId ||
        ''
    );
}

function extractMessageData(m) {
    const jid = m.key.remoteJid;
    const rawSender = m.key.participant || m.key.remoteJid;
    const cleanSender = clearJid(rawSender);
    const isGroup = jid?.endsWith("@g.us");
    return { jid, rawSender, cleanSender, isGroup };
}

// ============================================================
// 4. ROLE & AUTHORITY (HARDCODED + MONGODB)
// ============================================================
const safeMasterList = [
    "6285779306512@s.whatsapp.net",
    "260129140297849@lid"
];

// Checker Sinkron (Untuk validasi cepat berbasis array hardcoded)
const isMaster = (jid) => safeMasterList.includes(clearJid(jid));

// Checker Asinkron (Validasi lengkap dari Database + Hardcoded)
async function getUserAuthority(cleanSender) {
    const roleDoc = await RoleModel.findOne({
        $or: [{ jid: cleanSender }, { lid: cleanSender }]
    });

    const isHardcodedMaster = isMaster(cleanSender);
    const isDbMaster = roleDoc?.role === 'master';
    
    // Jika ada di array hardcoded ATAU di database master = true
    const isUserMaster = isHardcodedMaster || isDbMaster; 
    const isMod = roleDoc?.role === 'mod';
    const hasDeepAuthority = isUserMaster || isMod;
    
    let isGuest = false;
    if (roleDoc?.role === 'guest') {
        if (roleDoc.expiresAt && new Date() < new Date(roleDoc.expiresAt)) {
            isGuest = true;
        } else if (roleDoc.expiresAt && new Date() >= new Date(roleDoc.expiresAt)) {
            await RoleModel.deleteOne({ _id: roleDoc._id }); // Otomatis cabut role jika expired
        }
    }

    return { isMaster: isUserMaster, isMod, hasDeepAuthority, isGuest, roleDoc };
}

// ============================================================
// 5. RESOLVE TARGET & GETTERS
// ============================================================
function getMentioned(msg) {
    return msg?.extendedTextMessage?.contextInfo?.mentionedJid || [];
}

async function getTarget(message) {
    const msg = message.message;
    const mention = getMentioned(msg);
    if (mention.length) return clearJid(mention[0]);

    const quoted = msg?.extendedTextMessage?.contextInfo?.participant;
    if (quoted) return clearJid(quoted);

    const text = msg?.conversation || msg?.extendedTextMessage?.text || "";
    const parts = text.trim().split(/\s+/);
    parts.shift();
    if (parts.length > 0) {
        let num = parts.join("").replace(/[^0-9]/g, "");
        if (num.startsWith("0")) num = "62" + num.slice(1);
        else if (!num.startsWith("62")) num = "62" + num;
        if (num.length >= 11 && num.length <= 15) return clearJid(num + "@s.whatsapp.net");
    }
    return null;
}

async function resolveTargetIdentity(sock, m, args, jid, numericArgIndex = 2) {
    const real = unwrapMessage(m.message) || {};
    let rawTarget = null;
    let targetAlt = null;

    const contextInfo =
        real.extendedTextMessage?.contextInfo ||
        real.imageMessage?.contextInfo ||
        real.videoMessage?.contextInfo ||
        real.documentMessage?.contextInfo ||
        m.msg?.contextInfo;

    if (contextInfo && contextInfo.participant) {
        rawTarget = contextInfo.participant;
        if (contextInfo.participantAlt) targetAlt = contextInfo.participantAlt;
    }
    if (!rawTarget && m.quoted) {
        rawTarget = m.quoted.sender || m.quoted.participant || m.quoted.key?.participant;
        if (m.quoted.key?.participantAlt) targetAlt = m.quoted.key.participantAlt;
    }
    if (!rawTarget) {
        const mentions = contextInfo?.mentionedJid || m.mentionedJid || m.msg?.mentionedJid;
        if (Array.isArray(mentions) && mentions.length > 0) rawTarget = mentions[0];
    }
    if (!rawTarget && args && args[numericArgIndex]) {
        const inputArg = args[numericArgIndex].trim();
        if (inputArg.includes('@')) {
            rawTarget = inputArg;
        } else {
            const cleanNum = inputArg.replace(/[^0-9]/g, '');
            if (cleanNum.length >= 5) rawTarget = `${cleanNum}@s.whatsapp.net`;
        }
    }

    if (!rawTarget) return { rawTarget: null, realJid: '', realLid: '', cleanedRaw: '', cleanedAlt: '' };

    let cleanedRaw = clearJid(rawTarget).replace(/:[0-9]+/g, '');
    let cleanedAlt = targetAlt ? clearJid(targetAlt).replace(/:[0-9]+/g, '') : null;

    let realJid = '', realLid = '';
    if (cleanedRaw.endsWith('@s.whatsapp.net')) realJid = cleanedRaw;
    if (cleanedRaw.endsWith('@lid')) realLid = cleanedRaw;
    if (cleanedAlt) {
        if (cleanedAlt.endsWith('@s.whatsapp.net')) realJid = cleanedAlt;
        if (cleanedAlt.endsWith('@lid')) realLid = cleanedAlt;
    }

    try {
        if (realLid && !realJid) {
            const foundJid = await sock.signalRepository.lidMapping.getPNForLID(realLid);
            if (foundJid) realJid = foundJid.replace(/:[0-9]+/g, '');
        } else if (realJid && !realLid) {
            const foundLid = await sock.signalRepository.lidMapping.getLIDForPN(realJid);
            if (foundLid) realLid = foundLid;
        }
    } catch (e) {
        logger.error('resolveTargetIdentity:lidMapping', e);
    }

    return { rawTarget, realJid, realLid, cleanedRaw, cleanedAlt };
}

// ============================================================
// 6. GROUP METADATA & ADMIN HELPERS
// ============================================================
async function isBotAdmin(sock, jid) {
    try {
        const metadata = await sock.groupMetadata(jid);
        const myId = clearJid(sock.user?.id);
        const myLid = clearJid(sock.user?.lid);
        const botData = metadata.participants.find(v => {
            const pid = clearJid(v.id);
            const plid = v.lid ? clearJid(v.lid) : null;
            return pid === myId || (myLid && pid === myLid) || (plid && pid === myId) || (myLid && plid && plid === myLid);
        });
        return botData ? (botData.admin === "admin" || botData.admin === "superadmin") : false;
    } catch (err) {
        return false;
    }
}

async function isAdmin(sock, jid, user) {
    try {
        const metadata = await sock.groupMetadata(jid);
        const cleanUser = clearJid(user);
        return metadata.participants.some(v =>
            (v.admin === "admin" || v.admin === "superadmin") &&
            (clearJid(v.id) === cleanUser || (v.lid && clearJid(v.lid) === cleanUser))
        );
    } catch (err) {
        return false;
    }
}

async function getGroupInfo(sock, jid, sender) {
    const metadata = await sock.groupMetadata(jid);
    const cleanSender = clearJid(sender);
    const myId = clearJid(sock.user?.id);
    const myLid = clearJid(sock.user?.lid);

    const admins = metadata.participants.filter(v => v.admin === "admin" || v.admin === "superadmin");
    const isadmin = admins.some(v =>
        clearJid(v.id) === cleanSender || (v.lid && clearJid(v.lid) === cleanSender)
    );
    const botadmin = admins.some(v => {
        const pid = clearJid(v.id);
        const plid = v.lid ? clearJid(v.lid) : null;
        return pid === myId || (myLid && pid === myLid) || (plid && pid === myId) || (myLid && plid && plid === myLid);
    });

    return { metadata, admins, isadmin, botadmin };
}

async function syncGroupMetadata(sock, jid, sessionId) {
    try {
        const metadata = await sock.groupMetadata(jid);
        const admins = metadata.participants
            .filter(v => v.admin === "admin" || v.admin === "superadmin")
            .map(v => clearJid(v.id));

        const docId = `${sessionId}_${jid}`;
        await GroupModel.findByIdAndUpdate(docId, {
            sessionId,
            jid,
            subject: metadata.subject,
            admins,
            updatedAt: new Date()
        }, { upsert: true, returnDocument: 'after' });

        return metadata;
    } catch (err) {
        return null;
    }
}

// ============================================================
// EXPORT SEMUA FUNGSI (Pusat Distribusi)
// ============================================================
module.exports = {
    logger,
    clearJid,
    formatGroupJid,
    unwrapMessage,
    getText,
    extractMessageData,
    isMaster,           // Sinkron (Untuk cek cepat di fungsi kecil)
    getUserAuthority,   // Asinkron (Gabungan Database + Hardcoded)
    getMentioned,
    getTarget,
    resolveTargetIdentity,
    isBotAdmin,
    isAdmin,
    getGroupInfo,
    syncGroupMetadata
};
