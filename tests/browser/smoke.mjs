import {createEnglishBitmap} from '../fixtures/generated-english.js';
import {chromium} from 'playwright';
import {readFile, writeFile, mkdir, cp, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const directory = await mkdtemp(join(tmpdir(), 'manga-extension-smoke-'));
let context, reader, options, worker;
let phase = 'launch';
let calls = 0;
const errors = [], providerInputs = [], network = [], routed = [], consoleErrors = [];
const sanitize = value => String(value).replaceAll('synthetic-test-key-not-real', '[synthetic key redacted]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]').slice(0, 1000);
const record = (list, item) => { if (list.length < 100) list.push(item); };
const requestInfo = request => {
  const url = new URL(request.url());
  return {method: request.method(), origin: url.origin, path: url.pathname, serviceWorker: !!request.serviceWorker?.()};
};
try {
  const extension = join(directory, 'extension');
  await cp('dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  // Test-only fixed hosts avoid permission UI. Production permissions are unchanged.
  manifest.host_permissions = ['https://reader.example.com/*', 'https://api.openai.com/*'];
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
        await route.fulfill({contentType: 'image/bmp', body: createEnglishBitmap().imageBytes});
      } else {
        await route.fulfill({contentType: 'text/html', body: '<!doctype html><html><body><h1>Synthetic reader fixture</h1><img src="/page.png" width="800" height="300"></body></html>'});
      }
      return;
    }
    if (url.href === 'https://api.openai.com/v1/chat/completions') {
      calls++;
      const body = route.request().postDataJSON();
      assert.equal(body.store, false);
      assert.equal(body.messages[1].role, 'user');
      const input = JSON.parse(body.messages[1].content);
      assert.ok(input.regions.length > 0);
      providerInputs.push(input);
      await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{
        finish_reason: 'stop', message: {content: JSON.stringify({translations: input.regions.map(region => ({
          regionId: region.regionId, text: `Translated: ${region.sourceText}`,
        }))})},
      }]})});
      return;
    }
    errors.push(`Unexpected outbound origin: ${url.origin}`);
    await route.abort('blockedbyclient');
    } catch (error) {
      record(errors, `Mock route failure: ${sanitize(error.message)}`);
      await route.abort('failed').catch(() => {});
    }
  });
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
  await configure();
  phase = 'open synthetic reader';
  reader = await context.newPage();
  await reader.goto('https://reader.example.com/');
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({url: 'https://reader.example.com/*'});
    return tabs[0].id;
  });
  async function enable() {
    const response = await options.evaluate(tabId => chrome.runtime.sendMessage({
      type: 'MLT_UI_ENABLE', tabId, imageOrigins: [], auto: false,
    }), tabId);
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
    const displayed = await reader.locator('[role="status"]').textContent();
    assert.match(displayed, /^Translated\./, `Translation ended without success (${phase}); displayed status: ${sanitize(displayed)}`);
  }
  async function translate() {
    await reader.getByRole('button', {name: 'Translate', exact: true}).click();
    await waitForTranslation();
  }
  phase = 'initial enable and cold translation';
  await enable();
  await translate();
  assert.equal(calls, 1);
  assert.match(await reader.locator('.region').first().textContent(), /Translated:.*HELLO\s+WORLD/s);
  phase = 'warm translation';
  await translate();
  assert.equal(calls, 1, 'completed warm cache request must make zero new LLM requests');
  const warm = await metrics();
  assert.equal(warm.ocrCalls, 1);
  assert.equal(warm.translationCalls, 1);
  assert.equal(warm.ocrHits, 1);
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
  assert.deepEqual(errors, []);
  await writeFile('artifacts/browser-smoke.json', JSON.stringify({
    browser: context.browser()?.version(), calls, warm, afterForget,
    realLocalOCR: true, mockedProvider: true, productionManifestUnchanged: true,
    verified: ['warm completion', 'source correction', 'context invalidation', 'original toggle', 'forget and reconfigure'], errors, consoleErrors, network, routed,
  }, null, 2));
  console.log('Browser smoke passed: packaged OCR, mocked provider, warm cache, corrections, context, original toggle, forget/reconfigure.');
} catch (error) {
  const diagnostics = {phase, error: sanitize(error?.stack || error), calls, errors, consoleErrors, network, routed};
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
