import test from 'node:test';
import assert from 'node:assert/strict';
import { groupTextLines, orderByGeometry, normalizeGroupingConfig, GROUPING_REVISION, READING_ORDER_REVISION, createPipeline, validateRegions, validateOCRResult } from '../../packages/core/index.js';
const line = (regionId, x, y, width = 30, height = 10, extra = {}) => ({ regionId, bbox: { x, y, width, height }, sourceText: regionId, readingOrder: Number(regionId.match(/\d+/)?.[0] ?? 0), ...extra });
const bubble = (regionId, x, y, width, height, readingOrder = 0) => ({ regionId, bbox: { x, y, width, height }, readingOrder, confidence: 0.9 });
const detection = regions => ({ regions, detectorRevision: 'fixture-bubbles', experimental: true });
const dimensions = { width: 400, height: 400 };
const group = (regions, bubbles = [], config = {}) => groupTextLines({ regions, detection: detection(bubbles), ...dimensions, ...config });

test('候选气泡聚合整图行，框外字幕保留独立 ID 和原始坐标', async () => {
  const lines = [line('l1', 20, 20, 30, 10, { confidence: 0.95 }), line('l2', 20, 40, 40, 10, { confidence: 0.8 }), line('l3', 200, 20)];
  const result = await group(lines, [bubble('b1', 10, 10, 100, 70)]);
  assert.equal(result.regions.length, 2);
  const dialogue = result.regions.find(region => region.bubbleId);
  assert.equal(dialogue.sourceText, 'l1\nl2'); assert.deepEqual(dialogue.lineIds, ['l1', 'l2']); assert.equal(dialogue.confidence, 0.8);
  assert.deepEqual(dialogue.bbox, { x: 20, y: 20, width: 40, height: 30 });
  assert.deepEqual(dialogue.bubbleBox, { x: 10, y: 10, width: 100, height: 70 });
  assert.deepEqual(dialogue.lines.map(line => line.bbox), lines.slice(0, 2).map(line => line.bbox));
  const caption = result.regions.find(region => !region.bubbleId);
  assert.equal(caption.sourceText, 'l3'); assert.deepEqual(caption.lineIds, ['l3']);
  assert.ok(caption.uncertainty.includes('outside-detected-bubbles'));
  assert.equal(result.grouping.inputLineCount, 3); assert.equal(result.grouping.groupCount, 2);
  assert.equal(result.grouping.revision, GROUPING_REVISION); assert.equal(result.grouping.readingOrderRevision, READING_ORDER_REVISION);
  assert.equal('panelId' in dialogue, false);
});

test('部分包含遵守阈值且不伪造缺失置信度，源码空白完整保留', async () => {
  const result = await group([line('l1', 10, 20, 40, 10, { sourceText: '  Hello! ', confidence: 0.95 }), line('l2', 20, 40, 30, 10, { sourceText: 'World.  ' })], [bubble('b1', 16, 10, 80, 80)]);
  assert.equal(result.regions.length, 1); assert.equal(result.regions[0].confidence, undefined);
  assert.equal(result.regions[0].sourceText, '  Hello! \nWorld.  ');
  assert.equal(result.regions[0].bbox.x, 10);
  const outside = await group([line('l1', 10, 20, 40, 10)], [bubble('b1', 17, 10, 80, 80)]);
  assert.equal(outside.regions[0].bubbleId, undefined);
});

test('相邻气泡不因行距接近合并，零检测保留每行', async () => {
  const lines = [line('l1', 20, 30), line('l2', 20, 45), line('l3', 20, 61), line('l4', 20, 76)];
  const result = await group(lines, [bubble('b1', 10, 20, 80, 37), bubble('b2', 10, 59, 80, 38, 1)]);
  assert.deepEqual(result.regions.map(region => region.lineIds), [['l1','l2'],['l3','l4']]);
  const none = await group(lines); assert.equal(none.regions.length, 4);
  assert.equal((await group([], [])).regions.length, 0);
});

test('嵌套框选择最小包围框，交叠歧义和跨框行不会强行归属', async () => {
  const nested = await group([line('l1', 40, 40)], [bubble('large', 0, 0, 150, 150), bubble('small', 30, 30, 70, 60, 1)]);
  assert.equal(nested.regions[0].bubbleId, 'small');
  const ambiguous = await group([line('l1', 50, 50)], [bubble('a', 20, 20, 80, 80), bubble('b', 40, 40, 80, 80, 1)]);
  assert.equal(ambiguous.regions[0].bubbleId, undefined); assert.ok(ambiguous.regions[0].uncertainty.includes('ambiguous-bubble-membership'));
  const crossing = await group([line('l1', 10, 20, 100, 10)], [bubble('b1', 20, 0, 40, 50)]);
  assert.equal(crossing.regions[0].bubbleId, undefined);
});

test('稳定组 ID 不依赖检测/行输入排列或页方向，保留原始 polygon', async () => {
  const polygon = [{ x: 20, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 30 }, { x: 20, y: 30 }];
  const lines = [line('l1', 20, 20, 30, 10, { polygon }), line('l2', 20, 40), line('l3', 200, 20)];
  const bubbles = [bubble('b1', 10, 10, 80, 80), bubble('b2', 190, 10, 80, 80, 1)];
  const first = await group(lines, bubbles), rtl = await group([...lines].reverse().map((line, readingOrder) => ({ ...line, readingOrder })), [...bubbles].reverse().map((bubble, readingOrder) => ({ ...bubble, readingOrder })), { readingDirection: 'rtl' });
  assert.deepEqual(first.regions.map(region => region.regionId), rtl.regions.map(region => region.regionId).reverse());
  assert.equal(rtl.regions[1].sourceText, 'l1\nl2'); assert.deepEqual(rtl.regions[1].lines[0].polygon, polygon);
  rtl.regions[1].lines[0].polygon[0].x = 99; assert.equal(lines[0].polygon[0].x, 20);
});

test('递归 XY-cut 先分隔互不相交的列，再保留列内顺序；RTL 镜像排序', () => {
  const regions = [line('l1', 0, 0, 40, 30), line('l2', 0, 50, 40, 30), line('l3', 100, 20, 40, 40)];
  const ltr = orderByGeometry(regions), rtl = orderByGeometry(regions, { readingDirection: 'rtl' });
  assert.deepEqual(ltr.regions.map(region => region.regionId), ['l1','l2','l3']);
  assert.deepEqual(rtl.regions.map(region => region.regionId), ['l3','l1','l2']);
  assert.equal(ltr.hierarchy.type, 'split'); assert.equal(ltr.hierarchy.axis, 'x');
  assert.deepEqual(ltr.regions.map(region => region.readingOrder), [0,1,2]);
});

test('没有全局空隙时用共同重叠行，不让纵向连锁重叠串成一行', () => {
  const regions = [line('l1', 90, 0, 30, 20), line('l2', 40, 15, 80, 20), line('l3', 0, 30, 80, 20)];
  const result = orderByGeometry(regions);
  assert.equal(result.hierarchy.type, 'rows');
  assert.deepEqual(result.hierarchy.rows, [['l2','l1'],['l3']]);
  assert.deepEqual(orderByGeometry(regions, { readingDirection: 'rtl' }).hierarchy.rows, [['l1','l2'],['l3']]);
});

test('竖排保持列序，水平 RTL 行序不改变行内文本', async () => {
  const vertical = await group([line('l1', 20, 20, 10, 40, { direction: 'vertical' }), line('l2', 40, 20, 10, 40, { direction: 'vertical' })], [bubble('b1', 10, 10, 70, 70)]);
  assert.equal(vertical.regions[0].sourceText, 'l2\nl1'); assert.equal(vertical.regions[0].direction, 'vertical');
  const rtl = await group([line('l1', 20, 20, 20, 10, { direction: 'rtl' }), line('l2', 50, 20, 20, 10, { direction: 'rtl' })], [bubble('b1', 10, 10, 80, 80)]);
  assert.equal(rtl.regions[0].sourceText, 'l2\nl1');
});

test('分组配置和源行元数据严格校验，过长聚合不截断', async () => {
  for (const value of [true, [], { readingDirection: 'auto' }, { enabled: 'true' }, { revision: 'fake' }]) assert.throws(() => normalizeGroupingConfig(value));
  assert.equal(normalizeGroupingConfig({}).readingDirection, 'ltr'); assert.equal(normalizeGroupingConfig({ enabled: false }).enabled, false);
  const result = await group([line('l1', 20, 20)], [bubble('b1', 10, 10, 80, 80)]);
  const valid = result.regions[0]; assert.doesNotThrow(() => validateRegions([valid], dimensions));
  for (const patch of [{ lineIds: ['wrong'] }, { lines: [{ ...valid.lines[0], lineId: 'bad id' }] }, { bubbleBox: { x: 0, y: 0, width: 500, height: 500 } }, { polygon: [{ x: 0, y: 0 }] }]) assert.throws(() => validateRegions([{ ...valid, ...patch }], dimensions));
  assert.throws(() => validateOCRResult({ regions: [line('l1', 20, 20, 30, 10, { polygon: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 401, y: 5 }] })] }, dimensions));
  await assert.rejects(group([line('l1', 20, 20, 30, 10, { sourceText: 'x'.repeat(5000) }), line('l2', 20, 40, 30, 10, { sourceText: 'x'.repeat(5000) })], [bubble('b1', 10, 10, 80, 80)]), /exceeds budget/);
});

const request = () => ({ imageBytes: new Uint8Array([1, 2, 3]), ...dimensions, namespace: 'test', ocrConfig: { engine: 'full-image-fixture' }, detectionConfig: { revision: 1 }, groupingConfig: { enabled: true, readingDirection: 'ltr' }, translation: { sourceLanguage: 'en', targetLanguage: 'zh', provider: 'fixture', endpoint: 'https://example.invalid', accountNamespace: 'test', model: 'fixture' } });
function setup() {
  const calls = { ocr: 0, translation: 0 };
  const pipeline = createPipeline({ detect: async ({ config }) => detection([bubble('b1', 10, 10, 80 + config.revision, 80), bubble('b2', 190, 10, 80, 80, 1)]),
    ocr: async ({ config, detection }) => { calls.ocr++; assert.equal(config.regions, undefined); assert.equal(detection, null); return { regions: [line('l1', 20, 20), line('l2', 20, 40), line('l3', 200, 20)] }; },
    translate: async request => { calls.translation++; return { translations: request.regions.map(region => ({ regionId: region.regionId, text: region.sourceText })) }; } });
  return { pipeline, calls };
}

test('原始整图 OCR 跨检测修订复用，分组和阅读序修订进入译文身份', async () => {
  const { pipeline, calls } = setup();
  const first = await pipeline.run(request());
  const changed = await pipeline.run({ ...request(), detectionConfig: { revision: 2 } });
  assert.equal(first.ocrKey, changed.ocrKey); assert.notEqual(first.groupingKey, changed.groupingKey); assert.notEqual(first.translationKey, changed.translationKey);
  const rtl = await pipeline.run({ ...request(), groupingConfig: { enabled: true, readingDirection: 'rtl' } });
  assert.notEqual(first.groupingKey, rtl.groupingKey); assert.notEqual(first.translationKey, rtl.translationKey);
  assert.deepEqual(first.regions.map(region => region.regionId), rtl.regions.map(region => region.regionId).reverse());
  assert.equal(calls.ocr, 1); assert.equal(calls.translation, 3);
});

test('源文本编辑发生在聚合之后，不污染原始行缓存；准备和翻译身份一致', async () => {
  const { pipeline, calls } = setup(); const prepared = await pipeline.prepare(request());
  const id = prepared.regions[0].regionId;
  const translated = await pipeline.run({ ...request(), sourceEdits: { [id]: 'Corrected full bubble' } });
  assert.equal(translated.regions[0].sourceText, 'Corrected full bubble'); assert.equal(translated.regions[0].sourceRevision, 1);
  assert.equal(translated.regions[0].lines[0].sourceText, 'l1'); assert.equal(prepared.groupingKey, translated.groupingKey);
  const repeat = await pipeline.run(request()); assert.equal(repeat.regions[0].sourceText, 'l1\nl2'); assert.equal(calls.ocr, 1);
  await assert.rejects(pipeline.run({ ...request(), sourceEdits: { l1: 'Not a group ID' } }), /unknown region/);
});

test('分组配置在首个 await 前快照，取消和清缓存不复活旧结果', async () => {
  const { pipeline } = setup(); const input = request(); const pending = pipeline.run(input); input.groupingConfig.readingDirection = 'rtl';
  assert.equal((await pending).grouping.readingDirection, 'ltr');
  const controller = new AbortController(); controller.abort(); await assert.rejects(pipeline.run(request(), { signal: controller.signal }), { name: 'AbortError' });
  pipeline.clear(); assert.equal(pipeline.diagnostics().ocrEntries, 0); assert.equal(pipeline.diagnostics().translationEntries, 0);
});
