#!/usr/bin/env node

/**
 * Quick Single Exchange Test
 *
 * Tests a single STT → Chat → TTS exchange for quick validation.
 * Run with: node tests/quick-test.js
 */

const path = require('path');

// Use server's node_modules
const serverModulesPath = path.join(__dirname, '../server/node_modules');
const axiosModule = require(path.join(serverModulesPath, 'axios'));
const axios = axiosModule.default || axiosModule;
const FormData = require(path.join(serverModulesPath, 'form-data'));

const { generateSilentAudio } = require('./utils/audio-generator');
const { parseSSEStream } = require('./utils/sse-parser');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:4000';
const TEST_MESSAGE = process.argv[2] || 'Hello, how are you?';

console.log('🚀 Quick Conversation Test');
console.log(`Server: ${SERVER_URL}`);
console.log(`Message: "${TEST_MESSAGE}"`);
console.log('─'.repeat(60));

async function runQuickTest() {
  const totalStart = Date.now();

  try {
    // Step 1: STT
    console.log('\n1️⃣  Testing STT...');
    const sttStart = Date.now();
    
    const audioBuffer = await generateSilentAudio(2000);
    const form = new FormData();
    form.append('audio', audioBuffer, {
      filename: 'test.wav',
      contentType: 'audio/wav',
    });

    const sttResponse = await axios.post(`${SERVER_URL}/api/stt`, form, {
      headers: form.getHeaders(),
      timeout: 30000,
    });

    const sttTime = Date.now() - sttStart;
    console.log(`✅ STT completed in ${sttTime}ms`);
    console.log(`   Transcript: "${sttResponse.data.transcript}"`);

    // Step 2: Chat
    console.log('\n2️⃣  Testing Chat Stream...');
    const chatStart = Date.now();
    let firstTokenTime = null;
    let chatText = '';

    const chatResponse = await axios.post(
      `${SERVER_URL}/api/chat/stream`,
      { messages: [{ role: 'user', content: TEST_MESSAGE }] },
      { responseType: 'stream', timeout: 60000 }
    );

    await parseSSEStream(chatResponse.data, (token) => {
      if (firstTokenTime === null) {
        firstTokenTime = Date.now();
        console.log(`⚡ First token in ${firstTokenTime - chatStart}ms`);
      }
      chatText += token;
      process.stdout.write(token);
    });

    const chatTime = Date.now() - chatStart;
    console.log(`\n✅ Chat completed in ${chatTime}ms`);
    console.log(`   Response length: ${chatText.length} chars`);

    // Step 3: TTS
    console.log('\n3️⃣  Testing TTS Stream...');
    const ttsStart = Date.now();
    let firstChunkTime = null;
    let chunkCount = 0;

    const ttsResponse = await axios.post(
      `${SERVER_URL}/api/tts/stream`,
      { text: chatText },
      { responseType: 'stream', timeout: 60000 }
    );

    await parseSSEStream(ttsResponse.data, (audioData) => {
      if (firstChunkTime === null) {
        firstChunkTime = Date.now();
        console.log(`⚡ First chunk in ${firstChunkTime - ttsStart}ms`);
      }
      chunkCount++;
    }, true);

    const ttsTime = Date.now() - ttsStart;
    console.log(`✅ TTS completed in ${ttsTime}ms (${chunkCount} chunks)`);

    // Summary
    const totalTime = Date.now() - totalStart;
    console.log('\n' + '═'.repeat(60));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(60));
    console.log(`STT:              ${sttTime}ms`);
    console.log(`Chat (first):     ${firstTokenTime ? firstTokenTime - chatStart : 'N/A'}ms`);
    console.log(`Chat (complete):  ${chatTime}ms`);
    console.log(`TTS (first):      ${firstChunkTime ? firstChunkTime - ttsStart : 'N/A'}ms`);
    console.log(`TTS (complete):   ${ttsTime}ms`);
    console.log(`─`.repeat(60));
    console.log(`TOTAL:            ${totalTime}ms`);
    console.log('═'.repeat(60));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    process.exit(1);
  }
}

runQuickTest();

