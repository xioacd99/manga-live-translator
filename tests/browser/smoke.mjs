import {createBubbleBitmap} from '../fixtures/generated-bubble.js';
import {createHash} from 'node:crypto';
import {DETECTOR_MODEL} from '../../extension/model-store.js';
import {PRETRAINED_DETECTOR_REVISION} from '../../extension/adapters/pretrained-regions.js';
import {chromium} from 'playwright';
import {readFile, writeFile, mkdir, cp, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const directory = await mkdtemp(join(tmpdir(), 'manga-extension-smoke-'));
let context, reader, options, worker, popup;
let phase = 'launch';
let calls = 0;
let cancelledDownloadProgress, unknownDownloadProgress, cachedModelReloadMs;
const errors = [], providerInputs = [], network = [], routed = [], consoleErrors = [];
const sanitize = value => String(value).replaceAll('synthetic-test-key-not-real', '[synthetic key redacted]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]').slice(0, 1000);
const record = (list, item) => { if (list.length < 100) list.push(item); };
const requestInfo = request => {
  const url = new URL(request.url());
  return {method: request.method(), origin: url.origin, path: url.pathname, serviceWorker: !!request.serviceWorker?.()};
};

async function refreshProviderEvidence() {
  if (!worker) return [];
  const diagnostics = await worker.evaluate(() => globalThis.__syntheticDiagnostics || []);
  const inputs = diagnostics.filter(entry => entry.kind === 'provider').map(entry => entry.input);
  calls = inputs.length;
  providerInputs.splice(0, providerInputs.length, ...inputs);
  return diagnostics;
}

try {
  const extension = join(directory, 'extension');
  await cp('dist', extension, {recursive: true});
  // CI 从固定官方地址下载测试权重；这里仅把校验后的真实文件放入临时测试扩展。
  const modelBytes = await readFile(process.env.TEST_MODEL_PATH || '.test-models/detector.onnx');
  assert.equal(modelBytes.length, DETECTOR_MODEL.bytes);
  assert.equal(createHash('sha256').update(modelBytes).digest('hex'), DETECTOR_MODEL.sha256);
  await writeFile(join(extension, 'synthetic-model.onnx'), modelBytes);
  const panelBytes = await readFile('tests/fixtures/original-panel.png');
  // Instrument only the temporary copy. Neither shipped redaction nor actual OCR is replaced.
  for (const name of ['background.js', 'offscreen.js']) {
    const path = join(extension, name);
    let original = await readFile(path, 'utf8');
    assert.ok(original.includes('function safeError(error) {'));
    original = original.replace('function safeError(error) {', `function safeError(error) {
      (globalThis.__syntheticErrors ||= []).push(String(error?.message));
      globalThis.__syntheticReport?.({kind:'error',message:String(error?.message)}).catch(()=>{});
    `);
    if (name === 'offscreen.js') {
      // 仅在临时测试副本中记录真实检测返回，不能以 OCR 成功推断检测命中。
      const detectorCall = '() => detector.detect(input)';
      assert.ok(original.includes(detectorCall));
      original = original.replace(detectorCall, `async () => {
        const began = performance.now();
        const detected = await detector.detect(input);
        await globalThis.__syntheticReport({kind:'detector-execution',width:input.width,height:input.height,regions:detected.regions,revision:detected.detectorRevision,adapterDurationMs:performance.now()-began});
        return detected;
      }`);
      const detectionReturn = /const byId = new Map\(\((\w+)\.translations/;
      assert.ok(detectionReturn.test(original));
      original = original.replace(detectionReturn, (match, variable) => `await globalThis.__syntheticReport({kind:'detection',regions:${variable}.detection?.regions || [],revision:${variable}.detection?.detectorRevision});
    ${match}`);
    }
    const prefix = name === 'background.js' ? `
      globalThis.__syntheticDiagnostics = [];
      chrome.runtime.onMessage.addListener((message, sender, reply) => {
        if (message?.target !== 'synthetic-test' || message.type !== 'DIAGNOSTIC') return;
        if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('offscreen.html')) return;
        if (globalThis.__syntheticDiagnostics.length < 100) globalThis.__syntheticDiagnostics.push(message.detail);
        reply({ok:true});
      });
    ` : `
      globalThis.__syntheticReport = detail => chrome.runtime.sendMessage({target:'synthetic-test',type:'DIAGNOSTIC',detail});
      (() => {
        const nativeFetch = globalThis.fetch.bind(globalThis);
        globalThis.fetch = async (input, options = {}) => {
          const url = typeof input === 'string' ? input : input.url || String(input);
          options.signal?.throwIfAborted();
          if (url === ${JSON.stringify(DETECTOR_MODEL.url)}) {
            if (options.credentials !== 'omit' || options.referrerPolicy !== 'no-referrer') throw new Error('Model privacy contract changed');
            const attempt = globalThis.__syntheticModelAttempts = (globalThis.__syntheticModelAttempts || 0) + 1;
            await globalThis.__syntheticReport({kind:'model-fetch'});
            const bytes = new Uint8Array(await (await nativeFetch(chrome.runtime.getURL('synthetic-model.onnx'))).arrayBuffer());
            let offset = 0, stopped = false;
            const stream = new ReadableStream({
              async pull(controller) {
                await new Promise(resolve => setTimeout(resolve, 80));
                if (stopped) return;
                if (options.signal?.aborted) { stopped = true; controller.error(new DOMException('Cancelled', 'AbortError')); return; }
                if (offset === bytes.length) { controller.close(); return; }
                const end = Math.min(offset + 262144, bytes.length);
                controller.enqueue(bytes.slice(offset, end)); offset = end;
              },
              cancel() { stopped = true; },
            });
            return new Response(stream, {headers:{'content-type':'application/octet-stream',...(attempt === 1 ? {'content-length':String(bytes.length)} : {})}});
          }
          if (url === 'https://api.openai.com/v1/chat/completions') {
            try {
              const body = JSON.parse(options.body);
              if (options.method !== 'POST' || options.credentials !== 'omit' || options.redirect !== 'error' || body.store !== false || body.messages?.[1]?.role !== 'user') throw new Error('Synthetic provider transport contract changed');
              const data = JSON.parse(body.messages[1].content);
              if (!Array.isArray(data.regions) || !data.regions.length || data.regions.some(region => typeof region.regionId !== 'string' || typeof region.sourceText !== 'string')) throw new Error('Synthetic provider region contract changed');
              if (body.response_format?.json_schema?.strict !== true) throw new Error('Synthetic provider strict schema missing');
              // Await the relay so a completed translation proves its request was counted.
              await globalThis.__syntheticReport({kind:'provider',input:data});
              options.signal?.throwIfAborted();
              return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({translations:data.regions.map(region => ({regionId:region.regionId,text:'Translated: '+region.sourceText}))})}}]}), {headers:{'content-type':'application/json'}});
            } catch (error) {
              await globalThis.__syntheticReport({kind:'error',message:String(error.message)}).catch(()=>{});
              throw error;
            }
          }
          if (url.startsWith(chrome.runtime.getURL('')) || url.startsWith('blob:')) return nativeFetch(input, options);
          await globalThis.__syntheticReport({kind:'error',message:'Blocked unexpected offscreen fetch: '+new URL(url,location.href).origin}).catch(()=>{});
          throw new Error('Unexpected synthetic offscreen network request blocked');
        };
      })();
    `;
    await writeFile(path, prefix + '\n' + original);
  }
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  // Test-only fixed hosts avoid permission UI. Production permissions are unchanged.
  manifest.host_permissions = ['https://reader.example.com/*', 'https://api.openai.com/*', 'https://huggingface.co/*', 'https://cas-bridge.xethub.hf.co/*'];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(join(directory, 'profile'), {
    headless: true, channel: 'chromium',
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}),
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(120000);
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  // Playwright context routing does not intercept this extension service worker's fetch.
  // Substitute only the synthetic acquisition boundary; production validation and decoding still run.
  await worker.evaluate(({bytes, panelBytes}) => {
    globalThis.__syntheticImageFetches = 0;
    globalThis.__syntheticImageOrder = [];
    globalThis.fetch = async (url, options = {}) => {
      options.signal?.throwIfAborted();
      if (!/^https:\/\/reader\.example\.com\/(?:page|near|rest|lazy|panel)\.png$/.test(String(url))) throw new Error('Unexpected synthetic worker fetch');
      if (options.credentials !== 'omit' || options.redirect !== 'error') throw new Error('Image fetch privacy options changed');
      globalThis.__syntheticImageFetches++;
      globalThis.__syntheticImageOrder.push(new URL(url).pathname);
      return new Response(new Uint8Array(String(url).endsWith('/panel.png') ? panelBytes : bytes), {headers: {'content-type': String(url).endsWith('/panel.png') ? 'image/png' : 'image/bmp'}});
    };
  }, {bytes: Array.from(createBubbleBitmap().imageBytes), panelBytes: Array.from(panelBytes)});
  context.on('page', page => page.on('pageerror', error => record(errors, sanitize(error.message))));
  context.on('console', message => {
    if (message.type() === 'error') record(consoleErrors, sanitize(message.text()));
  });
  context.on('request', request => {
    if (/^https?:/.test(request.url())) record(network, {...requestInfo(request), event: 'request'});
  });
  context.on('requestfailed', request => {
    if (/^https?:/.test(request.url())) record(network, {...requestInfo(request), event: 'failed', error: sanitize(request.failure()?.errorText)});
  });
  // Never fall through to a real remote provider, even if the endpoint unexpectedly changes.
  await context.route(/^https?:\/\//, async route => {
    try {
    const url = new URL(route.request().url());
    record(routed, requestInfo(route.request()));
    if (url.origin === 'https://reader.example.com') {
      if (url.pathname.endsWith('.png')) {
        await route.fulfill({contentType: url.pathname === '/panel.png' ? 'image/png' : 'image/bmp', body: url.pathname === '/panel.png' ? panelBytes : createBubbleBitmap().imageBytes});
      } else {
        await route.fulfill({contentType: 'text/html', body: '<!doctype html><html><body><h1>Synthetic reader fixture</h1><img src="/page.png" width="800" height="300"></body></html>'});
      }
      return;
    }
    errors.push(`Unexpected outbound origin: ${url.origin}`);
    await route.abort('blockedbyclient');
    } catch (error) {
      record(errors, `Mock route failure: ${sanitize(error.message)}`);
      await route.abort('failed').catch(() => {});
    }
  });
  phase = 'first model download progress and cancellation';
  popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator('#modelDownload').waitFor();
  await popup.waitForFunction(() => !document.getElementById('modelDownload').disabled);
  await popup.locator('#modelDownload').click();
  await popup.waitForFunction(() => document.getElementById('modelStatus').textContent.includes('%') && Number(document.getElementById('modelProgress').value) > 0);
  cancelledDownloadProgress = await popup.evaluate(() => ({text:document.getElementById('modelStatus').textContent,loaded:document.getElementById('modelProgress').value,total:document.getElementById('modelProgress').max}));
  assert.ok(cancelledDownloadProgress.loaded > 0 && cancelledDownloadProgress.loaded < DETECTOR_MODEL.bytes);
  assert.equal(cancelledDownloadProgress.total, DETECTOR_MODEL.bytes);
  await popup.locator('#modelCancel').click();
  await popup.waitForFunction(() => document.getElementById('modelStatus').textContent.includes('已取消'));
  assert.equal(await popup.locator('#modelDownload').isEnabled(), true);
  phase = 'retry actual model download and local initialization';
  await popup.locator('#modelDownload').click();
  await popup.waitForFunction(() => document.getElementById('modelStatus').textContent.includes('大小未知'));
  unknownDownloadProgress = await popup.evaluate(() => ({text:document.getElementById('modelStatus').textContent,indeterminate:!document.getElementById('modelProgress').hasAttribute('value')}));
  assert.equal(unknownDownloadProgress.indeterminate, true);
  await popup.waitForFunction(() => document.getElementById('modelStatus').textContent.includes('模型已就绪'));
  assert.equal((await refreshProviderEvidence()).filter(entry => entry.kind === 'model-fetch').length, 2);
  // 销毁推理上下文后重开，验证 IndexedDB 完整模型缓存，而非仅复用内存状态。
  const cachedReloadStart = performance.now();
  await worker.evaluate(async () => { await chrome.offscreen.closeDocument(); });
  await popup.reload();
  await popup.waitForFunction(() => document.getElementById('modelStatus').textContent.includes('模型已就绪'));
  assert.equal((await refreshProviderEvidence()).filter(entry => entry.kind === 'model-fetch').length, 2, 'recreating the executor must reuse the verified persistent model without another download');
  cachedModelReloadMs = performance.now() - cachedReloadStart;
  await popup.close();
  phase = 'configure initial settings';
  options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  async function configure(dialogueContext = '') {
    await options.locator('#key').fill('synthetic-test-key-not-real');
    await options.locator('#model').fill('test-model');
    await options.locator('#context').fill(dialogueContext);
    await options.locator('#consent').check();
    // An earlier successful save has the same status text. Clear it so the wait proves this save finished.
    await options.locator('#status').evaluate(element => { element.textContent = ''; });
    await options.getByRole('button', {name: 'Save for this session', exact: true}).click();
    await options.waitForFunction(() => document.getElementById('status').textContent.length > 0);
    assert.match(await options.locator('#status').textContent(), /^Configured/, 'Settings save failed');
  }
  phase = 'open synthetic reader without provider';
  reader = await context.newPage();
  await reader.goto('https://reader.example.com/');
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({url: 'https://reader.example.com/*'});
    return tabs[0].id;
  });
  async function enable(settings = {}) {
    await reader.bringToFront();
    const response = await options.evaluate(({tabId, settings}) => chrome.runtime.sendMessage({
      type: 'MLT_UI_ENABLE', tabId, imageOrigins: [], auto: false, settings,
    }), {tabId, settings});
    assert.equal(response.ok, true, JSON.stringify(response));
  }
  async function metrics() {
    const response = await options.evaluate(() => chrome.runtime.sendMessage({type: 'MLT_UI_METRICS'}));
    assert.equal(response.ok, true, JSON.stringify(response));
    return response.metrics;
  }
  async function waitForTranslation() {
    // Click handlers synchronously replace the previous status before beginning async work.
    // Detect terminal errors immediately instead of hiding them behind a 120-second timeout.
    await reader.waitForFunction(() => {
      const root = document.querySelector('[data-mlt-reader]')?.shadowRoot;
      const status = root?.querySelector('[role="status"]');
      const button = [...(root?.querySelectorAll('button') || [])].find(button => button.textContent === 'Translate');
      return status?.textContent && !status.textContent.startsWith('Fetching') && button && !button.disabled;
    });
    await refreshProviderEvidence();
    const displayed = await reader.locator('[role="status"]').textContent();
    assert.match(displayed, /^Translated\./, `Translation ended without success (${phase}); displayed status: ${sanitize(displayed)}`);
  }
  async function translate() {
    await reader.getByRole('button', {name: 'Translate', exact: true}).click();
    await waitForTranslation();
  }
  async function waitForPreparation(count = 1) {
    await reader.waitForFunction(count => [...document.querySelectorAll('[data-mlt-reader]')].filter(host => host.shadowRoot?.querySelector('[role="status"]')?.textContent === '本地准备完成，尚未翻译。').length === count, count);
    await refreshProviderEvidence();
  }
  phase = 'local preparation without provider';
  await enable({prepareEnabled: true, prepareBudget: 1});
  await waitForPreparation();
  assert.equal(calls, 0, 'local-only preparation must not require or call a provider');
  const withoutProvider = await metrics();
  assert.equal(withoutProvider.ocrCalls, 1);
  const detections = (await refreshProviderEvidence()).filter(entry => entry.kind === 'detection');
  assert.ok(detections.some(entry => entry.revision === PRETRAINED_DETECTOR_REVISION), 'local preparation must run the pinned pretrained detector, even when the simple bitmap has no detections');
  assert.equal(await reader.locator('.region').count(), 0);
  phase = 'local preparation with configured provider';
  await configure();
  await reader.reload();
  await enable({prepareEnabled: true, prepareBudget: 1});
  await waitForPreparation();
  assert.equal(calls, 0, 'configuring a provider does not consent to remote prefetch');
  const prepared = await metrics();
  phase = 'initial translation reuses preparation';
  await translate();
  assert.equal(calls, 1);
  assert.match(await reader.locator('.region').first().textContent(), /Translated:.*HELLO\s+WORLD/s);
  phase = 'warm translation';
  await translate();
  assert.equal(calls, 1, 'completed warm cache request must make zero new LLM requests');
  const warm = await metrics();
  assert.equal(warm.ocrCalls, 1);
  assert.equal(warm.translationCalls, 1);
  assert.equal(warm.ocrHits, prepared.ocrHits + 2, 'reading and warm replay must reuse local preparation');
  assert.equal(warm.translationHits, 1);

  phase = 'source correction';
  await reader.getByRole('button', {name: 'Read / correct text', exact: true}).click();
  await reader.locator('.panel textarea').first().fill('HELLO CORRECTED WORLD');
  await reader.getByRole('button', {name: 'Translate corrected source', exact: true}).click();
  await waitForTranslation();
  assert.equal(calls, 2, 'corrected source must invalidate translation');
  assert.equal(providerInputs.at(-1).regions[0].sourceText, 'HELLO CORRECTED WORLD');
  assert.equal((await metrics()).ocrCalls, 1, 'source correction must reuse OCR');

  phase = 'context invalidation';
  await configure('A synthetic friend is greeting another friend.');
  await enable();
  await translate();
  assert.equal(calls, 3, 'changed context must invalidate translation');
  assert.equal(providerInputs.at(-1).context, 'A synthetic friend is greeting another friend.');
  assert.equal(providerInputs.at(-1).regions[0].sourceText, 'HELLO CORRECTED WORLD');
  assert.equal((await metrics()).ocrCalls, 1, 'context change must reuse OCR');

  await reader.getByRole('button', {name: 'Show original', exact: true}).click();
  assert.equal(await reader.locator('.regions').isVisible(), false);
  assert.equal(await reader.locator('img').count(), 1);
  await reader.getByRole('button', {name: 'Show translation', exact: true}).click();
  assert.equal(await reader.locator('.regions').isVisible(), true);
  await mkdir('artifacts', {recursive: true});
  await reader.screenshot({path: 'artifacts/reader-smoke.png'});

  phase = 'forget and reconfigure';
  await options.getByRole('button', {name: 'Forget key and clear session', exact: true}).click();
  await options.getByRole('status').filter({hasText: 'Session cleared.'}).waitFor();
  const forgotten = await options.evaluate(() => chrome.runtime.sendMessage({type: 'MLT_UI_STATUS'}));
  assert.equal(forgotten.configured, false);
  assert.equal(calls, 3);
  await configure();
  await enable();
  await translate();
  assert.equal(calls, 4, 'forget and reconfigure must permit new real local OCR');
  const afterForget = await metrics();
  assert.equal(afterForget.ocrCalls, 1);
  assert.equal(afterForget.translationCalls, 1);
  phase = 'bounded visible then near preparation';
  await reader.reload();
  await reader.evaluate(() => {
    const rest = document.createElement('img'); rest.src = '/rest.png'; rest.width = 800; rest.height = 300; rest.style.cssText = 'position:absolute;top:5000px';
    const near = document.createElement('img'); near.src = '/near.png'; near.width = 800; near.height = 300; near.style.cssText = 'position:absolute;top:900px';
    document.body.append(rest, near);
  });
  await reader.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
  await worker.evaluate(() => { globalThis.__syntheticImageOrder = []; });
  await enable({prepareEnabled: true, prepareBudget: 2});
  await waitForPreparation(2);
  assert.deepEqual(await worker.evaluate(() => globalThis.__syntheticImageOrder), ['/page.png', '/near.png']);
  assert.equal(calls, 4, 'bounded local preparation does not send unseen text');
  const pauseResult = await options.evaluate(tabId => chrome.runtime.sendMessage({type: 'MLT_UI_PAUSE', tabId}), tabId);
  assert.equal(pauseResult.ok, true);
  await reader.evaluate(() => { const image = document.createElement('img'); image.src = '/lazy.png'; image.width = 800; image.height = 300; document.body.append(image); });
  await reader.waitForFunction(() => document.images.length === 4 && [...document.images].every(image => image.complete));
  const clearResult = await options.evaluate(() => chrome.runtime.sendMessage({type: 'MLT_UI_CLEAR'}));
  assert.equal(clearResult.ok, true);
  const pausedGrant = await worker.evaluate(async tabId => (await chrome.storage.session.get(`tab:${tabId}`))[`tab:${tabId}`], tabId);
  assert.equal(pausedGrant.paused, true);
  assert.equal(pausedGrant.prepareRemaining, 0);
  assert.deepEqual(await worker.evaluate(() => globalThis.__syntheticImageOrder), ['/page.png', '/near.png']);
  phase = 'actual pretrained inference on original panel without translation';
  await reader.reload();
  await reader.locator('img').evaluate(image => { image.src = '/panel.png'; });
  await reader.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0);
  const beforePanel = (await refreshProviderEvidence()).filter(entry => entry.kind === 'detection').length;
  const beforePanelRuns = (await refreshProviderEvidence()).filter(entry => entry.kind === 'detector-execution').length;
  const panelStarted = performance.now();
  await enable({prepareEnabled: true, prepareBudget: 1});
  await waitForPreparation();
  const panelPreparationMs = performance.now() - panelStarted;
  const panelExecutions = (await refreshProviderEvidence()).filter(entry => entry.kind === 'detector-execution').slice(beforePanelRuns);
  assert.ok(panelExecutions.length > 0 && panelExecutions.every(entry => Number.isFinite(entry.adapterDurationMs) && entry.adapterDurationMs > 0));
  const panelDetections = (await refreshProviderEvidence()).filter(entry => entry.kind === 'detection').slice(beforePanel);
  assert.ok(panelDetections.some(entry => entry.revision === PRETRAINED_DETECTOR_REVISION && entry.regions.length > 0), 'the independently drawn panel must yield real model regions');
  assert.equal(calls, 4, 'pretrained panel preparation must not call the provider');
  const offscreenDiagnostics = await refreshProviderEvidence();
  assert.deepEqual(offscreenDiagnostics.filter(entry => entry.kind === 'error'), [], 'Offscreen reported a synthetic-run failure');
  assert.deepEqual(errors, []);
  await writeFile('artifacts/browser-smoke.json', JSON.stringify({
    browser: context.browser()?.version(), calls, withoutProvider, prepared, warm, afterForget,
    modelDownload: {mockedTransport:true,realPinnedWeights:true,sha256:DETECTOR_MODEL.sha256,bytes:DETECTOR_MODEL.bytes,cancelledDownloadProgress,unknownDownloadProgress,cachedModelReloadMs,networkAttempts:offscreenDiagnostics.filter(entry => entry.kind === 'model-fetch').length},
    originalPanel: {source:'independently drawn synthetic panel',panelPreparationMs,executions:panelExecutions,timingScope:'adapterDurationMs includes image decode, preprocessing and model inference; preparation includes OCR. Single CI sample, not real manga performance.'},
    realLocalOCR: true, mockedProvider: true, mockedImageAcquisition: true, productionManifestUnchanged: true,
    verified: ['model download progress and cancellation', 'model retry and cached popup reload', 'real pretrained panel inference', 'local preparation without provider', 'local preparation with provider without LLM', 'visible-near priority and budget', 'pause and clear', 'warm completion', 'source correction', 'context invalidation', 'original toggle', 'forget and reconfigure'], errors, consoleErrors, network, routed,
  }, null, 2));
  console.log('Browser smoke passed: packaged OCR, mocked provider, warm cache, corrections, context, original toggle, forget/reconfigure.');
} catch (error) {
  const offscreenDiagnostics = await refreshProviderEvidence().catch(error => [{kind:'inspection-error',message:sanitize(error.message)}]);
  const backgroundErrors = worker ? await worker.evaluate(() => globalThis.__syntheticErrors || []).catch(() => []) : [];
  const diagnostics = {offscreenErrors: offscreenDiagnostics.filter(entry => entry.kind !== 'provider').map(entry => ({kind:entry.kind,message:sanitize(entry.message)})), backgroundErrors: backgroundErrors.map(sanitize),phase, error: sanitize(error?.stack || error), calls, errors, consoleErrors, network, routed};
  if (reader && !reader.isClosed()) {
    diagnostics.reader = await reader.evaluate(() => ({
      url: location.origin + location.pathname,
      images: [...document.images].map(image => ({complete: image.complete, width: image.naturalWidth, height: image.naturalHeight})),
      controls: [...document.querySelectorAll('[data-mlt-reader]')].map(host => ({
        status: host.shadowRoot?.querySelector('[role="status"]')?.textContent,
        buttons: [...(host.shadowRoot?.querySelectorAll('.controls button') || [])].map(button => ({text: button.textContent, disabled: button.disabled})),
      })),
    })).catch(failure => ({inspectionError: sanitize(failure.message)}));
  }
  if (options && !options.isClosed()) diagnostics.optionsStatus = sanitize(await options.locator('#status').textContent().catch(() => 'unavailable'));
  await mkdir('artifacts', {recursive: true});
  if (reader && !reader.isClosed()) await reader.screenshot({path: 'artifacts/reader-smoke-failure.png', timeout: 5000}).catch(() => {});
  await writeFile('artifacts/browser-smoke-failure.json', JSON.stringify(diagnostics, null, 2));
  console.error('Browser smoke failure diagnostics:', JSON.stringify(diagnostics, null, 2));
  throw error;
} finally {
  await context?.close();
  await rm(directory, {recursive: true, force: true});
}
