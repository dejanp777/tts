#!/usr/bin/env node
/**
 * Comprehensive LLM Benchmark for OpenRouter
 * Tests 10 roleplay/conversational models for latency and quality
 *
 * Usage:
 *   node benchmark-llms.js [--runs 3] [--json]
 */

const fs = require('fs');
const path = require('path');

// Load .env manually (no dotenv dependency)
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

const API_BASE = process.env.API_BASE_URL || 'http://localhost:4000';

// 10 Best Roleplay/Conversational LLMs on OpenRouter
const MODELS_TO_TEST = [
  // Fast/Small Models (Speed-optimized)
  {
    id: 'meta-llama/llama-3.1-8b-instruct',
    name: 'Llama 3.1 8B Instruct',
    category: 'fast',
    description: 'Fast, lightweight, good for chat'
  },
  {
    id: 'mistralai/mistral-7b-instruct',
    name: 'Mistral 7B Instruct',
    category: 'fast',
    description: 'Fast, creative, low latency'
  },
  {
    id: 'google/gemini-2.0-flash-001',
    name: 'Gemini 2.0 Flash',
    category: 'fast',
    description: 'Google fast model, popular'
  },
  {
    id: 'anthropic/claude-3-haiku-20240307',
    name: 'Claude 3 Haiku',
    category: 'fast',
    description: 'Anthropic fast model, high quality'
  },

  // Roleplay-Optimized Models
  {
    id: 'neversleep/llama-3-lumimaid-70b',
    name: 'Llama 3 Lumimaid 70B',
    category: 'roleplay',
    description: 'Top RP model, uncensored when needed'
  },
  {
    id: 'gryphe/mythomax-l2-13b',
    name: 'MythoMax L2 13B',
    category: 'roleplay',
    description: 'Popular RP model, good balance'
  },
  {
    id: 'cognitivecomputations/dolphin-mixtral-8x22b',
    name: 'Dolphin Mixtral 8x22B',
    category: 'roleplay',
    description: 'Uncensored, creative'
  },
  {
    id: 'nousresearch/hermes-3-llama-3.1-70b',
    name: 'Hermes 3 Llama 70B',
    category: 'conversational',
    description: 'Strong conversational, follows instructions'
  },

  // Current Baseline & Alternatives
  {
    id: 'deepseek/deepseek-chat-v3-0324',
    name: 'DeepSeek Chat V3 (BASELINE)',
    category: 'baseline',
    description: 'Current model - baseline comparison'
  },
  {
    id: 'qwen/qwen-2.5-72b-instruct',
    name: 'Qwen 2.5 72B Instruct',
    category: 'conversational',
    description: 'Strong instruction following'
  }
];

// Test prompts that simulate roleplay scenarios
const TEST_PROMPTS = [
  "Hello, how are you today?",
  "Tell me a short joke.",
  "What's your favorite thing about New York?",
  "I'm feeling stressed today.",
  "What should I wear to a party?"
];

// System prompt (same as your app uses)
const SYSTEM_PROMPT = `You are a 24-year-old secretary working in New York City. You have a sassy, confident personality with a hint of flirtatiousness. You're smart, quick-witted, and always have a clever comeback. Keep your responses short and punchy - no more than 7 words. Never break character.`;

class LLMBenchmark {
  constructor(options = {}) {
    this.runs = options.runs || 3;
    this.jsonOutput = options.json || false;
    this.results = {};
    this.apiKey = process.env.OPENROUTER_API_KEY;
  }

  async testModel(model, prompt) {
    const startTime = Date.now();
    let firstTokenTime = null;
    let responseText = '';
    let tokenCount = 0;
    let error = null;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'http://localhost:5173',
          'X-Title': 'LLM Benchmark Test'
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
        throw new Error(`HTTP ${response.status}: ${errorBody}`);
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
              tokenCount++;
            }
          } catch (e) {
            // Skip malformed JSON
          }
        }
      }
    } catch (e) {
      error = e.message;
    }

    const totalTime = Date.now() - startTime;

    return {
      model: model.id,
      modelName: model.name,
      prompt,
      success: !error,
      error,
      firstTokenMs: firstTokenTime,
      totalMs: totalTime,
      response: responseText.trim(),
      responseLength: responseText.length,
      tokenCount
    };
  }

  async benchmarkModel(model) {
    const results = [];

    if (!this.jsonOutput) {
      console.log(`\n📊 Testing: ${model.name}`);
      console.log(`   Model ID: ${model.id}`);
      console.log(`   Category: ${model.category}`);
    }

    for (let run = 0; run < this.runs; run++) {
      const prompt = TEST_PROMPTS[run % TEST_PROMPTS.length];

      if (!this.jsonOutput) {
        process.stdout.write(`   Run ${run + 1}/${this.runs}: `);
      }

      const result = await this.testModel(model, prompt);
      results.push(result);

      if (!this.jsonOutput) {
        if (result.success) {
          console.log(`✅ TTFT: ${result.firstTokenMs}ms, Total: ${result.totalMs}ms`);
          console.log(`      Response: "${result.response.substring(0, 50)}..."`);
        } else {
          console.log(`❌ Error: ${result.error}`);
        }
      }

      // Small delay between requests to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }

    // Calculate statistics
    const successfulRuns = results.filter(r => r.success);
    const ttfts = successfulRuns.map(r => r.firstTokenMs).filter(t => t);
    const totals = successfulRuns.map(r => r.totalMs);

    const stats = {
      model: model.id,
      modelName: model.name,
      category: model.category,
      description: model.description,
      runsCompleted: successfulRuns.length,
      runsFailed: results.length - successfulRuns.length,
      ttft: {
        min: ttfts.length ? Math.min(...ttfts) : null,
        max: ttfts.length ? Math.max(...ttfts) : null,
        avg: ttfts.length ? Math.round(ttfts.reduce((a, b) => a + b, 0) / ttfts.length) : null,
        p95: ttfts.length ? ttfts.sort((a, b) => a - b)[Math.floor(ttfts.length * 0.95)] : null
      },
      total: {
        min: totals.length ? Math.min(...totals) : null,
        max: totals.length ? Math.max(...totals) : null,
        avg: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : null
      },
      sampleResponses: successfulRuns.slice(0, 2).map(r => r.response),
      rawResults: results
    };

    return stats;
  }

  async runBenchmark() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   🚀 OpenRouter LLM Benchmark - Roleplay/Conversational Models');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`   Testing ${MODELS_TO_TEST.length} models with ${this.runs} runs each`);
    console.log(`   System prompt: "${SYSTEM_PROMPT.substring(0, 50)}..."`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    const allStats = [];

    for (const model of MODELS_TO_TEST) {
      try {
        const stats = await this.benchmarkModel(model);
        allStats.push(stats);
      } catch (e) {
        console.error(`Failed to test ${model.name}: ${e.message}`);
        allStats.push({
          model: model.id,
          modelName: model.name,
          category: model.category,
          error: e.message,
          runsCompleted: 0,
          runsFailed: this.runs
        });
      }

      // Delay between models
      await new Promise(r => setTimeout(r, 1000));
    }

    return allStats;
  }

  printResults(allStats) {
    console.log('\n');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('   📊 BENCHMARK RESULTS - Sorted by Average TTFT (Fastest First)');
    console.log('═══════════════════════════════════════════════════════════════════════════════');

    // Sort by average TTFT (fastest first)
    const sorted = allStats
      .filter(s => s.ttft?.avg)
      .sort((a, b) => a.ttft.avg - b.ttft.avg);

    const failed = allStats.filter(s => !s.ttft?.avg);

    console.log('\n┌─────┬────────────────────────────────┬──────────┬──────────┬──────────┬──────────┬───────────┐');
    console.log('│ Rank│ Model                          │ Category │ TTFT Avg │ TTFT Min │ TTFT Max │ Total Avg │');
    console.log('├─────┼────────────────────────────────┼──────────┼──────────┼──────────┼──────────┼───────────┤');

    sorted.forEach((stats, index) => {
      const rank = index + 1;
      const name = stats.modelName.substring(0, 30).padEnd(30);
      const cat = stats.category.substring(0, 8).padEnd(8);
      const ttftAvg = `${stats.ttft.avg}ms`.padStart(8);
      const ttftMin = `${stats.ttft.min}ms`.padStart(8);
      const ttftMax = `${stats.ttft.max}ms`.padStart(8);
      const totalAvg = `${stats.total.avg}ms`.padStart(9);

      const marker = stats.model === 'deepseek/deepseek-chat-v3-0324' ? ' ⬅️ BASELINE' : '';
      const winner = rank === 1 ? ' 🏆' : '';

      console.log(`│ ${String(rank).padStart(3)} │ ${name} │ ${cat} │ ${ttftAvg} │ ${ttftMin} │ ${ttftMax} │ ${totalAvg} │${winner}${marker}`);
    });

    console.log('└─────┴────────────────────────────────┴──────────┴──────────┴──────────┴──────────┴───────────┘');

    if (failed.length > 0) {
      console.log('\n❌ Failed Models:');
      failed.forEach(s => {
        console.log(`   - ${s.modelName}: ${s.error || 'No successful runs'}`);
      });
    }

    // Find baseline and winner
    const baseline = sorted.find(s => s.model === 'deepseek/deepseek-chat-v3-0324');
    const winner = sorted[0];

    if (baseline && winner && winner.model !== baseline.model) {
      const improvement = Math.round((1 - winner.ttft.avg / baseline.ttft.avg) * 100);
      console.log('\n═══════════════════════════════════════════════════════════════════════════════');
      console.log(`   🏆 WINNER: ${winner.modelName}`);
      console.log(`   ⚡ TTFT: ${winner.ttft.avg}ms (${improvement}% faster than DeepSeek baseline)`);
      console.log(`   📝 Category: ${winner.category}`);
      console.log(`   💡 Recommendation: Update server/.env with:`);
      console.log(`      OPENROUTER_MODEL=${winner.model}`);
      console.log('═══════════════════════════════════════════════════════════════════════════════');
    }

    // Sample responses from winner
    if (winner?.sampleResponses?.length) {
      console.log('\n📝 Sample Responses from Winner:');
      winner.sampleResponses.forEach((resp, i) => {
        console.log(`   ${i + 1}. "${resp}"`);
      });
    }

    return { sorted, failed, baseline, winner };
  }

  printJSON(allStats) {
    const sorted = allStats
      .filter(s => s.ttft?.avg)
      .sort((a, b) => a.ttft.avg - b.ttft.avg);

    const baseline = sorted.find(s => s.model === 'deepseek/deepseek-chat-v3-0324');
    const winner = sorted[0];

    const output = {
      timestamp: new Date().toISOString(),
      runsPerModel: this.runs,
      modelsCount: MODELS_TO_TEST.length,
      results: sorted.map(s => ({
        rank: sorted.indexOf(s) + 1,
        model: s.model,
        name: s.modelName,
        category: s.category,
        ttftAvg: s.ttft.avg,
        ttftMin: s.ttft.min,
        ttftMax: s.ttft.max,
        totalAvg: s.total.avg,
        successRate: `${s.runsCompleted}/${s.runsCompleted + s.runsFailed}`,
        sampleResponses: s.sampleResponses
      })),
      recommendation: winner ? {
        model: winner.model,
        name: winner.modelName,
        ttftAvg: winner.ttft.avg,
        improvementVsBaseline: baseline ?
          `${Math.round((1 - winner.ttft.avg / baseline.ttft.avg) * 100)}%` : 'N/A',
        envConfig: `OPENROUTER_MODEL=${winner.model}`
      } : null,
      failed: allStats.filter(s => !s.ttft?.avg).map(s => ({
        model: s.model,
        name: s.modelName,
        error: s.error
      }))
    };

    console.log(JSON.stringify(output, null, 2));
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  runs: 3,
  json: false
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--runs' && args[i + 1]) {
    options.runs = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--json') {
    options.json = true;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
Usage: node benchmark-llms.js [options]

Options:
  --runs <n>   Number of test runs per model (default: 3)
  --json       Output results as JSON
  --help, -h   Show this help message

Example:
  node benchmark-llms.js --runs 5
  node benchmark-llms.js --json > results.json
`);
    process.exit(0);
  }
}

// Run benchmark
const benchmark = new LLMBenchmark(options);
benchmark.runBenchmark()
  .then(stats => {
    if (options.json) {
      benchmark.printJSON(stats);
    } else {
      benchmark.printResults(stats);
    }
  })
  .catch(err => {
    console.error('Benchmark failed:', err);
    process.exit(1);
  });
