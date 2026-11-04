import { hashKey } from './keys.js';
import { validateRegions, LIMITS } from './schema.js';

export const GROUPING_REVISION = 'bubble-containment-v1';
export const READING_ORDER_REVISION = 'recursive-xy-cut-overlap-rows-v1';
const area = box => box.width * box.height;
const right = box => box.x + box.width;
const bottom = box => box.y + box.height;
const compareId = (a, b) => a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0;
const union = boxes => {
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(right)) - x, height: Math.max(...boxes.map(bottom)) - y };
};
const contains = (outer, inner) => outer.x <= inner.x && outer.y <= inner.y && right(outer) >= right(inner) && bottom(outer) >= bottom(inner);
const intersection = (a, b) => Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x)) * Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y));

export function normalizeGroupingConfig(value) {
  if (value === undefined || value === null) return null;
  if (Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(k => !['enabled', 'readingDirection'].includes(k)) ||
      (value.enabled !== undefined && typeof value.enabled !== 'boolean') ||
      (value.readingDirection !== undefined && !['ltr', 'rtl'].includes(value.readingDirection))) throw new TypeError('Invalid grouping configuration');
  return { enabled: value.enabled !== false, readingDirection: value.readingDirection ?? 'ltr', revision: GROUPING_REVISION, readingOrderRevision: READING_ORDER_REVISION };
}

/** 使用共同重叠区间，避免连锁相交把整页串成同一行。 */
function overlapRows(items, direction) {
  const rows = [];
  const sorted = [...items].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x || compareId(a, b));
  for (const item of sorted) {
    const row = rows.find(row => Math.min(row.end, bottom(item.bbox)) > Math.max(row.start, item.bbox.y));
    if (row) { row.items.push(item); row.start = Math.max(row.start, item.bbox.y); row.end = Math.min(row.end, bottom(item.bbox)); }
    else rows.push({ start: item.bbox.y, end: bottom(item.bbox), items: [item] });
  }
  return rows.map(row => row.items.sort((a, b) => (direction === 'rtl' ? right(b.bbox) - right(a.bbox) : a.bbox.x - b.bbox.x) || a.bbox.y - b.bbox.y || compareId(a, b)));
}

/** 几何分区不是检测到的分镜；只输出可解释的启发式阅读层次。 */
export function orderByGeometry(regions, { readingDirection = 'ltr' } = {}) {
  if (!['ltr', 'rtl'].includes(readingDirection)) throw new TypeError('Invalid reading direction');
  const items = validateRegions(regions);
  function visit(part) {
    if (!part.length) return { ordered: [], hierarchy: { type: 'rows', rows: [] } };
    // 先找横向空隙，再找纵向空隙；均取不穿过任何框的最大间隔。
    for (const axis of ['y', 'x']) {
      const endOf = axis === 'y' ? bottom : right;
      const sorted = [...part].sort((a, b) => a.bbox[axis] - b.bbox[axis] || compareId(a, b));
      let end = endOf(sorted[0].bbox), split = -1, largest = 0;
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].bbox[axis] - end;
        if (gap > largest) { largest = gap; split = i; }
        end = Math.max(end, endOf(sorted[i].bbox));
      }
      if (split > 0) {
        const parts = [sorted.slice(0, split), sorted.slice(split)];
        if (axis === 'x' && readingDirection === 'rtl') parts.reverse();
        const children = parts.map(visit);
        return { ordered: children.flatMap(child => child.ordered), hierarchy: { type: 'split', axis, children: children.map(child => child.hierarchy) } };
      }
    }
    const rows = overlapRows(part, readingDirection);
    return { ordered: rows.flat(), hierarchy: { type: 'rows', rows: rows.map(row => row.map(item => item.regionId)) } };
  }
  const result = visit(items);
  return { regions: result.ordered.map((item, readingOrder) => ({ ...item, readingOrder })), hierarchy: result.hierarchy };
}

function ownerOf(line, bubbles) {
  const candidates = bubbles.filter(bubble => {
    const center = { x: line.bbox.x + line.bbox.width / 2, y: line.bbox.y + line.bbox.height / 2 };
    return center.x >= bubble.bbox.x && center.x <= right(bubble.bbox) && center.y >= bubble.bbox.y && center.y <= bottom(bubble.bbox) && intersection(line.bbox, bubble.bbox) / area(line.bbox) >= 0.85;
  }).sort((a, b) => area(a.bbox) - area(b.bbox) || compareId(a, b));
  if (!candidates.length) return { bubble: null, reason: 'outside-detected-bubbles' };
  const best = candidates[0];
  // 嵌套候选优先小框；非嵌套重叠框没有足够证据判断归属，保留独立文本。
  if (candidates.slice(1).some(other => !contains(other.bbox, best.bbox))) return { bubble: null, reason: 'ambiguous-bubble-membership' };
  return { bubble: best, reason: 'detected-bubble-membership' };
}

/** 整图 OCR 行先按候选气泡归属聚合。框外字幕不会被丢弃或跨区域强行合并。 */
export async function groupTextLines({ regions, detection = null, width, height, readingDirection = 'ltr' }) {
  const lines = validateRegions(regions, { width, height });
  const bubbles = validateRegions((detection?.regions ?? []).map(region => ({ ...region, sourceText: '' })), { width, height });
  const groups = new Map();
  for (const line of lines) {
    const owner = ownerOf(line, bubbles), key = owner.bubble ? `bubble:${owner.bubble.regionId}` : `line:${line.regionId}`;
    if (!groups.has(key)) groups.set(key, { ...owner, lines: [] });
    groups.get(key).lines.push(line);
  }
  const grouped = await Promise.all([...groups.values()].map(async (group, index) => {
    // 页方向只影响气泡先后；英文气泡内的水平文字仍按 LTR 行序，不翻转句子。
    const vertical = group.lines.every(line => line.direction === 'vertical');
    const lineDirection = group.lines.every(line => line.direction === 'rtl') ? 'rtl' : 'ltr';
    const ordered = vertical ? [...group.lines].sort((a, b) => right(b.bbox) - right(a.bbox) || a.bbox.y - b.bbox.y || compareId(a, b)) : overlapRows(group.lines, lineDirection).flat();
    const lineIds = ordered.map(line => line.regionId);
    const regionId = 'group_' + (await hashKey({ lineIds: [...lineIds].sort() })).slice(0, 24);
    const sourceText = ordered.map(line => line.sourceText).join('\n');
    if (sourceText.length > LIMITS.maxText) throw new TypeError('Grouped source text exceeds budget');
    const confidence = ordered.every(line => line.confidence !== undefined) ? Math.min(...ordered.map(line => line.confidence)) : undefined;
    return { regionId, bbox: union(ordered.map(line => line.bbox)), sourceText, readingOrder: index, lineIds,
      lines: ordered.map(({ regionId: lineId, bbox, sourceText, confidence, direction, polygon }) => ({ lineId, bbox, sourceText, ...(confidence === undefined ? {} : { confidence }), ...(direction === undefined ? {} : { direction }), ...(polygon === undefined ? {} : { polygon }) })),
      ...(group.bubble ? { bubbleId: group.bubble.regionId, bubbleBox: group.bubble.bbox } : {}),
      ...(confidence === undefined ? {} : { confidence }), ...(vertical ? { direction: 'vertical' } : { direction: lineDirection }),
      uncertainty: [group.reason, 'geometric-reading-order'] };
  }));
  // 气泡外框用于空隙分区，原始文本联合框仍保留为实际源坐标。
  const ordered = orderByGeometry(grouped.map(region => ({ ...region, bbox: region.bubbleBox ?? region.bbox })), { readingDirection });
  const originalBoxes = new Map(grouped.map(region => [region.regionId, region.bbox]));
  return { regions: ordered.regions.map(region => ({ ...region, bbox: originalBoxes.get(region.regionId) })), grouping: {
    revision: GROUPING_REVISION, readingOrderRevision: READING_ORDER_REVISION, readingDirection,
    hierarchy: ordered.hierarchy, inputLineCount: lines.length, groupCount: grouped.length,
  } };
}
