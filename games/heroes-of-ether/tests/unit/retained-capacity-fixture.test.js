"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), { createHash } = require("node:crypto");
const { extend, verify } = require("../../scripts/benchmarks/retained-capacity-fixture.cjs");
test("retained-history fixture preserves source balances and audit rejects one missing historical operation", () => {
  const f = { data: { version: 14, profiles: {} }, tokens: [], summary: {} };
  for (let i = 0; i < 1280; i++) {
    const token = "token" + i, key = createHash("sha256").update(token).digest("hex"); f.tokens.push(token);
    f.data.profiles[key] = { testFixture: "database-capacity-20261110", receipts: {}, wallet: { coins: i } };
  }
  extend(f, { active: 95, activeReceipts: 3, dormantReceipts: 1 });
  const copy = structuredClone(f.data), proof = verify(f, copy);
  assert.equal(proof.historicalReceipts, 1470);
  assert(Object.values(copy.profiles).every((p, i) => p.wallet.coins === i));
  const p = Object.values(copy.profiles)[0], bucket = Object.values(p.arenaReceipts)[0];
  delete bucket[Object.keys(bucket)[0]];
  assert.throws(() => verify(f, copy), /changed or missing/);
});

test('fresh daytime retained fixture keeps membership, balances and every old receipt through lobby linking',()=>{
  const at=Date.parse('2026-11-24T09:00:00.000Z');
  const f=require('../../scripts/benchmarks/database-room-fixture.cjs').createFixture(at);
  const balances=Object.values(f.data.profiles).map(p=>({...p.wallet}));
  extend(f,{active:125,activeReceipts:3,dormantReceipts:1});
  const before=structuredClone(f);
  require('../../scripts/benchmarks/realistic-lobby-plan.cjs').detachLobby(f,120,5,2);
  assert.deepEqual(Object.values(f.data.profiles).map(p=>p.wallet),balances);
  assert.equal(verify(before,f.data).historicalReceipts,1530);
  const hash=token=>createHash('sha256').update(token).digest('hex');
  const lobby=f.tokens.slice(120,125).map(t=>f.data.profiles[hash(t)]);
  assert.equal(lobby.filter(p=>p.clanId).length,2);
  const calendar=require('../../public/shared/clan-season-calendar'),day=calendar.daily(at);
  assert(day.start<=at&&at+60*60*1000<day.end);
  assert.equal(calendar.season(at).mode,'quests');
  const broken=structuredClone(f.data),p=broken.profiles[hash(f.tokens[124])],bucket=Object.values(p.arenaReceipts)[0];
  delete bucket[Object.keys(bucket)[0]];assert.throws(()=>verify(before,broken),/changed or missing/);
});
