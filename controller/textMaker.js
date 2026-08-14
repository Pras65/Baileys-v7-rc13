const { Jimp, loadFont, measureText } = require('jimp');
const { SANS_64_WHITE } = require('jimp/fonts');

async function createBlackWhiteText(text) {
    try {
        const image = new Jimp({ width: 512, height: 512, color: 0x000000FF });
        
        const font = await loadFont(SANS_64_WHITE);
        const fontHeight = 64; 
        const lineSpacing = 12;

        // Fungsi pemecah kata cerdas per 6 karakter maksimal tanpa merusak kata
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

                if ((currentLine + (currentLine ? ' ' : '') + word).length <= maxCharsPerLine) {
                    currentLine += (currentLine ? ' ' : '') + word;
                } else {
                    if (currentLine) lines.push(currentLine);
                    currentLine = word;
                }
            }
            if (currentLine) lines.push(currentLine);
            return lines;
        }

        const lines = wrapTextByWord(text, 6);
        const totalLines = lines.length;
        
        // Hitung tinggi total blok teks
        const totalTextHeight = (fontHeight * totalLines) + (lineSpacing * (totalLines - 1));
        let startY = (512 - totalTextHeight) / 2;

        // Cetak tiap baris dengan mengukur lebar piksel aslinya pakai measureText bawaan Jimp
        for (let i = 0; i < totalLines; i++) {
            const currentY = startY + (i * (fontHeight + lineSpacing));
            
            // measureText menghitung lebar asli teks dalam piksel secara akurat (bebas dari masalah spasi/karakter sempit)
            const lineWidth = measureText(font, lines[i]);
            const currentX = (512 - lineWidth) / 2;

            image.print({
                font: font,
                x: currentX,
                y: currentY,
                text: {
                    text: lines[i]
                }
            });
        }

        const buffer = await image.getBuffer('image/png');
        return buffer;
    } catch (err) {
        throw new Error("Gagal merender teks: " + err.message);
    }
}

module.exports = { createBlackWhiteText };
