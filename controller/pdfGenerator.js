// File: ./utils/pdfGenerator.js
const RdModel = require('../models/RdModel');

async function generatePdfFromSource(sourceData) {
    // 1. Ambil RapidAPI Key dari RdModel (Pola Key-Value)
    const keyDoc = await RdModel.findOne({ key: 'RAPID_API_KEY' }); 
    if (!keyDoc || !keyDoc.value) {
        throw new Error("RAPIDAPI_KEY belum terdaftar di database.");
    }
    const rapidApiKey = keyDoc.value;

    // 2. Tembak API yakpdf via fetch
    const response = await fetch('https://yakpdf.p.rapidapi.com/pdf', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-rapidapi-host': 'yakpdf.p.rapidapi.com',
            'x-rapidapi-key': rapidApiKey
        },
        body: JSON.stringify({
            source: sourceData, // Bisa berupa { html: "..." } atau { url: "..." } nantinya
            pdf: { format: 'A4', scale: 1, printBackground: true },
            wait: { for: 'navigation', waitUntil: 'load', timeout: 2500 }
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gagal dari server PDF (Status: ${response.status}) - ${errText}`);
    }

    // 3. Ambil hasil PDF dalam bentuk Buffer
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

module.exports = { generatePdfFromSource };
