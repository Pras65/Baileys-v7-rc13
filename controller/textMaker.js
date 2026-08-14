const Jimp = require('jimp');

/**
 * Membuat gambar kotak hitam dengan teks putih di tengahnya (100% Pure JS)
 * @param {string} text - Teks yang ingin ditulis
 * @returns {Promise<Buffer>} - Buffer gambar berformat PNG
 */
async function createBlackWhiteText(text) {
    // 1. Buat kanvas hitam berukuran 512x512
    // Format warna: 0xRRGGBBAA (0x000000FF = Hitam Solid)
    const image = new Jimp(512, 512, 0x000000FF);

    // 2. Load font bawaan Jimp (Warna Putih)
    // Jika teks panjang, pakai font kecil (ukuran 32). Jika pendek, font besar (ukuran 64).
    const fontToUse = text.length > 40 ? Jimp.FONT_SANS_32_WHITE : Jimp.FONT_SANS_64_WHITE;
    const font = await Jimp.loadFont(fontToUse);

    // 3. Print teks ke tengah kanvas (Jimp sudah otomatis memotong baris / word-wrap!)
    image.print(
        font,
        0, // Koordinat X awal
        0, // Koordinat Y awal
        {
            text: text,
            alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
            alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
        },
        512, // Batas lebar maksimal (Max Width)
        512  // Batas tinggi maksimal (Max Height)
    );

    // 4. Jadikan bentuk Buffer PNG
    const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
    return buffer;
}

module.exports = { createBlackWhiteText };
