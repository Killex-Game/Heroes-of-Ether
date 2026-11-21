/* Local benchmark only: transfer exact Float64 part fields, never physics. */
"use strict";
const threads = require("node:worker_threads");
const keys = ["x", "y", "mass", "radius", "mergeVersion", "mergeMs", "burnMs"];
function pack(job) {
  const transfers = [];
  const rooms = job.rooms.map(room => ({ ...room, states: room.states.map(group => {
    const snapshot = { ...group.snapshot, players: (group.snapshot.players || []).map(player => {
      if (!player.parts || player.parts.some(p =>
        Object.keys(p).join(",") !== (p.birth ? "id,x,y,mass,radius,mergeVersion,birth,mergeMs,burnMs" :
          "id,x,y,mass,radius,mergeVersion,mergeMs,burnMs") || keys.some(k => !Number.isFinite(p[k]))))
        return player;
      const numbers = new Float64Array(player.parts.length * keys.length), ids = [], births = [];
      let index = 0;
      for (const part of player.parts) {
        ids.push(part.id);
        births.push(part.birth || null);
        for (const key of keys) numbers[index++] = part[key];
      }
      transfers.push(numbers.buffer);
      return { ...player, parts: { ids, births, numbers } };
    }) };
    return { ...group, snapshot };
  }) }));
  return [{ ...job, rooms, partTransfer: true }, transfers];
}
function unpack(job) {
  if (!job.partTransfer) return job;
  delete job.partTransfer;
  for (const room of job.rooms) for (const group of room.states)
    for (const player of group.snapshot.players || []) {
      const packed = player.parts;
      if (!packed || Array.isArray(packed)) continue;
      player.parts = packed.ids.map((id, i) => {
        const o = i * keys.length, n = packed.numbers;
        const row = { id, x: n[o], y: n[o+1], mass: n[o+2], radius: n[o+3], mergeVersion: n[o+4] };
        if (packed.births[i]) row.birth = packed.births[i];
        row.mergeMs = n[o+5]; row.burnMs = n[o+6];
        return row;
      });
    }
  return job;
}
if (process.env.LOAD_PART_TRANSFER === "1") {
  if (threads.isMainThread) {
    const send = threads.Worker.prototype.postMessage;
    threads.Worker.prototype.postMessage = function(job, transfers) {
      return job.rooms && job.id ? send.call(this, ...pack(job)) : send.call(this, job, transfers);
    };
  } else if (threads.parentPort) {
    const on = threads.parentPort.on;
    threads.parentPort.on = function(name, listener) {
      return name === "message" ? on.call(this, name, job => listener(unpack(job))) : on.call(this, name, listener);
    };
  }
}
module.exports = { pack, unpack };
