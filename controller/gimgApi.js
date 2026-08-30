// File: gimgApi.js

async function generateImage(finalPrompt, width, height) {
    const randomSeed = Math.floor(Math.random() * 1000000);
    
    // 🔥 PERHATIKAN BAGIAN AKHIR URL: Tambahan &model=flux
    const apiUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=${width}&height=${height}&nologo=true&seed=${randomSeed}&model=flux`;
    
    console.log("[DEBUG] MENGHUBUNGI AI:", apiUrl);

    const response = await fetch(apiUrl);
    if (!response.ok) {
        throw new Error(`Gagal menghubungi server AI (Status: ${response.status})`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

module.exports = { generateImage };
