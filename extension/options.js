import { validateTranslationSettings, validateLocalOcrSettings, LOCAL_OCR_ORIGIN_PERMISSION } from './security.js';

const el = id => document.getElementById(id);
let busy = true;

function setBusy(value) {
  busy = value;
  el('local-fields').disabled = value;
  el('remote-fields').disabled = value;
  el('forget').disabled = value;
}

function localModeText() {
  const managed = el('local-mode').value === 'managed';
  el('manual-local-fields').hidden = managed;
  for (const id of ['local-endpoint', 'local-token']) { el(id).disabled = managed; el(id).required = !managed; }
  el('local-mode-note').textContent = managed
    ? '须先按安装指南注册 Native Messaging 宿主。保存只记住模式与图片授权，不启动或下载；点击启用或下载模型时才启动。关闭最后一个普通窗口、忘记设置或撤销权限会停止服务。'
    : '手动服务不会被扩展关闭。请自行启动服务并填写地址和本次会话令牌。';
}
el('local-mode').onchange = () => { el('local-token').value = ''; el('local-consent').checked = false; localModeText(); };

function providerText() {
  const deepseek = el('provider').value === 'deepseek';
  const name = deepseek ? 'DeepSeek' : 'OpenAI';
  el('provider-endpoint').textContent = `固定地址：${deepseek ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/chat/completions'}`;
  el('remote-consent-label').textContent = `我允许在翻译或启用自动翻译时向 ${name} 发送上述文本，并了解可能产生 API 费用。`;
  el('model-note').textContent = deepseek
    ? '默认使用 DeepSeek V4.1 Flash，实际 API 模型名为 deepseek-flash。使用 JSON Object 输出并在本地校验全部区域 ID；项目未进行真实付费 API 验证。'
    : '请输入支持 Chat Completions 严格 JSON Schema 的 OpenAI 模型 ID。项目未进行真实付费 API 验证。';
}

el('provider').onchange = () => {
  el('model').value = el('provider').value === 'deepseek' ? 'deepseek-flash' : '';
  // 切换接收方后必须重新输入密钥并明确授权，不把旧提供方密钥发送给新提供方。
  el('key').value = '';
  el('consent').checked = false;
  providerText();
};

async function saveSettings(event, local) {
  event.preventDefault();
  if (busy) return;
  const status = el(local ? 'local-status' : 'status');
  setBusy(true);
  try {
    const settings = local ? validateLocalOcrSettings({
      localOcr: { mode: el('local-mode').value || 'manual', endpoint: el('local-endpoint').value.trim(), token: el('local-token').value, enabled: true, consent: el('local-consent').checked },
      readingDirection: el('reading-direction').value,
    }) : validateTranslationSettings({
      provider: el('provider').value, apiKey: el('key').value, model: el('model').value.trim(),
      targetLanguage: el('target').value.trim(), context: el('context').value, glossary: el('glossary').value, consent: el('consent').checked,
    });
    // 权限请求必须保持在点击事件的同步路径中，不先等待消息或状态加载。
    const granted = await chrome.permissions.request({ origins: [local ? LOCAL_OCR_ORIGIN_PERMISSION : `${new URL(settings.endpoint).origin}/*`], ...(local && settings.localOcr.mode === 'managed' ? {permissions: ['nativeMessaging']} : {}) });
    if (!granted) throw new Error('未授予连接权限，设置未保存。');
    const result = await chrome.runtime.sendMessage({ type: local ? 'MLT_UI_LOCAL_CONFIGURE' : 'MLT_UI_CONFIGURE', settings });
    if (!result?.ok) throw new Error(result?.error?.message || '设置未保存，请检查配置后重试。');
    el(local ? 'local-token' : 'key').value = '';
    status.textContent = local
      ? settings.localOcr.mode === 'managed' ? '本机 OCR 已配置为自动管理。点击启用或准备模型时启动；关闭最后一个普通窗口时停止。启动方式和本机图片授权已记住。' : '本机 OCR 已配置。请在弹窗检查服务状态并准备模型；无需远程翻译密钥即可准备图片。'
      : 'Configured for this browser session. 请通过弹窗启用页面。';
  } catch (error) { status.textContent = error.message; }
  finally { setBusy(false); }
}

el('local-settings-form').onsubmit = event => saveSettings(event, true);
el('settings-form').onsubmit = event => saveSettings(event, false);
el('forget').onclick = async () => {
  if (busy) return;
  setBusy(true);
  try {
    const result = await chrome.runtime.sendMessage({ type: 'MLT_UI_FORGET' });
    if (!result?.ok) throw new Error('会话未清除，请重试。');
    el('key').value = '';
    el('local-token').value = '';
    el('context').value = '';
    el('glossary').value = '';
    el('consent').checked = false;
    el('local-consent').checked = false;
    el('local-status').textContent = '本机 OCR 配置与已记住的自动管理授权已清除；扩展启动的服务已停止。';
    el('status').textContent = 'Session cleared. 两类密钥和阅读缓存已清除。';
  } catch (error) { el('status').textContent = error.message; }
  finally { setBusy(false); }
};

async function initialize() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'MLT_UI_STATUS' });
    if (!result?.ok) throw new Error('无法读取会话状态。你仍可填写并保存新配置。');
    if (result.provider === 'openai' || result.provider === 'deepseek') el('provider').value = result.provider;
    el('model').value = result.model || (el('provider').value === 'deepseek' ? 'deepseek-flash' : '');
    el('target').value = result.targetLanguage || 'Simplified Chinese';
    el('context').value = typeof result.context === 'string' ? result.context : '';
    el('glossary').value = typeof result.glossary === 'string' ? result.glossary : '';
    el('local-mode').value = result.localOcr?.mode === 'managed' ? 'managed' : 'manual';
    if (result.localOcr?.endpoint) el('local-endpoint').value = result.localOcr.endpoint;
    if (['ltr', 'rtl'].includes(result.readingDirection)) el('reading-direction').value = result.readingDirection;
    if (result.configured) el('status').textContent = '本次会话已有远程翻译配置。修改时请重新输入密钥并确认授权。';
    if (result.localConfigured) el('local-status').textContent = result.localOcr?.mode === 'managed' ? '已记住自动管理模式。服务只在点击启用或准备模型时启动；修改时请重新确认本机图片授权。' : '本次会话已有本机 OCR 配置。修改时请重新输入本机令牌并确认授权。';
  } catch (error) { el('status').textContent = error.message; }
  finally { providerText(); localModeText(); setBusy(false); }
}
void initialize();
