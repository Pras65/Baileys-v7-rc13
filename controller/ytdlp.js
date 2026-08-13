const fs = require('fs')
const path = require('path')
const axios = require('axios')
const https = require('https')
const RdModel = require('../models/RdModel')

const TMP_DIR = path.join(__dirname, 'tmp')
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

// IPv4 Agent Anti-Timeout
const ipv4Agent = new https.Agent({ 
    family: 4,
    keepAlive: true 
})

let memoryCache = { key: null, host: null, lastFetch: 0 }

async function getCredentials() {
    const now = Date.now()
    if (memoryCache.key && (now - memoryCache.lastFetch < 300000)) {
        return { key: memoryCache.key, host: memoryCache.host }
    }
    try {
        const keyDoc = await RdModel.findOne({ key: 'RAPID_API_KEY' })
        const hostDoc = await RdModel.findOne({ key: 'RAPID_API_HOST' })
        memoryCache.key = keyDoc ? keyDoc.value : ""
        memoryCache.host = hostDoc ? hostDoc.value : "social-media-video-downloader.p.rapidapi.com"
        memoryCache.lastFetch = now
        return { key: memoryCache.key, host: memoryCache.host }
    } catch (err) {
        return { key: "", host: "social-media-video-downloader.p.rapidapi.com" }
    }
}

function getYoutubeId(url) {
    const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/);
    return (match && match[2].length === 11) ? match[2] : null;
}

function getInstagramShortcode(url) {
    const match = url.match(/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
}

function formatBytes(bytes) {
    if (!bytes) return "N/A"
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`
}

function formatDuration(totalSeconds) {
    if (!totalSeconds || isNaN(totalSeconds)) return "00:00:00";
    
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);

    const pad = (num) => num.toString().padStart(2, '0');
    
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

async function downloadVideo(url) {
    const filePath = path.join(TMP_DIR, `${Date.now()}.mp4`)

    try {
        // ==========================================
        // BYPASS KHUSUS TIKTOK (Menggunakan TikWM)
        // ==========================================
        if (url.includes('tiktok.com') || url.includes('vm.tiktok.com')) {
            console.log(`[Downloader] TikTok terdeteksi. menggunakan API cadangan...`)
            const tikRes = await axios.post('https://www.tikwm.com/api/', { url: url, hd: 1 }, { httpsAgent: ipv4Agent })
            const tikData = tikRes.data.data
            
            if (!tikData || (!tikData.play && !tikData.hdplay)) {
                throw new Error("Video TikTok tidak ditemukan atau link private.")
            }

            const writer = fs.createWriteStream(filePath)
            const vidResponse = await axios({
                url: tikData.hdplay || tikData.play,
                method: 'GET',
                responseType: 'stream',
                httpsAgent: ipv4Agent,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            })

            vidResponse.data.pipe(writer)

            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    const stats = fs.statSync(filePath)
                    resolve({
                        path: filePath,
                        title: tikData.title || "Video TikTok",
                        uploader: tikData.author?.nickname || "TikToker",
                        duration: formatDuration(tikData.duration),
                        thumbnail: tikData.cover || null,
                        resolution: "HD",
                        size: formatBytes(stats.size),
                        sizeBytes: stats.size
                    })
                })
                writer.on('error', reject)
            })
        }

        // ==========================================
        // SISA PLATFORM LAIN (Menggunakan RapidAPI)
        // ==========================================
        const { key, host } = await getCredentials()
        if (!key) throw new Error("RAPID_API_KEY belum terdaftar di database.")

        let endpoint = ''
        let params = {}

        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            const videoId = getYoutubeId(url)
            if (!videoId) throw new Error("Link YouTube tidak valid.")
            endpoint = '/youtube/v3/video/details'
            params = { videoId, urlAccess: 'proxied', renderableFormats: '720p,highres', getTranscript: 'false' }
        } 
        else if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.gg')) {
            endpoint = '/facebook/v3/post/details'
            params = { renderableFormats: '720p,highres', url: url }
        } 
        else if (url.includes('instagram.com')) {
            const shortcode = getInstagramShortcode(url)
            if (!shortcode) throw new Error("Link Instagram tidak valid.")
            endpoint = '/instagram/v3/media/post/details'
            params = { renderableFormats: '720p,highres', shortcode: shortcode }
        }
        else {
            throw new Error("Platform link tidak didukung.")
        }

        console.log(`[Downloader] Mengarahkan ke endpoint API Utama...`)

        const response = await axios.get(`https://${host}${endpoint}`, {
            params: params,
            headers: {
                'Content-Type': 'application/json',
                'x-rapidapi-host': host,
                'x-rapidapi-key': key
            },
            httpsAgent: ipv4Agent,
            timeout: 50000 
        })

        const resData = response.data
        const videosList = resData.contents?.[0]?.videos || []
        const selectedVideo = 
            videosList.find(v => v.label === 'native_hd') || 
            videosList.find(v => v.label === 'native_sd') || 
            videosList.find(v => v.metadata?.has_audio === true) || 
            videosList[0];

        const videoUrl = selectedVideo?.url || resData.url || resData.download_url

        if (!videoUrl) {
            fs.writeFileSync(path.join(__dirname, 'random.txt'), JSON.stringify(resData, null, 2))
            throw new Error("Link unduhan tidak ditemukan, Cek random.txt")
        }

        // ==========================================
        // PERBAIKAN: EKSTRAKSI DURASI YANG BENAR
        // ==========================================
        let durationSeconds = 0;
        
        if (resData.metadata?.additionalData?.length_in_second) {
            durationSeconds = resData.metadata.additionalData.length_in_second;
        } else if (resData.metadata?.additionalData?.playable_duration_in_ms) {
            durationSeconds = resData.metadata.additionalData.playable_duration_in_ms / 1000;
        } else if (resData.contents?.[0]?.videos?.[0]?.metadata?.duration) {
            durationSeconds = resData.contents[0].videos[0].metadata.duration / 1000;
        } else if (resData.metadata?.duration) {
            durationSeconds = resData.metadata.duration / 1000;
        } else if (resData.data?.duration) {
            durationSeconds = resData.data.duration;
        } else if (resData.duration) {
            durationSeconds = resData.duration;
        }

        const finalDuration = formatDuration(durationSeconds);

        // ==========================================
        // PERBAIKAN: EKSTRAKSI THUMBNAIL YANG BENAR
        // ==========================================
        const finalThumbnail = 
            resData.metadata?.thumbnailUrl || 
            resData.metadata?.additionalData?.thumbnailImage?.uri ||
            resData.metadata?.additionalData?.first_frame_thumbnail ||
            resData.thumbnail || 
            resData.data?.thumbnail || 
            resData.data?.cover ||
            resData.cover || 
            null;

        // ==========================================
        // PERBAIKAN: EKSTRAKSI UPLOADER YANG LEBIH LUAS
        // ==========================================
        const finalUploader = 
            resData.metadata?.author?.name || 
            resData.metadata?.owner?.username ||
            resData.data?.author?.name ||
            resData.data?.author ||
            resData.data?.owner?.username ||
            resData.author?.name ||
            resData.author ||
            resData.owner_username ||
            resData.result?.author ||
            "-";

        // --- PROSES DOWNLOAD STREAMING ---
        const writer = fs.createWriteStream(filePath)
        const vidResponse = await axios({
            url: videoUrl,
            method: 'GET',
            responseType: 'stream',
            httpsAgent: ipv4Agent,
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 60000
        })

        vidResponse.data.pipe(writer)

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                const stats = fs.statSync(filePath)
                
                if (stats.size > 100 * 1024 * 1024) {
                    fs.unlinkSync(filePath)
                    return reject(new Error("File melebihi 100MB."))
                }

                resolve({
                    path: filePath,
                    title: resData.metadata?.title || resData.title || resData.data?.title || "-",
                    uploader: finalUploader, 
                    duration: finalDuration, 
                    thumbnail: finalThumbnail, 
                    resolution: "720p",
                    size: formatBytes(stats.size),
                    sizeBytes: stats.size
                })
            })
            writer.on('error', (err) => {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
                reject(err)
            })
        })

    } catch (e) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        throw new Error(e.response?.data?.error?.message || e.message || "Gagal memproses link.")
    }
}

function deleteFile(filePath) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
}

async function getInfo(url) {
    return { title: "Video" }
}

module.exports = { downloadVideo, deleteFile, getInfo }
