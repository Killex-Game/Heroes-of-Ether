"use strict";
const fs = require("node:fs"), crypto = require("node:crypto");
let serial = 0, seed = 8837;
const at = Date.parse("2026-11-11T10:00:00Z");
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
crypto.randomUUID = () => `00000000-0000-4000-8000-${(++serial).toString(16).padStart(12, "0")}`;
crypto.randomBytes = n => Buffer.from(Array.from({length:n}, () => Math.floor(random()*256)));
crypto.randomInt = (a,b) => b === undefined ? Math.floor(random()*a) : a+Math.floor(random()*(b-a));
Date.now = () => at; Math.random = random;
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { createProfileBatch, sealProfileBatch } = require("../../src/server/profiles/profile-batch");
const store = new ProfileStore({now:() => at}), tokens = [];
for (let i=0;i<40;i++) {
  const auth = store.open(); tokens.push(auth.token);
  store.find(auth.token).inventory.rocket = 200;
}
function freeze(o) { if (!o || typeof o !== "object" || Object.isFrozen(o)) return;
  Object.freeze(o); for(const v of Object.values(o)) freeze(v); }
const hashes = [], errors = [];
for (let round=0;round<20;round++) {
  freeze(store.data);
  const before = JSON.stringify(store.data), base = store.data;
  const batch = process.env.PLAIN_PROFILE_BATCH === "1" ? {next:base} : createProfileBatch(base);
  for(let i=0;i<32;i++) {
    const request = `operation-${round}-${i}`.padEnd(18,"x");
    const use = () => store.consume(tokens[i], "rocket", request, "rocket", () => {
      if (i === 13 && round%3 === 0) throw Error("Invalid target");
      return {mass:1000};
    }, true, batch);
    try { use(); if (i%5 === 0) use(); }
    catch (e) { errors.push(e.message); }
  }
  sealProfileBatch(batch);
  if (JSON.stringify(base) !== before) throw Error("Published world mutated");
  store.save(batch.next, at);
  hashes.push(crypto.createHash("sha256").update(JSON.stringify(store.data)).digest("hex"));
}
fs.writeFileSync(process.argv[2],JSON.stringify({hashes,errors,final:store.data}));
console.log(JSON.stringify({batches:hashes.length,hash:hashes.at(-1),rejected:errors.length}));
