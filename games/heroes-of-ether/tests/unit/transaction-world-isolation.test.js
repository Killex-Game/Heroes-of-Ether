"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const history = require("../../src/server/profiles/transaction-history");
function profile(id, wallet = {coins:100, crystals:10, bucks:0}, account) {
  const p = {id, wallet, ...(account ? {account} : {})};
  history.initialize(p,1000);
  return p;
}
function freeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value); for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
test("economy scans preserve committed history and record each changed currency/account exactly once", () => {
  const previous = freeze({profiles:{a:profile("a"),b:profile("b"),idle:profile("idle")}});
  const next = freeze({profiles:{
    ...previous.profiles,
    a:{...previous.profiles.a,wallet:{coins:150,crystals:17,bucks:5}},
    b:{...previous.profiles.b,account:{vipUntil:5000,premiumUntil:6000}},
  }});
  const before=JSON.stringify(next);
  const saved=history.syncWorld(next,2000,{kind:"reward",label:"Награда"});
  assert.equal(JSON.stringify(next),before,"an unsuccessful later save cannot leak transaction entries");
  assert.equal(previous.profiles.a.wallet.coins,100);
  assert.equal(saved.profiles.idle,previous.profiles.idle);
  for (const key of ["a","b"]) {
    const p=saved.profiles[key]; history.validate(p);
    assert.equal(p.transactions.entries.length,1);
    assert.equal(p.transactions.entries[0].at,2000);
    assert.equal(p.transactions.entries[0].kind,"reward");
    assert.equal(p.transactions.entries[0].label,"Награда");
    assert.deepEqual(p.transactions.entries[0].before,history.snapshot(previous.profiles[key]));
    assert.deepEqual(p.transactions.entries[0].after,history.snapshot(next.profiles[key]));
  }
  const retried=history.syncWorld(freeze(saved),3000);
  assert.deepEqual(retried,saved,"scanning again must not duplicate or relabel a reward");
});
test("economy scans initialize a zero balance, tolerate old absent optional fields and reject invalid money", () => {
  const world=freeze({profiles:{
    zero:{id:"zero",wallet:{coins:0,crystals:0}},
    old:profile("old",{coins:10,crystals:0}),
  }});
  const saved=history.syncWorld(world,1000);
  for(const p of Object.values(saved.profiles)) history.validate(p);
  assert.equal(saved.profiles.zero.transactions.entries.length,0);
  assert.equal(saved.profiles.zero.transactions.startedAt,1000);
  assert.equal(saved.profiles.old.transactions.entries.length,0);
  const invalid=freeze({profiles:{...saved.profiles,old:{...saved.profiles.old,wallet:{coins:-1,crystals:0}}}});
  assert.throws(()=>history.syncWorld(invalid,2000),/Недопустимый баланс/);
  assert.equal(saved.profiles.old.wallet.coins,10);
});
