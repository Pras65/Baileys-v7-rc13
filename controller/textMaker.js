const { Jimp, loadFont } = require('jimp');
const { SANS_128_WHITE, SANS_64_WHITE, SANS_32_WHITE } = require('jimp/fonts');

async function createBlackWhiteText(text) {
    try {
        const image = new Jimp({ width: 512, height: 512, color: 0x000000FF });

        // Pilih font berdasarkan panjang karakter
        let font;
        if (text.length < 15) {
            font = await loadFont(SANS_128_WHITE); // Teks pendek sangat besar
        } else if (text.length < 40) {
            font = await loadFont(SANS_64_WHITE);  // Teks sedang
        } else {
            font = await loadFont(SANS_32_WHITE);  // Teks panjang
        }

        image.print({
            font: font,
            x: 0,
            y: 0,
            text: {
                text: text,
                // Mengatur alignment ke tengah (CENTER) dan tengah vertikal (MIDDLE)
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
                alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
            },
            maxWidth: 512,
            maxHeight: 512
        });

        const buffer = await image.getBuffer('image/png');
        return buffer;
    } catch (err) {
        throw new Error("Gagal merender teks: " + err.message);
    }
}

module.exports = { createBlackWhiteText };
