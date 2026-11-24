"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const accounts = require("../../src/server/accounts/account-benefits");
function fixture() {
  let at = Date.parse("2026-11-24T10:00:00Z");
  const store = new ProfileStore({ filePath: null, now: () => at });
  const p = store.find(store.open().token);
  p.account = { ...accounts.fresh(), vipUntil: at + 10000, premiumUntil: at + 20000 };
  p.appearance.avatarFrame = p.appearance.arenaFrame = "premium";
  return { store, p, setAt(value) { at = value; }, get at() { return at; } };
}
function exact(store, p) {
  const full = store.identity(p), value = store.arenaAppearance(p);
  assert.deepEqual(value, { account: full.account, skinId: full.skinId, appearance: full.appearance });
  return value;
}
test("appearance survives unrelated immutable profile commits without copying or retaining the old profile", () => {
  const f = fixture(), first = exact(f.store, f.p);
  let p = f.p;
  for (let i = 0; i < 100; i++) {
    p = { ...p, revision: p.revision + 1, wallet: { ...p.wallet, coins: i },
      inventory: { ...p.inventory, candy: i }, progress: { ...p.progress, maxMass: i },
      transactions: { entries: [{ sequence: i }] } };
    assert.equal(exact(f.store, p), first);
  }
  const entry = f.store.arenaAppearanceCache.entries.get(p.appearance);
  assert(entry.source instanceof WeakRef);
  assert(!Object.values(entry).includes(f.p));
  p.revision++;
  p.appearance.arenaFrame = "default";
  assert.notEqual(exact(f.store, p), first);
});
test("every appearance dependency, expiry, claim and test flag matches the uncached identity", () => {
  const f = fixture(); let p = f.p;
  const changes = [
    p => ({ ...p, account: { ...p.account, vipUntil: 0 } }),
    p => ({ ...p, account: { ...p.account, currencyClaims: { vip: { coins: accounts.loginRewardDay(f.at) } } } }),
    p => ({ ...p, skinId: "forest-spirit" }),
    p => ({ ...p, purchasedSkinCollections: ["synthetic-unused"] }),
    p => ({ ...p, grantedSkins: ["moon-dragon"] }),
    p => ({ ...p, honors: { ...p.honors, claimed: 10 } }),
    p => ({ ...p, honors: { ...p.honors, medals: { ...p.honors.medals, boss: { at: f.at } } } }),
    p => ({ ...p, appearance: { ...p.appearance, arenaFrame: "default" } }),
    p => ({ ...p, id: "another-profile-sharing-a-test-branch" }),
  ];
  for (const change of changes) {
    const before = exact(f.store, p);
    p = change(p); p.revision++;
    assert.notEqual(exact(f.store, p), before);
  }
  for (const flag of ["unlockLeagueBackgrounds", "unlockLeagueFrames"]) {
    const before = exact(f.store, p); f.store[flag] = !f.store[flag];
    assert.notEqual(exact(f.store, p), before);
  }
  f.setAt(f.at + 20000); assert.equal(exact(f.store, p).account.premium, false);
  f.setAt(f.at - 10000); assert.equal(exact(f.store, p).account.premium, true);
  f.setAt(Date.parse("2026-11-24T21:00:00Z")); exact(f.store, p);
});
test("the hot arena projection does not build unused lobby identity fields", () => {
  const f = fixture(), expected = exact(f.store, f.p);
  f.store.arenaAppearanceCache = null;
  f.store.identity = () => { throw Error("Unneeded lobby projection"); };
  assert.deepEqual(f.store.arenaAppearance(f.p), expected);
});
