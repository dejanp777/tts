#!/usr/bin/env node
/**
 * DeepSeek Variants Benchmark
 * Tests all available DeepSeek models on OpenRouter
 */

const fs = require('fs');
const path = require('path');

// Load .env manually
function loadEnv(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    });
  } catch (e) {
    console.error(`Warning: Could not load ${filePath}`);
  }
}

loadEnv(path.join(__dirname, '../../server/.env'));

// DeepSeek models to test
const DEEPSEEK_MODELS = [
  {
    id: 'deepseek/deepseek-chat-v3-0324',
    name: 'DeepSeek V3 (March 2024) - CURRENT',
    description: 'Current baseline model'
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3 (Latest)',
    description: 'Latest V3 model'
  },
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    description: 'Reasoning model, 671B params'
  },
  {
    id: 'deepseek/deepseek-r1:free',
    name: 'DeepSeek R1 (Free)',
    description: 'Free tier R1'
  },
  {
    id: 'deepseek/deepseek-r1-0528',
    name: 'DeepSeek R1 (May 2025)',
    description: 'Updated R1 with better reasoning'
  },
  {
    id: 'deepseek/deepseek-v3-0324',
    name: 'DeepSeek V3 0324 (alt ID)',
    description: 'Alternative model ID'
  },
  {
    id: 'tngtech/deepseek-r1t-chimera:free',
    name: 'DeepSeek R1T Chimera (Free)',
    description: 'R1+V3 merged model, 20% faster'
  }
];

const SYSTEM_PROMPT = `You are a 24-year-old secretary working in New York City. You have a sassy, confident personality with a hint of flirtatiousness. You're smart, quick-witted, and always have a clever comeback. Keep your responses short and punchy - no more than 7 words. Never break character.`;

const TEST_PROMPTS = [
  "Hello, how are you today?",
  "Tell me a short joke.",
  "What's your favorite thing about NYC?"
];

async function testModel(model, prompt, apiKey) {
  const startTime = Date.now();
  let firstTokenTime = null;
  let responseText = '';
  let error = null;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'DeepSeek Benchmark'
      },
      body: JSON.stringify({
        model: model.id,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_tokens: 50,
        temperature: 0.8,
        stream: true
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorBody.substring(0, 100)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            if (!firstTokenTime) {
              firstTokenTime = Date.now() - startTime;
            }
            responseText += content;
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    error = e.message;
  }

  return {
    success: !error,
    error,
    firstTokenMs: firstTokenTime,
    totalMs: Date.now() - startTime,
    response: responseText.trim()
  };
}

async function runBenchmark() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   🔬 DeepSeek Variants Benchmark');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`   Testing ${DEEPSEEK_MODELS.length} DeepSeek models`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const results = [];

  for (const model of DEEPSEEK_MODELS) {
    console.log(`\n📊 Testing: ${model.name}`);
    console.log(`   Model ID: ${model.id}`);

    const modelResults = [];

    for (let i = 0; i < 3; i++) {
      const prompt = TEST_PROMPTS[i];
      process.stdout.write(`   Run ${i + 1}/3: `);

      const result = await testModel(model, prompt, apiKey);
      modelResults.push(result);

      if (result.success) {
        console.log(`✅ TTFT: ${result.firstTokenMs}ms, Total: ${result.totalMs}ms`);
        console.log(`      "${result.response.substring(0, 50)}..."`);
      } else {
        console.log(`❌ ${result.error.substring(0, 60)}`);
      }

      await new Promise(r => setTimeout(r, 500));
    }

    const successful = modelResults.filter(r => r.success);
    const ttfts = successful.map(r => r.firstTokenMs).filter(t => t);

    results.push({
      model: model.id,
      name: model.name,
      description: model.description,
      runs: modelResults.length,
      success: successful.length,
      avgTTFT: ttfts.length ? Math.round(ttfts.reduce((a, b) => a + b, 0) / ttfts.length) : null,
      minTTFT: ttfts.length ? Math.min(...ttfts) : null,
      maxTTFT: ttfts.length ? Math.max(...ttfts) : null,
      samples: successful.slice(0, 2).map(r => r.response)
    });

    await new Promise(r => setTimeout(r, 1000));
  }

  // Print results table
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('   📊 RESULTS - Sorted by Average TTFT');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const sorted = results.filter(r => r.avgTTFT).sort((a, b) => a.avgTTFT - b.avgTTFT);
  const failed = results.filter(r => !r.avgTTFT);

  console.log('┌─────┬─────────────────────────────────────┬──────────┬──────────┬──────────┐');
  console.log('│ Rank│ Model                               │ TTFT Avg │ TTFT Min │ TTFT Max │');
  console.log('├─────┼─────────────────────────────────────┼──────────┼──────────┼──────────┤');

  sorted.forEach((r, i) => {
    const rank = String(i + 1).padStart(3);
    const name = r.name.substring(0, 35).padEnd(35);
    const avg = `${r.avgTTFT}ms`.padStart(8);
    const min = `${r.minTTFT}ms`.padStart(8);
    const max = `${r.maxTTFT}ms`.padStart(8);
    const marker = r.model === 'deepseek/deepseek-chat-v3-0324' ? ' ⬅️ CURRENT' : '';
    const winner = i === 0 ? ' 🏆' : '';
    console.log(`│ ${rank} │ ${name} │ ${avg} │ ${min} │ ${max} │${winner}${marker}`);
  });

  console.log('└─────┴─────────────────────────────────────┴──────────┴──────────┴──────────┘');

  if (failed.length > 0) {
    console.log('\n❌ Failed/Unavailable Models:');
    failed.forEach(r => console.log(`   - ${r.name} (${r.model})`));
  }

  // Recommendation
  const current = sorted.find(r => r.model === 'deepseek/deepseek-chat-v3-0324');
  const winner = sorted[0];

  if (winner && current && winner.model !== current.model) {
    const improvement = Math.round((1 - winner.avgTTFT / current.avgTTFT) * 100);
    console.log('\n═══════════════════════════════════════════════════════════════════════════════');
    console.log(`   🏆 RECOMMENDED: ${winner.name}`);
    console.log(`   ⚡ ${improvement}% faster than current (${winner.avgTTFT}ms vs ${current.avgTTFT}ms)`);
    console.log(`   💡 Update server/.env:`);
    console.log(`      OPENROUTER_MODEL=${winner.model}`);
    console.log('═══════════════════════════════════════════════════════════════════════════════');
  } else if (winner) {
    console.log('\n═══════════════════════════════════════════════════════════════════════════════');
    console.log(`   ✅ Current model is optimal or best available`);
    console.log('═══════════════════════════════════════════════════════════════════════════════');
  }

  // Sample responses
  if (winner?.samples?.length) {
    console.log('\n📝 Sample Responses from Winner:');
    winner.samples.forEach((s, i) => console.log(`   ${i + 1}. "${s}"`));
  }
}

runBenchmark().catch(console.error);
