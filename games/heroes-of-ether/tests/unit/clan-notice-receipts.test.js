"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { temporary } = require("../temp"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  chests = require("../../src/server/clans/clan-chest-rewards");
const AT = Date.UTC(2026, 9, 26, 10);
const DAY = 86400000;

test("Clan notices expire at 24 hours from arrival, independently of display and chest lifetime", () => {
  const store = new ProfileStore({ now: () => AT }),
    auth = store.open(),
    p = store.find(auth.token);
  p.account = {
    dailyDay: null,
    dailyAmount: 0,
    vipUntil: AT + 3 * DAY,
    premiumUntil: AT + 3 * DAY,
  };
  chests.grant(p, "high", AT, { claimRequired: true });
  chests.notice(p, "Показанная награда", AT);
  p.clanChests.notices[1].notifiedAt = AT + DAY - 1;
  chests.notice(p, "Новая награда", AT + 1000);
  const before = structuredClone(p),
    freshId = p.clanChests.notices[2].id;
  assert.equal(chests.needsExpiry(p, AT + DAY - 1), false);
  assert.equal(chests.view(p, AT + DAY - 1).notices.length, 3);
  assert.deepEqual(
    chests.view(p, AT + DAY).notices.map((n) => n.id),
    [freshId],
  );
  assert.deepEqual(p, before, "Reading must not mutate committed data");
  assert.equal(chests.needsExpiry(p, AT + DAY), true);
  assert.equal(chests.expire(p, AT + DAY), true);
  assert.deepEqual(
    p.clanChests.notices.map((n) => n.id),
    [freshId],
  );
  assert.deepEqual(p.clanChests.items, before.clanChests.items);
  for (const field of ["wallet", "inventory", "greatness", "quests", "transactions"])
    assert.deepEqual(p[field], before[field]);
  assert.equal(chests.expire(p, AT + DAY), false);
  chests.act(p, "dismiss", freshId, AT + DAY);
  chests.act(p, "dismiss", freshId, AT + DAY);
  assert.deepEqual(p.clanChests.notices, []);
  assert.deepEqual(p.clanChests.items, before.clanChests.items);
});

test("Automatic notice cleanup survives reload and rolls back on disk failure without losing rewards", (t) => {
  const filePath = path.join(temporary(t), "profiles.json");
  let now = AT;
  const store = new ProfileStore({ filePath, now: () => now }),
    auth = store.open(),
    get = () => store.find(auth.token);
  get().account = {
    dailyDay: null,
    dailyAmount: 0,
    vipUntil: AT + 3 * DAY,
    premiumUntil: AT + 3 * DAY,
  };
  chests.grant(get(), "high", AT, { claimRequired: true });
  store.save(store.data, now);
  const before = structuredClone(store.data),
    reward = structuredClone(get().clanChests.items);
  now += DAY;
  store.filePath = path.join(filePath, "invalid.json");
  assert.throws(() => store.refreshCompetition());
  assert.deepEqual(store.data, before);
  store.filePath = filePath;
  assert.equal(store.refreshCompetition(), true);
  assert.deepEqual(get().clanChests.notices, []);
  assert.deepEqual(get().clanChests.items, reward);
  const reload = new ProfileStore({ filePath, now: () => now });
  assert.deepEqual(reload.find(auth.token).clanChests.notices, []);
  assert.deepEqual(reload.find(auth.token).clanChests.items, reward);
  assert.equal(reload.refreshCompetition(), false);
  reload.clanChestAction(auth.token, {
    action: "claim",
    chestId: reward[0].id,
    requestId: randomUUID(),
  });
  assert.equal(reload.find(auth.token).clanChests.items[0].stored, true);
});
test("Clan notice first-display receipts persist independently of rewards, with rollback and replay", (t) => {
  const filePath = path.join(temporary(t), "profiles.json"),
    store = new ProfileStore({ filePath, now: () => AT }),
    auth = store.open(),
    get = () => store.find(auth.token);
  chests.grant(get(), "high", AT, { claimRequired: true });
  chests.notice(get(), "Награда за неделю: Бронзовая. Призовое место: 1.", AT);
  store.save(store.data, AT);
  const before = structuredClone(get()),
    ids = before.clanChests.notices.map((n) => n.id),
    request = { action: "notice", ids, requestId: randomUUID() },
    save = store.save.bind(store);
  store.save = () => {
    throw Error("disk failure");
  };
  assert.throws(() => store.clanChestAction(auth.token, request), /disk failure/);
  assert.deepEqual(get(), before);
  store.save = save;
  store.clanChestAction(auth.token, request);
  const expected = structuredClone(before.clanChests);
  expected.notices.forEach((n) => {
    n.notifiedAt = AT;
  });
  assert.deepEqual(get().clanChests, expected);
  for (const field of ["wallet", "inventory", "greatness", "quests", "transactions"])
    assert.deepEqual(get()[field], before[field]);
  const reload = new ProfileStore({ filePath, now: () => AT + 10000 });
  assert.equal(reload.clanChestAction(auth.token, request).replay, true);
  reload.clanChestAction(auth.token, { ...request, requestId: randomUUID() });
  assert.deepEqual(reload.find(auth.token).clanChests, expected);
  const other = reload.open();
  reload.clanChestAction(other.token, { ...request, requestId: randomUUID() });
  assert.deepEqual(reload.view(reload.find(other.token)).clanChests.notices, []);
  for (const bad of [[], null, [1], [""], ["x".repeat(101)], Array(101).fill(ids[0])])
    assert.throws(
      () => reload.clanChestAction(auth.token, { ...request, ids: bad }),
      /Некорректные/,
    );
  chests.notice(reload.find(auth.token), "Новая награда", AT + 10000);
  assert.equal(
    reload.view(reload.find(auth.token)).clanChests.notices.at(-1).notifiedAt,
    undefined,
  );
  reload.clanChestAction(auth.token, {
    action: "claim",
    chestId: expected.items[0].id,
    requestId: randomUUID(),
  });
  assert.equal(reload.find(auth.token).clanChests.items[0].stored, true);
  assert.deepEqual(reload.find(auth.token).clanChests.notices.slice(0, 2), expected.notices);
});
