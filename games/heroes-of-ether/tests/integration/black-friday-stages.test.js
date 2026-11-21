"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { randomUUID } = require("node:crypto");
const fixture = require("../helpers/black-friday-fixture");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const B = require("../../src/server/events/black-friday");
const book = require("../../src/server/events/black-friday-orders");

test("legacy Friday stage migration persists without losing rewards, and repeated loading cannot regrant", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-stage-migration-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "profiles.json"), f = fixture({ filePath, journal: true });
  f.store.transact(f.user.token, randomUUID(), "seed-legacy", p => {
    const s = { tokens: 150, completedOrders: 0, days: {}, purchases: {}, finalAt: null,
      achievementVersion: 2, achievementClaims: { friday_tokens: 1 } };
    p.blackFriday = { runs: { [f.run.id]: s } };
    book.ensure(p, s, B.day(f.now()), f.now()).earned = 150;
  });
  const original = structuredClone(f.p());
  await f.store.close();
  let store = new ProfileStore({ filePath, journal: true, now: f.now });
  const key = randomUUID();
  try {
    store.events = f.manager;
    let p = store.find(f.user.token), s = p.blackFriday.runs[f.run.id];
    assert.equal(s.stageSpent.friday_tokens, 100);
    assert.deepEqual(s.achievementClaims, original.blackFriday.runs[f.run.id].achievementClaims);
    assert.deepEqual(s.days, original.blackFriday.runs[f.run.id].days);
    assert.equal(p.greatness, original.greatness);
    assert.deepEqual(p.wallet, original.wallet);
    const before = p.greatness;
    store.transact(f.user.token, key, "package", p => B.rewardCurrencyPack(p, f.run, 25, f.now()));
    p = store.find(f.user.token); s = p.blackFriday.runs[f.run.id];
    assert.equal(s.achievementClaims.friday_tokens, 2);
    assert.equal(s.stageSpent.friday_tokens, 400);
    assert.equal(p.greatness - before, 25);
    await store.close();
    store = new ProfileStore({ filePath, journal: true, now: f.now });
    store.events = f.manager;
    assert.deepEqual(store.find(f.user.token).blackFriday, p.blackFriday);
    assert.equal(store.find(f.user.token).greatness, p.greatness);
    assert.equal(store.transact(f.user.token, key, "package", () => { throw Error("duplicate"); }).replay, true);
    assert.equal(B.achievementView(store.find(f.user.token), f.manager, f.now()).find(a => a.id === "friday_tokens").value, 0);
  } finally { await store.close(); }
});
