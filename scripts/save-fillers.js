#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');

const API_URL = 'http://localhost:4000/api/tts/generate-fillers';
const OUTPUT_DIR = path.join(__dirname, '../web/public/audio/fillers');

console.log('[Save Fillers] Generating filler audio files...');
console.log('[Save Fillers] Output directory:', OUTPUT_DIR);

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log('[Save Fillers] Created output directory');
}

// Make POST request
const req = http.request(API_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
}, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);

      if (!response.fillers || response.fillers.length === 0) {
        console.error('[Save Fillers] No fillers returned from API');
        process.exit(1);
      }

      console.log(`[Save Fillers] Received ${response.fillers.length} filler files`);

      // Save each filler
      response.fillers.forEach(filler => {
        // Extract base64 data from data URL
        const base64Data = filler.audio.replace(/^data:audio\/mp3;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const filePath = path.join(OUTPUT_DIR, filler.filename);
        fs.writeFileSync(filePath, buffer);

        console.log(`[Save Fillers] ✓ Saved ${filler.filename} (${(buffer.length / 1024).toFixed(1)} KB)`);
      });

      console.log('[Save Fillers] All filler files saved successfully!');
      process.exit(0);
    } catch (error) {
      console.error('[Save Fillers] Error parsing response:', error.message);
      console.error('[Save Fillers] Response:', data.substring(0, 200));
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.error('[Save Fillers] Request failed:', error.message);
  console.error('[Save Fillers] Make sure the server is running on http://localhost:4000');
  process.exit(1);
});

req.end();
