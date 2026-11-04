import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as security from '../../extension/security.js';

const source = (await readFile(new URL('../../extension/options.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function harness({ permission = async () => true, send = async () => ({ ok: true }) } = {}) {
  const elements = {}, calls = [];
  const el = id => elements[id] ??= { value: '', checked: false, disabled: false, textContent: '' };
  for (const [id, value] of Object.entries({ provider: 'deepseek', model: 'deepseek-flash', target: 'Simplified Chinese', 'local-endpoint': 'http://127.0.0.1:8787', 'reading-direction': 'ltr' })) el(id).value = value;
  const chrome = {
    permissions: { request: async args => { calls.push({ kind: 'permission', args }); return permission(args); } },
    runtime: { sendMessage: async message => { calls.push({ kind: 'message', message }); return send(message); } },
  };
  vm.runInNewContext(source, { document: { getElementById: el }, chrome, URL,
    LOCAL_OCR_ORIGIN_PERMISSION: security.LOCAL_OCR_ORIGIN_PERMISSION,
    validateTranslationSettings: value => security.validateTranslationSettings(structuredClone(value)),
    validateLocalOcrSettings: value => security.validateLocalOcrSettings(structuredClone(value)),
  });
  await tick();
  return { el, calls, submit: local => el(local ? 'local-settings-form' : 'settings-form').onsubmit({ preventDefault() {} }) };
}

test('选项页分开请求本机权限与图片同意，无需远程 API 密钥', async () => {
  const h = await harness();
  h.el('local-token').value = 'synthetic-local-service-token-123456789';
  h.el('local-consent').checked = true;
  await h.submit(true);
  const calls = h.calls.slice(1);
  assert.equal(calls[0].kind, 'permission');
  assert.deepEqual(Array.from(calls[0].args.origins), ['http://127.0.0.1/*']);
  assert.equal(calls[1].message.type, 'MLT_UI_LOCAL_CONFIGURE');
  assert.equal(calls[1].message.settings.apiKey, undefined);
  assert.equal(h.el('local-token').value, '');
  assert.match(h.el('local-status').textContent, /^本机 OCR 已配置/);
});

test('选项页先校验同意再请求权限，拒绝权限后不发送配置', async () => {
  const h = await harness({ permission: async () => false });
  h.el('key').value = 'synthetic-provider-key';
  await h.submit(false);
  assert.equal(h.calls.length, 1);
  h.el('consent').checked = true;
  await h.submit(false);
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].kind, 'permission');
  assert.equal(h.el('key').value, 'synthetic-provider-key');
  assert.match(h.el('status').textContent, /未授予连接权限/);
  assert.equal(h.el('remote-fields').disabled, false);
});

test('切换提供方会清空旧密钥与同意，新提供方使用自己的固定权限', async () => {
  const h = await harness();
  h.el('key').value = 'old-provider-key'; h.el('consent').checked = true;
  h.el('provider').value = 'openai'; h.el('provider').onchange();
  assert.equal(h.el('key').value, ''); assert.equal(h.el('consent').checked, false); assert.equal(h.el('model').value, '');
  h.el('key').value = 'new-provider-key'; h.el('model').value = 'test-model'; h.el('consent').checked = true;
  await h.submit(false);
  assert.deepEqual(Array.from(h.calls[1].args.origins), ['https://api.openai.com/*']);
  assert.equal(h.calls[2].message.settings.provider, 'openai');
  assert.equal(JSON.stringify(h.calls).includes('old-provider-key'), false);
  assert.equal(h.el('key').value, ''); assert.match(h.el('status').textContent, /^Configured/);
});

test('重复保存不会重复发送，清除会话清空两类密钥和同意', async () => {
  const gate = deferred();
  const h = await harness({ permission: () => gate.promise });
  h.el('key').value = 'synthetic-provider-key'; h.el('consent').checked = true;
  const pending = h.submit(false);
  await h.submit(false); await h.el('forget').onclick();
  assert.equal(h.calls.length, 2); assert.equal(h.el('forget').disabled, true);
  gate.resolve(true); await pending;
  h.el('local-token').value = 'synthetic-local-service-token-123456789'; h.el('local-consent').checked = true;
  h.el('context').value = 'private context'; h.el('glossary').value = 'private glossary';
  await h.el('forget').onclick();
  assert.equal(h.el('key').value, ''); assert.equal(h.el('local-token').value, '');
  assert.equal(h.el('consent').checked, false); assert.equal(h.el('local-consent').checked, false);
  assert.equal(h.el('context').value, ''); assert.equal(h.el('glossary').value, '');
  assert.match(h.el('status').textContent, /^Session cleared/);
});

test('选项页恢复非敏感配置，不从状态载入密钥或默认为再次同意', async () => {
  const h = await harness({ send: async () => ({ ok: true, configured: true, provider: 'openai', model: 'test-model', context: 'saved context', localConfigured: true, localOcr: { endpoint: 'http://127.0.0.1:9999', token: 'must-not-load' }, apiKey: 'must-not-load', readingDirection: 'rtl' }) });
  assert.equal(h.el('provider').value, 'openai'); assert.equal(h.el('model').value, 'test-model');
  assert.equal(h.el('local-endpoint').value, 'http://127.0.0.1:9999'); assert.equal(h.el('reading-direction').value, 'rtl');
  assert.equal(h.el('key').value, ''); assert.equal(h.el('local-token').value, '');
  assert.equal(h.el('consent').checked, false); assert.equal(h.el('local-consent').checked, false);
});


test('选择自动管理不要求令牌，保存才同步请求本机权限且不发送启动或下载', async () => {
  const h = await harness();
  h.el('local-mode').value='managed';h.el('local-mode').onchange();
  assert.equal(h.el('manual-local-fields').hidden,true);assert.equal(h.el('local-token').required,false);assert.equal(h.el('local-token').disabled,true);
  h.el('local-consent').checked=true;
  const pending=h.submit(true);
  assert.equal(h.calls[1].kind,'permission');assert.deepEqual([...h.calls[1].args.permissions],['nativeMessaging']);
  await pending;
  assert.deepEqual(h.calls[2].message.settings,{localOcr:{mode:'managed',enabled:true,consent:true},readingDirection:'ltr'});
  assert.equal(h.calls.some(call=>['MLT_UI_ENABLE','MLT_UI_MODEL_DOWNLOAD'].includes(call.message?.type)),false);
  assert.match(h.el('local-status').textContent,/自动管理/);
});

test('管理模式权限拒绝不保存，切换回手动清令牌和图片授权', async () => {
  const h=await harness({permission:async()=>false});
  h.el('local-mode').value='managed';h.el('local-mode').onchange();h.el('local-consent').checked=true;
  await h.submit(true);assert.equal(h.calls.length,2);assert.match(h.el('local-status').textContent,/未授予/);
  h.el('local-token').value='do-not-retain';h.el('local-mode').value='manual';h.el('local-mode').onchange();
  assert.equal(h.el('local-token').value,'');assert.equal(h.el('local-consent').checked,false);assert.equal(h.el('local-token').required,true);assert.equal(h.el('local-token').disabled,false);
});

test('恢复已保存管理模式不读取令牌、不请求新权限、不启动', async () => {
  const h=await harness({send:async()=>({ok:true,localConfigured:true,localOcr:{mode:'managed',token:'do-not-load'},readingDirection:'rtl'})});
  assert.equal(h.el('local-mode').value,'managed');assert.equal(h.el('manual-local-fields').hidden,true);
  assert.equal(h.el('local-token').value,'');assert.equal(h.el('local-consent').checked,false);assert.equal(h.calls.length,1);
  assert.match(h.el('local-status').textContent,/已记住自动管理/);
});
