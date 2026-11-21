/* Local benchmark only. Differential inter-thread food transport; no physics. */
"use strict";
const threads = require("node:worker_threads");
class FoodTransfer {
  constructor() { this.rooms = new Map(); }
  pack(job) {
    const transfers = [];
    const rooms = job.rooms.map(room => ({ ...room, states: room.states.map(group => {
      const snapshot = group.snapshot, rows = snapshot.ether || [];
      const old = this.rooms.get(room.id) || new Map(), next = new Map();
      const refs = new Int32Array(rows.length), xy = new Float64Array(rows.length * 2), fresh = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i], keys = Object.keys(row), prior = old.get(row.id);
        let equal = !!prior && keys.length === prior.keys.length;
        for (let k = 0; equal && k < keys.length; k++) {
          const key = keys[k], value = row[key];
          if (key !== prior.keys[k]) equal = false;
          else if (key !== "x" && key !== "y") {
            equal = Object.is(value, prior.values[k]);
            if (value && typeof value === "object") equal &&= Object.isFrozen(value) &&
              Object.values(value).every(v => v === null || typeof v !== "object");
          }
        }
        refs[i] = equal ? prior.index : -fresh.push(row);
        xy[i * 2] = row.x; xy[i * 2 + 1] = row.y;
        next.set(row.id, { keys: equal ? prior.keys : keys,
          values: equal ? prior.values : keys.map(k => row[k]), index: i });
      }
      this.rooms.set(room.id, next);
      transfers.push(refs.buffer, xy.buffer);
      return { ...group, snapshot: { ...snapshot, ether: { refs, xy, fresh } } };
    }) }));
    for (const room of job.rooms) if (!room.peers.length) this.rooms.delete(room.id);
    return [{ ...job, foodTransfer: true, rooms }, transfers];
  }
  unpack(job) {
    if (!job.foodTransfer) return job;
    delete job.foodTransfer;
    for (const room of job.rooms) {
      for (const group of room.states) {
        const { refs, xy, fresh } = group.snapshot.ether, old = this.rooms.get(room.id) || [];
        const rows = Array.from(refs, (ref, i) => {
          if (ref < 0) return fresh[-ref - 1];
          const prior = old[ref], x = xy[i * 2], y = xy[i * 2 + 1];
          return Object.is(prior.x, x) && Object.is(prior.y, y) ? prior : { ...prior, x, y };
        });
        group.snapshot.ether = rows; this.rooms.set(room.id, rows);
      }
      if (!room.peers.length) this.rooms.delete(room.id);
    }
    return job;
  }
}
if (process.env.LOAD_FOOD_TRANSFER === "1") {
  if (threads.isMainThread) {
    const send = threads.Worker.prototype.postMessage, encoders = new WeakMap();
    threads.Worker.prototype.postMessage = function(job, transfers) {
      if (!job.rooms || !job.id) return send.call(this, job, transfers);
      if (!encoders.has(this)) encoders.set(this, new FoodTransfer());
      return send.call(this, ...encoders.get(this).pack(job));
    };
  } else if (threads.parentPort) {
    const on = threads.parentPort.on, decoder = new FoodTransfer();
    threads.parentPort.on = function(name, listener) {
      return name === "message" ? on.call(this, name, job => listener(decoder.unpack(job))) : on.call(this, name, listener);
    };
  }
}
module.exports = { FoodTransfer };
