"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { difference, ProfileJournal, recover } = require("../../src/server/profiles/profile-journal");
const { applyTransfer } = require("../../src/server/profiles/profile-transfer");
const receipts = require("../../src/server/progression/quest-receipts");
const world = session => ({ profiles: { p: { quests: { session } } }, clans: {} });
const add = (base, names) => {
  const session = { ...base.profiles.p.quests.session }, scope = new WeakMap();
  for (const name of names) receipts.record(session, name, scope);
  return world(session);
};
function verify(next, previous) {
  const patch = difference(next, previous);
  const transferred = applyTransfer(previous, structuredClone(patch));
  assert.deepEqual(transferred, next);
  assert.deepEqual(difference(transferred, previous), patch);
  return transferred;
}
test("receipt provenance survives IPC patches and batched contacts exactly", () => {
  const start = add(world({ seen: {} }), Array.from({length: 20000}, (_,i)=>'old:'+i));
  const saved = structuredClone(start);
  for (const bucket of Object.values(start.profiles.p.quests.session.seenBuckets)) Object.freeze(bucket);
  let next = start;
  for (let n=0;n<6;n++) {
    const previous = next;
    next = verify(add(previous, ['__proto__', ...Array.from({length: 80}, (_,i)=>`new:${n}:${i}`)]), previous);
    verify(next, start);
  }
  assert.deepEqual(start, saved);
  assert.ok(JSON.stringify(difference(next, start)).length < 30000);
});
test("tracked bucket deltas remain durable across sealed checkpoints", async t => {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'receipt-delta-')),file=path.join(root,'profiles.json');
  const journal=new ProfileJournal(file,{intervalMs:60000});
  t.after(async()=>{if(!journal.closed)await journal.close();fs.rmSync(root,{recursive:true,force:true});});
  let current=add(world({seen:{}}),Array.from({length:3000},(_,i)=>'old:'+i));
  journal.commit(current);
  for(let i=0;i<12;i++)current=add(current,['__proto__','part:'+i]);
  journal.commit(current);
  assert.deepEqual(recover(file).data.profiles,current.profiles);
  await journal.requestCheckpoint();
  current=add(current,['final']);journal.commit(current);
  await journal.close();
  assert.deepEqual(recover(file).data.profiles,current.profiles);
});
test("unrelated branches, long chains and removal fall back without losing receipts", () => {
  const start=add(world({seen:{}}),['a','b','c']);
  let current=start;
  for(let i=0;i<20;i++) current=add(current,['part:'+i]);
  verify(current,start);
  const branch=add(start,['another']);
  verify(current,branch);
  const removed=structuredClone(current);
  const buckets=removed.profiles.p.quests.session.seenBuckets;
  delete buckets[Object.keys(buckets)[0]];
  verify(removed,current);
  const copied=structuredClone(current);
  receipts.record(copied.profiles.p.quests.session,'external',new WeakMap());
  verify(copied,current);
});
