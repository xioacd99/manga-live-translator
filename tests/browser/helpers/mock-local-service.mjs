import {createServer} from 'node:http';
import {createHash, timingSafeEqual} from 'node:crypto';
import {once} from 'node:events';
import {createBubbleBitmap} from '../../fixtures/generated-bubble.js';

// 这是明确标注的协议夹具，不加载模型，不能用于声称真实 OCR 或检测质量。
export const MOCK_TOKEN = 'synthetic-loopback-token-not-a-real-secret-0001';
export const MOCK_MODEL_REVISION = 'mock-paddle-v6-medium-fixture-1';
export const MOCK_DETECTOR_REVISION = 'mock-rtdetr-fixture-1';
export const fixtureImage = createBubbleBitmap();
export const fixtureLines = [
  {regionId: 'line_hello', bbox: {x: 50, y: 40, width: 290, height: 70}, sourceText: 'HELLO', readingOrder: 0, confidence: .99},
  {regionId: 'line_world', bbox: {x: 410, y: 40, width: 290, height: 70}, sourceText: 'WORLD', readingOrder: 1, confidence: .98},
  {regionId: 'line_caption', bbox: {x: 50, y: 147, width: 100, height: 10}, sourceText: 'OUTSIDE CAPTION', readingOrder: 2, confidence: .6},
];
export const fixtureBubbles = [{regionId: 'bubble_one', bbox: {x: 20, y: 15, width: 740, height: 130}, readingOrder: 0, confidence: .95}];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const imageDigest = digest(fixtureImage.imageBytes);

export function createMockOcrHandler({now = Date.now} = {}) {
  let host, origin, phase = 'idle', downloadStarted = 0, attempts = 0;
  const evidence = {kind: 'synthetic-http-ocr-fixture', realOCR: false, realDetector: false, requests: [], rejected: [], downloads: 0};
  function status() {
    const elapsed = Math.max(0, now() - downloadStarted);
    if (phase === 'downloading' && elapsed >= 3200) phase = 'ready';
    return {ready: phase === 'ready', detectorReady: phase === 'ready', modelRevision: MOCK_MODEL_REVISION, detectorRevision: MOCK_DETECTOR_REVISION,
      download: {state: phase, bytesDownloaded: phase === 'ready' ? 4096 : phase === 'downloading' ? Math.min(4095, Math.floor(elapsed)) : 0, bytesTotal: attempts === 1 ? 4096 : null}};
  }
  function json(response, code, body) {
    response.writeHead(code, {'content-type': 'application/json', 'cache-control': 'no-store', ...(origin ? {'access-control-allow-origin': origin, 'vary': 'Origin'} : {})});
    response.end(JSON.stringify(body));
  }
  function reject(request, response, code, reason) {
    evidence.rejected.push({method: request.method, path: request.url, code, reason});
    json(response, code, {error: reason});
  }
  const handler = async (request, response) => {
    try {
      if (request.headers.host !== host) return reject(request, response, 403, 'host');
      if ((request.headers.origin !== undefined && request.headers.origin !== origin) || !origin) return reject(request, response, 403, 'origin');
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-allow-private-network': 'true', 'vary': 'Origin'});
        response.end(); return;
      }
      const expected = Buffer.from(`Bearer ${MOCK_TOKEN}`), actual = Buffer.from(request.headers.authorization || '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reject(request, response, 401, 'authorization');
      const allowed = new Set(['GET /status', 'POST /models/download', 'POST /models/cancel', 'POST /ocr', 'POST /detect']);
      if (!allowed.has(`${request.method} ${request.url}`)) return reject(request, response, 404, 'route');
      if (request.headers.cookie || request.headers.referer) return reject(request, response, 400, 'ambient-credentials');
      const entry = {method: request.method, path: request.url, authenticated: true, originMatched: request.headers.origin === origin, originAccepted: true, originPresent: request.headers.origin !== undefined, cookieAbsent: true, refererAbsent: true};
      evidence.requests.push(entry);
      if (request.url === '/models/download') {
        attempts++; evidence.downloads++; downloadStarted = now(); phase = 'downloading';
      }
      if (request.url === '/models/cancel') phase = 'cancelled';
      if (['/status', '/models/download', '/models/cancel'].includes(request.url)) return json(response, 200, status());
      if (!status().ready) return json(response, 503, {error: 'models-not-ready'});
      if (request.headers['content-type'] !== 'image/bmp') return reject(request, response, 415, 'content-type');
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 4 * 1024 * 1024) return reject(request, response, 413, 'image-budget'); chunks.push(chunk); }
      const bytes = Buffer.concat(chunks);
      entry.bytes = size; entry.sha256 = digest(bytes);
      if (entry.sha256 !== imageDigest) return reject(request, response, 422, 'unexpected-fixture-image');
      json(response, 200, {width: fixtureImage.width, height: fixtureImage.height,
        ...(request.url === '/detect' ? {regions: fixtureBubbles, detectorRevision: MOCK_DETECTOR_REVISION} : {regions: fixtureLines, modelRevision: MOCK_MODEL_REVISION})});
    } catch (error) { json(response, 500, {error: 'fixture-internal-error'}); }
  };
  return {handler, setBoundary: value => { host = value.host; origin = value.origin; }, snapshot: () => structuredClone(evidence)};
}

export async function startMockLocalService() {
  const fixture = createMockOcrHandler();
  const server = createServer(fixture.handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  return {...fixture, endpoint,
    setExtensionId: id => fixture.setBoundary({host: new URL(endpoint).host, origin: `chrome-extension://${id}`}),
    close: () => new Promise((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }),
  };
}
