"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { ProfileJournal, recover } = require("../../src/server/profiles/profile-journal");

test("Quest session deltas preserve absorption history across WAL replay and checkpoints", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quest-journal-"));
  const file = path.join(dir, "profiles.json");
  const journal = new ProfileJournal(file, { intervalMs: 60000 });
  t.after(async () => {
    if (!journal.closed) await journal.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const seen = Object.freeze(
    Object.fromEntries(Array.from({ length: 2000 }, (_, i) => ["victim-part-" + i, true])),
  );
  let p = {
    coins: 100,
    roulette: { results: [] },
    quests: { day: "2026-11-06", session: { lifeId: "one", seconds: 0, seen } },
  };
  const save = (next) => {
    p = next;
    journal.commit({ profiles: { p }, clans: {} });
  };
  const check = () => assert.deepEqual(recover(file).data.profiles.p, p);
  save(p);
  const before = journal.activeBytes;
  save({ ...p, quests: { ...p.quests, session: { ...p.quests.session, seconds: 30 } } });
  assert.ok(
    journal.activeBytes - before < 1000,
    "A time sample must not rewrite 2000 unchanged receipts",
  );
  check();
  // New absorptions, a daily reset and a new life must all remain durable.
  save({
    ...p,
    quests: { ...p.quests, session: { ...p.quests.session, seen: { ...seen, newVictim: true } } },
  });
  check();
  await journal.requestCheckpoint();
  save({ ...p, quests: { ...p.quests, day: "2026-11-07" } });
  check();
  save({ ...p, quests: { ...p.quests, session: { lifeId: "two", seconds: 0, seen: {} } } });
  check();
  save({ ...p, quests: { ...p.quests, session: null } });
  check();
  await journal.close();
  check();
});
