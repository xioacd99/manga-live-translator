// Independently drawn synthetic glyphs: no copyrighted manga or external font input.
export function createEnglishBitmap() {
  const glyphs = {
    H: ['10001','10001','10001','11111','10001','10001','10001'],
    E: ['11111','10000','10000','11110','10000','10000','11111'],
    L: ['10000','10000','10000','10000','10000','10000','11111'],
    O: ['01110','10001','10001','10001','10001','10001','01110'],
    W: ['10001','10001','10001','10101','10101','11011','10001'],
    R: ['11110','10001','10001','11110','10100','10010','10001'],
    D: ['11110','10001','10001','10001','10001','10001','11110'],
  };
  const width = 800, height = 160, stride = width * 3;
  const bytes = Buffer.alloc(54 + stride * height, 255);
  bytes.fill(0, 0, 54); bytes.write('BM'); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10); bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18); bytes.writeInt32LE(height, 22); bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(stride * height, 34);
  let left = 50;
  for (const letter of 'HELLO WORLD') {
    for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) {
      if (glyphs[letter]?.[row][col] === '1') for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
        const offset = 54 + (height - 1 - (40 + row * 10 + y)) * stride + (left + col * 10 + x) * 3;
        bytes.fill(0, offset, offset + 3);
      }
    }
    left += 60;
  }
  return { imageBytes: bytes, width, height };
}

