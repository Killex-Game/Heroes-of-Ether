"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { POOLS } = require("../../src/server/progression/title-chest-rewards");
const day = 86400000;
test("Просмотр награды не начисляет её; дата и повтор запроса проверяются сервером", () => {
  let at = Date.UTC(2026, 10, 8, 20, 59, 59);
  const store = new ProfileStore({ now: () => at }), { token } = store.open();
  const before = structuredClone(store.find(token));
  const shown = store.view(store.find(token)).dailyLoginReward;
  for (let i = 0; i < 5; i++) store.open(token);
  assert.deepEqual(store.find(token), before);
  assert.equal(shown.day, 1); assert.equal(shown.reward.coins, 100);
  at += 1000; // Московская полночь: устаревшее окно не выдаёт другую награду.
  assert.throws(() => store.claimLoginReward(token, { date: shown.date }), /новый день/);
  assert.deepEqual(store.find(token), before);
  const current = store.view(store.find(token)).dailyLoginReward;
  const claim = store.claimLoginReward(token, { date: current.date });
  assert.equal(claim.profile.wallet.coins, before.wallet.coins + 100);
  assert.equal(claim.profile.dailyLoginReward, null);
  assert.equal(store.claimLoginReward(token, { date: current.date }).loginReward, null);
});
test("Серия входов выдаёт все семь наград один раз, переживает перезапуск и сбрасывается при пропуске", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heroes-login-")),
    file = path.join(dir, "profiles.json");
  let at = Date.UTC(2026, 10, 3, 20, 59, 59),
    store;
  const open = () => new ProfileStore({ filePath: file, journal: true, now: () => at });
  store = open();
  t.after(async () => {
    await store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const { token } = store.open();
  const original = { ...store.find(token).wallet };
  for (let i = 1; i <= 7; i++) {
    if (i === 2) at += 1000;
    else if (i > 2) at += day;
    if (i === 7) {
      const p = store.find(token);
      p.account ||= require("../../src/server/accounts/account-benefits").fresh();
      p.account.vipUntil = at + day;
    }
    const claim = store.claimLoginReward(token);
    assert.equal(claim.loginReward.day, i);
    assert.equal(store.claimLoginReward(token).loginReward, null);
    if (i === 4 || i === 6) {
      const items = Object.entries(claim.loginReward.items);
      assert.ok(items.every(([id]) => POOLS[i === 4 ? "rare" : "advanced"].includes(id)));
      assert.equal(
        items.reduce((n, [, q]) => n + q, 0),
        i === 4 ? 10 : 50,
      );
    }
    if (i === 4) {
      await store.close();
      store = open();
      assert.equal(store.claimLoginReward(token).loginReward, null);
    }
  }
  assert.equal(store.find(token).account.vipUntil, at + day + 3600000);
  assert.deepEqual(store.find(token).wallet, {
    coins: original.coins + 900,
    crystals: original.crystals + 175,
    bucks: original.bucks + 15,
  });
  at += day;
  assert.equal(store.claimLoginReward(token).loginReward.day, 1);
  at += day;
  assert.equal(store.claimLoginReward(token).loginReward.day, 2);
  at += 2 * day;
  assert.equal(store.claimLoginReward(token).loginReward.day, 1);
});
test("Неудачная запись позволяет безопасно повторить выдачу", () => {
  const store = new ProfileStore(),
    { token } = store.open(),
    original = store.find(token),
    save = store.save;
  store.save = () => {
    throw Error("disk");
  };
  assert.throws(() => store.claimLoginReward(token), /disk/);
  assert.equal(store.find(token), original);
  store.save = save;
  assert.equal(store.claimLoginReward(token).profile.wallet.coins, original.wallet.coins + 100);
});
