import {createEnglishBitmap} from './generated-english.js';
// 独立绘制的合成气泡，保留原有字形；不使用真实漫画或外部字体。
export function createBubbleBitmap() {
  const image = createEnglishBitmap();
  const {imageBytes: bytes, width, height} = image;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x >= 22 && x < 758 && y >= 17 && y < 143) continue;
    const value = x >= 20 && x < 760 && y >= 15 && y < 145 ? 0 : 128;
    const offset = 54 + (height - 1 - y) * width * 3 + x * 3;
    bytes.fill(value, offset, offset + 3);
  }
  return image;
}
