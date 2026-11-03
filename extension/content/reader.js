import {imageGeometry, projectBox, isEligibleImage, isCurrentRequest} from './geometry.js';

const MAX_IMAGES = 80;
const MAX_AUTO_PENDING = 2;
const CSS = `
:host { all: initial; position: fixed; display: block; z-index: 2147483646; pointer-events: none; }
* { box-sizing: border-box; }
.controls { position: absolute; left: 0; top: 0; display: flex; flex-wrap: wrap; gap: 4px; max-width: 100%; background: #172135; padding: 4px; border-radius: 6px; pointer-events: auto; color: white; font: 12px/1.4 system-ui, sans-serif; }
button { border: 1px solid #8795ac; border-radius: 4px; padding: 4px 7px; background: white; color: #172135; font: 12px/1.4 system-ui, sans-serif; cursor: pointer; }
button:focus-visible, textarea:focus-visible { outline: 3px solid #ffb433; outline-offset: 1px; }
button:disabled { opacity: .6; cursor: wait; }
.regions { position: absolute; overflow: hidden; pointer-events: none; }
.region { position: absolute; padding: 3px; border: 1px solid #64748b; border-radius: 5px; background: #fff; color: #111; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.35 system-ui, sans-serif; pointer-events: auto; cursor: pointer; }
.panel { position: absolute; left: 0; top: 42px; max-width: min(440px, 90vw); max-height: 65vh; width: 440px; overflow: auto; padding: 12px; background: #fff; color: #111; box-shadow: 0 4px 22px #0006; border: 2px solid #334155; border-radius: 8px; pointer-events: auto; font: 14px/1.5 system-ui, sans-serif; }
.panel p { white-space: pre-wrap; overflow-wrap: anywhere; }
.panel label { display: block; margin-top: 12px; }
.panel textarea { display: block; width: 100%; min-height: 65px; font: 14px/1.5 system-ui, sans-serif; }
[hidden] { display: none !important; }
`;

export function installReader({document: doc = globalThis.document, window: win = globalThis.window, runtime = globalThis.chrome.runtime} = {}) {
  const states = new Map();
  let enabled = false, auto = false, serial = 0, frame = 0;
  let pageUrl = win.location.href;
  const session = globalThis.crypto.randomUUID();
  const node = (tag, text) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
  const send = async message => runtime.sendMessage(message);
  const button = (label, callback) => { const el = node('button', label); el.type = 'button'; el.addEventListener('click', callback); return el; };
  const source = image => image.currentSrc || image.src;
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
  function reset(state) {
    cancel(state, 'Image changed. Select Translate.');
    state.sourceVersion = `${session}:${++serial}`;
    state.imageUrl = source(state.image);
    state.corrections = Object.create(null);
    state.result = null; state.renderedResult = null; state.layoutKey = null; state.attempted = false; state.original = false;
    state.regions.replaceChildren(); state.panel.hidden = true;
    state.toggle.hidden = state.details.hidden = true;
  }
  function openPanel(state) {
    if (!state.result) return;
    state.panel.replaceChildren(button('Close text panel', () => { state.panel.hidden = true; }));
    const corrections = Object.create(null);
    for (const region of state.result.regions) {
      const label = node('label', `Source ${region.id}${typeof region.confidence === 'number' && region.confidence < 0.7 ? ' · Low OCR confidence' : ''}`);
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
    // Shadow DOM isolates styles, not secrets. Open mode keeps accessibility and browser tests inspectable.
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
  async function translate(state, corrections) {
    if (!enabled || state.requestId || !isEligibleImage(state.image)) return;
    if (state.imageUrl !== source(state.image)) reset(state);
    if (corrections) Object.assign(state.corrections, corrections);
    const sourceEdits = {...state.corrections};
    state.attempted = true;
    const requestId = `${session}:request:${++serial}`;
    state.requestId = requestId; state.translate.disabled = true; state.cancel.hidden = false;
    state.status.textContent = 'Fetching → local OCR → translation…';
    const snapshot = {requestId, sourceVersion: state.sourceVersion, imageUrl: state.imageUrl, pageUrl};
    try {
      const response = await send({type: 'MLT_TRANSLATE', requestId, imageUrl: state.imageUrl, sourceVersion: state.sourceVersion, width: state.image.naturalWidth, height: state.image.naturalHeight, ...(Object.keys(sourceEdits).length ? {corrections: sourceEdits} : {})});
      if (!isCurrentRequest(snapshot, {enabled, connected: state.image.isConnected, requestId: state.requestId, sourceVersion: state.sourceVersion, imageUrl: source(state.image), pageUrl: win.location.href})) return;
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
  function layout(state) {
    const rect = state.image.getBoundingClientRect();
    state.host.hidden = !visible(state.image);
    Object.assign(state.host.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`});
    state.regions.hidden = state.original;
    if (!state.result || state.original || !rect.width || !rect.height) return;
    const css = win.getComputedStyle(state.image);
    // Rotated/skewed images cannot use axis-aligned OCR rectangles; the text panel stays available.
    if (css.transform !== 'none' && css.transform !== '') { state.regions.replaceChildren(); state.layoutKey = null; return; }
    const px = key => parseFloat(css[key]) || 0;
    const left = px('borderLeftWidth') + px('paddingLeft'), top = px('borderTopWidth') + px('paddingTop');
    const width = rect.width - left - px('borderRightWidth') - px('paddingRight');
    const height = rect.height - top - px('borderBottomWidth') - px('paddingBottom');
    Object.assign(state.regions.style, {left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`});
    const key = [width, height, left, top, css.objectFit, css.objectPosition].join('|');
    if (state.renderedResult === state.result && state.layoutKey === key) return;
    state.renderedResult = state.result; state.layoutKey = key;
    state.regions.replaceChildren();
    const geometry = imageGeometry(width, height, state.result.width, state.result.height, css.objectFit, css.objectPosition);
    for (const region of state.result.regions) {
      const box = projectBox(region.box, geometry); if (!box) continue;
      const text = button(region.translation, () => openPanel(state)); text.className = 'region';
      text.title = 'Open full translation and source text';
      text.setAttribute('aria-label', `${region.translation}. Open full text and corrections.`);
      Object.assign(text.style, {left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px`});
      state.regions.append(text);
    }
  }
  function scan() {
    frame = 0;
    if (!enabled) return;
    if (pageUrl !== win.location.href) {
      // Navigation requires a fresh user enable action, including SPA changes.
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
    let pending = [...states.values()].filter(state => state.requestId).length;
    for (const state of states.values()) {
      layout(state);
      if (auto && pending < MAX_AUTO_PENDING && !state.attempted && visible(state.image)) { pending++; translate(state); }
    }
  }
  function schedule() { if (enabled && !frame) frame = win.requestAnimationFrame(scan); }
  const resize = new win.ResizeObserver(schedule);
  const mutations = new win.MutationObserver(records => {
    if (records.some(record => !record.target.closest?.('[data-mlt-reader]'))) schedule();
  });
  function enable(automatic = false) {
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
    if (message?.type === 'MLT_ENABLE') { enable(message.auto); reply?.({ok: true}); }
    else if (message?.type === 'MLT_DISABLE') { disable(); reply?.({ok: true}); }
    else if (message?.type === 'MLT_PAUSE') { auto = false; reply?.({ok: true}); }
  }
  runtime.onMessage.addListener(onMessage);
  win.addEventListener('scroll', schedule, {passive: true, capture: true});
  win.addEventListener('resize', schedule);
  win.addEventListener('popstate', schedule);
  win.addEventListener('hashchange', schedule);
  doc.addEventListener('load', schedule, true);
  // currentSrc can change without a DOM mutation; history.pushState also emits no event.
  const interval = win.setInterval(schedule, 1000);
  return {enable, disable, destroy() {
    disable(); win.clearInterval(interval); runtime.onMessage.removeListener(onMessage);
    win.removeEventListener('scroll', schedule, true); win.removeEventListener('resize', schedule);
    win.removeEventListener('popstate', schedule); win.removeEventListener('hashchange', schedule);
    doc.removeEventListener('load', schedule, true);
  }};
}
