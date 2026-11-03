export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_PIXELS = 16 * 1024 * 1024;
export function publicHttpUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Invalid URL.');
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') || /^\d+\./.test(host) || host.includes(':')) throw new Error('Only public HTTP(S) image hosts are supported.');
  return url;
}
export function validateImageRequest(message, sender, grant) {
  if (!sender?.tab || sender.frameId !== 0 || !grant || sender.tab.incognito) throw new Error('Enable this page in the extension popup first.');
  const page = publicHttpUrl(sender.url);
  if (page.origin !== grant.origin || new URL(sender.tab.url).origin !== grant.origin) throw new Error('Page permission has changed. Enable this page again.');
  if (typeof message.requestId !== 'string' || !/^[\w:.-]{1,160}$/.test(message.requestId)) throw new Error('Invalid request identifier.');
  const image = publicHttpUrl(message.imageUrl);
  if (!grant.imageOrigins.includes(image.origin)) throw new Error('Image host is not enabled. Add its origin in the popup and enable the page again.');
  const {width,height}=message;
  if (!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width*height>MAX_PIXELS) throw new Error('Image exceeds the decoded pixel budget.');
  if (message.corrections && (typeof message.corrections!=='object'||Array.isArray(message.corrections)||Object.keys(message.corrections).length>300||Object.values(message.corrections).some(v=>typeof v!=='string'||v.length>10000))) throw new Error('Invalid text correction.');
  return image;
}
export async function readBoundedImage(response, signal) {
  if (!response.ok) throw new Error('Image request failed.');
  const mime=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
  if (!['image/png','image/jpeg','image/webp','image/bmp'].includes(mime)) throw new Error('Use a static PNG, JPEG, WebP, or BMP image.');
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 4 MiB byte budget.');
  if (!response.body) throw new Error('Empty image body.');
  const reader=response.body.getReader(); let total=0; const chunks=[];
  try { while(true) { signal?.throwIfAborted(); const {done,value}=await reader.read(); if(done)break; total+=value.length; if(total>MAX_IMAGE_BYTES)throw new Error('Image exceeds the 4 MiB byte budget.'); chunks.push(value); } }
  catch(e) { await reader.cancel().catch(()=>{}); throw e; }
  const bytes=new Uint8Array(total); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return {bytes,mime};
}
export function toBase64(bytes) { let s=''; for(let n=0;n<bytes.length;n+=32768)s+=String.fromCharCode(...bytes.subarray(n,n+32768)); return btoa(s); }
export function safeError(error) {
  if(error?.name==='AbortError')return {code:'CANCELLED',message:'Translation cancelled.'};
  // Only authored, non-provider error messages may be displayed.
  return {code:'FAILED',message:'Could not process this image. Check page permissions, model configuration, image limits, and provider availability. No automatic retry was sent.'};
}
