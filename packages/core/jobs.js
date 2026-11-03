export function abortError() { return new DOMException('Operation cancelled', 'AbortError'); }
export function throwIfAborted(signal) { if (signal?.aborted) throw abortError(); }
export class QueueFullError extends Error { constructor() { super('Work queue is full'); this.name = 'QueueFullError'; } }

/** Concurrency is occupied until an adapter actually settles, even if it ignores abort. */
export class BoundedQueue {
  constructor({ concurrency = 1, maxQueue = 16 } = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(maxQueue) || maxQueue < 0) throw new TypeError('Invalid queue limits');
    this.concurrency = concurrency; this.maxQueue = maxQueue; this.active = 0; this.pending = [];
  }
  run(work, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.active >= this.concurrency && this.pending.length >= this.maxQueue) return Promise.reject(new QueueFullError());
    return new Promise((resolve, reject) => {
      const item = { work, signal, resolve, reject, onAbort: null };
      item.onAbort = () => { const index = this.pending.indexOf(item); if (index >= 0) { this.pending.splice(index, 1); reject(abortError()); signal.removeEventListener('abort', item.onAbort); } };
      if (this.active < this.concurrency) this.start(item);
      else { this.pending.push(item); signal?.addEventListener('abort', item.onAbort, { once: true }); }
    });
  }
  start(item) {
    item.signal?.removeEventListener('abort', item.onAbort); this.active++;
    Promise.resolve().then(() => { throwIfAborted(item.signal); return item.work(); }).then(item.resolve, item.reject).finally(() => {
      this.active--; if (this.pending.length) this.start(this.pending.shift());
    });
  }
}

/** Each subscriber owns cancellation; only the last detachment aborts shared work. */
export class SingleFlight {
  constructor() { this.jobs = new Map(); }
  has(key) { return this.jobs.has(key); }
  run(key, work, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(abortError());
    let job = this.jobs.get(key);
    if (!job) {
      job = { controller: new AbortController(), subscribers: new Set(), settled: false };
      this.jobs.set(key, job);
      Promise.resolve().then(() => { throwIfAborted(job.controller.signal); return work(job.controller.signal); }).then(
        value => this.finish(key, job, true, value), error => this.finish(key, job, false, error)
      );
    }
    return new Promise((resolve, reject) => {
      const subscriber = { resolve, reject, signal, onAbort: null };
      subscriber.onAbort = () => {
        job.subscribers.delete(subscriber); signal?.removeEventListener('abort', subscriber.onAbort); reject(abortError());
        if (!job.settled && job.subscribers.size === 0) { if (this.jobs.get(key) === job) this.jobs.delete(key); job.controller.abort(); }
      };
      job.subscribers.add(subscriber); signal?.addEventListener('abort', subscriber.onAbort, { once: true });
    });
  }
  finish(key, job, succeeded, value) {
    job.settled = true; if (this.jobs.get(key) === job) this.jobs.delete(key);
    for (const subscriber of job.subscribers) {
      subscriber.signal?.removeEventListener('abort', subscriber.onAbort);
      if (!succeeded) subscriber.reject(value);
      else {
        try { subscriber.resolve(structuredClone(value)); }
        catch (error) { subscriber.reject(error); }
      }
    }
    job.subscribers.clear();
  }
}
