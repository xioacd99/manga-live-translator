import {preparationSettings} from './content/scheduler.js';
const el = id => document.getElementById(id);
const status = el('status');
let tab, configured = false;
el('enable').disabled = true;
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error?.message || '操作失败。');
  return response;
}
async function run(fn) { try { status.textContent = '处理中…'; await fn(); } catch (error) { status.textContent = error.message; } }
const ready = Promise.all([chrome.tabs.query({active: true, currentWindow: true}), send({type: 'MLT_UI_STATUS'})]).then(([tabs, response]) => {
  tab = tabs[0]; configured = response.configured;
  el('config').textContent = configured ? `模型：${response.model}；目标语言：${response.targetLanguage}` : '尚未配置翻译服务，可独立启用本地准备。';
  el('enable').disabled = !tab;
}).catch(error => { status.textContent = error.message; });
el('settings').onclick = () => chrome.runtime.openOptionsPage();
el('enable').onclick = () => run(async () => {
  const settings = preparationSettings({prepareEnabled: el('prepare').checked, prepareBudget: Number(el('prepareBudget').value), remotePrefetchEnabled: el('remotePrefetch').checked, remotePrefetchBudget: Number(el('remoteBudget').value), detectorMode: el('wholeImage').checked ? 'whole-image' : 'regions'});
  if (!configured && (el('auto').checked || settings.remotePrefetchEnabled)) throw new Error('请先配置翻译服务；本地准备不需要 API 密钥。');
  const origin = new URL(tab.url).origin;
  const imageOrigins = el('origins').value.split(/\n/).map(value => value.trim()).filter(Boolean);
  if (imageOrigins.length > 5) throw new Error('最多允许五个额外图片来源。');
  const origins = [origin, ...imageOrigins, ...(configured ? ['https://api.openai.com'] : [])].map(value => `${new URL(value).origin}/*`);
  // 权限请求保持在用户点击调用链中，不在前面等待初始化或其他异步操作。
  if (!await chrome.permissions.request({origins})) throw new Error('未授予所需来源权限。');
  await send({type: 'MLT_UI_ENABLE', tabId: tab.id, imageOrigins, auto: el('auto').checked, settings});
  status.textContent = '已启用当前页面。准备完成不等于已翻译；仅处理当前文档已加载图片，不自动翻页。每次重新启用会重置所选预算。';
});
el('pause').onclick = () => run(async () => { await ready; await send({type: 'MLT_UI_PAUSE', tabId: tab.id}); status.textContent = '已暂停。重新启用才恢复；已发送的远端请求仍可能计费。'; });
el('disable').onclick = () => run(async () => { await ready; await send({type: 'MLT_UI_DISABLE', tabId: tab.id}); status.textContent = '已关闭当前页面。'; });
el('clear').onclick = () => run(async () => { await send({type: 'MLT_UI_CLEAR'}); status.textContent = '阅读缓存已清空，处理已取消；请重新启用。已发送的请求仍可能计费。'; });
el('metrics').onclick = () => run(async () => { const response = await send({type: 'MLT_UI_METRICS'}); status.textContent = JSON.stringify(response.metrics, null, 2); });
