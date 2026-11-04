// 当前文档内的有界调度；不抓取链接、不触发懒加载、不跨页面发现。
export const MAX_IMAGES = 80;
export const MAX_PENDING = 2;
export const MAX_PREPARES = 20;
export function preparationSettings(input = {}) {
  const integer = (value, fallback, min, max) => value === undefined ? fallback : Number.isInteger(value) && value >= min && value <= max ? value : (() => { throw new Error('提前处理预算必须为范围内的整数。'); })();
  for (const key of ['prepareEnabled', 'remotePrefetchEnabled']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('提前处理开关必须为布尔值。');
  const settings = {prepareEnabled: input.prepareEnabled === true, prepareBudget: integer(input.prepareBudget, 8, 1, MAX_PREPARES), remotePrefetchEnabled: input.remotePrefetchEnabled === true, remotePrefetchBudget: integer(input.remotePrefetchBudget, 0, 0, MAX_PREPARES), detectorMode: input.detectorMode ?? 'regions'};
  if (!['regions', 'whole-image'].includes(settings.detectorMode)) throw new Error('区域选择模式无效。');
  if (settings.remotePrefetchEnabled && settings.remotePrefetchBudget < 1) throw new Error('请为远端预取明确填写 1–20 张的预算。');
  return settings;
}
export function imagePriority(rect, viewport) {
  if (rect.width <= 0 || rect.height <= 0) return 3;
  if (rect.bottom > 0 && rect.right > 0 && rect.top < viewport.height && rect.left < viewport.width) return 0;
  if (rect.bottom > -viewport.height && rect.top < viewport.height * 2 && rect.right > -viewport.width && rect.left < viewport.width * 2) return 1;
  return 2;
}
// 只返回当前可启动项，不保留无限等待队列；每次滚动重新排序。
export function selectPreparationJobs(candidates, {settings, localUsed = 0, remoteUsed = 0, pending = 0, paused = false, hidden = false}) {
  if (paused || hidden || pending >= MAX_PENDING) return [];
  const jobs = [];
  let localLeft = Math.max(0, settings.prepareBudget - localUsed), remoteLeft = Math.max(0, settings.remotePrefetchBudget - remoteUsed);
  const ordered = candidates.slice(0, MAX_IMAGES).map((item, index) => ({...item, index})).sort((a, b) => a.priority - b.priority || a.index - b.index);
  for (const item of ordered) {
    if (jobs.length >= MAX_PENDING - pending) break;
    if (item.pending || item.translated || item.priority >= 2) continue;
    if (settings.prepareEnabled && !item.prepared && !item.prepareAttempted && localLeft > 0) { jobs.push({id: item.id, kind: 'prepare'}); localLeft--; }
    else if (settings.remotePrefetchEnabled && !item.translateAttempted && remoteLeft > 0) { jobs.push({id: item.id, kind: 'prefetch'}); remoteLeft--; }
  }
  return jobs;
}
