import assert from 'node:assert/strict';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { createPipeline } from '../packages/core/index.js';

// Synthetic deterministic adapters measure core bookkeeping, never OCR/model quality or network latency.
const samples = Number(process.env.SAMPLES ?? 50);
if (!Number.isInteger(samples) || samples < 5 || samples > 10000) throw new Error('SAMPLES must be an integer from 5 to 10000');
const input = () => ({
  imageBytes: new Uint8Array(65536).fill(7), width: 1000, height: 1000, namespace: 'benchmark:synthetic',
  ocrConfig: { engine: 'deterministic-fixture', revision: '1' },
  translation: { sourceLanguage: 'en', targetLanguage: 'zh-Hans', provider: 'fixture', endpoint: 'https://example.invalid/mock', accountNamespace: 'fixture', model: 'deterministic-v1', promptVersion: '1', schemaVersion: '1', context: 'synthetic scene', glossary: {}, generation: { temperature: 0 } },
});
const regions = Array.from({length: 8}, (_, i) => ({ regionId: `r${i}`, bbox: { x: 10, y: 10 + i * 80, width: 200, height: 60 }, sourceText: `Synthetic dialogue ${i}`, readingOrder: i, sourceRevision: 0 }));
const calls = { ocr: 0, translation: 0 };
const pipeline = createPipeline({
  ocr: async () => { calls.ocr++; return { regions: structuredClone(regions) }; },
  translate: async request => { calls.translation++; return { translations: request.regions.map(r => ({ regionId: r.regionId, text: `Fixture translation: ${r.sourceText}` })) }; },
});
const difference = (after, before) => Object.fromEntries(Object.entries(after).filter(([,v])=>typeof v==='number').map(([k,v])=>[k,v-(before[k]??0)]));
const percentile = (sorted, p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
async function scenario(name, prepare) {
  const before = pipeline.diagnostics(), countersBefore = {...calls}, durations = [];
  for (let i = 0; i < samples; i++) {
    const request = prepare(i);
    const started = performance.now(); await pipeline.run(request); durations.push(performance.now() - started);
  }
  durations.sort((a,b)=>a-b);
  const metrics = difference(pipeline.diagnostics(), before);
  return { name, samples, durationMs: { p50: percentile(durations,.5), p95: percentile(durations,.95), min: durations[0], max: durations.at(-1) }, adapterCalls: difference(calls,countersBefore), cache: Object.fromEntries(Object.entries(metrics).filter(([k])=>/Lookups|Hits|Misses|Coalesced/.test(k))), applicationHitRates: { ocr: metrics.ocrHits / metrics.ocrLookups, translation: metrics.translationHits / metrics.translationLookups } };
}
const results=[];
results.push(await scenario('cold application cache; clear before each sample',()=>{pipeline.clear();return input();}));
results.push(await scenario('warm identical input',()=>input()));
assert.deepEqual(results[1].adapterCalls,{ocr:0,translation:0});
results.push(await scenario('context invalidation; OCR remains warm',i=>{const request=input();request.translation.context=`Different synthetic scene ${i}`;return request;}));
assert.deepEqual(results[2].adapterCalls,{ocr:0,translation:samples});
results.push(await scenario('source corrections; OCR remains warm',i=>({...input(),sourceEdits:{r0:`Edited synthetic text ${i}`}})));
assert.deepEqual(results[3].adapterCalls,{ocr:0,translation:samples});
results.push(await scenario('clear both stages between samples',()=>{pipeline.clear();return input();}));
assert.deepEqual(results[4].adapterCalls,{ocr:samples,translation:samples});
console.log(JSON.stringify({
  benchmark: 'synthetic cache core v1', generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
  conditions: { imageBytes:65536, width:1000, height:1000, regions:8, ocrConcurrency:1, translationConcurrency:2, maxQueue:16, cacheMaxEntriesPerStage:128, cacheMaxBytesPerStage:8388608, cacheTtlMs:1800000, network:'none', retries:0, adapters:'deterministic in-process fixtures; no image decode, OCR model or LLM', percentileMethod:'nearest rank', timer:'performance.now; complete core pipeline including hash/validation/cache', exclusions:'No real-browser/M4 latency, quality, decoded memory, paid-provider usage or provider prompt-cache measurements. Hit rates describe only these artificial scenarios.' },
  scenarios: results,
},null,2));
