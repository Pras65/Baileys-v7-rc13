function parseGimgPrompt(fullPrompt) {
    let tempPrompt = fullPrompt;

    // 1. Ekstrak Blok Style CSS: #id { color: yellow, font-size: 25px, ... }
    const styleRegex = /#([a-zA-Z0-9_-]+)\s*\{([^}]+)\}/i;
    const styleMatch = tempPrompt.match(styleRegex);

    let textStyle = {};
    let styleId = null;

    if (styleMatch) {
        styleId = styleMatch[1]; 
        const rawStyles = styleMatch[2]; 
        
        // Bedah string CSS menjadi Object JSON
        rawStyles.split(',').forEach(rule => {
            const parts = rule.split(':');
            if (parts.length === 2) {
                textStyle[parts[0].trim().toLowerCase()] = parts[1].trim();
            }
        });
        tempPrompt = tempPrompt.replace(styleMatch[0], ''); // Bersihkan dari prompt
    }

        // 2. Ekstrak Target Teks
    let textData = null;
    const textRegex = /-t=["“”]([^"“”]+)["“”]_['‘’]([^'‘’]+)['‘’]/i; 

    const textMatch = tempPrompt.match(textRegex);

    if (textMatch) {
        const targetId = textMatch[1];
        // Replace '/+' menjadi newline (\n) agar bisa multiline (enter)
        const rawText = textMatch[2].replace(/\/\+/g, '\n');
        
        textData = {
            id: targetId,
            text: rawText,
            // Jika ID teks dan ID CSS cocok, gabungkan stylenya
            style: (styleId === targetId) ? textStyle : {}
        };
        tempPrompt = tempPrompt.replace(textMatch[0], ''); // Bersihkan dari prompt
    }

    // 3. Ekstrak Penanda Gaya Gambar
    let width = 512, height = 512;
    let categoryName = 'Default';
    let finalPrompt = tempPrompt;
    const flagMatch = tempPrompt.match(/-(l|b|c|3d|r|a)\b/i);

    if (flagMatch) {
        const flag = flagMatch[1].toLowerCase();
        tempPrompt = tempPrompt.replace(flagMatch[0], '').trim();

        switch (flag) {
            case 'l': categoryName = 'Logo'; finalPrompt = `${tempPrompt}, professional minimalist logo design, vector graphic, clean background`; width = 512; height = 512; break;
            case 'b': 
    categoryName = 'Banner'; 
    finalPrompt = `${tempPrompt}, wide landscape format, highly detailed background`; 
    width = 1024; height = 512; 
    break;

            case 'c': categoryName = 'Character'; finalPrompt = `${tempPrompt}`; width = 512; height = 768; break;
            case '3d': categoryName = '3D rend'; finalPrompt = `${tempPrompt}, 3D render`; width = 512; height = 512; break;
            case 'r': categoryName = 'Realistic'; finalPrompt = `${tempPrompt}, Realistic`; width = 512; height = 512; break;
            case 'a': categoryName = 'Anime'; finalPrompt = `${tempPrompt}, Makoto shinkai, vibrant colors`; width = 512; height = 512; break;
        }
    } else {
        finalPrompt = `${tempPrompt.trim()}, masterpiece, high quality, highly detailed`;
    }

    return {
        cleanPrompt: tempPrompt.trim(),
        finalPrompt, width, height, categoryName, textData
    };
}

module.exports = { parseGimgPrompt };
