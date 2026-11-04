import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeRegionBackground, fitTranslation, isSafeRendering, TYPESETTING_REVISION} from '../../extension/content/typesetting.js';

function fixture(color = [240, 232, 219]) {
  const image = {width: 120, height: 100, data: new Uint8ClampedArray(120 * 100 * 4)};
  for (let i = 0; i < image.data.length; i += 4) image.data.set([...color, 255], i);
  const region = {box: {x: 35, y: 35, width: 40, height: 25}, bubbleBox: {x: 10, y: 10, width: 95, height: 80}};
  const pixel = (x, y, color) => image.data.set(color, (y * image.width + x) * 4);
  for (let y = 40; y < 53; y++) for (let x = 40; x < 70; x += 5) pixel(x, y, [20, 20, 20, 255]);
  return {image, region, pixel};
}
const measure = (text, size) => Array.from(text).reduce((n, ch) => n + (/[A-Za-z ]/.test(ch) ? .55 : 1) * size, 0);

test('纯色证据来自真实不透明像素，保持原始彩色背景并限制安全框', () => {
  const {image, region} = fixture(); const before = image.data.slice();
  const result = analyzeRegionBackground(image, region);
  assert.equal(result.mode, 'pure-color'); assert.deepEqual(result.color, [240, 232, 219]);
  assert.deepEqual(result.safeBox, {x: 33, y: 33, width: 44, height: 29});
  assert.equal(result.revision, TYPESETTING_REVISION); assert.ok(isSafeRendering(result, region));
  assert.deepEqual(image.data, before);
});

test('无气泡边界、越界、边缘接触、透明度和坏像素全部保留原图', () => {
  const {image, region, pixel} = fixture();
  assert.equal(analyzeRegionBackground(image, {...region, bubbleBox: undefined}).mode, 'side-panel');
  assert.equal(analyzeRegionBackground(image, {...region, bubbleBox: {...region.bubbleBox, x: -1}}).mode, 'side-panel');
  assert.equal(analyzeRegionBackground(image, {...region, box: {...region.box, x: 11}}).mode, 'side-panel');
  assert.equal(analyzeRegionBackground({...image, data: []}, region).mode, 'side-panel');
  pixel(50, 50, [240, 232, 219, 128]);
  assert.equal(analyzeRegionBackground(image, region).reason, 'transparent-background');
});

test('网点、渐变、线稿以及气泡矩形内的弯曲边框拒绝填色', () => {
  for (const pattern of ['tone', 'gradient', 'line', 'border']) {
    const {image, region, pixel} = fixture();
    if (pattern === 'tone') for (let y = 20; y < 80; y += 7) for (let x = 20; x < 95; x += 7) pixel(x, y, [120, 120, 120, 255]);
    if (pattern === 'gradient') for (let x = 20; x < 95; x++) pixel(x, 25, [x + 100, 190, 190, 255]);
    if (pattern === 'line') for (let x = 20; x < 95; x++) pixel(x, 70, [0, 0, 0, 255]);
    if (pattern === 'border') pixel(16, 16, [0, 0, 0, 255]);
    assert.equal(analyzeRegionBackground(image, region).mode, 'side-panel', pattern);
  }
});

test('使用各文字行证据，行间图案不被文本联合框吞掉，兼容 bbox', () => {
  const {image, region, pixel} = fixture();
  const lines = [{bbox: region.box}];
  assert.equal(analyzeRegionBackground(image, {...region, box: undefined, bbox: region.box, lines}).mode, 'pure-color');
  pixel(50, 58, [0, 0, 0, 255]);
  lines[0].bbox = {...region.box, height: 20};
  assert.equal(analyzeRegionBackground(image, {...region, lines}).mode, 'side-panel');
  assert.equal(analyzeRegionBackground(image, {...region, lines: [{bbox: {x: -1, y: 0, width: 5, height: 5}}]}).reason, 'invalid-line-evidence');
});

test('文字框内过于密集的异色及伪造或旧版排版元数据不予使用', () => {
  const {image, region, pixel} = fixture();
  const rendering = analyzeRegionBackground(image, region);
  assert.equal(isSafeRendering({...rendering, evidence: undefined}, region), false);
  assert.equal(isSafeRendering({...rendering, revision: 'old'}, region), false);
  assert.equal(isSafeRendering({...rendering, color: [999, 0, 0]}, region), false);
  assert.equal(isSafeRendering({...rendering, safeBox: {x: 0, y: 0, width: 2, height: 2}}, region), false);
  for (let y = 35; y < 60; y++) for (let x = 35; x < 75; x++) pixel(x, y, [0, 0, 0, 255]);
  assert.equal(analyzeRegionBackground(image, region).reason, 'dense-or-complex-source');
});

test('自适应字号按测量宽度折行且保留全部中文，避免行首闭标点和行尾开标点', () => {
  const text = '等等！你真的确定吗？我们（明天）一起去看海吧。';
  const result = fitTranslation(text, {width: 150, height: 150, measure});
  assert.equal(result.mode, 'overlay'); assert.ok(result.fontSize >= 12);
  assert.equal(result.lines.join(''), text);
  assert.ok(result.lines.every(line => measure(line, result.fontSize) <= 144));
  assert.ok(result.lines.every(line => !/^[！？，。；）]/u.test(line) && !/[（]$/u.test(line)));
  assert.ok(result.lines.length * result.fontSize * result.lineHeight <= 144);
});

test('短译文可放大，长译文不得小于最小字号或裁切，缺少浏览器测量时降级', () => {
  const short = fitTranslation('你好', {width: 180, height: 90, measure});
  assert.equal(short.fontSize, 28);
  assert.equal(fitTranslation('非常长的译文'.repeat(100), {width: 50, height: 40, measure}).mode, 'side-panel');
  assert.equal(fitTranslation('你好', {width: 5, height: 90, measure}).mode, 'side-panel');
  assert.equal(fitTranslation('你好', {width: 100, height: 90}).mode, 'side-panel');
  assert.equal(fitTranslation('你好', {width: 100, height: 90, measure: () => NaN}).mode, 'side-panel');
});

test('换行、英文长词和组合字符保留可读内容，无截断', () => {
  const text = 'Hello extraordinary world\n明天见！👨‍👩‍👧‍👦';
  const result = fitTranslation(text, {width: 210, height: 200, measure});
  assert.equal(result.mode, 'overlay');
  assert.equal(result.lines.join('').replaceAll(' ', ''), text.replaceAll('\n', '').replaceAll(' ', ''));
  assert.ok(result.lines.some(line => line.includes('👨‍👩‍👧‍👦')));
});

import {installReader} from '../../extension/content/reader.js';
function readerHarness(region, dimensions = {width: 400, height: 400}, fit = 'fill') {
  const elements = [], frames = [], listeners = new Map();
  const node = tag => {
    const el = {tag, children: [], style: {}, attributes: {}, handlers: {}, isConnected: true,
      append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
      setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(key, fn) { this.handlers[key] = fn; },
      remove() { this.isConnected = false; }, attachShadow() { return this.shadow = node('shadow'); }, closest() { return null; }};
    if (tag === 'canvas') el.getContext = () => ({font: '', measureText(text) { return {width: measure(text, parseFloat(this.font))}; }});
    elements.push(el); return el;
  };
  const rect = {left: 0, top: 0, right: dimensions.width, bottom: dimensions.height, ...dimensions};
  const image = Object.assign(node('img'), {complete: true, naturalWidth: 400, naturalHeight: 400, src: 'https://reader.test/image', getBoundingClientRect: () => rect});
  const doc = {images: [image], documentElement: node('html'), createElement: node, addEventListener() {}, removeEventListener() {}};
  const win = {location: {href: 'https://reader.test'}, innerWidth: 900, innerHeight: 900,
    ResizeObserver: class {observe() {} unobserve() {} disconnect() {}}, MutationObserver: class {observe() {} disconnect() {}},
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
    setInterval() { return 1; }, clearInterval() {}, addEventListener(event, callback) { listeners.set(event, callback); }, removeEventListener() {},
    getComputedStyle: () => ({transform: 'none', objectFit: fit, objectPosition: '50% 50%'})};
  const runtime = {onMessage: {addListener() {}, removeListener() {}}, sendMessage: async () => ({ok: true, result: {width: 400, height: 400, regions: Array.isArray(region) ? region : [region]}})};
  const reader = installReader({document: doc, window: win, runtime});
  const click = label => elements.findLast(el => el.textContent === label)?.handlers.click();
  reader.enable(); frames.shift()(); click('Translate');
  return {reader, elements, image, click, rect, win, flush: () => { const pending = frames.splice(0); pending.forEach(fn => fn()); }, event: event => listeners.get(event)?.()};
}
function renderRegion(translation = '你好') {
  const image = {width: 400, height: 400, data: new Uint8ClampedArray(400 * 400 * 4).fill(255)};
  const region = {id: 'g1', text: 'Hello', translation, box: {x: 140, y: 150, width: 90, height: 70}, bubbleBox: {x: 80, y: 70, width: 230, height: 250}};
  region.rendering = analyzeRegionBackground(image, region); return region;
}

test('阅读器仅在安全且字号可容纳时覆盖；原图切换保留源地址', async () => {
  const h = readerHarness(renderRegion()); await new Promise(resolve => setImmediate(resolve));
  const overlay = h.elements.find(el => el.className === 'region');
  assert.equal(overlay.style.background, 'rgb(255,255,255)');
  assert.equal(overlay.style.fontSize, '28px'); assert.equal(overlay.style.left, '138px');
  const original = h.image.src;
  h.click('Show original'); assert.equal(h.elements.find(el => el.className === 'regions').hidden, true);
  h.click('Show translation'); assert.equal(h.elements.find(el => el.className === 'regions').hidden, false);
  assert.equal(h.image.src, original); h.reader.destroy();
});

test('阅读器溢出时不擦除原字，显示完整译文卡片和非遮挡指示框', async () => {
  const region = renderRegion('很长的译文'.repeat(500)); const h = readerHarness(region);
  await new Promise(resolve => setImmediate(resolve));
  const card = h.elements.find(el => el.className === 'region');
  assert.equal(card.style.background, undefined); assert.equal(card.textContent, region.translation);
  assert.ok(h.elements.find(el => el.className === 'sidecar').children.includes(card));
  assert.ok(h.elements.find(el => el.className === 'source-indicator'));
  h.reader.destroy();
});

test('object-fit:cover 部分裁剪安全框时保留原图并转侧栏', async () => {
  const region = renderRegion(); region.box.x = 90; region.rendering.safeBox.x = 88;
  const h = readerHarness(region, {width: 120, height: 400}, 'cover');
  await new Promise(resolve => setImmediate(resolve));
  const card = h.elements.find(el => el.className === 'region');
  assert.equal(card.style.background, undefined);
  assert.ok(h.elements.find(el => el.className === 'sidecar').children.includes(card));
  h.reader.destroy();
});


test('来源标记与译文卡片使用一致的短序号，原始 ID 和完整译文不变', async () => {
  const a = {...renderRegion('第一句'), id: 'group_0123456789abcdef0123456789abcdef', rendering: undefined};
  const b = {...renderRegion('第二句'), id: 'group_fedcba9876543210fedcba9876543210', rendering: undefined};
  const h = readerHarness([a, b]); await new Promise(resolve => setImmediate(resolve));
  const cards = h.elements.filter(el => el.className === 'region');
  const marks = h.elements.filter(el => el.className === 'source-indicator');
  assert.deepEqual(cards.map(el => el.attributes['data-source-label']), ['1', '2']);
  assert.deepEqual(marks.map(el => el.attributes['data-source-label']), ['1', '2']);
  assert.deepEqual(cards.map(el => el.textContent), ['第一句', '第二句']);
  assert.equal(cards[0].attributes['data-source-id'], a.id); assert.ok(cards[0].title.includes(a.id));
  h.reader.destroy();
});

test('滚动与缩放重排保留侧栏阅读位置，原图切换恢复后不丢失卡片', async () => {
  const h = readerHarness({...renderRegion(), rendering: undefined}); await new Promise(resolve => setImmediate(resolve));
  h.flush();
  let sidecar = h.elements.findLast(el => el.className === 'sidecar'); sidecar.scrollTop = 75;
  const beforeScroll = sidecar;
  h.rect.top = -100; h.rect.bottom = 300; h.event('scroll'); h.flush();
  sidecar = h.elements.findLast(el => el.className === 'sidecar');
  assert.equal(sidecar, beforeScroll);
  assert.equal(sidecar.scrollTop, 75); assert.equal(sidecar.style.top, '108px');
  h.win.innerWidth = 450; h.event('resize'); h.flush();
  sidecar = h.elements.findLast(el => el.className === 'sidecar');
  assert.equal(sidecar.scrollTop, 75); assert.equal(sidecar.style.top, '408px');
  sidecar.offsetHeight = 150; h.rect.top = -430; h.rect.bottom = -30; h.event('scroll'); h.flush();
  assert.equal(h.elements.find(el => el.shadow).hidden, false);
  h.click('Show original'); assert.equal(h.elements.find(el => el.className === 'regions').hidden, true);
  h.rect.top = 0; h.rect.bottom = 400; h.click('Show translation');
  assert.equal(h.elements.find(el => el.className === 'regions').hidden, false);
  assert.equal(h.elements.findLast(el => el.className === 'sidecar').children.length, 1);
  h.reader.destroy();
});
