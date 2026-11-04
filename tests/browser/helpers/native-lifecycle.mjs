import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync} from 'node:crypto';
import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

export const NATIVE_HOST_NAME = 'com.manga_live_translator.local_ocr';

// 随机公钥只用于临时测试扩展的稳定身份，不持久化私钥或修改生产 manifest。
export function createExtensionIdentity() {
  const {publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  const der = publicKey.export({type: 'spki', format: 'der'});
  const id = [...createHash('sha256').update(der).digest().subarray(0, 16)]
    .flatMap(byte => [byte >> 4, byte & 15]).map(nibble => String.fromCharCode(97 + nibble)).join('');
  return {key: der.toString('base64'), id};
}

// 只观察真实 API；不替换连接、消息、HTTP 响应或窗口事件。
export const NATIVE_PROBE_SOURCE = `
(() => {
  const original = chrome.runtime.connectNative.bind(chrome.runtime);
  const probe = {connections: [], lastReady: null};
  globalThis.__nativeLifecycleProbe = probe;
  chrome.runtime.connectNative = (...args) => {
    const port = original(...args);
    const record = {host: args[0], disconnected: false, ready: null, error: null};
    probe.connections.push(record);
    port.onMessage.addListener(message => {
      if (message?.type === 'ready') { record.ready = message; probe.lastReady = message; }
    });
    port.onDisconnect.addListener(() => {
      record.disconnected = true;
      record.error = chrome.runtime.lastError?.message || null;
    });
    return port;
  };
  // 原始端口验证浏览器退出时的管道关闭，不把它当作 UI 按钮集成。
  probe.rawStart = host => new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative(host);
    probe.rawPort = port;
    const timeout = setTimeout(() => { port.disconnect(); reject(new Error('native_probe_timeout')); }, 15000);
    port.onMessage.addListener(message => {
      if (message?.type === 'ready') { clearTimeout(timeout); resolve(message); }
      else if (message?.type === 'error') { clearTimeout(timeout); reject(new Error(message.error || message.code || 'native_host_error')); }
    });
    port.onDisconnect.addListener(() => {
      clearTimeout(timeout);
      reject(new Error(chrome.runtime.lastError?.message || 'native_host_disconnected'));
    });
    port.postMessage({type: 'start'});
  });
})();
`;

export async function createNativeLifecycleExtension(directory, {dist = resolve('dist')} = {}) {
  const extension = join(directory, 'extension');
  await cp(dist, extension, {recursive: true});
  const productionManifest = await readFile(join(dist, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(productionManifest), identity = createExtensionIdentity();
  assert.ok([...manifest.permissions, ...(manifest.optional_permissions || [])].includes('nativeMessaging'), '生产 manifest 必须声明 nativeMessaging');
  manifest.permissions = [...new Set([...manifest.permissions, 'nativeMessaging'])];
  manifest.optional_permissions = (manifest.optional_permissions || []).filter(value => value !== 'nativeMessaging');
  manifest.key = identity.key;
  manifest.name += ' Native lifecycle integration';
  // 静态授权只存在临时副本，不验收浏览器权限弹窗。
  manifest.host_permissions = ['http://127.0.0.1/*', 'https://reader.example.com/*', 'https://api.deepseek.com/*'];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  const background = join(extension, 'background.js');
  await writeFile(background, NATIVE_PROBE_SOURCE + '\n' + await readFile(background, 'utf8'));
  // 浏览器网络拦截不一定涵盖工作线程；另加只拒绝外网的守卫，绝不伪造服务响应。
  const networkGuard = `const __nativeFixtureFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url || String(input), location.href);
  if (url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname !== '127.0.0.1')) throw new Error('native_fixture_external_request_blocked');
  return __nativeFixtureFetch(input, options);
};\n`;
  for (const file of ['background.js', 'offscreen.js']) {
    const path = join(extension, file);
    const source = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT' && file === 'offscreen.js') return null; throw error; });
    if (source !== null) await writeFile(path, networkGuard + source);
  }
  return {extension, id: identity.id, productionManifest};
}

export async function isolatedBrowserEnvironment(directory) {
  const home = join(directory, 'home'), profile = join(directory, 'profile');
  const config = join(home, '.config'), cache = join(home, '.cache'), data = join(home, '.local', 'share');
  await Promise.all([home, profile, config, cache, data].map(path => mkdir(path, {recursive: true})));
  return {home, profile, env: {...process.env, HOME: home, XDG_CONFIG_HOME: config, CHROME_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache, XDG_DATA_HOME: data, CHROME_USER_DATA_DIR: profile}};
}

export function redactedNativeEvidence(value, secrets = []) {
  if (typeof value === 'string') {
    let text = value;
    for (const secret of secrets) if (secret) text = text.replaceAll(secret, '[redacted]');
    return text.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]').slice(0, 6000);
  }
  if (Array.isArray(value)) return value.map(item => redactedNativeEvidence(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /token|apiKey|authorization/i.test(key) ? '[redacted]' : redactedNativeEvidence(item, secrets)]));
  return value;
}

export async function waitUntil(predicate, {timeout = 15000, description = 'condition'} = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('等待超时：' + description);
}

export async function health(ready, {token = ready.token} = {}) {
  const response = await fetch(ready.endpoint + '/health', {
    headers: {Authorization: 'Bearer ' + token}, signal: AbortSignal.timeout(1500),
    credentials: 'omit', redirect: 'error', cache: 'no-store',
  });
  return {status: response.status, body: await response.json()};
}

export async function waitForServerExit(ready) {
  await waitUntil(async () => {
    try { await health(ready); return false; }
    catch (error) {
      // 超时不是退出证据；必须观测到 TCP 拒绝连接。
      return error.cause?.code === 'ECONNREFUSED';
    }
  }, {description: '托管 HTTP 端口关闭'});
}
