#!/usr/bin/env node

/**
 * Automated Conversation Test
 * 
 * Tests the full STT → Chat → TTS pipeline with multiple exchanges.
 * Run with: node tests/conversation-test.js [options]
 * 
 * Options:
 *   --exchanges <n>  Number of conversation exchanges (default: 5)
 *   --server <url>   Server URL (default: http://localhost:3000)
 *   --verbose        Show detailed logs
 *   --json           Output results as JSON
 */

const fs = require('fs');
const path = require('path');

// Use server's node_modules
const serverModulesPath = path.join(__dirname, '../server/node_modules');
const axiosModule = require(path.join(serverModulesPath, 'axios'));
const axios = axiosModule.default || axiosModule;
const FormData = require(path.join(serverModulesPath, 'form-data'));

const { generateSilentAudio } = require('./utils/audio-generator');
const { parseSSEStream } = require('./utils/sse-parser');

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (flag, defaultValue) => {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : defaultValue;
};

const NUM_EXCHANGES = parseInt(getArg('--exchanges', '5'));
const SERVER_URL = getArg('--server', 'http://localhost:4000');
const VERBOSE = args.includes('--verbose');
const JSON_OUTPUT = args.includes('--json');

// Test phrases to send
const TEST_PHRASES = [
  "Hello, how are you today?",
  "What's the weather like?",
  "Tell me a short joke.",
  "What can you help me with?",
  "Thank you for your help.",
];

// Results storage
const results = {
  exchanges: [],
  summary: {
    totalTime: 0,
    avgSTT: 0,
    avgChatFirstToken: 0,
    avgChatComplete: 0,
    avgTTSFirstChunk: 0,
    avgTTSComplete: 0,
    avgExchangeTime: 0,
  },
};

/**
 * Log with timestamp
 */
function log(message, level = 'info') {
  if (!JSON_OUTPUT) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const prefix = level === 'error' ? '❌' : level === 'success' ? '✅' : level === 'timing' ? '⏱️' : 'ℹ️';
    console.log(`[${timestamp}] ${prefix} ${message}`);
  }
}

/**
 * Verbose log (only shown with --verbose)
 */
function vlog(message) {
  if (VERBOSE && !JSON_OUTPUT) {
    console.log(`  ${message}`);
  }
}

/**
 * Test STT endpoint
 */
async function testSTT(audioBuffer, encoding = 'wav') {
  const startTime = Date.now();

  const form = new FormData();
  form.append('audio', audioBuffer, {
    filename: `test.${encoding}`,
    contentType: `audio/${encoding}`,
  });

  try {
    const response = await axios.post(`${SERVER_URL}/api/stt`, form, {
      headers: form.getHeaders(),
      timeout: 30000,
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    vlog(`STT Response: ${JSON.stringify(response.data).substring(0, 100)}`);

    return {
      success: true,
      transcript: response.data.transcript,
      duration,
    };
  } catch (error) {
    const endTime = Date.now();
    return {
      success: false,
      error: error.message,
      duration: endTime - startTime,
    };
  }
}

/**
 * Test Chat streaming endpoint
 */
async function testChatStream(messages) {
  const startTime = Date.now();
  let firstTokenTime = null;
  let fullText = '';

  try {
    const response = await axios.post(
      `${SERVER_URL}/api/chat/stream`,
      { messages },
      {
        responseType: 'stream',
        timeout: 60000,
      }
    );

    const chunks = await parseSSEStream(response.data, (token) => {
      if (firstTokenTime === null) {
        firstTokenTime = Date.now();
      }
      fullText += token;
      vlog(`Chat token: ${token}`);
    });

    const endTime = Date.now();

    return {
      success: true,
      text: fullText,
      firstTokenDuration: firstTokenTime ? firstTokenTime - startTime : null,
      totalDuration: endTime - startTime,
      tokenCount: chunks.length,
    };
  } catch (error) {
    const endTime = Date.now();
    return {
      success: false,
      error: error.message,
      duration: endTime - startTime,
    };
  }
}

/**
 * Test TTS streaming endpoint
 */
async function testTTSStream(text) {
  const startTime = Date.now();
  let firstChunkTime = null;
  let chunkCount = 0;
  let totalAudioBytes = 0;

  try {
    const response = await axios.post(
      `${SERVER_URL}/api/tts/stream`,
      { text },
      {
        responseType: 'stream',
        timeout: 60000,
      }
    );

    await parseSSEStream(response.data, (audioData) => {
      if (firstChunkTime === null) {
        firstChunkTime = Date.now();
      }
      chunkCount++;
      totalAudioBytes += audioData.length;
      vlog(`TTS chunk ${chunkCount}: ${audioData.length} bytes`);
    }, true); // true = TTS mode (base64 audio chunks)

    const endTime = Date.now();

    return {
      success: true,
      firstChunkDuration: firstChunkTime ? firstChunkTime - startTime : null,
      totalDuration: endTime - startTime,
      chunkCount,
      totalAudioBytes,
    };
  } catch (error) {
    const endTime = Date.now();
    return {
      success: false,
      error: error.message,
      duration: endTime - startTime,
    };
  }
}

/**
 * Run a single conversation exchange
 */
async function runExchange(exchangeNum, userMessage) {
  log(`Exchange ${exchangeNum}: "${userMessage}"`);
  
  const exchangeStart = Date.now();
  const exchange = {
    number: exchangeNum,
    userMessage,
    stt: null,
    chat: null,
    tts: null,
    totalTime: 0,
  };

  // Step 1: Generate audio for the user message
  vlog('Generating audio...');
  const audioBuffer = await generateSilentAudio(2000); // 2 seconds of silence as placeholder

  // Step 2: STT
  log('Testing STT...', 'info');
  exchange.stt = await testSTT(audioBuffer, 'wav');
  
  if (!exchange.stt.success) {
    log(`STT failed: ${exchange.stt.error}`, 'error');
    return exchange;
  }
  
  log(`STT completed in ${exchange.stt.duration}ms`, 'timing');

  // Step 3: Chat
  log('Testing Chat...', 'info');
  const messages = [
    { role: 'user', content: userMessage }
  ];
  
  exchange.chat = await testChatStream(messages);
  
  if (!exchange.chat.success) {
    log(`Chat failed: ${exchange.chat.error}`, 'error');
    return exchange;
  }
  
  log(`Chat first token in ${exchange.chat.firstTokenDuration}ms`, 'timing');
  log(`Chat completed in ${exchange.chat.totalDuration}ms`, 'timing');
  vlog(`Assistant: ${exchange.chat.text.substring(0, 100)}...`);

  // Step 4: TTS
  log('Testing TTS...', 'info');
  exchange.tts = await testTTSStream(exchange.chat.text);
  
  if (!exchange.tts.success) {
    log(`TTS failed: ${exchange.tts.error}`, 'error');
    return exchange;
  }
  
  log(`TTS first chunk in ${exchange.tts.firstChunkDuration}ms`, 'timing');
  log(`TTS completed in ${exchange.tts.totalDuration}ms (${exchange.tts.chunkCount} chunks)`, 'timing');

  // Calculate total time
  const exchangeEnd = Date.now();
  exchange.totalTime = exchangeEnd - exchangeStart;
  
  log(`Exchange ${exchangeNum} completed in ${exchange.totalTime}ms`, 'success');
  log('─'.repeat(60));

  return exchange;
}

/**
 * Calculate summary statistics
 */
function calculateSummary() {
  const successful = results.exchanges.filter(e => 
    e.stt?.success && e.chat?.success && e.tts?.success
  );

  if (successful.length === 0) {
    return;
  }

  results.summary.totalTime = results.exchanges.reduce((sum, e) => sum + e.totalTime, 0);
  results.summary.avgSTT = successful.reduce((sum, e) => sum + e.stt.duration, 0) / successful.length;
  results.summary.avgChatFirstToken = successful.reduce((sum, e) => sum + e.chat.firstTokenDuration, 0) / successful.length;
  results.summary.avgChatComplete = successful.reduce((sum, e) => sum + e.chat.totalDuration, 0) / successful.length;
  results.summary.avgTTSFirstChunk = successful.reduce((sum, e) => sum + e.tts.firstChunkDuration, 0) / successful.length;
  results.summary.avgTTSComplete = successful.reduce((sum, e) => sum + e.tts.totalDuration, 0) / successful.length;
  results.summary.avgExchangeTime = results.summary.totalTime / successful.length;
  results.summary.successRate = (successful.length / results.exchanges.length) * 100;
}

/**
 * Print summary
 */
function printSummary() {
  if (JSON_OUTPUT) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log('\n' + '═'.repeat(60));
  console.log('📊 CONVERSATION TEST SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Total Exchanges: ${results.exchanges.length}`);
  console.log(`Success Rate: ${results.summary.successRate.toFixed(1)}%`);
  console.log(`Total Time: ${results.summary.totalTime}ms`);
  console.log('');
  console.log('Average Timings:');
  console.log(`  STT:                ${results.summary.avgSTT.toFixed(0)}ms`);
  console.log(`  Chat First Token:   ${results.summary.avgChatFirstToken.toFixed(0)}ms`);
  console.log(`  Chat Complete:      ${results.summary.avgChatComplete.toFixed(0)}ms`);
  console.log(`  TTS First Chunk:    ${results.summary.avgTTSFirstChunk.toFixed(0)}ms`);
  console.log(`  TTS Complete:       ${results.summary.avgTTSComplete.toFixed(0)}ms`);
  console.log(`  Exchange Total:     ${results.summary.avgExchangeTime.toFixed(0)}ms`);
  console.log('═'.repeat(60));
}

/**
 * Main test runner
 */
async function main() {
  log('🚀 Starting Conversation Test');
  log(`Server: ${SERVER_URL}`);
  log(`Exchanges: ${NUM_EXCHANGES}`);
  log('═'.repeat(60));

  for (let i = 0; i < NUM_EXCHANGES; i++) {
    const phrase = TEST_PHRASES[i % TEST_PHRASES.length];
    const exchange = await runExchange(i + 1, phrase);
    results.exchanges.push(exchange);
    
    // Small delay between exchanges
    if (i < NUM_EXCHANGES - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  calculateSummary();
  printSummary();
}

// Run the test
main().catch(error => {
  log(`Fatal error: ${error.message}`, 'error');
  if (VERBOSE) {
    console.error(error);
  }
  process.exit(1);
});

