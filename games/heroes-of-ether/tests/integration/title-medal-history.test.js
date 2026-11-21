"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const { temporary } = require("../temp"),
  { ProfileStore } = require("../../src/server/profiles/profile-store");
const T = require("../../src/server/progression/title-chest-rewards");
const { randomUUID } = require("node:crypto");
test("Медали званий сохраняют первую дату, полный набор и переживают повтор, отказ записи и перезапуск", (t) => {
  const filePath = path.join(temporary(t, "title-medals"), "profiles.json");
  let at = Date.UTC(2026, 10, 1, 10),
    store = new ProfileStore({ filePath, now: () => at }),
    auth = store.open(),
    p = () => store.find(auth.token);
  p().greatness = 25000;
  T.awardTitles(p(), at);
  const expected = T.publicTitleMedals(p());
  assert.equal(expected.length, 3);
  assert.ok(expected.every((m) => m.awardedAt === at));
  at += 10000;
  T.awardTitles(p(), at);
  assert.deepEqual(T.publicTitleMedals(p()), expected);
  const before = structuredClone(p()),
    save = store.save;
  store.save = () => {
    throw Error("disk failure");
  };
  assert.throws(
    () => store.acknowledgeTitle(auth.token, { degree: 3, requestId: randomUUID() }),
    /disk failure/,
  );
  assert.deepEqual(p(), before);
  store.save = save;
  store.acknowledgeTitle(auth.token, { degree: 3, requestId: randomUUID() });
  store = new ProfileStore({ filePath, now: () => at });
  assert.deepEqual(T.publicTitleMedals(p()), expected);
  assert.deepEqual(store.publicPlayer(p().id).titleMedals, expected);
  p().greatness = 100000;
  T.awardTitles(p(), at);
  assert.equal(T.publicTitleMedals(p()).at(-1).awardedAt, at);
  p().greatness = 100;
  T.rebalanceTitles(p());
  assert.equal(T.publicTitleMedals(p()).length, 4);
});
test("Исторические медали без записанной даты не получают выдуманный срок", () => {
  const store = new ProfileStore(),
    auth = store.open(),
    p = store.find(auth.token);
  p.greatness = 25000;
  T.awardTitles(p, 1000);
  delete p.honors.medals;
  assert.equal(T.publicTitleMedals(p).length, 3);
  assert.ok(T.publicTitleMedals(p).every((m) => m.awardedAt === null));
  p.greatness = 100000;
  T.awardTitles(p, 2000);
  assert.equal(T.publicTitleMedals(p)[0].awardedAt, null);
  assert.equal(T.publicTitleMedals(p)[3].awardedAt, 2000);
  p.honors.medals.novice = -1;
  assert.throws(() => T.validateHonors(p));
});
