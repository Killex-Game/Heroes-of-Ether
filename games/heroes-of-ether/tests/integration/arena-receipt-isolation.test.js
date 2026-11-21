"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
test("Arena receipt history is shared on samples, isolated on absorption, and survives failed/repeated commits", async (t) => {
  let at = Date.UTC(2026, 10, 6, 12);
  const store = new ProfileStore({ filePath: null, now: () => at });
  t.after(() => store.close());
  const auth = store.open();
  store.startLife(auth.profile.id, "life");
  const old = store.find(auth.token);
  old.quests.session.seen = Object.freeze({ "earlier:part": true });
  const seen = old.quests.session.seen;
  at += 1000;
  store.applyArenaProgress(
    "sample",
    [{ type: "lifeTime", profileId: old.id, lifeId: "life", durationSeconds: 1 }],
    at,
  );
  assert.equal(store.find(auth.token).quests.session.seen, seen);
  const before = structuredClone(store.data),
    save = store.save;
  const events = [
    { type: "massPeak", profileId: old.id, lifeId: "life", mass: 100 },
    ...["one", "two"].map((victimPartId) => ({
      type: "absorbed",
      profileId: old.id,
      lifeId: "victim-life",
      victimProfileId: "victim",
      victimPartId,
      victimDefeated: false,
      gain: 10,
    })),
  ];
  store.save = () => {
    throw Error("simulated write failure");
  };
  assert.throws(() => store.applyArenaProgress("absorb", events, at), /simulated write/);
  assert.deepEqual(store.data, before);
  assert.deepEqual(seen, { "earlier:part": true });
  store.save = save;
  store.applyArenaProgress("absorb", events, at);
  const current = store.find(auth.token);
  assert.equal(current.quests.session.seen, seen);
  assert.deepEqual(Object.assign({}, current.quests.session.seen,
    ...Object.values(current.quests.session.seenBuckets)), {
    "earlier:part": true,
    "victim-life:one": true,
    "victim-life:two": true,
  });
  const committed = structuredClone(store.data);
  store.applyArenaProgress("absorb", events, at);
  assert.deepEqual(store.data, committed);
  assert.deepEqual(seen, { "earlier:part": true });
});

test("Bucketed absorption history remains isolated on failure, replay and new lives", async (t) => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-receipts-"));
  const filePath = path.join(dir, "profiles.json"), at = Date.UTC(2026, 10, 6, 12);
  let store = new ProfileStore({ filePath, journal: true, now: () => at });
  t.after(async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const auth = store.open();
  store.startLife(auth.profile.id, "life");
  const events = Array.from({ length: 2000 }, (_, i) => ({ type: "absorbed", profileId: auth.profile.id,
    lifeId: "victim-life", victimProfileId: "victim", victimPartId: String(i), victimDefeated: false, gain: 1 }));
  store.applyArenaProgress("first", events, at);
  const p = store.find(auth.token), session = p.quests.session;
  for (const bucket of Object.values(session.seenBuckets)) Object.freeze(bucket);
  Object.freeze(session.seenBuckets);
  const nextEvent = { ...events[0], victimPartId: "new" };
  const before = structuredClone(store.data), save = store.save;
  store.save = () => { throw Error("failed write"); };
  assert.throws(() => store.applyArenaProgress("second", [nextEvent], at), /failed write/);
  assert.deepEqual(store.data, before);
  store.save = save;
  const bytes = store.journal.activeBytes;
  store.applyArenaProgress("second", [nextEvent], at);
  assert.ok(store.journal.activeBytes - bytes < 4000, "Only the touched bucket should be journalled");
  const next = store.find(auth.token).quests.session;
  assert.equal(Object.values(next.seenBuckets).filter((b, i) => b !== Object.values(session.seenBuckets)[i]).length, 1);
  const committed = structuredClone(store.find(auth.token));
  const recovered = require("../../src/server/profiles/profile-journal").recover(filePath).data;
  assert.deepEqual(Object.values(recovered.profiles).find(row => row.id === auth.profile.id).quests,
    committed.quests, "Uncheckpointed bucket deltas recover from the journal");
  await store.close();
  store = new ProfileStore({ filePath, journal: true, now: () => at });
  assert.deepEqual(store.find(auth.token).quests, committed.quests);
  const quests = require("../../src/server/progression/personal-quests");
  const draft = structuredClone(store.find(auth.token));
  quests.progress(draft, nextEvent, at);
  assert.deepEqual(draft.quests, committed.quests, "A repeated absorption after recovery is ignored");
  store.startLife(auth.profile.id, "new-life");
  assert.equal(store.find(auth.token).quests.session.seenBuckets, undefined);
  assert.deepEqual(store.find(auth.token).quests.session.seen, {});
});

test("Every changed or loaded receipt bucket is validated", () => {
  const receipts = require("../../src/server/progression/quest-receipts");
  const session = { seen: { legacy: true } };
  assert.equal(receipts.record(session, "legacy"), false);
  assert.equal(receipts.record(session, "new"), true);
  assert.equal(receipts.record(session, "new"), false);
  assert.equal(receipts.valid(session.seenBuckets), true);
  const bucket = Object.keys(session.seenBuckets)[0];
  const broken = { ...session.seenBuckets, [bucket]: { new: false } };
  assert.equal(receipts.valid(broken), false);
  assert.equal(receipts.valid(broken, session.seenBuckets), false);
  assert.equal(receipts.valid({ "128": {} }), false);
  assert.equal(receipts.valid({ "00": {} }), false);
  assert.equal(receipts.valid([]), false);
  assert.equal(receipts.valid({ "0": { new: true } }), bucket === "0");
});
test("Changed and loaded quest receipt maps still receive full validation", async (t) => {
  const store = new ProfileStore({ filePath: null });
  t.after(() => store.close());
  const auth = store.open();
  store.startLife(auth.profile.id, "life");
  const p = structuredClone(store.find(auth.token)),
    before = p.quests.session.seen;
  p.quests.session.seen = { ...before, bad: false };
  const quests = require("../../src/server/progression/personal-quests");
  assert.throws(() => quests.validate(p), /Повреждены личные задания/);
  assert.throws(() => quests.validate(p, before), /Повреждены личные задания/);
});
