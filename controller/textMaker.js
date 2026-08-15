const { Jimp, loadFont, measureText } = require('jimp');
const { SANS_128_BLACK } = require('jimp/fonts'); // Menggunakan font warna hitam ukuran 128

async function createBlackWhiteText(text) {
    try {
        // Background putih murni
        const image = new Jimp({ width: 512, height: 512, color: 0xFFFFFFFF });
        
        // Meload font raksasa 128 warna hitam
        const font = await loadFont(SANS_128_BLACK);
        const fontHeight = 128; // Tinggi disesuaikan dengan font
        const lineSpacing = 16; // Jarak antar baris disesuaikan agar tidak terlalu renggang

        // FUNGSI PEMECAH KATA CERDAS (Spasi aman, tidak merusak hitungan)
        function wrapTextByWord(str, maxCharsPerLine) {
            const words = str.trim().split(/\s+/);
            let lines = [];
            let currentLine = '';

            for (let word of words) {
                // Jika kata tunggal kepanjangan, potong paksa
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

                // Hitung panjang baris saat ini jika ditambah kata baru (mengabaikan spasi sebagai beban batas)
                const testLine = currentLine ? currentLine + ' ' + word : word;
                
                // Batas dihitung berdasarkan panjang huruf murni per baris agar tidak mudah kepotong
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

        // Batasi 6 karakter per baris agar font 128 tidak meluber ke luar batas lebar 512
        const lines = wrapTextByWord(text, 6);
        const totalLines = lines.length;
        
        // Hitung total tinggi teks untuk mencari posisi tengah vertikal
        const totalTextHeight = (fontHeight * totalLines) + (lineSpacing * (totalLines - 1));
        let startY = (512 - totalTextHeight) / 2;

        // Cetak baris per baris
        for (let i = 0; i < totalLines; i++) {
            const currentY = startY + (i * (fontHeight + lineSpacing));
            
            // Hitung lebar pasti dari baris ini untuk diposisikan di tengah horizontal
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

        // Ekspor ke buffer PNG agar bisa dikonversi oleh wa-sticker-formatter
        const buffer = await image.getBuffer('image/png');
        return buffer;
    } catch (err) {
        throw new Error("Gagal merender teks: " + err.message);
    }
}

module.exports = { createBlackWhiteText };
