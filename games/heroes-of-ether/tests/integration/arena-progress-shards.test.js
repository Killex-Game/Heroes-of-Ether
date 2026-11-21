"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { ArenaProgressShards, laneFor } = require("../../src/server/profiles/arena-progress-shards");
const { recover } = require("../../src/server/profiles/profile-journal");
const { EventManager } = require("../../src/server/events/event-manager");
const at = Date.parse("2026-11-10T12:00:00Z");
function comparable(data) {
  const copy = structuredClone(data);
  for (const p of Object.values(copy.profiles))
    for (const [i, item] of (p.transactions?.entries || []).entries()) item.id = `receipt-${i}`;
  return copy;
}
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hero-shards-"));
  const store = new ProfileStore({filePath:path.join(dir,"profiles.json"),journal:true,now:()=>at});
  store.arenaPreparer = new ArenaProgressShards({count:3});
  const serial = new ProfileStore({now:()=>at}), opened = [];
  t.after(async () => { await store.close(); await serial.close(); fs.rmSync(dir,{recursive:true,force:true}); });
  for (let i=0;i<12;i++) {
    const auth = store.open(); opened.push(auth);
    store.startLife(auth.profile.id,`life-${i}`);
  }
  store.events = new EventManager({now:()=>at});
  serial.events = new EventManager({now:()=>at});
  const seeded = structuredClone(store.data);
  for (const p of Object.values(seeded.profiles)) p.quests.items.forEach((row,i)=>{
    row.questId=["harvest","great_feast","hunter","feast"][i];
  });
  store.save(seeded);
  serial.data = structuredClone(store.data);
  const batch = (round=1) => ({id:`test-${round}`,at:at+round*1000,progress:opened.flatMap((auth,i)=>[
    {type:"massPeak",profileId:auth.profile.id,mass:1000+round*1000},
    {type:"lifeTime",profileId:auth.profile.id,lifeId:`life-${i}`,durationSeconds:round},
    {type:"absorbed",profileId:auth.profile.id,victimProfileId:opened[(i+1)%12].profile.id,
      lifeId:`victim-${round}`,victimPartId:`part-${round}`,gain:30,victimDefeated:true},
  ])});
  return {store,serial,opened,batch};
}
test("sharded progress matches ordered serial rewards and replay across multiple ticks",async t=>{
  const {store,serial,batch}=await fixture(t);
  for(let i=1;i<=12;i++) {
    const b=batch(i), before=structuredClone(store.data), original=store.data;
    const promise=store.applyArenaGroup([b]);
    assert.deepEqual(store.data,before);
    serial.applyArenaProgress(b.id,b.progress,b.at);
    await promise;
    assert.deepEqual(original,before);
    assert.deepEqual(comparable(store.data),comparable(serial.data));
  }
  const before=store.data;
  assert.deepEqual(await store.applyArenaGroup([batch(12)]),[[]]);
  assert.equal(store.data,before);
  assert.equal(store.arenaPreparer.stats.failures,0);
  // UUIDs are random: twelve profiles can legitimately occupy only two lanes.
  const expectedLanes=new Set(Object.values(store.data.profiles).map(p=>laneFor(p.id,3)));
  assert.equal(store.arenaPreparer.lanes.filter(Boolean).length,expectedLanes.size);
  assert.deepEqual(recover(store.filePath).data.profiles,store.data.profiles);
});

test("alternating profiles remain resident without replaying an obsolete predicted reward",async t=>{
  const {store,serial,opened,batch}=await fixture(t);
  for(let i=1;i<=18;i++) {
    const b=batch(i);
    const id=opened[i%opened.length].profile.id;
    b.progress=b.progress.filter(e=>e.profileId===id);
    // A later authoritative wallet change must override the worker's prediction.
    if(i===13) {
      const key=Object.keys(store.data.profiles).find(k=>store.data.profiles[k].id===id);
      const next=structuredClone(store.data);
      next.profiles[key].wallet.coins+=17;
      store.save(next); serial.data=structuredClone(store.data);
    }
    serial.applyArenaProgress(b.id,b.progress,b.at);
    await store.applyArenaGroup([b]);
    assert.deepEqual(comparable(store.data),comparable(serial.data));
  }
  assert.equal(store.arenaPreparer.lanes.filter(Boolean).reduce((n,lane)=>n+Object.keys(lane.prediction.world.profiles).length,0),12);
  assert.equal(store.arenaPreparer.stats.failures,0);
});
test("concurrent wallet write fences all shards and retry never overwrites the purchase",async t=>{
  const {store,serial,opened,batch}=await fixture(t), b=batch();
  const pending=store.applyArenaGroup([b]);
  store.transact(opened[0].token,"purchase-concurrent-shards-1","purchase",p=>{p.wallet.coins-=10;});
  assert.equal(await pending,null);
  serial.data=structuredClone(store.data);
  serial.applyArenaProgress(b.id,b.progress,b.at);
  await store.applyArenaGroup([b]);
  assert.deepEqual(comparable(store.data),comparable(serial.data));
});
test("event changes fence sharded calculations before publication",async t=>{
  const {store,batch}=await fixture(t), before=store.data;
  const pending=store.applyArenaGroup([batch()]);
  store.events.data=structuredClone(store.events.data);
  assert.equal(await pending,null);
  assert.equal(store.data,before);
});
test("one dead shard falls back to canonical FIFO without partial rewards",async t=>{
  const {store,serial,batch}=await fixture(t), b=batch();
  const pending=store.applyArenaGroup([b]);
  await store.arenaPreparer.lanes.find(Boolean).worker.terminate();
  await pending;
  serial.applyArenaProgress(b.id,b.progress,b.at);
  assert.deepEqual(comparable(store.data),comparable(serial.data));
  assert.equal(store.arenaPreparer.stats.failures,1);
});
test("failed fsync leaves all sharded rewards unpublished and recoverable on retry",async t=>{
  const {store,serial,batch}=await fixture(t), b=batch(), before=store.data;
  const mock=t.mock.method(fs,"fsync",(fd,done)=>setImmediate(()=>done(Error("test flush failure"))));
  await assert.rejects(store.applyArenaGroup([b]),/test flush failure/); mock.mock.restore();
  assert.equal(store.data,before);
  assert.deepEqual(recover(store.filePath).data.profiles,before.profiles);
  await store.applyArenaGroup([b]);serial.applyArenaProgress(b.id,b.progress,b.at);
  assert.deepEqual(comparable(store.data),comparable(serial.data));
});
test("XP from separate shards is added to the same clan, not overwritten",async t=>{
  const store=new ProfileStore({now:()=>at}), pool=new ArenaProgressShards({count:3});
  t.after(async()=>{await pool.close();await store.close();});
  const ids=[];
  for(let i=0;i<12;i++) { const a=store.open();ids.push(a.profile.id);store.startLife(a.profile.id,`life-${i}`); }
  // Isolate the draft merge. Global league/calendar settlement is tested via
  // the journaled end-to-end cases, not a fabricated partial clan record.
  store.data.clans.shared={xp:123};
  for(const p of Object.values(store.data.profiles)) p.clanId="shared";
  store.prepareSnapshot=next=>next;
  const b={id:"clan-sum",at:at+1000,progress:ids.map((profileId,i)=>({
    type:"absorbed",profileId,victimProfileId:`victim-${i}`,lifeId:`victim-life-${i}`,
    victimPartId:`part-${i}`,gain:30,victimDefeated:true,
  }))};
  const expected=store.arenaProgressDraft(store.data,b.id,b.progress,b.at);
  const actual=await pool.prepare(store,[b]);
  assert.deepEqual(comparable(actual.snapshot),comparable(expected.next));
  assert.deepEqual(actual.changes,[expected.ids]);
  assert.ok(actual.snapshot.clans.shared.xp>123);
  assert.equal(store.data.clans.shared.xp,123);
});
test("event orders, consumed booster actions and level rewards stay equivalent",async t=>{
  const {store,serial,opened}=await fixture(t);
  store.events.apply("test","start",{eventId:"black-friday",requestId:"shards-event-start-0001",revision:store.events.data.revision});
  const next=structuredClone(store.data);
  for(const p of Object.values(next.profiles)) p.quests.items.forEach((row,i)=>{
    row.questId=["harvest","great_feast","hunter","feast"][i];
  });
  store.save(next);serial.data=structuredClone(store.data);serial.events.data=structuredClone(store.events.data);
  for(let round=0;round<2;round++) {
    const b={id:`event-${round}`,at:at+(round?61000:500),progress:opened.flatMap((a,i)=>{
      const common={profileId:a.profile.id,lifeId:`life-${i}`};
      return round?[{...common,type:"lifeEnded",durationSeconds:61,reason:"exit"}]:[
        {...common,type:"questSample",food:150,rank:20},
        ...Array.from({length:6},(_,j)=>({...common,type:"arenaAction",metric:"rocketHits",sequence:j+1,targetProfileId:`target-${j%5}`})),
        {...common,type:"survivalMinute",mass:75000,minutes:20},
      ];
    })};
    await store.applyArenaGroup([b]);serial.applyArenaProgress(b.id,b.progress,b.at);
    assert.deepEqual(comparable(store.data),comparable(serial.data));
  }
  assert.ok(store.byId(opened[0].profile.id).progress.lastLife.levelReward.fridayTokens>0);
  assert.equal(store.arenaPreparer.stats.failures,0);
});
