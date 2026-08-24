const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { Sticker } = require('wa-sticker-formatter');

ffmpeg.setFfmpegPath(ffmpegStatic);

async function createVideoSticker(mediaBuffer, customAuthor = 'Whatsapp') {
    const inputPath = path.join(__dirname, `../temp_in_${Date.now()}.mp4`);
    const outputPath = path.join(__dirname, `../temp_out_${Date.now()}.mp4`);

    try {
        // 1. Simpan buffer video sementara
        fs.writeFileSync(inputPath, mediaBuffer);

        // 2. Proses potong dengan fast seeking (maksimal 8-10 detik)
        await new Promise((resolve, reject) => {
            let isFinished = false;

            const command = ffmpeg()
                .input(inputPath)
                .inputOptions(['-ss 00:00:00'])
                .setDuration(6) // Kita turunkan sedikit ke 8 detik agar ukuran file lebih aman
                .output(outputPath)
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-preset ultrafast'
                ])
                .on('end', () => {
                    if (!isFinished) {
                        isFinished = true;
                        resolve();
                    }
                })
                .on('error', (err) => {
                    if (!isFinished) {
                        isFinished = true;
                        reject(new Error(err.message));
                    }
                });

            command.run();

            setTimeout(() => {
                if (!isFinished) {
                    isFinished = true;
                    try { command.kill('SIGKILL'); } catch {}
                    reject(new Error('Proses pemotongan video timeout.'));
                }
            }, 10000);
        });

        // 3. Baca hasil video yang sudah dipotong
        const trimmedBuffer = fs.readFileSync(outputPath);

        // 4. Konversi ke Animated WebP dengan kompresi ketat agar lolos upload Baileys
        const sticker = new Sticker(trimmedBuffer, { 
            author: customAuthor, 
            type: 'crop',
            quality: 2,      // Kompresi sangat agresif agar ukuran file di bawah 500KB
            background: '#00000000'
        });

        const stickerBuffer = await sticker.toBuffer();
        return stickerBuffer;

    } catch (err) {
        throw new Error(`Gagal memproses stiker lokal: ${err.message}`);
    } finally {
        // Bersihkan file sampah sementara
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    }
}

module.exports = { createVideoSticker };
