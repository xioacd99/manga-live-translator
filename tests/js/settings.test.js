import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTranslationSettings, validateLocalOcrSettings } from '../../extension/security.js';

const remote = { apiKey: 'synthetic-provider-key', consent: true };
const local = { localOcr: { endpoint: 'http://127.0.0.1:8787', token: 'synthetic-local-service-token-123456789', enabled: true, consent: true }, readingDirection: 'ltr' };

test('独立保存本机 OCR 无需远程密钥，输出仅保留验证后的字段', () => {
  const result = validateLocalOcrSettings({ ...local, apiKey: 'do-not-copy', localOcr: { ...local.localOcr, evil: true } });
  assert.deepEqual(result, local); assert.equal(result.apiKey, undefined);
  assert.equal(validateLocalOcrSettings({ ...local, readingDirection: 'rtl' }).readingDirection, 'rtl');
  assert.equal(validateLocalOcrSettings({ ...local, localOcr: { ...local.localOcr, endpoint: 'http://127.0.0.1:8787/' } }).localOcr.endpoint, local.localOcr.endpoint);
});

test('本机 OCR 地址拒绝 DNS、IP 别名、远端、凭据、路径与缺失端口', () => {
  const endpoints = ['https://127.0.0.1:8787', 'http://localhost:8787', 'http://127.1:8787', 'http://2130706433:8787', 'http://0x7f000001:8787', 'http://127.0.0.2:8787', 'http://[::1]:8787', 'http://example.com:8787', 'http://127.0.0.1', 'http://127.0.0.1:0', 'http://127.0.0.1:80', 'http://127.0.0.1:1023', 'http://127.0.0.1:65536', 'http://127.0.0.1:08787', 'http://u:p@127.0.0.1:8787', 'http://127.0.0.1:8787/ocr', 'http://127.0.0.1:8787?token=a', 'http://127.0.0.1:8787#fragment', ' http://127.0.0.1:8787'];
  for (const endpoint of endpoints) assert.throws(() => validateLocalOcrSettings({ ...local, localOcr: { ...local.localOcr, endpoint } }));
});

test('本机图片同意、开关、令牌与阅读方向均严格验证', () => {
  for (const patch of [{ consent: false }, { consent: 'true' }, { enabled: false }, { enabled: 'true' }, { token: 'short' }, { token: 'x'.repeat(129) }, { token: 'x'.repeat(32) + '!' }, { token: `${'x'.repeat(32)}\n` }, { token: `${'x'.repeat(32)} 中` }]) assert.throws(() => validateLocalOcrSettings({ ...local, localOcr: { ...local.localOcr, ...patch } }));
  for (const readingDirection of ['auto', 'RTL', '', null]) assert.throws(() => validateLocalOcrSettings({ ...local, readingDirection }));
  for (const value of [null, [], {}, { localOcr: null }]) assert.throws(() => validateLocalOcrSettings(value));
});

test('远程翻译默认为 DeepSeek，可显式使用固定 OpenAI 地址', () => {
  const result = validateTranslationSettings(remote);
  assert.equal(result.provider, 'deepseek'); assert.equal(result.model, 'deepseek-flash');
  assert.equal(result.endpoint, 'https://api.deepseek.com/chat/completions');
  assert.equal(validateTranslationSettings({ ...remote, provider: 'openai', model: 'test-model' }).endpoint, 'https://api.openai.com/v1/chat/completions');
  assert.equal(validateTranslationSettings({ ...remote, localOcr: local.localOcr }).localOcr, undefined);
});

test('远程同意不能代替本机同意，提供方和文本预算不能绕过', () => {
  for (const patch of [{ consent: false }, { consent: 'true' }, { provider: '__proto__' }, { provider: 'constructor' }, { provider: 'custom' }, { endpoint: 'https://evil.invalid' }, { apiKey: 'short' }, { apiKey: 'x'.repeat(513) }, { apiKey: 'header\ninjection' }, { model: '' }, { model: 'contains space' }, { targetLanguage: ' ' }, { targetLanguage: 'x'.repeat(81) }, { context: 'x'.repeat(4001) }, { glossary: 'x'.repeat(4001) }, { context: {} }]) assert.throws(() => validateTranslationSettings({ ...remote, ...patch }));
  assert.throws(() => validateTranslationSettings({ ...local, apiKey: remote.apiKey }));
});
