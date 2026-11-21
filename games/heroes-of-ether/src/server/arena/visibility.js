/* Replication only: physics always sees the complete room. */
"use strict";
const snapshots = new WeakMap();
const CELL = 256;
// Covers camera lag, a 250 ms viewport report interval and fast projectiles.
const MARGIN = 400;
function foodGrid(items) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < items.length; i += 5) {
    if (!Number.isFinite(items[i + 1]) || !Number.isFinite(items[i + 2]) ||
        !Number.isFinite(items[i + 3]) || !Number.isFinite(items[i + 4])) return null;
    minX = Math.min(minX, Math.floor(items[i + 1] / CELL));
    minY = Math.min(minY, Math.floor(items[i + 2] / CELL));
    maxX = Math.max(maxX, Math.floor(items[i + 3] / CELL));
    maxY = Math.max(maxY, Math.floor(items[i + 4] / CELL));
  }
  const width = maxX - minX + 1, height = maxY - minY + 1;
  if (width * height > 65536 || !Number.isSafeInteger(width * height)) return null;
  const cells = new Array(width * height);
  for (let i = 0; i < items.length; i += 5) {
    const left = Math.floor(items[i + 1] / CELL) - minX, right = Math.floor(items[i + 3] / CELL) - minX;
    const top = Math.floor(items[i + 2] / CELL) - minY, bottom = Math.floor(items[i + 4] / CELL) - minY;
    if ((right - left + 1) * (bottom - top + 1) > 4096) return null;
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++)
      (cells[y * width + x] ??= []).push(i);
  }
  return { minX, minY, width, height, cells };
}
// Nearby viewports share many quantized edges. For a large population evaluate
// each half-plane once, then intersect its bits in original snapshot order.
function halfPlane(index, field, edge, minimum) {
  const cache = index.edges[field - 1];
  if (cache.has(edge)) return cache.get(edge);
  const items = index.items;
  const words = new Uint32Array(Math.ceil(items.length / (5 * 32)));
  for (let i = field, n = 0; i < items.length; i += 5, n++) {
    if (minimum ? items[i] >= edge : items[i] <= edge) words[n >>> 5] |= 1 << (n & 31);
  }
  cache.set(edge, words);
  return words;
}
function visibleWords(index, bounds) {
  const items = index.items;
  const words = new Uint32Array(Math.ceil(items.length / (5 * 32)));
  const [left, top, right, bottom] = bounds;
  if (index.grid) {
    const { minX, minY, width, height, cells } = index.grid;
    const x1 = Math.max(0, Math.floor(left / CELL) - minX), x2 = Math.min(width - 1, Math.floor(right / CELL) - minX);
    const y1 = Math.max(0, Math.floor(top / CELL) - minY), y2 = Math.min(height - 1, Math.floor(bottom / CELL) - minY);
    // Wide cameras benefit from shared half-planes; small cameras visit only
    // nearby bins. Exact inclusive bounds and snapshot order stay unchanged.
    if ((x2 - x1 + 1) * (y2 - y1 + 1) < width * height * 0.6) {
      for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) {
        const cell = cells[y * width + x];
        if (!cell) continue;
        // An entity is indexed in every cell its bounds touch. If a whole
        // cell is inside the viewport, each of its entities necessarily
        // intersects the viewport too, including objects larger than a cell.
        // Boundary cells retain the exact inclusive intersection test below.
        const cellLeft = (x + minX) * CELL, cellTop = (y + minY) * CELL;
        if (cellLeft >= left && cellLeft + CELL <= right &&
            cellTop >= top && cellTop + CELL <= bottom) {
          for (const i of cell) {
            const ordinal = i / 5;
            words[ordinal >>> 5] |= 1 << (ordinal & 31);
          }
          continue;
        }
        for (const i of cell) if (items[i + 3] >= left && items[i + 1] <= right &&
            items[i + 4] >= top && items[i + 2] <= bottom) {
          const ordinal = i / 5;
          words[ordinal >>> 5] |= 1 << (ordinal & 31);
        }
      }
      return words;
    }
  }
  if (!index.edges) {
    for (let i = 0; i < items.length; i += 5)
      if (items[i + 3] >= left && items[i + 1] <= right &&
          items[i + 4] >= top && items[i + 2] <= bottom) {
        const ordinal = i / 5;
        words[ordinal >>> 5] |= 1 << (ordinal & 31);
      }
    return words;
  }
  const x1 = halfPlane(index, 3, left, true), x2 = halfPlane(index, 1, right, false);
  const y1 = halfPlane(index, 4, top, true), y2 = halfPlane(index, 2, bottom, false);
  for (let i = 0; i < words.length; i++) words[i] = x1[i] & x2[i] & y1[i] & y2[i];
  return words;
}
function visibleIds(index, words) {
  const ids = new Set();
  for (let i = 0; i < words.length; i++)
    for (let bits = words[i]; bits; bits &= bits - 1)
      ids.add(index.items[(i * 32 + 31 - Math.clz32(bits & -bits)) * 5]);
  return ids;
}
class CameraView {
  constructor(key, players, projectiles, hazards, food) {
    Object.assign(this, { key, players, projectiles, hazards, food });
  }
  get foodWords() { return this.food.words; }
  get ether() {
    // Wire encoding uses ordinals. Keep the public ID set lazy.
    return this.food.ids ??= visibleIds(this.food.index, this.food.words);
  }
}
function viewport(input, world) {
  if (
    !input ||
    !world ||
    ![input.x, input.y, input.width, input.height].every(Number.isFinite) ||
    input.width <= 0 ||
    input.height <= 0
  )
    return null;
  return {
    x: Math.max(0, Math.min(world.width, input.x)),
    y: Math.max(0, Math.min(world.height, input.y)),
    width: Math.min(world.width * 2, input.width),
    height: Math.min(world.height * 2, input.height),
  };
}
function select(snapshot, requested, ownId) {
  if (!requested || !snapshot.world) return null;
  const view = viewport(requested, snapshot.world);
  if (!view) return null;
  const bounds = [
    Math.max(0, Math.floor((view.x - view.width / 2 - MARGIN) / CELL) * CELL),
    Math.max(0, Math.floor((view.y - view.height / 2 - MARGIN) / CELL) * CELL),
    Math.min(snapshot.world.width, Math.ceil((view.x + view.width / 2 + MARGIN) / CELL) * CELL),
    Math.min(snapshot.world.height, Math.ceil((view.y + view.height / 2 + MARGIN) / CELL) * CELL),
  ];
  const key = bounds.join(":");
  if (
    bounds[0] === 0 &&
    bounds[1] === 0 &&
    bounds[2] === snapshot.world.width &&
    bounds[3] === snapshot.world.height
  )
    return null;
  let cache = snapshots.get(snapshot);
  if (!cache) {
    // Flat columns avoid making a copied player-part object and four iterator
    // objects for every candidate in every receiver's viewport.
    const itemsWithBounds = { players: [], ether: [], projectiles: [], hazards: [] };
    const add = (list, item, id = item.id) => {
      const r = Math.max(0, item.radius || 0);
      list.push(id, item.x - r, item.y - r, item.x + r, item.y + r);
    };
    for (const p of snapshot.players || [])
      for (const part of p.parts?.length ? p.parts : [p]) add(itemsWithBounds.players, part, p.id);
    for (const kind of ["ether", "projectiles", "hazards"])
      for (const item of snapshot[kind] || []) add(itemsWithBounds[kind], item);
    const indexes = Object.fromEntries(Object.entries(itemsWithBounds).map(([kind, items]) =>
      [kind, { items, grid: kind === "ether" && items.length >= 256 * 5 ? foodGrid(items) : null,
        edges: items.length >= 256 * 5 ? [new Map(), new Map(), new Map(), new Map()] : null }]));
    cache = { indexes, views: new Map() };
    snapshots.set(snapshot, cache);
  }
  const ownView = (view) =>
    view.players.has(ownId)
      ? view
      : new CameraView(key + ":" + ownId, new Set([...view.players, ownId]),
          view.projectiles, view.hazards, view.food);
  if (cache.views.has(key)) return ownView(cache.views.get(key));
  const { players, projectiles, hazards, ether } = cache.indexes;
  const ids = index => visibleIds(index, visibleWords(index, bounds));
  const result = new CameraView(key, ids(players), ids(projectiles), ids(hazards),
    { index: ether, words: visibleWords(ether, bounds) });
  // All own split parts, including ones outside the camera, are authoritative.
  cache.views.set(key, result);
  return ownView(result);
}
module.exports = { viewport, select, MARGIN };
