import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createMockOcrHandler, MOCK_TOKEN, fixtureImage} from './helpers/mock-local-service.mjs';
import {groupTextLines} from '../../packages/core/grouping.js';
import {analyzeRegionBackground} from '../../extension/content/typesetting.js';
import {fixtureLines, fixtureBubbles} from './helpers/mock-local-service.mjs';

const host = '127.0.0.1:8787', origin = `chrome-extension://${'a'.repeat(32)}`;
function invoke(fixture, {path = '/status', method = 'GET', body, headers = {}} = {}) {
  const request = Readable.from(body ? [body] : []);
  Object.assign(request, {url: path, method, headers: {host, origin, authorization: `Bearer ${MOCK_TOKEN}`, ...headers}});
  return new Promise((resolve, reject) => fixture.handler(request, {
    writeHead(status, responseHeaders) { this.status = status; this.headers = responseHeaders; },
    end(text) { resolve({status: this.status, headers: this.headers, body: text ? JSON.parse(text) : null}); },
  }).catch(reject));
}

test('synthetic HTTP handler rejects wrong host, origin, and token', async () => {
  const fixture = createMockOcrHandler(); fixture.setBoundary({host, origin});
  assert.equal((await invoke(fixture, {headers: {authorization: ''}})).status, 401);
  assert.equal((await invoke(fixture, {headers: {origin: 'https://reader.example.com'}})).status, 403);
  assert.equal((await invoke(fixture, {headers: {host: 'localhost:8787'}})).status, 403);
  assert.equal((await invoke(fixture)).body.ready, false);
  assert.equal(fixture.snapshot().requests.length, 1);
  assert.equal(fixture.snapshot().realOCR, false);
});

test('synthetic model progress supports cancel, unknown total, and ready state', async () => {
  let now = 0;
  const fixture = createMockOcrHandler({now: () => now}); fixture.setBoundary({host, origin});
  assert.equal((await invoke(fixture, {path: '/models/download', method: 'POST'})).body.download.bytesTotal, 4096);
  now = 1000;
  assert.equal((await invoke(fixture)).body.download.bytesDownloaded, 1000);
  assert.equal((await invoke(fixture, {path: '/models/cancel', method: 'POST'})).body.download.state, 'cancelled');
  assert.equal((await invoke(fixture, {path: '/models/download', method: 'POST'})).body.download.bytesTotal, null);
  now = 5000;
  assert.equal((await invoke(fixture)).body.ready, true);
  const result = await invoke(fixture, {path: '/ocr', method: 'POST', body: fixtureImage.imageBytes, headers: {'content-type': 'image/bmp'}});
  assert.equal(result.status, 200); assert.equal(result.body.regions.length, 3);
  assert.equal(fixture.snapshot().requests.at(-1).bytes, fixtureImage.imageBytes.length);
});

test('synthetic boxes genuinely exercise production grouping, safe fill, and fallback', async () => {
  const grouped = await groupTextLines({regions: fixtureLines, detection: {regions: fixtureBubbles}, width: 800, height: 160});
  assert.equal(grouped.regions.length, 2);
  assert.equal(grouped.regions[0].sourceText, 'HELLO\nWORLD');
  assert.equal(grouped.regions[0].lineIds.length, 2);
  const data = new Uint8ClampedArray(800 * 160 * 4);
  for (let y = 0; y < 160; y++) for (let x = 0; x < 800; x++) {
    const at = 54 + (159 - y) * 2400 + x * 3, out = (y * 800 + x) * 4;
    data.set([fixtureImage.imageBytes[at + 2], fixtureImage.imageBytes[at + 1], fixtureImage.imageBytes[at], 255], out);
  }
  const image = {width: 800, height: 160, data};
  assert.equal(analyzeRegionBackground(image, grouped.regions[0]).mode, 'pure-color');
  assert.equal(analyzeRegionBackground(image, grouped.regions[1]).mode, 'side-panel');
});

test('production local adapter uses real authenticated loopback HTTP with synthetic results', async () => {
  const {startMockLocalService} = await import('./helpers/mock-local-service.mjs');
  const {createLocalOcrAdapter} = await import('../../extension/adapters/local-ocr.js');
  const service = await startMockLocalService(); service.setExtensionId('a'.repeat(32));
  const transport = (url, init) => fetch(url, {...init, headers: {...init.headers, Origin: origin}});
  const adapter = createLocalOcrAdapter({endpoint: service.endpoint, token: MOCK_TOKEN, fetchImpl: transport});
  try {
    assert.equal((await adapter.status()).ready, false);
    const bad = createLocalOcrAdapter({endpoint: service.endpoint, token: 'wrong-synthetic-token-00000000000000', fetchImpl: transport});
    await assert.rejects(bad.status(), /HTTP 401/);
    await adapter.download();
    assert.equal((await adapter.cancel()).download.state, 'cancelled');
    await adapter.download();
    const deadline = Date.now() + 6000;
    while (!(await adapter.status()).ready) { assert.ok(Date.now() < deadline, 'synthetic download deadline'); await new Promise(resolve => setTimeout(resolve, 100)); }
    const input = {imageBytes: fixtureImage.imageBytes, width: fixtureImage.width, height: fixtureImage.height};
    assert.equal((await adapter.recognize(input)).regions.length, 3);
    assert.equal((await adapter.detect(input)).regions.length, 1);
    const snapshot = service.snapshot();
    assert.ok(snapshot.requests.some(entry => entry.path === '/ocr' && entry.bytes === fixtureImage.imageBytes.length));
    assert.ok(snapshot.rejected.some(entry => entry.code === 401));
  } finally { await service.close(); }
});
