const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index++) crc = CRC_TABLE[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const fail = () => { throw new Error('Unsupported, malformed, animated or oversized image.'); };
function dimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS) fail();
  return { width, height };
}

/** 解码前检查容器与帧头；压缩内容是否有效仍由解码器验证。 */
export function inspectImage(input, mime) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
  if (!bytes || !bytes.length || bytes.length > MAX_BYTES) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (offset, count) => { if (offset < 0 || count < 0 || offset + count > bytes.length) fail(); };
  const u16 = (offset, little = false) => { need(offset, 2); return view.getUint16(offset, little); };
  const u32 = (offset, little = false) => { need(offset, 4); return view.getUint32(offset, little); };
  const ascii = (offset, count) => { need(offset, count); return String.fromCharCode(...bytes.subarray(offset, offset + count)); };
  const uint24 = offset => { need(offset, 3); return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536; };
  const expected = typeof mime === 'string' ? mime.toLowerCase().split(';')[0].trim() : '';

  if (expected === 'image/png') {
    need(0, 8);
    if (ascii(0, 8) !== '\x89PNG\r\n\x1a\n') fail();
    let offset = 8, size, hasData = false, ended = false;
    while (offset < bytes.length) {
      need(offset, 12); const length = u32(offset), type = ascii(offset + 4, 4); need(offset + 8, length + 4);
      if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes, offset + 4, offset + 8 + length) !== u32(offset + 8 + length)) fail();
      if (['acTL','fcTL','fdAT'].includes(type)) fail();
      if (offset === 8 && type !== 'IHDR') fail();
      if (type === 'IHDR') {
        if (offset !== 8 || length !== 13 || size) fail();
        size = dimensions(u32(offset + 8), u32(offset + 12));
        const depth = bytes[offset + 16], color = bytes[offset + 17];
        const depths = {0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
        if (!depths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) fail();
      }
      if (type === 'IDAT') hasData ||= length > 0;
      if (type === 'IEND') { if (length !== 0 || !hasData) fail(); ended = true; }
      offset += 12 + length;
      if (ended) { if (offset !== bytes.length) fail(); break; }
    }
    if (!size || !ended) fail(); return size;
  }

  if (expected === 'image/jpeg') {
    need(0, 4); if (u16(0) !== 0xffd8) fail();
    let offset = 2, size, scanned = false, inScan = false;
    while (offset < bytes.length) {
      if (inScan) {
        while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
        if (offset >= bytes.length) fail();
      }
      if (bytes[offset++] !== 0xff) fail();
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      need(offset, 1); const marker = bytes[offset++];
      if (inScan && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
      inScan = false;
      if (marker === 0xd9) { if (!size || !scanned || offset !== bytes.length) fail(); return size; }
      if (marker === 0 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) fail();
      const length = u16(offset); if (length < 2) fail(); need(offset, length);
      if (marker === 0xe2 && length >= 6 && ascii(offset + 2, 4) === 'MPF\0') fail();
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4,0xc8,0xcc].includes(marker);
      if (isFrame) {
        if (![0xc0,0xc2].includes(marker) || size || length < 8 || bytes[offset + 2] !== 8) fail();
        const components = bytes[offset + 7];
        if (![1,3,4].includes(components) || length !== 8 + 3 * components) fail();
        size = dimensions(u16(offset + 5), u16(offset + 3));
      }
      if (marker === 0xda) {
        if (!size || length < 6) fail();
        const components = bytes[offset + 2]; if (components < 1 || components > 4 || length !== 6 + 2 * components) fail();
        scanned = true; inScan = true;
      }
      offset += length;
    }
    fail();
  }

  if (expected === 'image/bmp' || expected === 'image/x-ms-bmp') {
    need(0, 54); if (ascii(0, 2) !== 'BM' || u32(2, true) !== bytes.length || u32(6, true) !== 0) fail();
    const pixelOffset = u32(10, true), dibSize = u32(14, true);
    if (![40,108,124].includes(dibSize)) fail(); need(14, dibSize);
    const width = view.getInt32(18, true), height = view.getInt32(22, true);
    const size = dimensions(width, Math.abs(height));
    const bits = u16(28, true);
    if (u16(26, true) !== 1 || ![24,32].includes(bits) || u32(30, true) !== 0 || pixelOffset < 14 + dibSize) fail();
    const dataBytes = Math.ceil(width * bits / 32) * 4 * Math.abs(height);
    const declaredData = u32(34, true);
    if (declaredData !== 0 && declaredData !== dataBytes) fail();
    need(pixelOffset, dataBytes); return size;
  }

  if (expected === 'image/webp') {
    need(0, 12); if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP' || u32(4, true) + 8 !== bytes.length) fail();
    let offset = 12, canvas, frame;
    while (offset < bytes.length) {
      need(offset, 8); const type = ascii(offset, 4), length = u32(offset + 4, true), data = offset + 8;
      need(data, length + (length & 1));
      if (type === 'ANIM' || type === 'ANMF') fail();
      if (type === 'VP8X') {
        if (offset !== 12 || canvas || length !== 10 || (bytes[data] & 0xc3) !== 0 || bytes[data + 1] || bytes[data + 2] || bytes[data + 3]) fail();
        canvas = dimensions(uint24(data + 4) + 1, uint24(data + 7) + 1);
      } else if (type === 'VP8 ') {
        if (frame || length < 10 || (bytes[data] & 1) !== 0 || ascii(data + 3, 3) !== '\x9d\x01\x2a') fail();
        frame = dimensions(u16(data + 6, true) & 0x3fff, u16(data + 8, true) & 0x3fff);
      } else if (type === 'VP8L') {
        if (frame || length < 5 || bytes[data] !== 0x2f || (bytes[data + 4] & 0xe0) !== 0) fail();
        const packed = u32(data + 1, true);
        frame = dimensions((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1);
      } else if (!canvas) fail();
      offset = data + length + (length & 1);
    }
    if (!frame || (canvas && (canvas.width !== frame.width || canvas.height !== frame.height))) fail();
    return frame;
  }
  fail();
}
