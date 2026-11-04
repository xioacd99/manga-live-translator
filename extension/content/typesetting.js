// 保守的纯色背景证据与排版；不推断真实气泡轮廓，也不使用实验中的真值掩膜。
export const TYPESETTING_REVISION = 'safe-fill-v1';
const fields = ['x', 'y', 'width', 'height'];
const validBox = box => !!box && fields.every(key => Number.isFinite(box[key])) && box.width > 0 && box.height > 0;
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
const fallback = reason => ({mode: 'side-panel', reason, revision: TYPESETTING_REVISION});

export function analyzeRegionBackground(image, region) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 || image.data?.length !== image.width * image.height * 4) return fallback('invalid-pixels');
  region = {...region, box: region?.box ?? region?.bbox};
  const bounds = {x: 0, y: 0, width: image.width, height: image.height};
  if (!validBox(region?.box) || !validBox(region?.bubbleBox) || !inside(region.bubbleBox, bounds) || !inside(region.box, region.bubbleBox)) return fallback('missing-bubble-evidence');
  const source = region.box, bubble = region.bubbleBox;
  const margin = Math.max(3, Math.ceil(Math.min(bubble.width, bubble.height) * .06));
  const interior = {x: Math.ceil(bubble.x + margin), y: Math.ceil(bubble.y + margin), width: Math.floor(bubble.x + bubble.width - margin) - Math.ceil(bubble.x + margin), height: Math.floor(bubble.y + bubble.height - margin) - Math.ceil(bubble.y + margin)};
  const safeBox = {x: Math.floor(source.x) - 2, y: Math.floor(source.y) - 2, width: Math.ceil(source.x + source.width) - Math.floor(source.x) + 4, height: Math.ceil(source.y + source.height) - Math.floor(source.y) + 4};
  if (!validBox(interior) || !inside(safeBox, interior)) return fallback('insufficient-border-clearance');
  // 只检查有限面积；超大候选宁可保留原图，避免阻塞执行线程。
  if (interior.width * interior.height > 1_000_000) return fallback('candidate-too-large');
  const suppliedLines = region.lines?.length ? region.lines.map(line => line.box ?? line.bbox) : [source];
  if (suppliedLines.length > 500 || suppliedLines.some(box => !validBox(box) || !inside(box, source))) return fallback('invalid-line-evidence');
  const textMask = new Uint8Array(interior.width * interior.height);
  for (const box of suppliedLines) for (let y = Math.ceil(box.y); y < box.y + box.height; y++) for (let x = Math.ceil(box.x); x < box.x + box.width; x++) textMask[(y - interior.y) * interior.width + x - interior.x] = 1;
  const at = (x, y) => (y * image.width + x) * 4;
  const index = at(interior.x, interior.y), color = Array.from(image.data.slice(index, index + 3));
  let backgroundPixels = 0, inkPixels = 0, sourcePixels = 0;
  for (let y = interior.y; y < interior.y + interior.height; y++) for (let x = interior.x; x < interior.x + interior.width; x++) {
    const i = at(x, y);
    if (image.data[i + 3] !== 255) return fallback('transparent-background');
    const distance = Math.max(Math.abs(color[0] - image.data[i]), Math.abs(color[1] - image.data[i + 1]), Math.abs(color[2] - image.data[i + 2]));
    const textPixel = textMask[(y - interior.y) * interior.width + x - interior.x] === 1;
    if (textPixel) sourcePixels++;
    if (distance <= 6) backgroundPixels++;
    else {
      // 文字框外出现任何异色像素即拒绝，不能把纹理或边框当作可涂抹背景。
      if (!textPixel) return fallback('nonuniform-background');
      inkPixels++;
    }
  }
  if (!sourcePixels || inkPixels / sourcePixels > .45 || backgroundPixels < interior.width * interior.height * .65) return fallback('dense-or-complex-source');
  return {mode: 'pure-color', safeBox, color, revision: TYPESETTING_REVISION, evidence: {method: 'opaque-interior-pixels', backgroundPixels, inkPixels, checkedPixels: interior.width * interior.height, borderMargin: margin}};
}

export function isSafeRendering(rendering, region) {
  region = {...region, box: region?.box ?? region?.bbox};
  const margin = rendering?.evidence?.borderMargin;
  const bubble = region.bubbleBox;
  const interior = validBox(bubble) && Number.isFinite(margin) ? {x: bubble.x + margin, y: bubble.y + margin, width: bubble.width - margin * 2, height: bubble.height - margin * 2} : null;
  return rendering?.mode === 'pure-color' && rendering.revision === TYPESETTING_REVISION && rendering.evidence?.method === 'opaque-interior-pixels' && rendering.evidence.checkedPixels > 0 && rendering.evidence.borderMargin >= 3 && validBox(rendering.safeBox) && validBox(region?.bubbleBox) && validBox(interior) && inside(rendering.safeBox, interior) && validBox(region.box) && inside(region.box, rendering.safeBox) && Array.isArray(rendering.color) && rendering.color.length === 3 && rendering.color.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
}

const opening = /[（【《〈「『〔［｛([{]$/u;
const closing = /^[，。！？、：；）】》〉」』〕］｝,.!?;:)\]}]/u;
function graphemes(text) {
  return typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(text), item => item.segment) : Array.from(text);
}

// 测量回调由浏览器 canvas 提供，测试可注入确定性宽度；不按字符数估算实际字体。
export function fitTranslation(text, {width, height, measure, minFont = 12, maxFont = 28, padding = 3, lineHeight = 1.35} = {}) {
  if (typeof text !== 'string' || text.length > 20000 || !text.trim() || ![width, height, minFont, maxFont, padding, lineHeight].every(Number.isFinite) || width <= padding * 2 || height <= padding * 2 || minFont < 10 || maxFont < minFont || padding < 0 || lineHeight < 1 || typeof measure !== 'function') return {mode: 'side-panel', reason: 'invalid-layout'};
  const limit = width - 2 * padding, available = height - 2 * padding;
  for (let fontSize = Math.min(48, Math.floor(maxFont)); fontSize >= minFont; fontSize--) {
    const lines = [];
    let failed = false;
    for (const paragraph of text.split(/\r?\n/u)) {
      let line = '';
      for (const ch of graphemes(paragraph)) {
        const measured = measure(line + ch, fontSize);
        if (!Number.isFinite(measured) || measured < 0) { failed = true; break; }
        if (measured <= limit) { line += ch; continue; }
        if (!line) { failed = true; break; }
        let carry = '';
        // 禁止行首闭标点及行末开标点；空间不足时移动前一个字，不挤出边界。
        if (closing.test(ch) || opening.test(line)) {
          const chars = graphemes(line); carry = chars.pop(); line = chars.join('');
          while (line && opening.test(line)) { const chars = graphemes(line); carry = chars.pop() + carry; line = chars.join(''); }
        } else {
          const split = line.lastIndexOf(' ');
          if (split > 0 && /[\p{Letter}\p{Number}]/u.test(ch)) { carry = line.slice(split + 1); line = line.slice(0, split); }
        }
        if (!line || closing.test(carry + ch) || measure(carry + ch, fontSize) > limit) { failed = true; break; }
        lines.push(line); line = carry + ch;
        if ((lines.length + 1) * fontSize * lineHeight > available) { failed = true; break; }
      }
      if (failed) break;
      lines.push(line);
    }
    if (!failed && lines.length * fontSize * lineHeight <= available && lines.every(line => measure(line, fontSize) <= limit && !opening.test(line))) return {mode: 'overlay', lines, fontSize, lineHeight, padding};
  }
  return {mode: 'side-panel', reason: 'minimum-font-overflow'};
}
