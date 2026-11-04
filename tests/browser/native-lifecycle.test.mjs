import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash, createPublicKey} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createExtensionIdentity, createNativeLifecycleExtension, isolatedBrowserEnvironment,
  NATIVE_PROBE_SOURCE, redactedNativeEvidence} from './helpers/native-lifecycle.mjs';

// 这些测试只验证夹具自身，不能作为 Chromium 或 NativeMessaging 通过的证据。
test('native fixture identity matches the manifest public key', () => {
  const {id, key} = createExtensionIdentity();
  assert.match(id, /^[a-p]{32}$/);
  const der = createPublicKey({key: Buffer.from(key, 'base64'), format: 'der', type: 'spki'}).export({format: 'der', type: 'spki'});
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
  assert.equal(id, [...hex].map(value => String.fromCharCode(97 + parseInt(value, 16))).join(''));
});

test('native fixture only changes temporary extension and browser directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-fixture-unit-'));
  try {
    const dist = join(directory, 'dist'); await mkdir(dist);
    const manifest = JSON.stringify({name: 'Fixture', permissions: ['nativeMessaging']});
    await writeFile(join(dist, 'manifest.json'), manifest);
    await writeFile(join(dist, 'background.js'), 'globalThis.productionLoaded = true;');
    const result = await createNativeLifecycleExtension(join(directory, 'copy'), {dist});
    assert.equal(await readFile(join(dist, 'manifest.json'), 'utf8'), manifest);
    assert.equal(await readFile(join(dist, 'background.js'), 'utf8'), 'globalThis.productionLoaded = true;');
    assert.equal(result.productionManifest, manifest);
    const copy = JSON.parse(await readFile(join(result.extension, 'manifest.json'), 'utf8'));
    assert.equal(copy.permissions.includes('nativeMessaging'), true);
    assert.deepEqual(copy.host_permissions, ['http://127.0.0.1/*', 'https://reader.example.com/*', 'https://api.deepseek.com/*']);
    const browser = await isolatedBrowserEnvironment(join(directory, 'browser'));
    for (const key of ['HOME', 'XDG_CONFIG_HOME', 'CHROME_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'CHROME_USER_DATA_DIR']) {
      assert.ok(browser.env[key].startsWith(directory + '/'), key);
    }
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('native observation preserves the real port and records readiness and disconnect', () => {
  const messageListeners = [], disconnectListeners = [], calls = [];
  const port = {onMessage: {addListener: fn => messageListeners.push(fn)}, onDisconnect: {addListener: fn => disconnectListeners.push(fn)}};
  const chrome = {runtime: {connectNative: (...args) => { calls.push(args); return port; }}};
  const context = vm.createContext({chrome, setTimeout, clearTimeout});
  vm.runInContext(NATIVE_PROBE_SOURCE, context);
  assert.equal(chrome.runtime.connectNative('com.example.test'), port);
  assert.deepEqual(calls, [['com.example.test']]);
  const ready = {type: 'ready', endpoint: 'http://127.0.0.1:12345', token: 'private-runtime-value'};
  messageListeners[0](ready);
  assert.equal(context.__nativeLifecycleProbe.lastReady, ready);
  chrome.runtime.lastError = {message: 'test disconnect'};
  disconnectListeners[0]();
  assert.equal(context.__nativeLifecycleProbe.connections[0].disconnected, true);
  assert.equal(context.__nativeLifecycleProbe.connections[0].error, 'test disconnect');
});

test('native lifecycle evidence never stores credentials in nested errors or readiness', () => {
  const secret = 'temporary-loopback-secret-123456789';
  const output = redactedNativeEvidence({token: secret, ready: {token: secret}, error: 'failed with ' + secret,
    request: {Authorization: 'Bearer ' + secret}, events: [{apiKey: 'fake-provider-value'}, 'Bearer other-value']}, [secret]);
  assert.equal(JSON.stringify(output).includes(secret), false);
  assert.equal(JSON.stringify(output).includes('fake-provider-value'), false);
  assert.equal(JSON.stringify(output).includes('other-value'), false);
  assert.equal(output.ready.token, '[redacted]');
});
