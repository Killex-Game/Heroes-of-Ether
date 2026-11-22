"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {pack,unpack,hash}=require("../../src/server/persistence/state-snapshot");
const {compatible:assertCompatible}=require("../../src/server/persistence/postgresql-state");
const {safeError}=require("../../src/server/persistence/postgresql-config");
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
test("Database snapshot round-trips receipts, buckets, root fields and auxiliary data", () => {
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
    safeError(new Error("postgresql://private:password@host")),
    "PG_OPERATION_FAILED",
  );
});