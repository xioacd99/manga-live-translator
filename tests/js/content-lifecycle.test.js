import test from 'node:test';
import assert from 'node:assert/strict';
import {installReader} from '../../extension/content/reader.js';

// A small synthetic DOM tests lifecycle contracts without fetching any reading content.
function harness() {
  const all = [], listeners = new Map(), frames = new Map(), sends = [];
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
  const document = {documentElement: element('html'), images: [image], createElement: element, addEventListener() {}, removeEventListener() {}};
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
    if (message.type === 'MLT_TRANSLATE') return new Promise(resolve => { settle = resolve; });
    return Promise.resolve({ok: true});
  }};
  const api = installReader({document, window, runtime});
  const flush = () => { const queue = [...frames.values()]; frames.clear(); queue.forEach(fn => fn()); };
  const result = {ok: true, result: {width: 400, height: 400, regions: [{id: 'r1', text: 'Hello', translation: '<script>literal text</script>', box: {x: 10, y: 10, width: 120, height: 100}}]}};
  return {api, image, window, document, runtime, sends, all, flush, result,
    async finish() { settle(result); await new Promise(resolve => setImmediate(resolve)); },
    click(label) { const button = all.findLast(el => el.tag === 'button' && el.textContent === label); assert.ok(button, label); button.handlers.click(); }};
}

test('no discovery or requests before enable; selection is explicit; disable cancels', () => {
  const h = harness();
  assert.equal(h.sends.length, 0);
  assert.equal(h.document.documentElement.children.length, 0);
  h.api.enable(false); h.flush();
  assert.equal(h.sends.length, 0);
  h.click('Translate'); assert.equal(h.sends[0].type, 'MLT_TRANSLATE');
  h.api.disable(); assert.equal(h.sends[1].type, 'MLT_CANCEL');
  assert.equal(h.document.documentElement.children[0].isConnected, false);
  h.api.destroy();
});

test('source replacement suppresses pending result, and original image is preserved', async () => {
  const h = harness(); h.api.enable(); h.flush(); h.click('Translate');
  h.image.currentSrc = 'https://reader.test/2.png';
  await h.finish();
  assert.equal(h.all.some(el => el.className === 'region'), false);
  assert.equal(h.image.currentSrc, 'https://reader.test/2.png');
  h.api.destroy();
});

test('rendered provider content is literal text and toggle is reversible', async () => {
  const h = harness(); h.api.enable(); h.flush(); h.click('Translate'); await h.finish();
  const region = h.all.find(el => el.className === 'region');
  assert.equal(region.textContent, '<script>literal text</script>');
  assert.equal(region.innerHTML, undefined);
  const container = h.all.find(el => el.className === 'regions');
  h.click('Show original'); assert.equal(container.hidden, true);
  h.click('Show translation'); assert.equal(container.hidden, false);
  h.api.destroy();
});

test('SPA navigation disables the session and ignores late results', async () => {
  const h = harness(); h.api.enable(true); h.flush();
  assert.equal(h.sends[0].type, 'MLT_TRANSLATE');
  h.window.location.href = 'https://reader.test/chapter2';
  await h.finish(); h.flush();
  assert.equal(h.all.some(el => el.className === 'region'), false);
  assert.equal(h.document.documentElement.children[0].isConnected, false);
  h.api.destroy();
});


test('successive corrections are cumulative, retries preserve them, and source changes reset them', async () => {
  const h = harness();
  h.result.result.regions.push({id: 'r2', text: 'Friend', translation: 'Friend translated', box: {x: 10, y: 150, width: 120, height: 100}});
  h.api.enable(); h.flush(); h.click('Translate'); await h.finish();
  h.click('Read / correct text');
  let inputs = h.all.filter(el => el.tag === 'textarea').slice(-2);
  inputs[0].value = 'Hello corrected'; inputs[0].handlers.input();
  h.click('Translate corrected source');
  assert.deepEqual(h.sends.at(-1).corrections, {r1: 'Hello corrected'});
  await h.finish();
  h.click('Read / correct text');
  inputs = h.all.filter(el => el.tag === 'textarea').slice(-2);
  inputs[1].value = 'Friend corrected'; inputs[1].handlers.input();
  h.click('Translate corrected source');
  assert.deepEqual(h.sends.at(-1).corrections, {r1: 'Hello corrected', r2: 'Friend corrected'});
  await h.finish();
  h.click('Translate');
  assert.deepEqual(h.sends.at(-1).corrections, {r1: 'Hello corrected', r2: 'Friend corrected'});
  await h.finish();
  const previousVersion = h.sends.at(-1).sourceVersion;
  h.image.currentSrc = 'https://reader.test/replaced.png';
  h.api.enable(); h.flush(); h.click('Translate');
  assert.equal(h.sends.at(-1).corrections, undefined);
  assert.notEqual(h.sends.at(-1).sourceVersion, previousVersion);
  h.api.destroy();
});


test('同账号设置失效取消旧任务并清除输出，重新启用保留同图校正和源身份', async () => {
  const h = harness(); h.api.enable(); h.flush(); h.click('Translate'); await h.finish();
  h.click('Read / correct text');
  const input = h.all.findLast(el => el.tag === 'textarea');
  input.value = 'Persist this correction'; input.handlers.input(); h.click('Translate corrected source'); await h.finish();
  const previousVersion = h.sends.at(-1).sourceVersion;
  h.click('Translate'); const pending = h.sends.at(-1);
  let reply;
  h.runtime.onMessage.listener({type: 'MLT_PAUSE', reset: false, invalidate: true}, {}, value => { reply = value; });
  assert.deepEqual(reply, {ok: true});
  assert.equal(h.sends.at(-1).type, 'MLT_CANCEL'); assert.equal(h.sends.at(-1).requestId, pending.requestId);
  const container = h.all.find(el => el.className === 'regions'), panel = h.all.find(el => el.className === 'panel');
  assert.deepEqual(container.children, []); assert.equal(panel.hidden, true); assert.deepEqual(panel.children, []);
  assert.equal(h.all.find(el => el.textContent === 'Read / correct text').hidden, true);
  await h.finish(); assert.deepEqual(container.children, []);
  const before = h.sends.length; h.click('Translate'); assert.equal(h.sends.length, before);
  h.api.enable(true); h.flush();
  assert.equal(h.sends.at(-1).type, 'MLT_TRANSLATE');
  assert.equal(h.sends.at(-1).sourceVersion, previousVersion);
  assert.deepEqual(h.sends.at(-1).corrections, {r1: 'Persist this correction'});
  await h.finish(); h.api.destroy();
});

test('账号或本地设置完整重置优先于失效，清除校正并更新源身份', async () => {
  const h = harness(); h.api.enable(); h.flush(); h.click('Translate'); await h.finish();
  h.click('Read / correct text');
  const input = h.all.findLast(el => el.tag === 'textarea');
  input.value = 'Old account correction'; input.handlers.input(); h.click('Translate corrected source'); await h.finish();
  const previousVersion = h.sends.at(-1).sourceVersion;
  h.runtime.onMessage.listener({type: 'MLT_PAUSE', reset: true, invalidate: true}, {}, () => {});
  assert.deepEqual(h.all.find(el => el.className === 'regions').children, []);
  h.api.enable(true); h.flush();
  assert.equal(h.sends.at(-1).type, 'MLT_TRANSLATE'); assert.equal(h.sends.at(-1).corrections, undefined);
  assert.notEqual(h.sends.at(-1).sourceVersion, previousVersion);
  await h.finish(); h.api.destroy();
});
