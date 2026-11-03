// 模型地址和校验值固定在扩展中，不接受网页传入的下载地址或模型配置。
export const DETECTOR_MODEL = Object.freeze({
  revision: '16e8a622f91fabc6b5b65c96d32d1183f8843546',
  url: 'https://huggingface.co/ogkalu/comic-text-and-bubble-detector/resolve/16e8a622f91fabc6b5b65c96d32d1183f8843546/detector-v4-s_int8.onnx',
  bytes: 11120765,
  sha256: '5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79',
  cacheKey: 'comic-detector:16e8a622f91fabc6b5b65c96d32d1183f8843546:int8',
});
const DB_NAME = 'manga-local-models';
const STORE_NAME = 'completed-models';
const fail = (code, message) => Object.assign(new Error(message), { code });
const cancelled = () => fail('CANCELLED', '模型准备已取消，下次将重新下载未完成的模型。');
const checkAbort = signal => { if (signal?.aborted) throw cancelled(); };
function storageError(error) {
  if (error?.code === 'CANCELLED' || (typeof error?.code === 'string' && error.code.startsWith('MODEL_'))) return error;
  return error?.name === 'QuotaExceededError'
    ? fail('MODEL_CACHE_QUOTA', '本地存储空间不足，模型未保存。请释放空间后重试。')
    : fail('MODEL_CACHE_UNAVAILABLE', '无法读写本地模型缓存，请检查浏览器存储设置后重试。');
}
function safeProgress(callback, event) {
  // 展示回调失败不能改变下载、校验或缓存的结果。
  try { callback?.(Object.freeze({ ...event, expectedBytes: DETECTOR_MODEL.bytes })); } catch { /* 忽略展示层异常。 */ }
}

export function createModelStore({ fetchImpl = globalThis.fetch, indexedDBImpl = globalThis.indexedDB,
  cryptoImpl = globalThis.crypto, onProgress } = {}) {
  let dbPromise;
  const jobs = new Map();
  function database() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      if (!indexedDBImpl) { reject(storageError()); return; }
      let blocked = false;
      const request = indexedDBImpl.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => { db.close(); dbPromise = undefined; };
        resolve(db);
      };
      request.onerror = () => reject(storageError(request.error));
      request.onblocked = () => { blocked = true; reject(storageError()); };
    }).catch(error => { dbPromise = undefined; throw storageError(error); });
    return dbPromise;
  }
  async function transact(mode, operation, signal) {
    checkAbort(signal);
    const db = await database();
    checkAbort(signal);
    return new Promise((resolve, reject) => {
      let tx, result, settled = false;
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const finish = (error, value) => {
        if (settled) return;
        settled = true; cleanup(); error ? reject(error) : resolve(value);
      };
      const abort = () => { try { tx?.abort(); } catch { /* 事务已结束。 */ } finish(cancelled()); };
      try {
        tx = db.transaction(STORE_NAME, mode);
        tx.oncomplete = () => finish(null, result);
        tx.onerror = () => finish(storageError(tx.error));
        tx.onabort = () => finish(signal?.aborted ? cancelled() : storageError(tx.error));
        const request = operation(tx.objectStore(STORE_NAME));
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => finish(storageError(request.error));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      } catch (error) { finish(storageError(error)); }
    });
  }
  async function valid(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== DETECTOR_MODEL.bytes) return false;
    if (!cryptoImpl?.subtle) throw fail('MODEL_VERIFY_UNAVAILABLE', '浏览器无法校验模型完整性。');
    const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') === DETECTOR_MODEL.sha256;
  }
  async function run(job, downloadAllowed) {
    const signal = job.controller.signal;
    const emit = event => {
      job.latest = event;
      safeProgress(onProgress, event);
      for (const client of job.clients) safeProgress(client.onProgress, event);
    };
    emit({ phase: 'checking', loaded: 0, total: null, cached: false });
    const record = await transact('readonly', store => store.get(DETECTOR_MODEL.cacheKey), signal);
    if (record) {
      emit({ phase: 'verifying', loaded: record.bytes?.byteLength || 0, total: null, cached: true });
      const bytes = record.bytes;
      if (record.sha256 === DETECTOR_MODEL.sha256 && await valid(bytes)) {
        checkAbort(signal);
        emit({ phase: 'ready', loaded: bytes.byteLength, total: null, cached: true });
        return bytes;
      }
      checkAbort(signal);
      await transact('readwrite', store => store.delete(DETECTOR_MODEL.cacheKey), signal);
    }
    checkAbort(signal);
    if (!downloadAllowed) throw fail('MODEL_DOWNLOAD_REQUIRED', '首次使用需下载本地检测模型。');
    emit({ phase: 'downloading', loaded: 0, total: null, cached: false });
    let response;
    try {
      response = await fetchImpl(DETECTOR_MODEL.url, {
        signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow', cache: 'no-store',
      });
    } catch { checkAbort(signal); throw fail('MODEL_DOWNLOAD_FAILED', '模型下载失败，请检查网络后手动重试。'); }
    checkAbort(signal);
    // 重定向由浏览器扩展 host permissions 限制；只接收已知 HTTPS 模型存储域的响应。
    if (response.url) {
      const url = new URL(response.url);
      if (url.protocol !== 'https:' || url.username || url.password ||
          !['huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.huggingface.co', 'cas-bridge.xethub.hf.co'].includes(url.hostname)) {
        await response.body?.cancel().catch(() => {});
        throw fail('MODEL_DOWNLOAD_ORIGIN', '模型下载被重定向至未批准的来源。');
      }
    }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw fail('MODEL_DOWNLOAD_FAILED', '模型下载失败，请检查网络后手动重试。'); }
    const header = response.headers.get('content-length');
    const total = header === null ? null : /^\d+$/.test(header) ? Number(header) : NaN;
    if (total !== null && total !== DETECTOR_MODEL.bytes) {
      await response.body?.cancel().catch(() => {});
      throw fail('MODEL_SIZE_MISMATCH', '模型大小与固定版本不一致，请手动重试。');
    }
    if (!response.body?.getReader) throw fail('MODEL_DOWNLOAD_FAILED', '浏览器不支持模型流式下载。');
    emit({ phase: 'downloading', loaded: 0, total, cached: false });
    const reader = response.body.getReader();
    const bytes = new Uint8Array(DETECTOR_MODEL.bytes);
    let loaded = 0;
    const abortReader = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', abortReader, { once: true });
    try {
      while (true) {
        checkAbort(signal);
        const { done, value } = await reader.read();
        checkAbort(signal);
        if (done) break;
        if (!(value instanceof Uint8Array) || loaded + value.byteLength > bytes.byteLength) {
          throw fail('MODEL_SIZE_MISMATCH', '模型下载大小异常，未保存缓存。');
        }
        bytes.set(value, loaded); loaded += value.byteLength;
        emit({ phase: 'downloading', loaded, total, cached: false });
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      checkAbort(signal);
      if (error.code) throw error;
      throw fail('MODEL_DOWNLOAD_FAILED', '模型下载中断，下次重试将从头下载。');
    } finally { signal.removeEventListener('abort', abortReader); reader.releaseLock(); }
    if (loaded !== DETECTOR_MODEL.bytes) throw fail('MODEL_SIZE_MISMATCH', '模型下载不完整，下次重试将从头下载。');
    emit({ phase: 'verifying', loaded, total, cached: false });
    if (!await valid(bytes)) throw fail('MODEL_HASH_MISMATCH', '模型完整性校验失败，未保存缓存。请手动重试。');
    checkAbort(signal);
    // 只在完整校验成功后以单次事务保存；中断没有可复用的半成品。
    await transact('readwrite', store => store.put({ sha256: DETECTOR_MODEL.sha256, bytes }, DETECTOR_MODEL.cacheKey), signal);
    checkAbort(signal);
    emit({ phase: 'ready', loaded, total, cached: false });
    return bytes;
  }
  function get({ downloadAllowed = false, signal, onProgress: progress } = {}) {
    if (signal?.aborted) return Promise.reject(cancelled());
    // 只读启动检查不加入下载任务，避免检查动作隐式等待或启动联网。
    const key = downloadAllowed === true ? 'download' : 'cache';
    let job = jobs.get(key);
    if (!job) {
      job = { controller: new AbortController(), clients: new Set(), latest: null };
      jobs.set(key, job);
    }
    return new Promise((resolve, reject) => {
      const client = { onProgress: progress, resolve, reject, cleanup: null };
      const abort = () => {
        job.clients.delete(client); client.cleanup(); reject(cancelled());
        if (!job.clients.size) {
          job.controller.abort();
          if (jobs.get(key) === job) jobs.delete(key);
        }
      };
      client.cleanup = () => signal?.removeEventListener('abort', abort);
      job.clients.add(client);
      signal?.addEventListener('abort', abort, { once: true });
      if (job.latest) safeProgress(progress, job.latest);
      if (!job.started) {
        job.started = true;
        // 先注册调用者，再启动，确保首次状态也能展示。
        run(job, downloadAllowed === true).then(bytes => {
          if (jobs.get(key) === job) jobs.delete(key);
          for (const current of job.clients) { current.cleanup(); current.resolve(bytes.slice()); }
        }, error => {
          if (jobs.get(key) === job) jobs.delete(key);
          for (const current of job.clients) { current.cleanup(); current.reject(error); }
        }).finally(() => {
          job.clients.clear();
          if (jobs.get(key) === job) jobs.delete(key);
        });
      }
    });
  }
  return Object.freeze({
    get,
    async hasCached(options = {}) {
      try { await get({ ...options, downloadAllowed: false }); return true; }
      catch (error) { if (error.code === 'MODEL_DOWNLOAD_REQUIRED') return false; throw error; }
    },
  });
}
