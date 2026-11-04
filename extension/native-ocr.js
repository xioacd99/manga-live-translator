import {LocalOcrError, validateLocalOcrSettings} from './security.js';

export const LOCAL_OCR_NATIVE_HOST = 'com.manga_live_translator.local_ocr';

// 端口归属于本次浏览器会话。保持连接使 MV3 工作线程存活，断线后只允许用户再次点击启动。
export function createNativeOcrLifecycle({runtime, onDisconnected = () => {}, startupTimeoutMs = 15000, timers = globalThis} = {}) {
  let current = null;

  function release(entry, error, notify = false, sendStop = false) {
    if (current !== entry) return;
    current = null;
    timers.clearTimeout(entry.timer);
    entry.port?.onMessage.removeListener(entry.message);
    entry.port?.onDisconnect.removeListener(entry.disconnect);
    if (!entry.credentials) entry.reject(error);
    if (sendStop) { try { entry.port?.postMessage({type: 'stop'}); } catch {} }
    try { entry.port?.disconnect(); } catch {}
    if (notify) onDisconnected();
  }

  function stop() {
    const entry = current;
    if (!entry) return;
    // 先作废状态，防止同步断线回调或迟到 ready 恢复已停止的凭据。
    const port = entry.port;
    release(entry, new DOMException('Local service stopped', 'AbortError'), false, true);
    // stop 与 EOF 都要求宿主退出；即使发送失败，仍关闭本扩展拥有的端口。
    return port !== undefined;
  }

  function start() {
    if (current) return current.promise;
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const entry = {promise, resolve, reject, credentials: null};
    current = entry;
    try {
      entry.port = runtime.connectNative(LOCAL_OCR_NATIVE_HOST);
      entry.message = value => {
        if (current !== entry) return;
        if (entry.credentials) return release(entry, new LocalOcrError('LOCAL_NATIVE_PROTOCOL'), true);
        try {
          if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'endpoint,token,type' || value.type !== 'ready') throw new Error();
          const validated = validateLocalOcrSettings({localOcr: {endpoint: value.endpoint, token: value.token, enabled: true, consent: true}});
          if (validated.localOcr.endpoint !== value.endpoint) throw new Error();
          entry.credentials = {endpoint: validated.localOcr.endpoint, token: validated.localOcr.token};
          timers.clearTimeout(entry.timer);
          resolve({...entry.credentials});
        } catch { release(entry, new LocalOcrError('LOCAL_NATIVE_PROTOCOL'), true); }
      };
      entry.disconnect = () => {
        // 读取但不透传 Chrome 原始错误，避免日志或安装路径进入页面。
        void runtime.lastError;
        release(entry, new LocalOcrError(entry.credentials ? 'LOCAL_NATIVE_DISCONNECTED' : 'LOCAL_NATIVE_UNAVAILABLE'), true);
      };
      entry.port.onMessage.addListener(entry.message);
      entry.port.onDisconnect.addListener(entry.disconnect);
      entry.timer = timers.setTimeout(() => release(entry, new LocalOcrError('LOCAL_NATIVE_TIMEOUT'), true), startupTimeoutMs);
      entry.port.postMessage({type: 'start'});
    } catch { release(entry, new LocalOcrError('LOCAL_NATIVE_UNAVAILABLE'), true); }
    return promise;
  }

  return {start, stop, get credentials() { return current?.credentials ? {...current.credentials} : null; }, get phase() { return current?.credentials ? 'running' : current ? 'starting' : 'stopped'; }};
}
