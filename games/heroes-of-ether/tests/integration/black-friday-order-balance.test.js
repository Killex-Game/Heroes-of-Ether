"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { randomUUID } = require("node:crypto");
const fixture = require("../helpers/black-friday-fixture");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { recover } = require("../../src/server/profiles/profile-journal");
const B = require("../../src/server/events/black-friday");

test("old game progress loads, upgrades, survives WAL/checkpoint and cannot replay a completed game", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-order-balance-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "profiles.json"), f = fixture({ filePath, journal: true });
  let now = f.now();
  const date = B.day(now), id = "important:0:0";
  f.store.transact(f.user.token, randomUUID(), "seed-legacy-order", p => {
    p.blackFriday = { runs: { [f.run.id]: { tokens: 0, completedOrders: 0, purchases: {}, finalAt: null,
      days: { [date]: { version: 3, earned: 0, swaps: 0, exchanges: {},
        lanes: { common: { done: 0, issued: 0 }, important: { done: 0, issued: 1 }, secret: { done: 0, issued: 0 } },
        slots: [{ tier: "important", complete: false, current: { id, revision: 0, template: 2, progress: 1, assignedAt: now } }],
      } } } } };
  });
  await f.store.close();
  let store = new ProfileStore({ filePath, journal: true, now: () => now });
  try {
    store.events = f.manager;
    const row = () => B.view(store.find(f.user.token), f.manager, now).orders.find(o => o.id === id);
    assert.equal(row().target, 10); assert.equal(row().progress, 1);
    const lifeId = randomUUID();
    const send = e => store.applyArenaProgress(randomUUID(), [{ ...e, profileId: f.p().id }], now);
    send({ type: "lifeStarted", lifeId }); now += 60000;
    const end = { type: "lifeEnded", lifeId, durationSeconds: 60, reason: "exit" };
    send(end); assert.equal(row().progress, 2);
    const p = store.find(f.user.token), saved = Object.values(recover(filePath).data.profiles).find(x => x.id === p.id);
    assert.deepEqual(saved.blackFriday, p.blackFriday);
    assert.equal(saved.blackFriday.runs[f.run.id].days[date].slots[0].current.catalogVersion, 2);
    await store.close();
    store = new ProfileStore({ filePath, journal: true, now: () => now }); store.events = f.manager;
    assert.equal(row().progress, 2);
    send(end); assert.equal(row().progress, 2);
    assert.equal(B.view(store.find(f.user.token), f.manager, now).completedOrders, 0);
  } finally { await store.close(); }
});
