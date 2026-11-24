"use strict";

// A broad phase for one synchronous combat update. Changed players remain
// candidates in every column until the update ends; an impact can never hide
// a newly grown, split or moved body from the next projectile.
class ProjectileCandidates {
  constructor(players, boundsFor, cellSize = 512) {
    this.players = players;
    this.cellSize = cellSize;
    this.columns = new Map();
    this.order = new Map(players.map((p, i) => [p, i]));
    this.dirty = new Set();
    this.queries = new Map();
    for (const p of players) {
      if (p.dead) continue;
      const bounds = boundsFor(p);
      const first = Math.floor(bounds.left / cellSize), last = Math.floor(bounds.right / cellSize);
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last - first > 256) {
        this.dirty.add(p);
        continue;
      }
      for (let x = first; x <= last; x++) {
        let column = this.columns.get(x);
        if (!column) this.columns.set(x, column = []);
        column.push(p);
      }
    }
  }
  invalidate(player) {
    if (!this.order.has(player) || this.dirty.has(player)) return;
    this.dirty.add(player);
    this.queries.clear();
  }
  query(left, right) {
    const first = Math.floor(left / this.cellSize), last = Math.floor(right / this.cellSize);
    // Long sweeps use the original scan. No repeated candidates or query-sized
    // allocation for a projectile crossing several columns.
    if (first !== last || !Number.isSafeInteger(first)) return this.players;
    let result = this.queries.get(first);
    if (result) return result;
    const column = this.columns.get(first) || [];
    result = this.dirty.size ? column.slice() : column;
    for (const player of this.dirty) if (!column.includes(player)) result.push(player);
    if (this.dirty.size) result.sort((a, b) => this.order.get(a) - this.order.get(b));
    this.queries.set(first, result);
    return result;
  }
}
module.exports = { ProjectileCandidates };
