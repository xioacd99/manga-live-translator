import {preparationSettings} from './content/scheduler.js';
const el = id => document.getElementById(id);
const status = el('status');
let tab, configured = false, localConfigured = false, provider='deepseek', localMode='manual', initialized=false, enabling=false;
let model = {phase: 'checking', loaded: 0, total: null}, pollingTimer, closed = false, polling = false;
const modelBusy = new Set(['checking', 'downloading', 'verifying', 'loading', 'cancelling']);
el('enable').disabled = true;
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error?.message || '操作失败。');
  return response;
}
async function run(fn) { try { status.textContent = '处理中…'; await fn(); } catch (error) { status.textContent = error.message; } }
// 只显示后台验证后的状态；已接收字节并不等于模型可用。
function renderModel(next) {
  model = next && typeof next === 'object' ? next : {phase: 'error', error: '模型状态无效，请重试。'};
  const names = {stopped: '本机服务已停止，点击启用时自动启动；首次使用可点击下载并准备模型', idle: '尚未下载模型', checking: '正在检查本地模型', downloading: '正在下载模型', verifying: '正在校验模型完整性', loading: '正在加载本地模型', ready: '权重已校验就绪（首次推理仍需加载）', error: '模型准备失败', cancelled: '模型准备已取消', cancelling: '正在取消模型准备'};
  const phase = Object.hasOwn(names, model.phase) ? model.phase : 'error';
  const loaded = Number.isSafeInteger(model.loaded) && model.loaded >= 0 ? model.loaded : 0;
  const total = Number.isSafeInteger(model.total) && model.total > 0 ? model.total : null;
  const bytes = total === null ? `${loaded.toLocaleString('zh-CN')} 字节，大小未知` : `${loaded.toLocaleString('zh-CN')} / ${total.toLocaleString('zh-CN')} 字节（${Math.min(100, Math.floor(loaded / total * 100))}%）`;
  el('modelStatus').textContent = `${names[phase]}${phase === 'downloading' ? `：${bytes}` : ''}${phase === 'error' ? `：${String(model.error || '请重试或使用整图 OCR。').slice(0, 200)}` : ''}${phase === 'ready' ? '，可启用当前页面。' : ''}`;
  const progress = el('modelProgress');
  progress.hidden = !modelBusy.has(phase);
  if (phase === 'downloading' && total !== null) { progress.max = total; progress.value = Math.min(loaded, total); }
  else progress.removeAttribute('value');
  el('modelDownload').disabled = !initialized || !localConfigured || modelBusy.has(phase);
  el('modelDownload').textContent = ['error', 'cancelled'].includes(phase) ? '重试下载并准备模型' : phase === 'ready' ? '重新检查模型' : '下载并准备模型';
  el('modelCancel').disabled = !initialized || !localConfigured || !modelBusy.has(phase) || phase === 'cancelling';
}
async function pollModel() {
  if (closed || polling) return;
  polling = true;
  let timeout;
  try {
    const response = await Promise.race([send({type: 'MLT_UI_MODEL_STATUS'}), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('读取模型状态超时，请重试。')), 10000); })]);
    if (!closed) renderModel(response.model);
  } catch (error) { if (!closed) renderModel({phase: 'error', error: error.message}); }
  finally {
    clearTimeout(timeout); polling = false;
    if (!closed) pollingTimer = setTimeout(pollModel, 1000);
  }
}
window.addEventListener('pagehide', () => { closed = true; clearTimeout(pollingTimer); }, {once: true});
el('modelDownload').onclick = () => run(async () => {
  // 首次下载权限必须在用户点击链内请求，不能先等待状态读取。
  if (!await chrome.permissions.request({origins: ['http://127.0.0.1/*'], ...(localMode === 'managed' ? {permissions: ['nativeMessaging']} : {})})) throw new Error('未授予 Python 环回服务权限，未开始下载。');
  renderModel({phase: 'checking', loaded: 0, total: null});
  try {
    const response = await send({type: 'MLT_UI_MODEL_DOWNLOAD'});
    if (response.model) renderModel(response.model);
    status.textContent = '模型准备已开始，请查看下载进度。就绪后再启用当前页面。';
  } catch (error) { renderModel({phase: 'error', error: error.message}); throw error; }
});
el('modelCancel').onclick = () => run(async () => {
  const response = await send({type: 'MLT_UI_MODEL_CANCEL'});
  renderModel(response.model || {phase: 'cancelled', loaded: model.loaded, total: model.total});
  status.textContent = '已请求取消模型准备，可重试。';
});
void pollModel();
const ready = Promise.all([chrome.tabs.query({active: true, currentWindow: true}), send({type: 'MLT_UI_STATUS'})]).then(([tabs, response]) => {
  tab = tabs[0]; configured = response.configured;localConfigured=response.localConfigured;provider=response.provider||'deepseek';localMode=response.localOcr?.mode||'manual';initialized=true;renderModel(model);
  el('config').textContent = configured ? `模型：${response.model}；目标语言：${response.targetLanguage}` : '尚未配置翻译服务，可独立启用本地准备。';
  el('enable').disabled = !tab;
}).catch(error => { status.textContent = error.message; });
el('settings').onclick = () => chrome.runtime.openOptionsPage();
el('enable').onclick = () => run(async () => {
  if(enabling || !initialized || !tab)return;
  enabling=true;el('enable').disabled=true;
  try {
  const settings = preparationSettings({prepareEnabled: el('prepare').checked, prepareBudget: Number(el('prepareBudget').value), remotePrefetchEnabled: el('remotePrefetch').checked, remotePrefetchBudget: Number(el('remoteBudget').value), detectorMode: el('wholeImage').checked ? 'whole-image' : 'regions'});
  if(!localConfigured)throw new Error('请先在设置中选择并配置本机 OCR 启动方式。');
  if (localMode !== 'managed' && model.phase !== 'ready') throw new Error('请先点击“下载并准备模型”，待模型就绪后再启用。');
  if (!configured && (el('auto').checked || settings.remotePrefetchEnabled)) throw new Error('请先配置翻译服务；本地准备不需要 API 密钥。');
  const origin = new URL(tab.url).origin;
  const imageOrigins = el('origins').value.split(/\n/).map(value => value.trim()).filter(Boolean);
  if (imageOrigins.length > 5) throw new Error('最多允许五个额外图片来源。');
  const origins = [origin, ...imageOrigins, 'http://127.0.0.1',...(configured ? [provider==='openai'?'https://api.openai.com':'https://api.deepseek.com'] : [])].map(value => `${new URL(value).origin}/*`);
  // 权限请求保持在用户点击调用链中，不在前面等待初始化或其他异步操作。
  if (!await chrome.permissions.request({origins, ...(localMode === 'managed' ? {permissions: ['nativeMessaging']} : {})})) throw new Error('未授予所需来源权限。');
  await send({type: 'MLT_UI_ENABLE', tabId: tab.id, imageOrigins, auto: el('auto').checked, settings});
  status.textContent = '已启用当前页面。准备完成不等于已翻译；仅处理当前文档已加载图片，不自动翻页。每次重新启用会重置所选预算。';
  } finally {enabling=false;el('enable').disabled=!tab;}
});
el('pause').onclick = () => run(async () => { await ready; await send({type: 'MLT_UI_PAUSE', tabId: tab.id}); status.textContent = '已暂停。重新启用才恢复；已发送的远端请求仍可能计费。'; });
el('disable').onclick = () => run(async () => { await ready; await send({type: 'MLT_UI_DISABLE', tabId: tab.id}); status.textContent = '已关闭当前页面。'; });
el('clear').onclick = () => run(async () => { await send({type: 'MLT_UI_CLEAR'}); status.textContent = '阅读缓存已清空，处理已取消；请重新启用。已发送的请求仍可能计费。'; });
el('metrics').onclick = () => run(async () => { const response = await send({type: 'MLT_UI_METRICS'}); status.textContent = JSON.stringify(response.metrics, null, 2); });
