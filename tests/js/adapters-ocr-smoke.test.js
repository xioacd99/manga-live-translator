import test from 'node:test';
import assert from 'node:assert/strict';
import { createOcrAdapter } from '../../extension/adapters/ocr.js';

import { createEnglishBitmap } from '../fixtures/generated-english.js';

test('real packaged English OCR recognizes a generated bitmap offline', { timeout: 30000 }, async () => {
  const root = new URL('../../node_modules/', import.meta.url).pathname;
  const adapter = createOcrAdapter({
    workerPath: `${root}tesseract.js/src/worker-script/node/index.js`,
    corePath: `${root}tesseract.js-core`, langPath: `${root}@tesseract.js-data/eng/4.0.0_best_int`,
  });
  try {
    const { regions } = await adapter.recognize(createEnglishBitmap());
    assert.match(regions.map(r => r.sourceText).join(' '), /HELLO WORLD/);
    assert.ok(regions.every(r => r.bbox.width > 0 && r.confidence > 0));
  } finally { await adapter.dispose(); }
});
