/* Короткий маршрут кастета снаружи физических контуров шаров. */
"use strict";
const EPS = 0.001;
function distance(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Касание разрешено только при движении наружу, внутрь контура идти нельзя.
function clearSegment(a, b, circles) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length2 = dx * dx + dy * dy;
  const minX = Math.min(a.x, b.x),
    maxX = Math.max(a.x, b.x),
    minY = Math.min(a.y, b.y),
    maxY = Math.max(a.y, b.y);
  for (const c of circles) {
    // Most of the 560 possible parts cannot touch this local route segment.
    // Reject their bounds before projection; retain the exact original test
    // for nearby contours, including tangency and outward movement.
    if (c.x + c.r < minX || c.x - c.r > maxX || c.y + c.r < minY || c.y - c.r > maxY) continue;
    if (!missesCircle(a, b, c, dx, dy, length2)) return false;
  }
  return true;
}

// The visibility graph tests thousands of segments against one immutable set of
// contours. Build bounds once, then visit only intersecting branches. Leaves
// retain the exact segment/circle test (including its tangency tolerance).
function segmentTester(circles) {
  if (circles.length < 32) return (a, b) => clearSegment(a, b, circles);
  // Pack leaves into vertical strips, then sort within each strip by height.
  // Each contour is sorted twice at most, even in a fully divided room.
  const sorted = circles.slice().sort((a,b) => a.x - b.x);
  const stripSize = 8 * Math.ceil(Math.sqrt(sorted.length / 8));
  const leaves = [];
  function bounds(items) {
    const node = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const c of items) {
      node.left = Math.min(node.left, c.x - c.r);
      node.right = Math.max(node.right, c.x + c.r);
      node.top = Math.min(node.top, c.y - c.r);
      node.bottom = Math.max(node.bottom, c.y + c.r);
    }
    return { ...node, items };
  }
  for (let i = 0; i < sorted.length; i += stripSize) {
    const strip = sorted.slice(i, i + stripSize).sort((a,b) => a.y - b.y);
    for (let j = 0; j < strip.length; j += 8) leaves.push(bounds(strip.slice(j, j + 8)));
  }
  let lastBlocker;
  return (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    if (lastBlocker && !missesCircle(a, b, lastBlocker, dx, dy, length2)) return false;
    const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
    const top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
    for (const leaf of leaves) {
      if (leaf.right < left || leaf.left > right || leaf.bottom < top || leaf.top > bottom) continue;
      for (const c of leaf.items) {
        if (c.x + c.r < left || c.x - c.r > right || c.y + c.r < top || c.y - c.r > bottom) continue;
        if (!missesCircle(a, b, c, dx, dy, length2)) {
          lastBlocker = c;
          return false;
        }
      }
    }
    return true;
  };
}

// После разделения/движения шар может накрыть точку попадания. Исправляем
// проникновение минимальным выходом на свободный контур, а не полётом сквозь шар.
function separate(point, circles, world) {
  if (circles.every((c) => distance(point, c) >= c.r - EPS)) return { ...point };
  let best = null;
  let nearby = circles;
  for (let i = 0; i < 32; i++) {
    const angle = (i * Math.PI) / 16,
      dx = Math.cos(angle),
      dy = Math.sin(angle);
    let offset = 0;
    for (let pass = 0; pass <= nearby.length; pass++) {
      let end = offset;
      for (const c of nearby) {
        const cx = c.x - point.x,
          cy = c.y - point.y;
        const along = cx * dx + cy * dy,
          cross = cx * dy - cy * dx;
        if (Math.abs(cross) >= c.r) continue;
        const half = Math.sqrt(c.r * c.r - cross * cross);
        if (along - half <= offset + EPS && along + half > offset)
          end = Math.max(end, along + half + EPS * 2);
      }
      if (end === offset) break;
      offset = end;
      if (best && offset >= best.offset) break;
    }
    if (best && offset >= best.offset) continue;
    const p = { x: point.x + dx * offset, y: point.y + dy * offset };
    if (p.x < 0 || p.y < 0 || p.x > world.width || p.y > world.height) continue;
    if ((!best || offset < best.offset) && nearby.every((c) => distance(p, c) >= c.r - EPS)) {
      // Once an exit is known, a ray only matters up to this distance. Distant
      // obstacles cannot intersect any shorter exit, including the EPS margin.
      if (!best) nearby = circles.filter(c =>
        Math.abs(c.x - point.x) <= offset + c.r + EPS &&
        Math.abs(c.y - point.y) <= offset + c.r + EPS);
      best = { ...p, offset };
    }
  }
  return best && { x: best.x, y: best.y };
}

function contact(from, target, d) {
  const t = d ? Math.max(0, (d - target.r) / d) : 0;
  return { x: from.x + (target.x - from.x) * t, y: from.y + (target.y - from.y) * t };
}
function route(start, circles, targets, world) {
  if (!targets.length) return [];
  // Test the graph's starting node before building any detours.
  for (const target of targets) {
    const d = distance(start, target);
    if (d < target.r - EPS) continue;
    const goal = contact(start, target, d);
    if (clearSegment(start, goal, circles)) return [goal];
  }
  // A strictly enclosed target has no reachable point on its circumference.
  targets = targets.filter(target => !circles.some(c => {
    const margin = c.r - target.r - EPS;
    return margin > 0 && Math.abs(c.x - target.x) <= margin && Math.abs(c.y - target.y) <= margin &&
      distance(c, target) + target.r < c.r - EPS;
  }));
  if (!targets.length) return [];
  // Keep only the sixteen nearest contours, in stable order for equal gaps.
  const local = [];
  for (const c of circles) {
    const gap = distance(start, c) - c.r;
    if (local.length === 16 && gap >= local[15].gap) continue;
    let pos = local.length;
    while (pos > 0 && gap < local[pos - 1].gap) pos--;
    local.splice(pos, 0, { c, gap });
    if (local.length > 16) local.pop();
  }
  // Every detour segment is between these nodes or ends on the line to
  // a target centre. Distant circles cannot intersect any such segment.
  let left = start.x, right = start.x, top = start.y, bottom = start.y;
  const include = (p, r) => {
    left = Math.min(left, p.x - r);
    right = Math.max(right, p.x + r);
    top = Math.min(top, p.y - r);
    bottom = Math.max(bottom, p.y + r);
  };
  const polygonRadius = (c) => c.r / Math.cos(Math.PI / 16) + 0.5;
  for (const target of targets) include(target, 0);
  for (const { c } of local) include(c, polygonRadius(c));
  const isClear = segmentTester(circles.filter((c) =>
    c.x + c.r >= left && c.x - c.r <= right && c.y + c.r >= top && c.y - c.r <= bottom
  ));
  const nodes = [{ ...start }];
  const owners = [null];
  for (const { c } of local) {
    // Описанный многоугольник: даже хорды между узлами остаются снаружи круга.
    const r = polygonRadius(c);
    const phase = Math.atan2(start.y - c.y, start.x - c.x);
    for (let i = 0; i < 16; i++) {
      const angle = phase + (i * Math.PI) / 8;
      const p = { x: c.x + Math.cos(angle) * r, y: c.y + Math.sin(angle) * r };
      if (p.x >= 0 && p.y >= 0 && p.x <= world.width && p.y <= world.height && isClear(p, p)) {
        nodes.push(p);
        owners.push(c);
      }
    }
  }
  const costs = nodes.map(() => Infinity),
    previous = [],
    visited = new Uint8Array(nodes.length);
  // Delay testing chords against the whole crowd until their destination
  // could actually be settled. A blocked lower bound is never used as a path.
  const settled = [], checked = new Uint16Array(nodes.length),
    visibleCost = costs.slice(), visibleParent = [];
  function clearEdge(from, to) {
    const a = nodes[from], b = nodes[to];
    return (!owners[from] || missesCircle(a, b, owners[from])) &&
      (owners[to] === owners[from] || missesCircle(a, b, owners[to])) && isClear(a, b);
  }
  costs[0] = 0;
  // Ограничиваем работу в плотной толпе. При отсутствии доступного маршрута — свободный отскок.
  while (settled.length < Math.min(96, nodes.length)) {
    let index = -1;
    for (let i = 0; i < nodes.length; i++)
      if (!visited[i] && (index < 0 || costs[i] < costs[index])) index = i;
    if (index < 0 || !Number.isFinite(costs[index])) break;
    if (index && checked[index] < settled.length) {
      const lowerBound = costs[index];
      if (lowerBound < visibleCost[index] && clearEdge(previous[index], index)) {
        visibleCost[index] = lowerBound;
        visibleParent[index] = previous[index];
      } else if (lowerBound < visibleCost[index]) {
        // Earlier settled predecessors have already been checked. Check the
        // new ones in settlement order to preserve equal-cost path ties.
        for (let j = checked[index]; j < settled.length; j++) {
          const fromIndex = settled[j];
          if (fromIndex === previous[index]) continue;
          const cost = costs[fromIndex] + distance(nodes[fromIndex], nodes[index]);
          if (cost < visibleCost[index] && clearEdge(fromIndex, index)) {
            visibleCost[index] = cost;
            visibleParent[index] = fromIndex;
          }
        }
      }
      checked[index] = settled.length;
      costs[index] = visibleCost[index];
      previous[index] = visibleParent[index];
      if (costs[index] > lowerBound) continue;
    }
    visited[index] = 1;
    settled.push(index);
    const from = nodes[index];
    for (const target of index === 0 ? [] : targets) {
      const d = distance(from, target);
      if (d < target.r - EPS) continue;
      const goal = contact(from, target, d);
      if (!isClear(from, goal)) continue;
      const result = [goal];
      for (let i = index; i > 0; i = previous[i]) result.unshift(nodes[i]);
      return result;
    }
    for (let i = 1; i < nodes.length; i++) {
      if (visited[i]) continue;
      const cost = costs[index] + distance(from, nodes[i]);
      if (cost < costs[i]) {
        costs[i] = cost;
        previous[i] = index;
      }
    }
  }
  return [];
}
function missesCircle(a, b, c, dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy) {
  const t = length2 ? Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / length2)) : 0;
  const ox = a.x + dx * t - c.x, oy = a.y + dy * t - c.y, radius = c.r - EPS;
  return radius <= 0 || ox * ox + oy * oy >= radius * radius;
}
module.exports = { clearSegment, segmentTester, separate, route };
