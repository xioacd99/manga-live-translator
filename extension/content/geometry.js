// Geometry uses CSS pixels; OCR boxes remain in the decoded image coordinate space.
export function isEligibleImage(image, minimum = 160) {
  return !!image.isConnected && image.complete && image.naturalWidth >= minimum &&
    image.naturalHeight >= minimum && !!(image.currentSrc || image.src);
}

function position(value, freeSpace) {
  if (value === 'left' || value === 'top') return 0;
  if (value === 'right' || value === 'bottom') return freeSpace;
  if (value === 'center') return freeSpace / 2;
  if (/^-?[\d.]+%$/.test(value)) return freeSpace * parseFloat(value) / 100;
  if (/^-?[\d.]+px$/.test(value)) return parseFloat(value);
  return freeSpace / 2;
}

export function imageGeometry(width, height, sourceWidth, sourceHeight, fit = 'fill', objectPosition = '50% 50%') {
  if (![width, height, sourceWidth, sourceHeight].every(n => Number.isFinite(n) && n > 0)) return null;
  let scaleX = width / sourceWidth;
  let scaleY = height / sourceHeight;
  if (fit !== 'fill') {
    const contain = Math.min(scaleX, scaleY);
    const scale = fit === 'cover' ? Math.max(scaleX, scaleY) : fit === 'none' ? 1 : fit === 'scale-down' ? Math.min(1, contain) : contain;
    scaleX = scaleY = scale;
  }
  const parts = objectPosition.trim().split(/\s+/);
  if (parts.length === 1) parts.push('50%');
  return {scaleX, scaleY, x: position(parts[0], width - sourceWidth * scaleX), y: position(parts[1], height - sourceHeight * scaleY), width, height};
}

export function projectBox(box, geometry) {
  if (!geometry || !box || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(box[k])) || box.width <= 0 || box.height <= 0) return null;
  const x = geometry.x + box.x * geometry.scaleX;
  const y = geometry.y + box.y * geometry.scaleY;
  const right = Math.min(geometry.width, x + box.width * geometry.scaleX);
  const bottom = Math.min(geometry.height, y + box.height * geometry.scaleY);
  const left = Math.max(0, x), top = Math.max(0, y);
  if (right <= left || bottom <= top) return null;
  return {x: left, y: top, width: right - left, height: bottom - top};
}

export function isCurrentRequest(snapshot, current) {
  return current.enabled && current.connected && snapshot.requestId === current.requestId &&
    snapshot.sourceVersion === current.sourceVersion && snapshot.imageUrl === current.imageUrl && snapshot.pageUrl === current.pageUrl;
}
