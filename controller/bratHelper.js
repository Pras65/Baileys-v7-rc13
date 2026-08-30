const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { Jimp, loadFont, measureText } = require('jimp');
const { SANS_128_BLACK } = require('jimp/fonts');

ffmpeg.setFfmpegPath(ffmpegStatic);

async function createBratSticker(textQuery) {
    const inputPath = path.join(__dirname, `./tmp/img/temp_brat_in_${Date.now()}.png`);
    const outputPath = path.join(__dirname, `./tmp/img/temp_brat_out_${Date.now()}.webp`);

    try {
        // 1. TAHAP JIMP: Render teks hitam di atas kanvas putih 512x512
        const image = new Jimp({ width: 512, height: 512, color: 0xFFFFFFFF });
        const font = await loadFont(SANS_128_BLACK);
        const fontHeight = 128;
        const lineSpacing = 16;

        function wrapTextByWord(str, maxCharsPerLine) {
            const words = str.trim().split(/\s+/);
            let lines = [];
            let currentLine = '';

            for (let word of words) {
                if (word.length > maxCharsPerLine) {
                    if (currentLine) {
                        lines.push(currentLine);
                        currentLine = '';
                    }
                    for (let i = 0; i < word.length; i += maxCharsPerLine) {
                        lines.push(word.slice(i, i + maxCharsPerLine));
                    }
                    continue;
                }

                const testLine = currentLine ? currentLine + ' ' + word : word;
                if (testLine.length <= maxCharsPerLine + 2) {
                    currentLine = testLine;
                } else {
                    if (currentLine) lines.push(currentLine);
                    currentLine = word;
                }
            }
            if (currentLine) lines.push(currentLine);
            return lines;
        }

        const lines = wrapTextByWord(textQuery, 6);
        const totalLines = lines.length;
        const totalTextHeight = (fontHeight * totalLines) + (lineSpacing * (totalLines - 1));
        let startY = (512 - totalTextHeight) / 2;

        for (let i = 0; i < totalLines; i++) {
            const currentY = startY + (i * (fontHeight + lineSpacing));
            const lineWidth = measureText(font, lines[i]);
            const currentX = (512 - lineWidth) / 2;

            image.print({
                font: font,
                x: currentX,
                y: currentY,
                text: { text: lines[i] }
            });
        }

        // Simpan hasil render Jimp ke file PNG sementara
        const pngBuffer = await image.getBuffer('image/png');
        fs.writeFileSync(inputPath, pngBuffer);

        // 2. TAHAP FFPEG: Konversi PNG langsung ke WebP Stiker yang stabil
        await new Promise((resolve, reject) => {
            let isFinished = false;

            ffmpeg()
                .input(inputPath)
                .output(outputPath)
                .outputOptions([
                    '-vcodec libwebp',
                    '-lossless 1',
                    '-loop 0',
                    '-an',
                    '-vsync 0',
                    '-vf scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0'
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
                })
                .run();

            setTimeout(() => {
                if (!isFinished) {
                    isFinished = true;
                    reject(new Error('Timeout rendering WebP brat dengan FFmpeg.'));
                }
            }, 10000);
        });

        // 3. Baca hasil file WebP jadi
        const webpBuffer = fs.readFileSync(outputPath);
        return webpBuffer;

    } catch (err) {
        throw new Error(`Gagal membuat stiker brat: ${err.message}`);
    } finally {
        // Bersihkan file sampah sementara
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    }
}

module.exports = { createBratSticker };