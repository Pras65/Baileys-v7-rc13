const { createCanvas, loadImage } = require('@napi-rs/canvas');

async function addAdvancedTextOverlay(imageBuffer, textData) {
    // Kalau nggak ada teks, langsung kembalikan gambar asli
    if (!textData || !textData.text) return imageBuffer;

    const image = await loadImage(imageBuffer);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');

    // Gambar ulang fotonya di atas kanvas
    ctx.drawImage(image, 0, 0, image.width, image.height);

    const { text, style } = textData;

    // Membaca Style CSS ala bot lu (dengan default value)
    const color = style['color'] || 'white';
    const fontSize = style['font-size'] || '40px'; 
    const fontStyle = style['font-style'] || 'normal'; // italic, bold
    const position = style['position'] || 'center'; // top, bottom, center, left, right

ctx.font = `${fontStyle} ${fontSize} sans-serif`;
    ctx.fillStyle = color;

    // Tambahkan bayangan hitam keren agar teks selalu kelihatan di background terang
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // Proses Multiline (Baris Baru)
    const lines = text.split('\n');
    const sizeVal = parseInt(fontSize.replace(/\D/g, '')) || 40;
    const lineHeight = sizeVal * 1.2;

    let x = canvas.width / 2;
    let y = canvas.height / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Kalkulasi Koordinat Horizontal (X)
    if (position === 'left') {
        x = 50; 
        ctx.textAlign = 'left';
    } else if (position === 'right') {
        x = canvas.width - 50; 
        ctx.textAlign = 'right';
    }

    // Kalkulasi Koordinat Vertikal (Y)
    const totalTextHeight = lines.length * lineHeight;
    if (position === 'top') {
        y = 50 + (lineHeight / 2); 
    } else if (position === 'bottom') {
        y = canvas.height - 50 - totalTextHeight + (lineHeight / 2); 
    } else {
        y = (canvas.height / 2) - (totalTextHeight / 2) + (lineHeight / 2);
    }

    // Tulis teks baris demi baris
    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i].trim(), x, y + (i * lineHeight));
    }

    // Wajib pakai encode('jpeg') untuk napi-rs/canvas
    return await canvas.encode('jpeg');
}

module.exports = { addAdvancedTextOverlay };
