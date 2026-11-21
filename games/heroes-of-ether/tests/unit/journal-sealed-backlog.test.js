"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { ProfileJournal, recover, difference } = require("../../src/server/profiles/profile-journal");
test("Existing profiles journal only changed fields without requiring a roulette archive", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-fields-"));
  const file = path.join(dir, "profiles.json"), journal = new ProfileJournal(file);
  t.after(async () => { await journal.close(); fs.rmSync(dir, {recursive:true,force:true}); });
  const inventory = Object.fromEntries(Array.from({length:2000}, (_,i) => ["item"+i,i]));
  let p = { coins:100, inventory, oldField:"remove", receipts:{a:{id:1}} };
  journal.commit({profiles:{p},clans:{}});
  const next = {...p, coins:90, oldField:undefined, roulette:{results:[{id:"spin"}]}};
  assert.ok(JSON.stringify(difference({profiles:{p:next},clans:{}}, journal.previous)).length < 600);
  journal.commit({profiles:{p:next},clans:{}});
  p = {...next, roulette:{results:[{id:"second"}]}, receipts:{b:{id:2}}};
  journal.commit({profiles:{p},clans:{}});
  await journal.requestCheckpoint();
  assert.deepEqual(recover(file).data.profiles.p, JSON.parse(JSON.stringify(p)));
});
test("Small booster seals trigger checkpoints by total WAL bytes before the backlog cap", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-seals-"));
  const file=path.join(dir,"profiles.json"), journal=new ProfileJournal(file,{maxPendingBytes:32000,intervalMs:60000});
  t.after(async()=>{await journal.close();fs.rmSync(dir,{recursive:true,force:true});});
  let checkpoints=0;
  const request=journal.requestCheckpoint.bind(journal);
  journal.requestCheckpoint=async()=>{checkpoints++;return request();};
  let world={profiles:{p:{coins:100,payload:"x".repeat(1500)}},clans:{}};
  journal.commit(world);
  for(let i=0;i<24;i++){
    if(journal.running)await journal.running;
    world={...world,profiles:{p:{...world.profiles.p,coins:i,payload:String(i).padEnd(1500,"x")}}};
    const entry=await journal.stage(world);
    assert.equal(journal.publishStaged(entry,world),true);
    await new Promise(resolve=>setImmediate(resolve));
    if(journal.running)await journal.running;
  }
  assert.ok(checkpoints>=3,"Frequent seals must not postpone checkpoints until the 30s timer");
  assert.deepEqual(recover(file).data.profiles,world.profiles);
});
