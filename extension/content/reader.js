import {fitTranslation, isSafeRendering} from './typesetting.js';
import {imageGeometry, projectBox, isEligibleImage, isCurrentRequest} from './geometry.js';

import {MAX_IMAGES, MAX_PENDING, preparationSettings, imagePriority, selectPreparationJobs} from './scheduler.js';
const CSS = `
:host { all: initial; position: fixed; display: block; z-index: 2147483646; pointer-events: none; }
* { box-sizing: border-box; }
.controls { position: absolute; left: 0; top: 0; display: flex; flex-wrap: wrap; gap: 4px; max-width: 100%; background: #172135; padding: 4px; border-radius: 6px; pointer-events: auto; color: white; font: 12px/1.4 system-ui, sans-serif; }
button { border: 1px solid #8795ac; border-radius: 4px; padding: 4px 7px; background: white; color: #172135; font: 12px/1.4 system-ui, sans-serif; cursor: pointer; }
button:focus-visible, textarea:focus-visible { outline: 3px solid #ffb433; outline-offset: 1px; }
button:disabled { opacity: .6; cursor: wait; }
.regions { position: absolute; overflow: visible; pointer-events: none; }
.region { position: absolute; margin: 0; padding: 0; border: 0; border-radius: 0; color: #111; white-space: pre; font-family: system-ui, sans-serif; font-weight: 400; pointer-events: auto; cursor: pointer; }
.source-indicator { position: absolute; border: 1px dashed #2563eb; background: transparent; pointer-events: none; }
.source-indicator::before { content: attr(data-source-label); position: absolute; left: 0; bottom: 100%; color: #2563eb; font: 10px/1.2 system-ui, sans-serif; }
.sidecar { position: absolute; width: 280px; max-height: 60vh; overflow: auto; display: grid; gap: 6px; pointer-events: auto; }
.sidecar .region { position: static; width: 100%; padding: 8px; background: #fff; color: #111; border: 1px solid #64748b; border-radius: 5px; font: 14px/1.5 system-ui, sans-serif; white-space: pre-wrap; overflow-wrap: anywhere; text-align: left; }

.sidecar .region::before { content: attr(data-source-label) " · "; color: #2563eb; font-weight: 600; }
.panel { position: absolute; left: 0; top: 42px; max-width: min(440px, 90vw); max-height: 65vh; width: 440px; overflow: auto; padding: 12px; background: #fff; color: #111; box-shadow: 0 4px 22px #0006; border: 2px solid #334155; border-radius: 8px; pointer-events: auto; font: 14px/1.5 system-ui, sans-serif; }
.panel p { white-space: pre-wrap; overflow-wrap: anywhere; }
.panel label { display: block; margin-top: 12px; }
.panel textarea { display: block; width: 100%; min-height: 65px; font: 14px/1.5 system-ui, sans-serif; }
[hidden] { display: none !important; }
`;

export function installReader({document: doc = globalThis.document, window: win = globalThis.window, runtime = globalThis.chrome.runtime} = {}) {
  const states = new Map();
  let enabled = false, auto = false, serial = 0, frame = 0, paused = false;
  let options = preparationSettings(), localUsed = 0, remoteUsed = 0;
  let pageUrl = win.location.href;
  const session = globalThis.crypto.randomUUID();
  const node = (tag, text) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
  const send = async message => runtime.sendMessage(message);
  const button = (label, callback) => { const el = node('button', label); el.type = 'button'; el.addEventListener('click', callback); return el; };
  const source = image => image.currentSrc || image.src;
  let textContext;
  try { textContext = doc.createElement('canvas').getContext?.('2d'); } catch {}
  const measure = textContext ? (text, size) => { textContext.font = `${size}px system-ui, sans-serif`; return textContext.measureText(text).width; } : undefined;
  const visible = image => { const r = image.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < win.innerHeight && r.left < win.innerWidth; };

  function cancel(state, label = 'Cancelled. A sent provider request may still be billed.') {
    if (state.requestId) send({type: 'MLT_CANCEL', requestId: state.requestId}).catch(() => {});
    state.requestId = null;
    state.status.textContent = label;
    state.translate.disabled = false;
    state.cancel.hidden = true;
  }
  function dispose(state) {
    cancel(state, ''); resize.unobserve(state.image); state.host.remove(); states.delete(state.image);
  }
  // 同账号上下文或翻译模型变化只失效输出，保留同图已确认的源文本校正。
  function invalidate(state, label = 'Settings changed. Select Translate.') {
    cancel(state, label);
    state.prepared = false; state.prepareAttempted = false;
    state.result = null; state.renderedResult = null; state.layoutKey = null; state.attempted = false; state.original = false;
    state.regions.replaceChildren(); state.regions.hidden = false; state.sidecar = null; state.sidecarBelow = false;
    state.panel.replaceChildren(); state.panel.hidden = true;
    state.toggle.textContent = 'Show original'; state.toggle.hidden = state.details.hidden = true;
  }
  function reset(state) {
    invalidate(state, 'Image changed. Select Translate.');
    state.sourceVersion = `${session}:${++serial}`;
    state.imageUrl = source(state.image);
    state.corrections = Object.create(null);
  }
  function openPanel(state) {
    if (!state.result) return;
    state.panel.replaceChildren(button('Close text panel', () => { state.panel.hidden = true; }));
    const corrections = Object.create(null);
    for (const [index, region] of state.result.regions.entries()) {
      const label = node('label', `Source ${index + 1}${typeof region.confidence === 'number' && region.confidence < 0.7 ? ' · Low OCR confidence' : ''}`);
      const input = node('textarea'); input.value = state.corrections[region.id] ?? region.text ?? ''; input.maxLength = 8000;
      input.addEventListener('input', () => { corrections[region.id] = input.value; });
      label.append(input); state.panel.append(label, node('p', region.translation));
    }
    state.panel.append(button('Translate corrected source', () => {
      if (Object.keys(corrections).length) { state.panel.hidden = true; translate(state, corrections); }
    }));
    state.panel.hidden = false;
  }
  function add(image) {
    const host = node('div'); host.setAttribute('data-mlt-reader', '');
    // Shadow DOM 用于隔离样式，不是秘密保护边界；开放模式便于无障碍访问与浏览器测试检查。
    const shadow = host.attachShadow({mode: 'open'});
    const style = node('style', CSS), regions = node('div'), controls = node('div'), panel = node('div');
    regions.className = 'regions'; controls.className = 'controls'; panel.className = 'panel'; panel.hidden = true;
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Translation and OCR corrections');
    const status = node('span', 'Ready'); status.setAttribute('role', 'status');
    const state = {image, host, regions, controls, panel, status, imageUrl: source(image), sourceVersion: `${session}:${++serial}`, requestId: null, corrections: Object.create(null), result: null, attempted: false, original: false};
    state.translate = button('Translate', () => translate(state));
    state.cancel = button('Cancel', () => cancel(state)); state.cancel.hidden = true;
    state.toggle = button('Show original', () => { state.original = !state.original; state.toggle.textContent = state.original ? 'Show translation' : 'Show original'; layout(state); });
    state.details = button('Read / correct text', () => openPanel(state));
    state.toggle.hidden = state.details.hidden = true;
    controls.append(state.translate, state.cancel, state.toggle, state.details, status);
    shadow.append(style, regions, controls, panel); doc.documentElement.append(host);
    states.set(image, state); resize.observe(image);
    return state;
  }
  async function translate(state, corrections, purpose = 'manual') {
    if (!enabled || paused || doc.hidden || state.requestId || !isEligibleImage(state.image) || [...states.values()].filter(s => s.requestId).length >= MAX_PENDING) return;
    if (state.imageUrl !== source(state.image)) reset(state);
    if (corrections) Object.assign(state.corrections, corrections);
    const sourceEdits = {...state.corrections};
    state.attempted = true;
    const requestId = `${session}:request:${++serial}`;
    state.requestId = requestId; state.translate.disabled = true; state.cancel.hidden = false;
    state.status.textContent = 'Fetching → local OCR → translation…';
    const snapshot = {requestId, sourceVersion: state.sourceVersion, imageUrl: state.imageUrl, pageUrl};
    try {
      const response = await send({type: 'MLT_TRANSLATE', requestId, imageUrl: state.imageUrl, sourceVersion: state.sourceVersion, purpose, prefetch: purpose === 'prefetch', detectorMode: options.detectorMode, width: state.image.naturalWidth, height: state.image.naturalHeight, ...(Object.keys(sourceEdits).length ? {corrections: sourceEdits} : {})});
      if (!isCurrentRequest(snapshot, {enabled: enabled && !doc.hidden, connected: state.image.isConnected, requestId: state.requestId, sourceVersion: state.sourceVersion, imageUrl: source(state.image), pageUrl: win.location.href})) return;
      if (!response?.ok) throw new Error(response?.error?.message || 'Translation failed. Check extension settings, then retry.');
      const result = response.result;
      if (!result || !Array.isArray(result.regions) || result.regions.length > 500 || ![result.width, result.height].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid translation response.');
      if (result.regions.some(r => typeof r.id !== 'string' || typeof r.translation !== 'string' || r.translation.length > 20000 || typeof r.text !== 'string')) throw new Error('Invalid translation regions.');
      state.result = result; state.original = false; state.toggle.textContent = 'Show original';
      state.status.textContent = result.regions.length ? 'Translated. Click text to read or correct.' : 'No readable text detected.';
      state.toggle.hidden = state.details.hidden = !result.regions.length;
      layout(state);
    } catch (error) {
      if (state.requestId === requestId) state.status.textContent = String(error.message || 'Extension unavailable. Reload this tab.').slice(0, 240);
    } finally {
      if (state.requestId === requestId) { state.requestId = null; state.translate.disabled = false; state.cancel.hidden = true; }
      schedule();
    }
  }
  async function prepare(state) {
    state.prepareAttempted = true;
    const requestId = `${session}:prepare:${++serial}`;
    state.requestId = requestId; state.translate.disabled = true; state.cancel.hidden = false;
    state.status.textContent = '正在获取图片并本地准备；不发送远端翻译…';
    const snapshot = {requestId, sourceVersion: state.sourceVersion, imageUrl: state.imageUrl, pageUrl};
    try {
      const response = await send({type: 'MLT_PREPARE', requestId, imageUrl: state.imageUrl, sourceVersion: state.sourceVersion, width: state.image.naturalWidth, height: state.image.naturalHeight, detectorMode: options.detectorMode});
      if (!isCurrentRequest(snapshot, {enabled: enabled && !doc.hidden, connected: state.image.isConnected, requestId: state.requestId, sourceVersion: state.sourceVersion, imageUrl: source(state.image), pageUrl: win.location.href})) return;
      if (!response?.ok) throw new Error(response?.error?.message || '本地准备失败，可手动翻译重试。');
      state.prepared = true;
      state.status.textContent = '本地准备完成，尚未翻译。';
    } catch (error) {
      if (state.requestId === requestId) state.status.textContent = String(error.message || '本地准备失败。').slice(0, 240);
    } finally {
      if (state.requestId === requestId) { state.requestId = null; state.translate.disabled = false; state.cancel.hidden = true; }
      schedule();
    }
  }
  function layout(state) {
    const rect = state.image.getBoundingClientRect();
    const belowVisible = !state.original && state.sidecarBelow && rect.right > 0 && rect.left < win.innerWidth && rect.bottom < win.innerHeight && rect.bottom + 8 + (state.sidecar?.offsetHeight || 0) > 0;
    state.host.hidden = !visible(state.image) && !belowVisible;
    Object.assign(state.host.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`});
    state.regions.hidden = state.original;
    if (!state.result || state.original || !rect.width || !rect.height) return;
    const css = win.getComputedStyle(state.image);
    // 旋转或倾斜的图像不能直接套用轴对齐 OCR 矩形，但仍可使用文本面板。
    if (css.transform !== 'none' && css.transform !== '') { state.regions.replaceChildren(); state.layoutKey = null; return; }
    const px = key => parseFloat(css[key]) || 0;
    const left = px('borderLeftWidth') + px('paddingLeft'), top = px('borderTopWidth') + px('paddingTop');
    const width = rect.width - left - px('borderRightWidth') - px('paddingRight');
    const height = rect.height - top - px('borderBottomWidth') - px('paddingBottom');
    Object.assign(state.regions.style, {left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`});
    const positionSidecar = sidecar => {
      const rightSpace = win.innerWidth - rect.right - 12, leftSpace = rect.left - 12;
      // 优先放到图像旁；窄视口放在图像下方，不覆盖当前原图，完整文本仍可由控制按钮打开。
      const sideTop = `${Math.max(0, 8 - rect.top - top)}px`;
      state.sidecarBelow = rightSpace < 160 && leftSpace < 160;
      const sideWidth = Math.max(120, Math.min(280, Math.max(rightSpace, leftSpace)));
      Object.assign(sidecar.style, rightSpace >= 160 ? {left: `${width + 8}px`, top: sideTop, width: `${Math.min(280, rightSpace)}px`} : leftSpace >= 160 ? {left: `${-sideWidth - left - 8}px`, top: sideTop, width: `${sideWidth}px`} : {left: '0px', top: `${height + 8}px`, width: `${Math.min(440, width)}px`});
    };
    // 页面纵向滚动只更新侧栏位置，不重建节点或丢失焦点、内部滚动位置。
    if (state.sidecar) positionSidecar(state.sidecar);
    const key = [width, height, left, top, rect.left, win.innerWidth, win.innerHeight, css.objectFit, css.objectPosition].join('|');
    if (state.renderedResult === state.result && state.layoutKey === key) return;
    const scrollTop = state.renderedResult === state.result ? (state.sidecar?.scrollTop || 0) : 0;
    state.renderedResult = state.result; state.layoutKey = key;
    state.regions.replaceChildren();
    const geometry = imageGeometry(width, height, state.result.width, state.result.height, css.objectFit, css.objectPosition);
    const sidecar = node('div'); sidecar.className = 'sidecar';
    sidecar.setAttribute('role', 'region'); sidecar.setAttribute('aria-label', 'Translations beside the original image');
    positionSidecar(sidecar);
    for (const [index, region] of state.result.regions.entries()) {
      const sourceLabel = String(index + 1);
      const box = projectBox(region.box, geometry);
      const rendering = region.rendering;
      const safe = isSafeRendering(rendering, region) ? projectBox(rendering.safeBox, geometry) : null;
      // object-fit:cover 裁掉安全框的一部分时，禁止擦除剩下的原文。
      const complete = safe && Math.abs(safe.width - rendering.safeBox.width * geometry.scaleX) < .01 && Math.abs(safe.height - rendering.safeBox.height * geometry.scaleY) < .01;
      const fit = complete ? fitTranslation(region.translation, {width: safe.width, height: safe.height, measure}) : {mode: 'side-panel'};
      const text = button(region.translation, () => openPanel(state)); text.className = 'region';
      text.title = `Source ${region.id}: ${region.text}. Open full translation and source text`;
      text.setAttribute('aria-label', `Source ${sourceLabel}: ${region.translation}. Open full text and corrections.`);
      if (fit.mode === 'overlay') {
        text.textContent = fit.lines.join('\n');
        const color = rendering.color, brightness = color[0] * .299 + color[1] * .587 + color[2] * .114;
        Object.assign(text.style, {left: `${safe.x}px`, top: `${safe.y}px`, width: `${safe.width}px`, height: `${safe.height}px`, background: `rgb(${color.join(',')})`, color: brightness >= 128 ? '#111' : '#fff', fontSize: `${fit.fontSize}px`, lineHeight: `${fit.lineHeight}`, padding: `${fit.padding}px`, textAlign: 'center'});
        state.regions.append(text);
      } else {
        if (box) {
          const indicator = node('div'); indicator.className = 'source-indicator'; indicator.setAttribute('aria-hidden', 'true'); indicator.setAttribute('data-source-id', region.id); indicator.setAttribute('data-source-label', sourceLabel);
          Object.assign(indicator.style, {left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px`});
          state.regions.append(indicator);
        }
        text.setAttribute('data-source-id', region.id); text.setAttribute('data-source-label', sourceLabel);
        sidecar.append(text);
      }
    }
    state.sidecar = sidecar;
    if (sidecar.children.length) { state.regions.append(sidecar); sidecar.scrollTop = scrollTop; }
  }

  function scan() {
    frame = 0;
    if (!enabled) return;
    if (pageUrl !== win.location.href) {
      // 导航（包括 SPA 路由变化）后需要用户重新启用。
      disable(); return;
    }
    for (const state of states.values()) {
      if (!isEligibleImage(state.image)) { dispose(state); continue; }
      if (source(state.image) !== state.imageUrl) reset(state);
    }
    for (const image of doc.images) {
      if (states.size >= MAX_IMAGES) break;
      if (!states.has(image) && isEligibleImage(image)) add(image);
    }
    if (doc.hidden) return;
    let pending = [...states.values()].filter(state => state.requestId).length;
    for (const state of states.values()) {
      layout(state);
      if (!paused && auto && pending < MAX_PENDING && !state.attempted && visible(state.image)) { pending++; translate(state, undefined, 'visible'); }
    }
    const candidates = [...states.values()].map(state => ({id: state, priority: imagePriority(state.image.getBoundingClientRect(), {width: win.innerWidth, height: win.innerHeight}), pending: !!state.requestId, translated: !!state.result, prepared: state.prepared, prepareAttempted: state.prepareAttempted, translateAttempted: state.attempted}));
    for (const job of selectPreparationJobs(candidates, {settings: options, localUsed, remoteUsed, pending, paused, hidden: !!doc.hidden})) {
      if (job.kind === 'prepare') { localUsed++; prepare(job.id); }
      else { remoteUsed++; translate(job.id, undefined, 'prefetch'); }
    }
  }
  function schedule() { if (enabled && !frame) frame = win.requestAnimationFrame(scan); }
  const resize = new win.ResizeObserver(schedule);
  const mutations = new win.MutationObserver(records => {
    if (records.some(record => !record.target.closest?.('[data-mlt-reader]'))) schedule();
  });
  function enable(automatic = false, settings = {}) {
    const nextOptions = preparationSettings(settings);
    if (enabled) for (const state of states.values()) {
      cancel(state, '设置已更新。');
      if (options.detectorMode !== nextOptions.detectorMode) reset(state);
      if (!state.result) state.attempted = false;
      if (!state.prepared) state.prepareAttempted = false;
    }
    options = nextOptions; localUsed = 0; remoteUsed = 0; paused = false;
    enabled = true; auto = automatic === true; pageUrl = win.location.href;
    mutations.observe(doc.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'sizes', 'style', 'class', 'width', 'height']});
    schedule();
  }
  function disable() {
    enabled = false; auto = false; mutations.disconnect();
    for (const state of [...states.values()]) dispose(state);
    resize.disconnect(); if (frame) win.cancelAnimationFrame(frame); frame = 0;
  }
  function onMessage(message, _sender, reply) {
    if (message?.type === 'MLT_ENABLE') { try { enable(message.auto, message.settings); reply?.({ok: true}); } catch (error) { reply?.({ok: false, error: {message: error.message}}); } }
    else if (message?.type === 'MLT_DISABLE') { disable(); reply?.({ok: true}); }
    else if (message?.type === 'MLT_PAUSE') { paused = true; auto = false; for (const state of states.values()) { if (message.reset === true) reset(state); else if (message.invalidate === true) invalidate(state); cancel(state, '已暂停。已发送的远端请求仍可能计费。'); } reply?.({ok: true}); }
  }
  runtime.onMessage.addListener(onMessage);
  win.addEventListener('scroll', schedule, {passive: true, capture: true});
  win.addEventListener('resize', schedule);
  win.addEventListener('pagehide', disable);
  win.addEventListener('popstate', schedule);
  win.addEventListener('hashchange', schedule);
  function visibilityChanged() {
    if (doc.hidden && enabled) { paused = true; auto = false; send({type: 'MLT_PAUSE_PAGE'}).catch(() => {}); for (const state of states.values()) if (state.requestId) cancel(state, '页面已隐藏，处理已取消；请重新启用。远端请求仍可能计费。'); }
    else schedule();
  }
  doc.addEventListener('visibilitychange', visibilityChanged);
  doc.addEventListener('load', schedule, true);
  // currentSrc 可能在 DOM 未变动时改变；history.pushState 也不会发出导航事件。
  const interval = win.setInterval(schedule, 1000);
  return {enable, disable, destroy() {
    disable(); win.clearInterval(interval); runtime.onMessage.removeListener(onMessage);
    win.removeEventListener('pagehide', disable); win.removeEventListener('scroll', schedule, true); win.removeEventListener('resize', schedule);
    win.removeEventListener('popstate', schedule); win.removeEventListener('hashchange', schedule);
    doc.removeEventListener('load', schedule, true); doc.removeEventListener('visibilitychange', visibilityChanged);
  }};
}
