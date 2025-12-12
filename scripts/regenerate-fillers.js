#!/usr/bin/env node

/**
 * Regenerate thinking filler audio files with high quality
 * Uses Cartesia TTS API with the same voice (Tessa) and parameters as the app
 */

const fs = require('fs');
const path = require('path');

// Load .env manually
const envPath = path.join(__dirname, '../server/.env');
const envContent = fs.readFileSync(envPath, 'utf8');
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    process.env[match[1].trim()] = match[2].trim();
  }
});

// Add server node_modules to path
module.paths.unshift(path.join(__dirname, '../server/node_modules'));

const axios = require('axios');

const CARTESIA_API_KEY = process.env.CARTESIA_API_KEY;
const CARTESIA_TTS_MODEL = process.env.CARTESIA_TTS_MODEL || 'sonic-3';
const CARTESIA_VERSION = process.env.CARTESIA_VERSION || '2024-06-10';
const TESSA_VOICE_ID = '6ccbfb76-1fc6-48f7-b71d-91ac6298247b';

const OUTPUT_DIR = path.join(__dirname, '../web/public/audio/fillers');

// Filler definitions with appropriate emotions
const FILLERS = [
  { text: 'hmm', emotion: 'curious', filename: 'hmm.mp3' },
  { text: 'let me see', emotion: 'curious', filename: 'let-me-see.mp3' },
  { text: 'let me think about that', emotion: 'curious', filename: 'let-me-think.mp3' },
  { text: 'okay', emotion: 'neutral', filename: 'okay.mp3' },
  { text: 'I see', emotion: 'curious', filename: 'i-see.mp3' },
  { text: 'right', emotion: 'neutral', filename: 'right.mp3' },
  { text: 'so', emotion: 'neutral', filename: 'so.mp3' },
  { text: 'well', emotion: 'curious', filename: 'well.mp3' }
];

async function generateFiller(filler) {
  console.log(`Generating: ${filler.filename} ("${filler.text}")...`);

  try {
    const response = await axios.post('https://api.cartesia.ai/tts/bytes', {
      model_id: CARTESIA_TTS_MODEL,
      transcript: filler.text,
      voice: { mode: 'id', id: TESSA_VOICE_ID },
      output_format: {
        container: 'mp3',
        encoding: 'mp3',
        sample_rate: 44100  // High quality sample rate
      },
      generation_config: {
        speed: 0.9,  // Slightly slower for natural thinking sound
        emotion: filler.emotion
      }
    }, {
      headers: {
        'X-API-Key': CARTESIA_API_KEY,
        'Cartesia-Version': CARTESIA_VERSION,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
      timeout: 60000,
    });

    const outputPath = path.join(OUTPUT_DIR, filler.filename);
    fs.writeFileSync(outputPath, Buffer.from(response.data));

    const stats = fs.statSync(outputPath);
    console.log(`  ✓ Saved ${filler.filename} (${(stats.size / 1024).toFixed(1)} KB)`);

    return true;
  } catch (error) {
    console.error(`  ✗ Error generating ${filler.filename}:`, error.response?.data || error.message);
    return false;
  }
}

async function main() {
  if (!CARTESIA_API_KEY) {
    console.error('Error: CARTESIA_API_KEY not found in server/.env');
    process.exit(1);
  }

  console.log('');
  console.log('=== Regenerating Thinking Filler Audio Files ===');
  console.log(`Voice: Tessa (${TESSA_VOICE_ID})`);
  console.log(`Model: ${CARTESIA_TTS_MODEL}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Sample Rate: 44100 Hz (high quality)`);
  console.log('');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let successCount = 0;
  let failCount = 0;

  for (const filler of FILLERS) {
    const success = await generateFiller(filler);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
    // Small delay between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('');
  console.log('=== Generation Complete ===');
  console.log(`Success: ${successCount}/${FILLERS.length}`);
  if (failCount > 0) {
    console.log(`Failed: ${failCount}`);
  }
}

main().catch(console.error);
