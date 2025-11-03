/**
 * Audio File Generator
 * 
 * Generates simple WAV audio files for testing STT
 */

/**
 * Generate a silent WAV audio file
 * 
 * @param {number} durationMs - Duration in milliseconds
 * @param {number} sampleRate - Sample rate (default: 16000 Hz for STT)
 * @returns {Buffer} WAV file buffer
 */
function generateSilentAudio(durationMs = 1000, sampleRate = 16000) {
  const numChannels = 1; // Mono
  const bitsPerSample = 16;
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const fileSize = 44 + dataSize; // 44 bytes for WAV header

  const buffer = Buffer.alloc(fileSize);

  // WAV Header (44 bytes)
  // RIFF chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write('WAVE', 8);

  // fmt sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28); // ByteRate
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32); // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Audio data (silence = all zeros)
  // The buffer is already initialized with zeros, so we're done!

  return buffer;
}

/**
 * Generate a WAV file with a simple tone (sine wave)
 * 
 * @param {number} durationMs - Duration in milliseconds
 * @param {number} frequency - Frequency in Hz (default: 440 Hz = A4 note)
 * @param {number} sampleRate - Sample rate (default: 16000 Hz)
 * @returns {Buffer} WAV file buffer
 */
function generateToneAudio(durationMs = 1000, frequency = 440, sampleRate = 16000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const fileSize = 44 + dataSize;

  const buffer = Buffer.alloc(fileSize);

  // WAV Header (same as silent audio)
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Generate sine wave
  const amplitude = 32767 * 0.5; // 50% volume
  let offset = 44;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.floor(amplitude * Math.sin(2 * Math.PI * frequency * t));
    buffer.writeInt16LE(sample, offset);
    offset += 2;
  }

  return buffer;
}

/**
 * Load a pre-recorded audio file from fixtures
 * 
 * @param {string} filename - Filename in tests/fixtures/
 * @returns {Buffer} Audio file buffer
 */
function loadFixtureAudio(filename) {
  const fs = require('fs');
  const path = require('path');
  const fixturePath = path.join(__dirname, '..', 'fixtures', filename);
  
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Fixture not found: ${fixturePath}`);
  }
  
  return fs.readFileSync(fixturePath);
}

/**
 * Save audio buffer to file (for debugging)
 * 
 * @param {Buffer} buffer - Audio buffer
 * @param {string} filename - Output filename
 */
function saveAudioToFile(buffer, filename) {
  const fs = require('fs');
  const path = require('path');
  const outputPath = path.join(__dirname, '..', 'output', filename);
  
  // Create output directory if it doesn't exist
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, buffer);
  console.log(`Audio saved to: ${outputPath}`);
}

module.exports = {
  generateSilentAudio,
  generateToneAudio,
  loadFixtureAudio,
  saveAudioToFile,
};

