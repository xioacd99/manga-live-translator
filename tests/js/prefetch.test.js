import test from 'node:test';
import assert from 'node:assert/strict';
import {preparationSettings, imagePriority, selectPreparationJobs, MAX_IMAGES} from '../../extension/content/scheduler.js';
const local = preparationSettings({prepareEnabled: true});
const candidate = (id, priority = 0, extra = {}) => ({id, priority, ...extra});
test('提前准备默认关闭，远端开关与本地准备独立', () => {
  assert.deepEqual(selectPreparationJobs([candidate('a')], {settings: preparationSettings()}), []);
  const settings = preparationSettings({remotePrefetchEnabled: true, remotePrefetchBudget: 1});
  assert.deepEqual(selectPreparationJobs([candidate('a')], {settings}), [{id: 'a', kind: 'prefetch'}]);
  assert.deepEqual(selectPreparationJobs([candidate('a')], {settings: local}), [{id: 'a', kind: 'prepare'}]);
});
test('严格验证整数预算、开关及检测模式，禁止宽松转换', () => {
  for (const value of [null, NaN, Infinity, -1, 0, 21, 1.5, '8']) assert.throws(() => preparationSettings({prepareBudget: value}));
  for (const value of [null, NaN, -1, 21, 0.5, '1']) assert.throws(() => preparationSettings({remotePrefetchBudget: value}));
  assert.throws(() => preparationSettings({remotePrefetchEnabled: true}));
  assert.throws(() => preparationSettings({prepareEnabled: 'true'}));
  assert.throws(() => preparationSettings({detectorMode: 'unknown'}));
});
test('可见优先、邻近其次、其余最后；相同优先级保持发现顺序', () => {
  const settings = local;
  assert.deepEqual(selectPreparationJobs([candidate('rest', 2), candidate('near', 1), candidate('visible', 0)], {settings}).map(x => x.id), ['visible', 'near']);
  assert.deepEqual(selectPreparationJobs([candidate('one'), candidate('two'), candidate('three')], {settings}).map(x => x.id), ['one', 'two']);
  const viewport = {width: 800, height: 800};
  const rect = top => ({width: 400, height: 400, top, bottom: top + 400, left: 0, right: 400});
  assert.equal(imagePriority(rect(0), viewport), 0);
  assert.equal(imagePriority(rect(900), viewport), 1);
  assert.equal(imagePriority(rect(2400), viewport), 2);
});
test('两项并发、发现上限、独立预算、暂停和隐藏均受限', () => {
  const candidates = Array.from({length: 100}, (_, id) => candidate(id, id >= MAX_IMAGES ? 0 : 2));
  assert.equal(selectPreparationJobs(candidates, {settings: local}).length, 2);
  assert.equal(selectPreparationJobs(candidates, {settings: local, pending: 1}).length, 1);
  assert.equal(selectPreparationJobs(candidates, {settings: local, pending: 2}).length, 0);
  assert.equal(selectPreparationJobs(candidates, {settings: local, localUsed: 8}).length, 0);
  assert.ok(selectPreparationJobs(candidates, {settings: local}).every(x => x.id < MAX_IMAGES));
  for (const option of [{paused: true}, {hidden: true}]) assert.deepEqual(selectPreparationJobs(candidates, {settings: local, ...option}), []);
  const settings = preparationSettings({prepareEnabled: true, remotePrefetchEnabled: true, remotePrefetchBudget: 1});
  assert.deepEqual(selectPreparationJobs([candidate('done', 0, {prepared: true})], {settings, localUsed: 8}), [{id: 'done', kind: 'prefetch'}]);
  assert.deepEqual(selectPreparationJobs([candidate('done', 0, {prepared: true})], {settings, remoteUsed: 1}), []);
});
test('不重复已启动、已完成或失败任务，滚动后重算而不保留等待队列', () => {
  const candidates = [candidate('pending', 0, {pending: true}), candidate('translated', 0, {translated: true}), candidate('prepared', 0, {prepared: true}), candidate('failed', 0, {prepareAttempted: true}), candidate('new', 1)];
  assert.deepEqual(selectPreparationJobs(candidates, {settings: local}), [{id: 'new', kind: 'prepare'}]);
  assert.deepEqual(selectPreparationJobs([candidate('old', 2), candidate('new', 0)], {settings: local, pending: 1}), [{id: 'new', kind: 'prepare'}]);
});

import {installReader} from '../../extension/content/reader.js';
// 合成 DOM 与受控响应仅验证调度生命周期，不访问网站或付费模型。
function readerHarness() {
  const all = [], listeners = new Map(), frames = new Map(), sends = [], completions = [];
  let nextFrame = 0;
  function element(tag) {
    const el = {tag, children: [], style: {}, hidden: false, isConnected: true, handlers: {},
      setAttribute() {}, addEventListener(type, fn) { this.handlers[type] = fn; },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      remove() { this.isConnected = false; },
      attachShadow() { this.shadow = element('shadow'); return this.shadow; },
      closest() { return null; }};
    all.push(el); return el;
  }
  const image = Object.assign(element('img'), {complete: true, naturalWidth: 400, naturalHeight: 400, currentSrc: 'https://reader.test/1.png', getBoundingClientRect: () => ({left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400})});
  const document = {documentElement: element('html'), images: [image], createElement: element, addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); }};
  const window = {location: {href: 'https://reader.test/chapter1'}, innerWidth: 800, innerHeight: 800,
    ResizeObserver: class {observe() {} unobserve() {} disconnect() {}},
    MutationObserver: class {observe() {} disconnect() {}},
    addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); },
    requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame(id) { frames.delete(id); },
    setInterval() { return 1; }, clearInterval() {},
    getComputedStyle() { return {transform: 'none', objectFit: 'fill', objectPosition: '50% 50%'}; }};
  let settle;
  const runtime = {onMessage: {addListener(fn) { this.listener = fn; }, removeListener() {}}, sendMessage(message) {
    sends.push(message);
    if (['MLT_TRANSLATE', 'MLT_PREPARE'].includes(message.type)) return new Promise(resolve => { settle = resolve; completions.push(resolve); });
    return Promise.resolve({ok: true});
  }};
  const api = installReader({document, window, runtime});
  const flush = () => { const queue = [...frames.values()]; frames.clear(); queue.forEach(fn => fn()); };
  const result = {ok: true, result: {width: 400, height: 400, regions: [{id: 'r1', text: 'Hello', translation: '<script>literal text</script>', box: {x: 10, y: 10, width: 120, height: 100}}]}};
  return {api, image, window, document, runtime, sends, all, flush, result, listeners, completions,
    async finish() { settle(result); await new Promise(resolve => setImmediate(resolve)); },
    click(label) { const button = all.findLast(el => el.tag === 'button' && el.textContent === label); assert.ok(button, label); button.handlers.click(); }};
}


test('本地准备不会发送翻译；显示尚未翻译，懒加载新增图片进入剩余预算', async () => {
  const h = readerHarness(); h.api.enable(false, {prepareEnabled: true, prepareBudget: 2}); h.flush();
  assert.equal(h.sends[0].type, 'MLT_PREPARE');
  h.completions[0]({ok: true, prepared: true}); await new Promise(resolve => setImmediate(resolve)); h.flush();
  assert.ok(h.all.some(el => el.textContent === '本地准备完成，尚未翻译。'));
  assert.equal(h.all.some(el => el.className === 'region'), false);
  assert.equal(h.sends.filter(message => message.type === 'MLT_TRANSLATE').length, 0);
  h.document.images.push({...h.image, currentSrc: 'https://reader.test/lazy.png'});
  h.listeners.get('load')(); h.flush();
  assert.equal(h.sends.filter(message => message.type === 'MLT_PREPARE').length, 2);
  h.api.destroy();
});
test('准备中隐藏页面立即取消并忽略迟到完成，返回后不自动重启', async () => {
  const h = readerHarness(); h.api.enable(false, {prepareEnabled: true}); h.flush();
  h.document.hidden = true; h.listeners.get('visibilitychange')();
  assert.equal(h.sends.at(-1).type, 'MLT_CANCEL');
  h.completions[0]({ok: true, prepared: true}); await new Promise(resolve => setImmediate(resolve)); h.flush();
  assert.equal(h.all.some(el => el.textContent === '本地准备完成，尚未翻译。'), false);
  h.document.hidden = false; h.listeners.get('visibilitychange')(); h.flush(); h.click('Translate');
  assert.equal(h.sends.filter(message => ['MLT_PREPARE', 'MLT_TRANSLATE'].includes(message.type)).length, 1);
  h.api.enable(false, {prepareEnabled: true}); h.flush();
  assert.equal(h.sends.filter(message => message.type === 'MLT_PREPARE').length, 2);
  h.api.destroy();
});
test('远端预取携带明确目的，暂停后取消且手动按钮不能绕过暂停', async () => {
  const h = readerHarness(); h.api.enable(false, {remotePrefetchEnabled: true, remotePrefetchBudget: 1}); h.flush();
  assert.equal(h.sends[0].purpose, 'prefetch'); assert.equal(h.sends[0].prefetch, true);
  h.runtime.onMessage.listener({type: 'MLT_PAUSE'}, null, () => {});
  assert.equal(h.sends.at(-1).type, 'MLT_CANCEL');
  h.click('Translate');
  h.completions[0](h.result); await new Promise(resolve => setImmediate(resolve)); h.flush();
  assert.equal(h.sends.filter(message => message.type === 'MLT_TRANSLATE').length, 1);
  assert.equal(h.all.some(el => el.className === 'region'), false);
  h.api.destroy();
});
test('准备中源替换与页面导航均抑制旧结果，整图设置传播到任务', async () => {
  const h = readerHarness(); h.api.enable(false, {prepareEnabled: true, detectorMode: 'whole-image'}); h.flush();
  assert.equal(h.sends[0].detectorMode, 'whole-image');
  h.image.currentSrc = 'https://reader.test/replacement.png';
  h.completions[0]({ok: true, prepared: true}); await new Promise(resolve => setImmediate(resolve)); h.flush();
  assert.equal(h.all.some(el => el.textContent === '本地准备完成，尚未翻译。'), false);
  assert.equal(h.sends.filter(message => message.type === 'MLT_PREPARE').length, 2);
  h.window.location.href = 'https://reader.test/chapter2'; h.listeners.get('popstate')(); h.flush();
  h.completions[1]({ok: true, prepared: true}); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.all.some(el => el.textContent === '本地准备完成，尚未翻译。'), false);
  assert.equal(h.document.documentElement.children[0].isConnected, false);
  h.api.destroy();
});
test('清空通知移除已准备标记，重新启用才重新准备', async () => {
  const h = readerHarness(); h.api.enable(false, {prepareEnabled: true}); h.flush();
  h.completions[0]({ok: true, prepared: true}); await new Promise(resolve => setImmediate(resolve)); h.flush();
  h.runtime.onMessage.listener({type: 'MLT_PAUSE', reset: true}, null, () => {}); h.flush();
  assert.equal(h.sends.filter(message => message.type === 'MLT_PREPARE').length, 1);
  h.api.enable(false, {prepareEnabled: true}); h.flush();
  assert.equal(h.sends.filter(message => message.type === 'MLT_PREPARE').length, 2);
  h.api.destroy();
});
