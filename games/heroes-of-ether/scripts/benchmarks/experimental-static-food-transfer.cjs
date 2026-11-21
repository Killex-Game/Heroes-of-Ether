"use strict";
// Benchmark only: compare sparse inter-thread food changes to full cloning.
const threads = require("node:worker_threads");
const { isDeepStrictEqual } = require("node:util");
const allowed = new Set(["id", "x", "y", "value", "radius", "color", "artValue", "ejected", "birth"]);
function capture(row) {
  const keys = Object.keys(row);
  if (keys.some(k => !allowed.has(k))) return null;
  for (const k of keys) if (k !== "birth" && row[k] !== null && typeof row[k] === "object") return null;
  return { keys, values: keys.map(k => k === "birth" && row[k] &&
      !(Object.isFrozen(row[k]) && Object.values(row[k]).every(v => v === null || typeof v !== "object"))
      ? structuredClone(row[k]) : row[k]) };
}
function matches(row, prior) {
  const keys = Object.keys(row);
  if (keys.length !== prior.keys.length) return false;
  for (let i=0;i<keys.length;i++) {
    const key = keys[i];
    if (key !== prior.keys[i]) return false;
    if (!Object.is(row[key], prior.values[i]) && (key !== "birth" || !isDeepStrictEqual(row[key], prior.values[i]))) return false;
  }
  return true;
}
class StaticFoodTransfer {
  constructor() { this.rooms = new Map(); }
  pack(job) {
    const transfers = [];
    const rooms = job.rooms.map(room => ({...room, states:room.states.map(group => {
      if (!Array.isArray(group.snapshot.ether)) return group;
      const old = this.rooms.get(room.id) || new Map(), next = new Map(), fresh = [];
      const refs = new Int32Array(group.snapshot.ether.length);
      for (let i=0;i<refs.length;i++) {
        const row = group.snapshot.ether[i], previous = old.get(row.id);
        let entry;
        if (previous && matches(row, previous)) {
          refs[i] = previous.index;
          entry = { keys: previous.keys, values: previous.values, index:i };
        } else {
          refs[i] = -fresh.push(row);
          const values = capture(row);
          if (values) entry = {...values, index:i};
        }
        if (entry) next.set(row.id, entry);
      }
      this.rooms.set(room.id, next);
      transfers.push(refs.buffer);
      return {...group, snapshot:{...group.snapshot,ether:{refs,fresh}}};
    })}));
    for (const room of job.rooms) if (!room.peers.length) this.rooms.delete(room.id);
    return [{...job, staticFoodTransfer:true, rooms},transfers];
  }
  unpack(job) {
    if (!job.staticFoodTransfer) return job;
    delete job.staticFoodTransfer;
    for (const room of job.rooms) {
      for (const group of room.states) {
        const data = group.snapshot.ether;
        if (!data?.refs) continue;
        const old = this.rooms.get(room.id) || [];
        const rows = Array.from(data.refs, ref => ref < 0 ? data.fresh[-ref-1] : old[ref]);
        group.snapshot.ether = rows;
        this.rooms.set(room.id, rows);
      }
      if (!room.peers.length) this.rooms.delete(room.id);
    }
    return job;
  }
}
if (process.env.LOAD_STATIC_FOOD_TRANSFER === "1") {
  if (threads.isMainThread) {
    const send=threads.Worker.prototype.postMessage, encoders=new WeakMap();
    threads.Worker.prototype.postMessage=function(job,transfers) {
      if (!job.rooms || !job.id) return send.call(this,job,transfers);
      let encoder=encoders.get(this);
      if (!encoder) encoders.set(this,encoder=new StaticFoodTransfer());
      return send.call(this,...encoder.pack(job));
    };
  } else if (threads.parentPort) {
    const on=threads.parentPort.on, decoder=new StaticFoodTransfer();
    threads.parentPort.on=function(name,listener) {
      return name==="message" ? on.call(this,name,job=>listener(decoder.unpack(job))) : on.call(this,name,listener);
    };
  }
}
module.exports={StaticFoodTransfer};
