"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  pack,
  unpack,
  changes,
  assertCompatible,
  hash,
} = require("../../src/server/persistence/mongodb-state");
const { safeError } = require("../../src/server/persistence/mongodb-config");
const world = () => ({
  version: 13,
  _journalRevision: 10,
  profiles: {
    a: {
      wallet: { coins: 100 },
      receipts: { purchase: { coins: 100 } },
      quests: { session: { seen: { old: true }, seenBuckets: { 0: { victim: true } } } },
      roulette: { results: Array.from({ length: 300 }, (_, id) => ({ id, reward: "coins" })) },
    },
  },
  clans: { c: { members: ["a"] } },
  completedBattles: ["one"],
});

test("Snapshot hashes retain legacy bytes and private values across unordered and unusual keys", () => {
  const crypto=require('node:crypto');
  const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
  const legacyHash=v=>crypto.createHash('sha256').update(JSON.stringify(ordered(v))).digest('hex');
  let seed=19373;const random=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
  const keys=['z','a','10','2','__proto__','constructor','🧪','é','a.b'];
  const tree=depth=>depth<=0?[null,true,false,Math.floor(random()*1000),'текст😀',undefined][Math.floor(random()*6)]:random()<.3?Array.from({length:3},()=>tree(depth-1)):Object.fromEntries(keys.filter(()=>random()<.6).map(k=>[k,tree(depth-1)]));
  for(let i=0;i<150;i++){
    const source=Object.assign(Object.fromEntries([['z',tree(2)],['__proto__',tree(2)],['extra',tree(2)]]),{profiles:Object.fromEntries(keys.map(k=>[k,{data:tree(2),wallet:{coins:i}}])),clans:{'2':{members:['z']},'10':{}},_journalRevision:i});
    const expected=legacyHash(source),snapshot=pack(source);
    assert.equal(snapshot.worldHash,expected);
    for(const doc of snapshot.docs.values())assert.equal(doc.hash,legacyHash(doc.value));
    assert.equal(snapshot.digest,legacyHash([...snapshot.docs].map(([id,doc])=>[id,doc.hash]).sort(([a],[b])=>a.localeCompare(b))));
    source.profiles.z.wallet.coins++;
    assert.equal(snapshot.docs.get('profiles:z').value.wallet.coins,i,'pending snapshot must not share mutable input');
  }
});

test("Full read fences one causal majority session and rejects concurrent metadata, cursor errors and corrupt data", async () => {
  const { MongoState } = require("../../src/server/persistence/mongodb-state");
  const snapshot=pack(world()), manifest={digest:snapshot.digest,worldHash:snapshot.worldHash,revision:snapshot.revision};
  const documents=[...snapshot.docs.values()];
  let active=false, checks=0, cursorFails=false, readCount=0, concurrent=null;
  const session={async endSession(){assert.equal(active,true);active=false;}};
  const guarded=documents.map(doc=>({ ...doc, get value(){assert.equal(active,false,"hashing runs after snapshot session");checks++;return doc.value;} }));
  let signal;
  const state={
    metrics:require('../../src/server/persistence/mongodb-metrics').observeMongo(),
    reader:{async connect(){},startSession(options){assert.deepEqual(options,{causalConsistency:true});active=true;readCount=0;return session;},async close(){assert.equal(active,false);}},
    readMeta:{async findOne(query,options){assert.strictEqual(options.session,session);assert.equal(active,true);assert.deepEqual(options.readConcern,{level:'majority'});assert.equal(options.readPreference,'primary');assert.equal(options.maxTimeMS,1200000);signal=options.signal;assert(signal instanceof AbortSignal);return ++readCount===2&&concurrent?{...manifest,...concurrent}:manifest;}},
    readState:{find(query,options){assert.strictEqual(options.session,session);assert.strictEqual(options.signal,signal);assert.equal(active,true);assert.equal(options.batchSize,8);return {async *[Symbol.asyncIterator](){yield* guarded;if(cursorFails)throw Object.assign(Error('snapshot expired'),{code:239});}};}}
  };
  const result=await MongoState.prototype.read.call(state);
  assert.deepEqual(result.world,world());assert.ok(checks>0);
  checks=0;cursorFails=true;
  await assert.rejects(MongoState.prototype.read.call(state),{code:239});assert.equal(checks,0);assert.equal(active,false);
  cursorFails=false;
  for(const change of [{generation:2},{sourceId:'other'},{writer:'other'},{updatedAt:new Date()}]){
    concurrent=change;checks=0;await assert.rejects(MongoState.prototype.read.call(state),{code:'MONGO_CONCURRENT_READ'});
    assert.equal(checks,0);assert.equal(active,false);
  }
  concurrent=null;documents[0].value.wallet.coins++;
  await assert.rejects(MongoState.prototype.read.call(state),{code:"MONGO_CHECKSUM_FAILED"});
});
test("MongoDB snapshot round-trips receipts, buckets, root fields and auxiliary data", () => {
  const original = world(),
    auxiliary = {
      "game-events.json": { events: [{ id: "friday" }] },
      "clan-chat.json": { messages: [] },
    };
  const snapshot = pack(original, auxiliary);
  const restored = unpack([...snapshot.docs.values()], snapshot);
  assert.deepEqual(restored.world, original);
  assert.deepEqual(restored.auxiliary, auxiliary);
  assert.equal(hash({ b: 1, a: 2 }), hash({ a: 2, b: 1 }));
  assert.throws(() => unpack([...snapshot.docs.values()].slice(1), snapshot), /CHECKSUM/);
});
test('online export pins a snapshot session and still rejects inconsistent or expired reads', async()=>{
  const {MongoState}=require('../../src/server/persistence/mongodb-state');
  const packed=pack(world()),manifest={...packed,docs:undefined},session={endSession:async()=>{}};
  let expired=false,moved=false,reads=0,closed=0;
  const state={metrics:require('../../src/server/persistence/mongodb-metrics').observeMongo(),
    reader:{connect:async()=>{},startSession:options=>{assert.deepEqual(options,{snapshot:true});reads=0;return session;},close:async()=>{closed++;}},
    readMeta:{findOne:async(q,o)=>{assert.equal(o.session,session);assert.equal(o.readConcern.level,'snapshot');return ++reads===2&&moved?{...manifest,generation:2}:manifest;}},
    readState:{find:(q,o)=>{assert.equal(o.session,session);return{async *[Symbol.asyncIterator](){if(expired)throw Object.assign(Error('expired'),{code:239});yield* packed.docs.values();}};}}};
  assert.deepEqual((await MongoState.prototype.read.call(state,{snapshot:true})).world,world());
  moved=true;await assert.rejects(MongoState.prototype.read.call(state,{snapshot:true}),{code:'MONGO_CONCURRENT_READ'});
  moved=false;expired=true;await assert.rejects(MongoState.prototype.read.call(state,{snapshot:true}),{code:239});assert.equal(closed,3);
});

test('cold reads reuse only an exact local snapshot; online exports remain independent', async()=>{
  const {MongoState}=require('../../src/server/persistence/mongodb-state');
  const packed=pack(world()),manifest={...packed,docs:undefined,sourceId:'source',version:1,generation:12};
  let cursors=0,metaReads=0,moved=false,closed=0;
  const state={config:{sourceId:'source'},metrics:require('../../src/server/persistence/mongodb-metrics').observeMongo(),
    reader:{connect:async()=>{},startSession:()=>{metaReads=0;return {endSession:async()=>{}};},close:async()=>closed++},
    readMeta:{findOne:async()=>++metaReads===2&&moved?{...manifest,generation:13}:manifest},
    readState:{find:()=>{cursors++;return {async *[Symbol.asyncIterator](){yield* packed.docs.values();}};}}};
  assert.deepEqual((await MongoState.prototype.read.call(state,{localSnapshot:packed})).world,world());
  assert.equal(cursors,0);assert.equal(metaReads,2);
  for(const key of ['revision','digest','worldHash','chatRevision','chatHash','chatFormat','documentFormat']){
    const before=cursors;
    await MongoState.prototype.read.call(state,{localSnapshot:{...packed,[key]:'different'}});
    assert.equal(cursors,before+1,key+' must trigger a full read');
  }
  state.config.sourceId='other';await MongoState.prototype.read.call(state,{localSnapshot:packed});assert.equal(cursors,8);
  state.config.sourceId='source';await MongoState.prototype.read.call(state,{snapshot:true,localSnapshot:packed});assert.equal(cursors,9);
  moved=true;await assert.rejects(MongoState.prototype.read.call(state,{localSnapshot:packed}),{code:'MONGO_CONCURRENT_READ'});
  moved=false;
  const corrupted=structuredClone(packed);corrupted.docs.values().next().value.value.wallet.coins++;
  await assert.rejects(MongoState.prototype.read.call(state,{localSnapshot:corrupted}),{code:'MONGO_CHECKSUM_FAILED'});
  assert.equal(cursors,9);assert.equal(closed,12);
});

test('acquire passes the local snapshot but still checks source and exact generation lease CAS', async()=>{
  const {MongoState}=require('../../src/server/persistence/mongodb-state');
  const local=pack(world()),manifest={...local,docs:undefined,sourceId:'source',version:1,generation:12};
  let writes=0,matchedCount=1;
  const state={config:{sourceId:'source'},writer:'writer',read:async options=>{
    assert.strictEqual(options.localSnapshot,local);return {snapshot:local,manifest};
  },meta:{updateOne:async(query,update)=>{writes++;assert.equal(query.sourceId,'source');assert.equal(query.generation,12);assert.equal(update.$set.writer,'writer');assert(query.$or.some(row=>row.writer==='writer'));return {matchedCount};}}};
  assert.deepEqual(await MongoState.prototype.acquire.call(state,local),{revision:local.revision,generation:12});
  matchedCount=0;await assert.rejects(MongoState.prototype.acquire.call(state,local),{code:'MONGO_WRITER_BUSY'});
  state.config.sourceId='other';await assert.rejects(MongoState.prototype.acquire.call(state,local),{code:'MONGO_SOURCE_MISMATCH'});assert.equal(writes,2);
});
test("Wallet delta does not resend archives; removals and unsafe keys are retained", () => {
  const original = world(),
    next = structuredClone(original);
  next._journalRevision++;
  next.profiles.a.wallet.coins = 90;
  next.profiles.a.receipts.second = { coins: -10 };
  delete next.clans.c;
  const delta = changes(pack(original), pack(next));
  assert.equal(delta.length, 3);
  const patch = delta.find((op) => op.updateOne?.filter._id === "profiles:a").updateOne.update;
  assert.equal(patch.$set["value.wallet.coins"], 90);
  assert.equal(patch.$set["value.receipts.second"].coins, -10);
  assert.ok(!JSON.stringify(delta).includes("roulette"));
  assert.ok(!JSON.stringify(delta).includes("seenBuckets"));
  original.profiles.a.dynamic = { "a.b": 1 };
  next.profiles.a.dynamic = { "a.b": 2 };
  const unsafe = changes(pack(original), pack(next)).find(
    (op) => op.updateOne?.filter._id === "profiles:a",
  );
  assert.deepEqual(unsafe.updateOne.update.$set["value.dynamic"], { "a.b": 2 });
  assert.deepEqual(changes(pack(original), pack(original)), []);
});
test("Cloud refuses mismatched sources, rollback, divergence and invalid snapshots", () => {
  const local = pack(world()),
    manifest = { ...local, version: 1, sourceId: "owner" };
  assert.doesNotThrow(() => assertCompatible(manifest, local, "owner"));
  assert.throws(() => assertCompatible(manifest, local, "other"), /SOURCE/);
  assert.throws(() => assertCompatible({ ...manifest, revision: 11 }, local, "owner"), /AHEAD/);
  assert.throws(
    () => assertCompatible({ ...manifest, worldHash: "other" }, local, "owner"),
    /DIVERGED/,
  );
  assert.throws(() => pack({ profiles: {}, clans: {}, _journalRevision: -1 }), /REVISION/);
  assert.equal(
    safeError(new Error("mongodb+srv://private:password@host")),
    "MONGO_OPERATION_FAILED",
  );
});
