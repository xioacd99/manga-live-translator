import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright';
import {chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createNativeLifecycleExtension, health, isolatedBrowserEnvironment, NATIVE_HOST_NAME,
  redactedNativeEvidence, waitForServerExit, waitUntil} from './helpers/native-lifecycle.mjs';

// 真实 Chromium -> 生产 Native Messaging 宿主 -> 真实 Python HTTP；不下载或加载模型。
// 启用动作走生产消息路由；不把测试消息调用说成浏览器权限弹窗或自动翻译按钮 UI 验收。
const run = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'manga-native-lifecycle-'));
const python = process.env.MLT_NATIVE_PYTHON ? resolve(process.env.MLT_NATIVE_PYTHON) : 'python3';
const contexts = [], readies = [], secrets = ['native-lifecycle-synthetic-provider-key'];
const evidence = {realBrowser: false, realNativeMessaging: false, realPythonHTTP: false,
  realLocalOCR: false, realDetector: false, modelDownloadsRequested: false, modelCacheVerifiedEmpty: false, providerNetworkAllowed: false,
  syntheticReaderPage: true, permissionPromptInteraction: false, automaticTranslationButtonInteraction: false,
  productionEnableMessagePath: false, productionLastWindowListener: false,
  rawPortUsedForBrowserExit: false, productionManifestUnchanged: false, verified: []};
let phase = 'prepare isolated extension and host installation';
const verify = label => evidence.verified.push(label);
const safe = value => redactedNativeEvidence(value, secrets);

async function launch(extension, id, isolated, profile = isolated.profile) {
  const context = await chromium.launchPersistentContext(profile, {
    headless: true, channel: 'chromium', env: {...isolated.env, CHROME_USER_DATA_DIR: profile},
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}),
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  contexts.push(context);
  context.setDefaultTimeout(15000);
  await context.route(/^https?:\/\//, route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'http:' && url.hostname === '127.0.0.1') return route.continue();
    if (url.origin === 'https://reader.example.com' && route.request().isNavigationRequest()) {
      return route.fulfill({contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Native lifecycle fixture</title><p>无图片、无付费请求的生命周期验证</p>'});
    }
    return route.abort('blockedbyclient');
  });
  const worker = await waitUntil(async () => {
    for (const candidate of context.serviceWorkers()) {
      if (candidate.url() !== `chrome-extension://${id}/background.js`) continue;
      const ready = await candidate.evaluate(() => !!globalThis.chrome?.runtime?.id && !!globalThis.__nativeLifecycleProbe).catch(() => false);
      if (ready) return candidate;
    }
    return null;
  }, {timeout: 20000, description: '扩展 API 与测试观察器就绪'});
  evidence.realBrowser = true;
  evidence.browser = context.browser()?.version();
  return {context, worker};
}

async function configureManaged({context, worker}, id) {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  const send = message => options.evaluate(message => chrome.runtime.sendMessage(message), message);
  const configured = await send({type: 'MLT_UI_LOCAL_CONFIGURE', settings: {
    localOcr: {mode: 'managed', enabled: true, consent: true}, readingDirection: 'ltr',
  }});
  assert.equal(configured.ok, true, JSON.stringify(configured));
  // 假密钥仅让 auto:true 经过已配置检查；无图片和模型，不发送任何提供方请求。
  const remote = await send({type: 'MLT_UI_CONFIGURE', settings: {provider: 'deepseek', consent: true,
    apiKey: secrets[0], model: 'deepseek-flash', targetLanguage: 'Simplified Chinese'}});
  assert.equal(remote.ok, true, JSON.stringify(remote));
  const passive = await send({type: 'MLT_UI_MODEL_STATUS'});
  assert.equal(passive.ok, true);
  assert.equal(passive.model.phase, 'stopped');
  assert.equal(await worker.evaluate(() => globalThis.__nativeLifecycleProbe.connections.length), 0);
  const reader = await context.newPage(); await reader.goto('https://reader.example.com/native-lifecycle');
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({url: 'https://reader.example.com/*'}))[0]?.id);
  assert.equal(typeof tabId, 'number');
  return {send, options, reader, tabId};
}

async function assertHealthy(ready) {
  if (typeof ready.token === 'string' && !secrets.includes(ready.token)) secrets.push(ready.token);
  assert.match(ready.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(ready.token, /^[A-Za-z0-9_-]{32,128}$/);
  if (!readies.includes(ready)) readies.push(ready);
  const response = await health(ready);
  assert.equal(response.status, 200);
  assert.equal(response.body.service, 'manga-local-ocr');
  assert.equal(response.body.state, 'needs_models');
  assert.equal(response.body.ready, false);
  assert.equal(response.body.download.state, 'idle');
  assert.equal(response.body.download.bytesDownloaded, 0);
  assert.deepEqual(response.body.engine, {ocr: 'unloaded', detector: 'unloaded'});
  return response.body;
}

try {
  const {extension, id, productionManifest} = await createNativeLifecycleExtension(directory);
  const isolated = await isolatedBrowserEnvironment(join(directory, 'registered'));
  const cache = join(directory, 'models'), data = join(directory, 'host');
  const manifestDir = join(isolated.profile, 'NativeMessagingHosts');
  const command = ['-m', 'manga_local_ocr.install_native_host', '--extension-id', id,
    '--browser', 'chromium', '--manifest-dir', manifestDir, '--data-dir', data, '--cache-dir', cache];
  // 先验计划中的每个写入路径，禁止污染实际用户 HOME 或浏览器配置。
  const dryRun = await run(python, [...command, '--dry-run'], {env: isolated.env, timeout: 15000});
  const plan = JSON.parse(dryRun.stdout);
  assert.equal(plan.host, NATIVE_HOST_NAME);
  assert.ok(plan.files.length > 0 && plan.files.every(file => file.path.startsWith(directory + '/')));
  await run(python, command, {env: isolated.env, timeout: 15000});
  const manifestPath = join(manifestDir, NATIVE_HOST_NAME + '.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${id}/`]);
  assert.ok(manifest.path.startsWith(directory + '/'));
  assert.deepEqual(await readdir(cache).catch(error => { if (error.code === 'ENOENT') return []; throw error; }), []);
  // Playwright 的 Chromium/CfT 品牌及版本影响默认路径；Chrome 146 前 CfT 使用 Chrome 路径。
  // 仅为临时夹具兼容这些官方路径，不宣称已验证生产安装器的品牌探测。
  for (const brand of ['chromium', 'google-chrome', 'google-chrome-for-testing']) {
    const defaultManifests = join(isolated.env.XDG_CONFIG_HOME, brand, 'NativeMessagingHosts');
    await mkdir(defaultManifests, {recursive: true});
    await copyFile(manifestPath, join(defaultManifests, NATIVE_HOST_NAME + '.json'));
    await chmod(join(defaultManifests, NATIVE_HOST_NAME + '.json'), 0o600);
  }
  const secondProfile = join(directory, 'second-profile');
  await mkdir(join(secondProfile, 'NativeMessagingHosts'), {recursive: true});
  await copyFile(manifestPath, join(secondProfile, 'NativeMessagingHosts', NATIVE_HOST_NAME + '.json'));
  await chmod(join(secondProfile, 'NativeMessagingHosts', NATIVE_HOST_NAME + '.json'), 0o600);
  verify('host registration touches only fresh temporary HOME/profile; installation neither starts service nor downloads models');

  phase = 'missing host produces useful production error';
  const missing = await launch(extension, id, await isolatedBrowserEnvironment(join(directory, 'missing-host')));
  const missingUi = await configureManaged(missing, id);
  const absent = await missingUi.send({type: 'MLT_UI_ENABLE', tabId: missingUi.tabId, auto: true});
  assert.equal(absent.ok, false);
  assert.equal(absent.error.code, 'LOCAL_NATIVE_UNAVAILABLE');
  assert.match(absent.error.message, /安装|注册/);
  assert.equal(await missing.worker.evaluate(() => globalThis.__nativeLifecycleProbe.lastReady), null);
  evidence.missingHostError = absent.error;
  await missing.context.close();
  verify('missing host returns the production installation guidance, without model download or silent retry');

  phase = 'production automatic-enable message starts actual native host';
  const first = await launch(extension, id, isolated);
  const ui = await configureManaged(first, id);
  verify('saving managed configuration and passive model status do not launch a native process');
  const enabled = await ui.send({type: 'MLT_UI_ENABLE', tabId: ui.tabId, auto: true});
  assert.equal(enabled.ok, false);
  assert.equal(enabled.error.code, 'LOCAL_MODELS_REQUIRED', JSON.stringify(enabled));
  const readyA = await first.worker.evaluate(() => globalThis.__nativeLifecycleProbe.lastReady);
  assert.ok(readyA);
  evidence.serviceA = await assertHealthy(readyA);
  evidence.realNativeMessaging = true; evidence.realPythonHTTP = true;
  evidence.productionEnableMessagePath = true;
  const repeated = await ui.send({type: 'MLT_UI_ENABLE', tabId: ui.tabId, auto: true});
  assert.equal(repeated.error.code, 'LOCAL_MODELS_REQUIRED');
  assert.equal(await first.worker.evaluate(() => globalThis.__nativeLifecycleProbe.connections.length), 1);
  const stored = await first.worker.evaluate(() => chrome.storage.local.get(null));
  assert.equal(JSON.stringify(stored).includes(readyA.token), false);
  assert.equal(JSON.stringify(stored).includes(readyA.endpoint), false);
  verify('production auto-enable message starts real Python HTTP; repeated enable reuses one connection; credentials are not persisted');

  phase = 'second browser instance owns independent native service';
  const second = await launch(extension, id, isolated, secondProfile);
  const readyB = await second.worker.evaluate(host => globalThis.__nativeLifecycleProbe.rawStart(host), NATIVE_HOST_NAME);
  evidence.serviceB = await assertHealthy(readyB);
  assert.notEqual(readyA.endpoint, readyB.endpoint);
  assert.notEqual(readyA.token, readyB.token);
  assert.equal((await health(readyB, {token: readyA.token})).status, 401);
  verify('separate browser process receives independent port and token; cross-instance credential is rejected');

  phase = 'closing one normal window leaves the service alive';
  const extra = await first.worker.evaluate(() => chrome.windows.create({url: 'about:blank', type: 'normal'}));
  await first.worker.evaluate(windowId => chrome.windows.remove(windowId), extra.id);
  await assertHealthy(readyA);
  verify('closing one of multiple normal windows preserves the owned service');

  phase = 'closing last normal window stops only its production-owned service';
  // 保留 popup 窗口，排除“整个浏览器退出导致 EOF”冒充窗口监听器生效。
  const popup = await first.worker.evaluate(() => chrome.windows.create({url: 'about:blank', type: 'popup'}));
  const normalIds = await first.worker.evaluate(async () => (await chrome.windows.getAll({windowTypes: ['normal']})).map(window => window.id));
  assert.ok(normalIds.length > 0);
  for (const windowId of normalIds) await first.worker.evaluate(id => chrome.windows.remove(id), windowId);
  await waitForServerExit(readyA);
  const remaining = await first.worker.evaluate(() => chrome.windows.getAll({populate: false}));
  assert.ok(remaining.some(window => window.id === popup.id && window.type === 'popup'));
  assert.equal(remaining.filter(window => window.type === 'normal').length, 0);
  await assertHealthy(readyB);
  evidence.productionLastWindowListener = true;
  verify('production last-normal-window listener closes A while its browser stays alive and browser B remains healthy');

  phase = 'browser exit closes native pipe and actual HTTP server';
  await second.context.close();
  await waitForServerExit(readyB);
  evidence.rawPortUsedForBrowserExit = true;
  await first.context.close();
  verify('closing browser B terminates its raw native connection and actual HTTP listener');
  assert.deepEqual(await readdir(cache), []);
  evidence.modelCacheVerifiedEmpty = true;
  verify('all lifecycle checks leave the model cache empty; no OCR, detector, provider call or image upload occurred');
  assert.equal(await readFile('dist/manifest.json', 'utf8'), productionManifest);
  evidence.productionManifestUnchanged = true;
  await mkdir('artifacts', {recursive: true});
  await writeFile('artifacts/native-lifecycle.json', JSON.stringify(safe(evidence), null, 2));
  console.log('Native lifecycle passed: real Chromium + Native Messaging + Python HTTP; no model downloads, inference, paid provider calls, or full UI-quality claim.');
} catch (error) {
  const failure = safe({phase, error: error?.stack || String(error), evidence});
  await mkdir('artifacts', {recursive: true});
  await writeFile('artifacts/native-lifecycle-failure.json', JSON.stringify(failure, null, 2));
  console.error('Native lifecycle failure:', JSON.stringify(failure, null, 2));
  process.exitCode = 1;
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => {})));
  for (const ready of readies) await waitForServerExit(ready).catch(() => { process.exitCode = 1; });
  await rm(directory, {recursive: true, force: true});
}
