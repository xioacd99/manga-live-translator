// 预算属于可信弹窗授权，不接受网页请求自行扩展；失败和中断同样消耗尝试预算。
export function preparationSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preparation settings.');
  const number = (v, fallback, min) => {
    const n = v === undefined ? fallback : v;
    if (!Number.isInteger(n) || n < min || n > 20) throw new Error('Preparation budget must be bounded.');
    return n;
  };
  const detectorMode = value.detectorMode ?? 'regions';
  if (!['regions', 'whole-image'].includes(detectorMode)) throw new Error('Unknown detector mode.');
  return {prepareEnabled:value.prepareEnabled === true, prepareBudget:number(value.prepareBudget,8,1),
    remotePrefetchEnabled:value.remotePrefetchEnabled === true, remotePrefetchBudget:number(value.remotePrefetchBudget,0,0),detectorMode};
}
export function reserveRequest(grant, message) {
  const next = structuredClone(grant);
  if (next.paused) throw new Error('Page processing is paused.');
  if (message.detectorMode !== undefined && message.detectorMode !== next.preparation.detectorMode) throw new Error('Detector setting differs from page consent.');
  if (message.type === 'MLT_PREPARE') {
    if (!next.preparation.prepareEnabled || !(next.prepareRemaining > 0)) throw new Error('Local preparation budget exhausted or disabled.');
    next.prepareRemaining--;
  } else if (message.prefetch === true || message.purpose === 'prefetch') {
    if (!next.preparation.remotePrefetchEnabled || !(next.remoteRemaining > 0)) throw new Error('Remote preparation is not authorized or exhausted.');
    next.remoteRemaining--;
  } else if (message.purpose === 'visible' && !next.auto) throw new Error('Automatic translation is not authorized.');
  else if (message.purpose !== undefined && !['manual','visible'].includes(message.purpose)) throw new Error('Unknown request purpose.');
  return next;
}
