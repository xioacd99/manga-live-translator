import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startMockLocalService, MOCK_TOKEN, fixtureImage, MOCK_DETECTOR_REVISION} from './helpers/mock-local-service.mjs';
import {instrumentExtension} from './helpers/instrument-extension.mjs';

// 本脚本验证真实 Chromium 与真实环回 HTTP 传输，OCR、检测、下载进度、翻译结果均为模拟。
// 真实模型推理由 services/local-ocr/tests/smoke_real_models.py 单独验证，不能互相替代。
const directory = await mkdtemp(join(tmpdir(), 'manga-native-http-smoke-'));
let context, service, worker, reader, options, popup, phase = 'start synthetic loopback HTTP service';
const errors = [], network = [];
const providerKey = 'synthetic-provider-key-not-real';
const sanitize = text => String(text).replaceAll(MOCK_TOKEN, '[synthetic token redacted]').replaceAll(providerKey, '[synthetic key redacted]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]').slice(0, 4000);
const safe = value => typeof value === 'string' ? sanitize(value) : Array.isArray(value) ? value.map(safe) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safe(item)])) : value;
const evidence = {realBrowser: false, realLoopbackHTTP: false, realLocalOCR: false, realDetector: false, mockedModelDownload: true, mockedProvider: true, mockedImageAcquisition: true, permissionPromptInteraction: false, productionManifestUnchanged: true, verified: []};
const diagnostics = async () => worker ? worker.evaluate(() => globalThis.__fixtureDiagnostics || []) : [];
const providerInputs = async () => (await diagnostics()).filter(item => item.kind === 'provider').map(item => item.input);
const calls = async () => (await providerInputs()).length;
const verify = label => evidence.verified.push(label);

try {
  service = await startMockLocalService();
  const {extension, probe, productionManifest} = await instrumentExtension(directory, service.endpoint);
  phase = 'launch Chromium';
  const home = join(directory, 'home'); await mkdir(home);
  context = await chromium.launchPersistentContext(join(directory, 'profile'), {
    headless: true, channel: 'chromium', viewport: {width: 1280, height: 900}, env: {...process.env, HOME: home},
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}),
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension},${probe}`, `--load-extension=${extension},${probe}`],
  });
  context.setDefaultTimeout(20000);
  context.on('page', page => page.on('pageerror', error => errors.push(sanitize(error.message))));
  context.on('request', request => {
    if (/^https?:/.test(request.url()) && network.length < 200) {
      const url = new URL(request.url()); network.push({method: request.method(), origin: url.origin, path: url.pathname});
    }
  });
  await context.route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (url.origin === service.endpoint) return route.continue();
    if (url.origin === 'https://reader.example.com') {
      if (url.pathname.endsWith('.bmp')) return route.fulfill({contentType: 'image/bmp', body: fixtureImage.imageBytes});
      return route.fulfill({contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><title>Synthetic native OCR fixture</title></head><body><h1>合成浏览器集成夹具（不是真实 OCR）</h1><img src="/page.bmp" width="800" height="160"></body></html>'});
    }
    errors.push(`Unexpected outbound request blocked: ${url.origin}`);
    return route.abort('blockedbyclient');
  });
  let probeWorker;
  const deadline = Date.now() + 20000;
  while ((!worker || !probeWorker) && Date.now() < deadline) {
    for (const candidate of context.serviceWorkers()) {
      if(!candidate.url().startsWith('chrome-extension://')||!candidate.url().endsWith('/background.js'))continue;
      // worker 出现早于扩展 API 绑定就绪时，不把启动瞬间当作产品故障。
      const name = await candidate.evaluate(() => globalThis.chrome?.runtime?.getManifest?.()?.name).catch(()=>null);
      if(typeof name!=='string')continue;
      if (name.endsWith('Synthetic HTTP integration')) worker = candidate;
      if (name.endsWith('Missing loopback permission probe')) probeWorker = candidate;
    }
    if (!worker || !probeWorker) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(worker && probeWorker, 'Both extension APIs must become ready; observed workers: '+context.serviceWorkers().map(item=>item.url()).join(', '));
  const id = new URL(worker.url()).host, probeId = new URL(probeWorker.url()).host;
  service.setExtensionId(id);
  evidence.browser = context.browser()?.version(); evidence.realBrowser = true;

  phase = 'deny missing loopback permission before network';
  const probePage = await context.newPage(); await probePage.goto(`chrome-extension://${probeId}/options.html`);
  const missingPermission = await probePage.evaluate(({endpoint, token}) => chrome.runtime.sendMessage({type: 'MLT_UI_LOCAL_CONFIGURE', settings: {localOcr: {endpoint, token, enabled: true, consent: true}}}), {endpoint: service.endpoint, token: MOCK_TOKEN});
  assert.equal(missingPermission.ok, false);
  assert.equal(service.snapshot().requests.length, 0);
  assert.equal(await probeWorker.evaluate(() => chrome.permissions.contains({origins: ['http://127.0.0.1/*']})), false);
  await probePage.close(); verify('missing optional loopback permission blocks configuration before HTTP');

  phase = 'configure local OCR through actual options UI';
  options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
  async function configureLocal(token = MOCK_TOKEN) {
    await options.waitForFunction(() => !document.getElementById('save-local').disabled);
    await options.locator('#local-endpoint').fill(service.endpoint);
    await options.locator('#local-token').fill(token);
    await options.locator('#local-consent').check();
    await options.locator('#local-status').evaluate(element => { element.textContent = ''; });
    await options.locator('#save-local').click();
    await options.waitForFunction(() => document.getElementById('local-status').textContent.length > 0);
    assert.match(await options.locator('#local-status').textContent(), /^本机 OCR 已配置/);
    assert.equal(await options.locator('#local-token').inputValue(), '');
  }
  async function configureRemote(dialogueContext = '') {
    await options.waitForFunction(() => !document.getElementById('save-remote').disabled);
    await options.locator('#provider').selectOption('deepseek');
    await options.locator('#key').fill(providerKey);
    await options.locator('#model').fill('deepseek-flash');
    await options.locator('#context').fill(dialogueContext);
    await options.locator('#consent').check();
    await options.locator('#status').evaluate(element => { element.textContent = ''; });
    await options.locator('#save-remote').click();
    await options.waitForFunction(() => document.getElementById('status').textContent.length > 0);
    assert.match(await options.locator('#status').textContent(), /^Configured/);
    assert.equal(await options.locator('#key').inputValue(), '');
  }
  const send = message => options.evaluate(message => chrome.runtime.sendMessage(message), message);
  const metrics = async () => { const response = await send({type: 'MLT_UI_METRICS'}); assert.equal(response.ok, true); return response.metrics; };
  await configureLocal();
  assert.equal(await options.locator('#model').inputValue(), 'deepseek-flash');
  assert.equal(await worker.evaluate(() => chrome.permissions.contains({origins: ['http://127.0.0.1/*']})), true);
  assert.equal((await send({type: 'MLT_UI_STATUS'})).configured, false);
  verify('local OCR options save independently of remote translation');

  phase = 'reject incorrect bearer token over actual HTTP';
  await configureLocal('synthetic-wrong-loopback-token-000000');
  assert.equal((await send({type: 'MLT_UI_MODEL_STATUS'})).ok, false);
  assert.ok(service.snapshot().rejected.some(item => item.code === 401));
  await configureLocal(); evidence.realLoopbackHTTP = true; verify('incorrect local bearer token rejected over HTTP');

  phase = 'synthetic download progress and cancel';
  popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForFunction(() => !document.getElementById('modelDownload').disabled);
  await popup.locator('#modelDownload').click();
  await popup.waitForFunction(() => Number(document.getElementById('modelProgress').value) > 0 && document.getElementById('modelStatus').textContent.includes('%'));
  evidence.cancelledDownload = await popup.evaluate(() => ({text: document.getElementById('modelStatus').textContent, loaded: document.getElementById('modelProgress').value, total: document.getElementById('modelProgress').max}));
  assert.ok(evidence.cancelledDownload.loaded > 0 && evidence.cancelledDownload.loaded < evidence.cancelledDownload.total);
  await popup.locator('#modelCancel').click();
  await popup.waitForFunction(() => document.getElementById('modelStatus').textContent.includes('已取消'));
  await popup.locator('#modelDownload').click();
  await popup.waitForFunction(() => document.getElementById('modelStatus').textContent.includes('大小未知'));
  assert.equal(await popup.locator('#modelProgress').getAttribute('value'), null);
  await popup.waitForFunction(() => document.getElementById('modelStatus').textContent.includes('权重已校验就绪'));
  assert.equal(service.snapshot().downloads, 2);
  await popup.reload();
  await popup.waitForFunction(() => document.getElementById('modelStatus').textContent.includes('权重已校验就绪'));
  assert.equal(service.snapshot().downloads, 2);
  await popup.close(); verify('synthetic model progress, cancellation, unknown total, ready popup reload');

  phase = 'prepare without remote key or provider call';
  reader = await context.newPage(); await reader.goto('https://reader.example.com/');
  await reader.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth === 800);
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({url: 'https://reader.example.com/*'}))[0].id);
  async function enable(settings = {}) {
    await reader.bringToFront();
    const result = await send({type: 'MLT_UI_ENABLE', tabId, imageOrigins: [], auto: false, settings});
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  async function waitForPreparation(count = 1) {
    await reader.waitForFunction(count => [...document.querySelectorAll('[data-mlt-reader]')].filter(host => host.shadowRoot?.querySelector('[role="status"]')?.textContent === '本地准备完成，尚未翻译。').length === count, count);
  }
  async function waitForTranslation() {
    await reader.waitForFunction(() => {
      const root = document.querySelector('[data-mlt-reader]')?.shadowRoot;
      const status = root?.querySelector('[role="status"]');
      const button = [...(root?.querySelectorAll('button') || [])].find(button => button.textContent === 'Translate');
      return status?.textContent && !status.textContent.startsWith('Fetching') && button && !button.disabled;
    });
    assert.match(await reader.locator('[role="status"]').first().textContent(), /^Translated\./, `Failed phase: ${phase}`);
  }
  async function translate() { await reader.getByRole('button', {name: 'Translate', exact: true}).first().click(); await waitForTranslation(); }
  await enable({prepareEnabled: true, prepareBudget: 1}); await waitForPreparation();
  assert.equal(await calls(), 0);
  evidence.withoutProvider = await metrics(); assert.equal(evidence.withoutProvider.ocrCalls, 1);
  const preparedResult = (await diagnostics()).filter(item => item.kind === 'preparation-result').at(-1).response.result;
  assert.equal(preparedResult.grouping.inputLineCount, 3); assert.equal(preparedResult.grouping.groupCount, 2);
  assert.equal(preparedResult.detection.detectorRevision, MOCK_DETECTOR_REVISION);
  assert.equal(preparedResult.regions[0].text, 'HELLO\nWORLD'); assert.equal(preparedResult.regions[0].lineIds.length, 2);
  assert.equal(preparedResult.regions[1].text, 'OUTSIDE CAPTION');
  assert.equal(await reader.locator('.region').count(), 0); verify('local-only preparation, grouping and outside-caption preservation without provider');

  phase = 'configured preparation still avoids remote calls';
  await configureRemote(); await reader.reload();
  await enable({prepareEnabled: true, prepareBudget: 1}); await waitForPreparation();
  assert.equal(await calls(), 0); assert.equal((await metrics()).ocrCalls, 1);
  phase = 'translate prepared text, safe fill and conservative fallback';
  await translate(); assert.equal(await calls(), 1);
  const inputs = await providerInputs();
  assert.equal(inputs[0].regions.length, 2); assert.equal(inputs[0].regions[0].sourceText, 'HELLO\nWORLD');
  assert.equal(await reader.locator('.regions > .region').count(), 1);
  assert.equal(await reader.locator('.sidecar .region').count(), 1);
  assert.match(await reader.locator('.sidecar .region').getAttribute('title'), /OUTSIDE CAPTION/);
  assert.equal(await reader.locator('img').count(), 1); verify('DeepSeek mocked structured text, grouped safe fill, outside text side panel');

  phase = 'warm cache';
  await translate(); assert.equal(await calls(), 1);
  evidence.warm = await metrics(); assert.equal(evidence.warm.ocrCalls, 1); assert.equal(evidence.warm.translationCalls, 1); assert.equal(evidence.warm.translationHits, 1);
  verify('warm replay adds no OCR, detection, or provider call');

  phase = 'source correction reuses OCR';
  await reader.getByRole('button', {name: 'Read / correct text', exact: true}).click();
  assert.equal(await reader.locator('.panel textarea').count(), 2);
  await reader.locator('.panel textarea').first().fill('HELLO CORRECTED WORLD');
  await reader.getByRole('button', {name: 'Translate corrected source', exact: true}).click(); await waitForTranslation();
  assert.equal(await calls(), 2); assert.equal((await providerInputs()).at(-1).regions[0].sourceText, 'HELLO CORRECTED WORLD');
  assert.equal((await metrics()).ocrCalls, 1); verify('source correction invalidates only translation');

  phase = 'context invalidation preserves OCR and corrections';
  await configureRemote('A synthetic friend is greeting another friend.'); await enable(); await translate();
  assert.equal(await calls(), 3);
  assert.equal((await providerInputs()).at(-1).context, 'A synthetic friend is greeting another friend.');
  assert.equal((await providerInputs()).at(-1).regions[0].sourceText, 'HELLO CORRECTED WORLD');
  assert.equal((await metrics()).ocrCalls, 1); verify('context invalidation preserves OCR and source correction');

  phase = 'oversize translation falls back without painting original';
  await configureRemote('overflow-fixture'); await enable(); await translate();
  assert.equal(await calls(), 4); assert.equal(await reader.locator('.regions > .region').count(), 0);
  assert.equal(await reader.locator('.sidecar .region').count(), 2); verify('minimum-font overflow falls back to full side-panel text');
  await reader.getByRole('button', {name: 'Show original', exact: true}).click();
  assert.equal(await reader.locator('.regions').isVisible(), false);
  await reader.getByRole('button', {name: 'Show translation', exact: true}).click();
  assert.equal(await reader.locator('.regions').isVisible(), true);
  await mkdir('artifacts', {recursive: true}); await reader.screenshot({path: 'artifacts/reader-native-http-smoke.png'});
  verify('original pixels retained and overlay toggled');

  phase = 'clear cache pauses page and allows explicit new processing';
  const beforeClearOCR = service.snapshot().requests.filter(item => item.path === '/ocr').length;
  assert.equal((await send({type: 'MLT_UI_CLEAR'})).ok, true);
  const pausedGrant = await worker.evaluate(async tabId => (await chrome.storage.session.get(`tab:${tabId}`))[`tab:${tabId}`], tabId);
  assert.equal(pausedGrant.paused, true);
  assert.equal(await calls(), 4);
  await enable(); await translate(); assert.equal(await calls(), 5);
  assert.equal(service.snapshot().requests.filter(item => item.path === '/ocr').length, beforeClearOCR + 1);
  verify('clear cache pauses work and explicit re-enable performs fresh OCR and translation');

  phase = 'forget and reconfigure';
  await options.locator('#forget').click();
  await options.waitForFunction(() => document.getElementById('status').textContent.startsWith('Session cleared.'));
  const forgotten = await send({type: 'MLT_UI_STATUS'}); assert.equal(forgotten.configured, false); assert.equal(forgotten.localConfigured, false);
  await configureLocal(); await configureRemote(); await enable(); await translate();
  assert.equal(await calls(), 6); verify('forget removes both configurations; reconfigure remains usable');

  phase = 'visible and near preparation budget, pause and clear';
  await reader.reload();
  await reader.evaluate(() => {
    for (const [src, top] of [['rest', 5000], ['near', 1000]]) { const image = document.createElement('img'); image.src = `/${src}.bmp`; image.width = 800; image.height = 160; image.style.cssText = `position:absolute;top:${top}px`; document.body.append(image); }
  });
  await reader.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
  const beforeImages = (await diagnostics()).filter(item => item.kind === 'image').length;
  await enable({prepareEnabled: true, prepareBudget: 2}); await waitForPreparation(2);
  assert.deepEqual((await diagnostics()).filter(item => item.kind === 'image').slice(beforeImages).map(item => item.path), ['/page.bmp', '/near.bmp']);
  assert.equal(await calls(), 6);
  assert.equal((await send({type: 'MLT_UI_PAUSE', tabId})).ok, true);
  assert.equal((await send({type: 'MLT_UI_CLEAR'})).ok, true);
  assert.equal(await calls(), 6); verify('bounded visible-near preparation makes no hidden provider requests');

  assert.equal(await readFile('dist/manifest.json', 'utf8'), productionManifest);
  assert.deepEqual((await diagnostics()).filter(item => ['unexpected-fetch', 'loopback-error'].includes(item.kind)), []);
  assert.deepEqual(errors, []);
  evidence.http = service.snapshot(); evidence.providerCalls = await calls();
  evidence.preparationResults = (await diagnostics()).filter(item => item.kind === 'preparation-result').map(item => item.response);
  evidence.network = network;
  assert.ok(evidence.http.requests.some(item => item.path === '/ocr' && item.bytes === fixtureImage.imageBytes.length));
  assert.ok(evidence.http.requests.some(item => item.path === '/detect' && item.bytes === fixtureImage.imageBytes.length));
  assert.ok(evidence.http.requests.every(item => item.authenticated && item.originAccepted && item.cookieAbsent && item.refererAbsent));
  await writeFile('artifacts/browser-smoke.json', JSON.stringify(safe(evidence), null, 2));
  console.log('Chromium + actual loopback HTTP smoke passed. OCR, detection, download progress, image acquisition, and DeepSeek responses are synthetic; no real model quality claim.');
} catch (error) {
  const failure = {phase, error: sanitize(error?.stack || error), evidence, http: service?.snapshot(), diagnostics: await diagnostics().catch(() => []), errors, network};
  if (reader && !reader.isClosed()) failure.reader = await reader.evaluate(() => ({images: [...document.images].map(image => ({width: image.naturalWidth, height: image.naturalHeight, complete: image.complete})), statuses: [...document.querySelectorAll('[data-mlt-reader]')].map(host => host.shadowRoot?.querySelector('[role="status"]')?.textContent)})).catch(() => null);
  await mkdir('artifacts', {recursive: true});
  if (reader && !reader.isClosed()) await reader.screenshot({path: 'artifacts/reader-native-http-smoke-failure.png', timeout: 5000}).catch(() => {});
  await writeFile('artifacts/browser-smoke-failure.json', JSON.stringify(safe(failure), null, 2));
  console.error('Native HTTP smoke failure:', JSON.stringify(safe(failure), null, 2));
  throw error;
} finally {
  await context?.close(); await service?.close(); await rm(directory, {recursive: true, force: true});
}
