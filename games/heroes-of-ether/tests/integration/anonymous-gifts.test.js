"use strict";
const test = require("node:test"), assert = require("node:assert/strict"),
  path = require("node:path"), { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { temporary } = require("../temp"),
  social = require("../../src/server/profiles/player-social");

function setup(options = {}) {
  const at = 100000, store = new ProfileStore({ ...options, now: () => at }),
    a = store.open(), b = store.open();
  store.find(a.token).name = "SecretSender";
  store.find(a.token).wallet = { coins: 10000, crystals: 1000, bucks: 1000 };
  const input = (extra = {}) => ({ action: "gift", giftId: "clover",
    targetId: b.profile.id, confirmed: true, requestId: randomUUID(), ...extra });
  return { at, store, a, b, input };
}
test("Anonymous gifts hide both sender fields in recipient/private/public projections, persist and retry once", t => {
  const filePath = path.join(temporary(t, "anonymous-gifts"), "profiles.json"),
    f = setup({ filePath }), request = f.input({ anonymous: true });
  const before = f.store.find(f.a.token).wallet.bucks;
  f.store.socialAction(f.a.token, request);
  const data = structuredClone(f.store.data);
  assert.equal(f.store.socialAction(f.a.token, request).replay, true);
  assert.deepEqual(f.store.data, data);
  assert.equal(f.store.find(f.a.token).wallet.bucks, before - 15);
  assert.throws(() => f.store.socialAction(f.a.token, { ...request, anonymous: false }), /другой операции/);
  const restored = new ProfileStore({ filePath, now: () => f.at });
  for (const store of [f.store, restored]) {
    const target = store.find(f.b.token);
    assert.equal(target.social.gifts[0].history[0].fromId, f.a.profile.id); // internal audit retained
    assert.equal(target.social.giftEffects.clover, f.at + 3600000);
    for (const projected of [store.view(target).social, store.publicPlayer(target.id).social,
      social.view(store, target, true), social.view(store, target)]) {
      assert.deepEqual(projected.gifts[0].history[0],
        { anonymous: true, at: f.at, expiresAt: f.at + 48 * 3600000 });
      const json = JSON.stringify(projected);
      assert.ok(!json.includes("SecretSender"));
      assert.ok(!json.includes(f.a.profile.id));
    }
  }
});
test("Named gifts remain compatible; self gifts, effects, failed writes and anonymous input validation", () => {
  const f = setup(), legacy = f.input();
  f.store.socialAction(f.a.token, legacy);
  assert.equal(f.store.socialAction(f.a.token, { ...legacy, anonymous: false }).replay, true);
  assert.equal(f.store.publicPlayer(f.b.profile.id).social.gifts[0].history[0].fromName, "SecretSender");
  for (const anonymous of ["true", 1, null, {}, []])
    assert.throws(() => f.store.socialAction(f.a.token, f.input({ anonymous })), /анонимности/);
  const before = structuredClone(f.store.data), save = f.store.save;
  f.store.save = () => { throw Error("disk full"); };
  assert.throws(() => f.store.socialAction(f.a.token, f.input({ anonymous: true })), /disk full/);
  assert.deepEqual(f.store.data, before);
  f.store.save = save;
  f.store.socialAction(f.a.token, f.input({ targetId: f.a.profile.id, anonymous: true }));
  const own = f.store.find(f.a.token);
  assert.equal(social.view(f.store, own, true).gifts[0].history[0].anonymous, true);
  assert.equal(own.social.giftEffects.clover, f.at + 3600000);
});

test("Explicit anonymous operation protects self gifts and shares receipts with the previous client", () => {
  const f = setup(), request = f.input({ action: "gift-anonymous", anonymous: true,
    giftId: "teddy", targetId: f.a.profile.id });
  const coins = f.store.find(f.a.token).wallet.coins;
  f.store.socialAction(f.a.token, request);
  const after = structuredClone(f.store.data);
  assert.equal(f.store.find(f.a.token).wallet.coins, coins - 500);
  assert.equal(f.store.socialAction(f.a.token, request).replay, true);
  assert.equal(f.store.socialAction(f.a.token, { ...request, action: "gift" }).replay, true);
  assert.deepEqual(f.store.data, after);
  const own = f.store.find(f.a.token);
  for (const projected of [f.store.view(own).social, f.store.publicPlayer(own.id).social]) {
    assert.deepEqual(projected.gifts[0].history[0],
      { anonymous: true, at: f.at, expiresAt: f.at + 48 * 3600000 });
  }
  assert.throws(() => f.store.socialAction(f.a.token, { ...request, action: "gift", anonymous: false }), /другой операции/);
  for (const anonymous of [undefined, false, "true", 1, null]) {
    assert.throws(() => f.store.socialAction(f.a.token, f.input({ action: "gift-anonymous", anonymous })), /анонимности/);
    assert.deepEqual(f.store.data, after);
  }
  const previousClient = f.input({ anonymous: true });
  f.store.socialAction(f.a.token, previousClient);
  const previousState = structuredClone(f.store.data);
  assert.equal(f.store.socialAction(f.a.token, { ...previousClient, action: "gift-anonymous" }).replay, true);
  assert.deepEqual(f.store.data, previousState);
});
