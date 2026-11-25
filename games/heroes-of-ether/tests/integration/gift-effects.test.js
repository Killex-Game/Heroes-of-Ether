"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { temporary } = require("../temp"),
  effects = require("../../src/server/profiles/gift-effects");
test("Эффекты подарков: атомарность, продление, повтор, перезапуск, самоотправка и старый каталог", (t) => {
  let at = 100000;
  const filePath = path.join(temporary(t, "gift-effects"), "profiles.json");
  const store = new ProfileStore({ filePath, now: () => at });
  const a = store.open(),
    b = store.open();
  store.find(a.token).wallet = { coins: 10000, crystals: 1000, bucks: 1000 };
  const send = (id, extra = {}) =>
    store.socialAction(a.token, {
      action: "gift",
      giftId: id,
      targetId: b.profile.id,
      confirmed: true,
      requestId: randomUUID(),
      ...extra,
    });
  const receipt = randomUUID();
  send("clover", { requestId: receipt });
  assert.equal(store.find(b.token).social.giftEffects.clover, at + 3600000);
  assert.equal(send("clover", { requestId: receipt }).replay, true);
  assert.equal(store.find(a.token).wallet.bucks, 985);
  at += 600000;
  send("clover");
  const until = 100000 + 7200000;
  assert.equal(store.find(b.token).social.giftEffects.clover, until);
  assert.equal(effects.modifiers(store.find(b.token), at).xp, 1.25);
  send("skull");
  assert.equal(effects.modifiers(store.find(b.token), at).xp, 1.2);
  const before = structuredClone(store.data),
    save = store.save;
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => send("clover"), /disk full/);
  assert.deepEqual(store.data, before);
  store.save = save;
  const restored = new ProfileStore({ filePath, now: () => at });
  assert.equal(restored.find(b.token).social.giftEffects.clover, until);
  at += 3600000;
  assert.equal(effects.modifiers(restored.find(b.token), at).xp, 1.25);
  at = until;
  assert.equal(effects.modifiers(restored.find(b.token), at).xp, 1);
  assert.throws(() => send("warm_heart"), /Подарок|подарок/);
  send("ring", { targetId: a.profile.id });
  assert.equal(store.find(a.token).wallet.crystals, 950);
  const p = store.find(b.token);
  p.social.gifts.push({
    id: "warm_heart",
    count: 1,
    history: [{ fromId: a.profile.id, fromName: "A", at }],
  });
  store.save(store.data);
  const old = new ProfileStore({ filePath, now: () => at });
  assert.ok(!old.publicPlayer(b.profile.id).social.gifts.some((g) => g.id === "warm_heart"));
  assert.ok(old.find(b.token).social.gifts.some((g) => g.id === "warm_heart"));
});
