/* Пространственный индекс для поиска соседних шаров. */
"use strict";

// Индекс одного снимка столкновений. Хранит только номера элементов,
// не изменяет тела и возвращает кандидатов в исходном порядке снимка.
class CircleIndex {
  constructor(bodies, cellSize = 256, centersOnly = false) {
    this.cells = new Map();
    this.wideCells = new Map();
    this.bucketPool = [];
    this.words = new Uint32Array(0);
    this.wordEpoch = new Uint32Array(0);
    this.reset(bodies, cellSize, centersOnly);
  }

  // Only the simulation's private synchronous food index uses reset. Public
  // query results stay independent arrays; published world snapshots never
  // contain this scratch index. Retain a bounded number of empty buckets.
  reset(bodies, cellSize = this.cellSize, centersOnly = this.centersOnly) {
    if (!Number.isFinite(cellSize) || cellSize <= 0)
      throw new RangeError("Invalid spatial cell size");
    const recycle = bucket => {
      bucket.length = 0; bucket.visited = 0;
      if (this.bucketPool.length < 4096) this.bucketPool.push(bucket);
    };
    for (const bucket of this.cells.values()) recycle(bucket);
    for (const column of this.wideCells.values()) for (const bucket of column.values()) recycle(bucket);
    this.cells.clear();
    this.wideCells.clear();
    this.bodies = bodies;
    this.cellSize = cellSize;
    this.centersOnly = centersOnly;
    const words = Math.ceil(bodies.length / 32);
    if (this.words.length < words || this.words.length > Math.max(256, words * 4)) {
      this.words = new Uint32Array(words);
      this.wordEpoch = new Uint32Array(words);
    } else this.wordEpoch.fill(0);
    this.querySerial = 0;
    // One synchronous visitor per index, instead of a closure per body.
    let index = 0;
    const insert = (x, y) => {
        let bucket;
        if (x >= -32768 && x <= 32767 && y >= -32768 && y <= 32767) {
          const key = (x << 16) | (y & 65535);
          bucket = this.cells.get(key);
          if (!bucket) this.cells.set(key, (bucket = this.bucketPool.pop() || []));
        } else {
          // Keep arbitrary valid coordinates exact. Bit-packing coordinates
          // outside the signed 16-bit range would alias distant cells.
          let column = this.wideCells.get(x);
          if (!column) this.wideCells.set(x, (column = new Map()));
          bucket = column.get(y);
          if (!bucket) column.set(y, (bucket = this.bucketPool.pop() || []));
        }
        // Ordinals arrive in order. Store occupied groups of 32 as (word, mask).
        const word = index >>> 5, bit = 1 << (index & 31);
        if (bucket.length && bucket[bucket.length - 2] === word) bucket[bucket.length - 1] |= bit;
        else bucket.push(word, bit);
    };
    for (; index < bodies.length; index++) {
      const body = bodies[index];
      this.visitCells(body, insert, centersOnly ? 0 : body.radius);
    }
    return this;
  }

  visitCells(body, visit, radius = body.radius) {
    if (!Number.isFinite(body.x) || !Number.isFinite(body.y) || !Number.isFinite(body.radius) || body.radius < 0) {
      throw new RangeError("Invalid circle bounds");
    }
    const left = Math.floor((body.x - radius) / this.cellSize);
    const right = Math.floor((body.x + radius) / this.cellSize);
    const top = Math.floor((body.y - radius) / this.cellSize);
    const bottom = Math.floor((body.y + radius) / this.cellSize);
    // Повреждённые координаты не должны превращаться в бесконечный цикл.
    if (
      !Number.isSafeInteger(left) || !Number.isSafeInteger(right) ||
      !Number.isSafeInteger(top) || !Number.isSafeInteger(bottom) ||
      (right - left + 1) * (bottom - top + 1) > 4096
    ) {
      throw new RangeError("Spatial query exceeds cell budget");
    }
    for (let x = left; x <= right; x++) {
      for (let y = top; y <= bottom; y++) visit(x, y);
    }
  }

  query(body, firstOrdinal = 0) {
    return this.queryMany([body], firstOrdinal);
  }

  queryMany(bodies, firstOrdinal = 0, result = [], ordinals = false) {
    result.length = 0;
    if (++this.querySerial >= 0xffffffff) {
      this.querySerial = 1;
      this.wordEpoch.fill(0);
      for (const bucket of this.cells.values()) bucket.visited = 0;
      for (const column of this.wideCells.values())
        for (const bucket of column.values()) bucket.visited = 0;
    }
    const serial = this.querySerial;
    let first = this.words.length, last = -1;
    const visit = (x, y) => {
      const bucket = x >= -32768 && x <= 32767 && y >= -32768 && y <= 32767
        ? this.cells.get((x << 16) | (y & 65535)) : this.wideCells.get(x)?.get(y);
      if (!bucket || bucket.visited === serial) return;
      bucket.visited = serial;
      first = Math.min(first, bucket[0]);
      last = Math.max(last, bucket[bucket.length - 2]);
      for (let i = 0; i < bucket.length; i += 2) {
        const word = bucket[i];
        if (this.wordEpoch[word] === serial) this.words[word] |= bucket[i + 1];
        else {
          this.wordEpoch[word] = serial;
          this.words[word] = bucket[i + 1];
        }
      }
    };
    for (const body of bodies) this.visitCells(body, visit);
    // Порядок разрешения поглощений совпадает с полным перебором,
    // в том числе когда несколько частей претендуют на одну жертву.
    const firstWord = firstOrdinal >>> 5;
    for (let word = Math.max(first, firstWord); word <= last; word++) {
      if (this.wordEpoch[word] !== serial) continue;
      let mask = this.words[word];
      if (word === firstWord) mask &= 0xffffffff << (firstOrdinal & 31);
      for (; mask; mask &= mask - 1) {
        const bit = 31 - Math.clz32(mask & -mask);
        const ordinal = word * 32 + bit;
        result.push(ordinals ? ordinal : this.bodies[ordinal]);
      }
    }
    return result;
  }

  queryOrdinals(bodies, result = []) {
    return this.queryMany(bodies, 0, result, true);
  }
}

module.exports = { CircleIndex };
