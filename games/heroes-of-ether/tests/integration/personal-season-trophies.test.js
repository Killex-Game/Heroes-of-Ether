"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { setup } = require("../fixtures/season-trophies"),
  { temporary } = require("../temp"),
  { ProfileStore } = require("../../src/server/profiles/profile-store");

test("Личные кубки: сохраняются после выхода, новички не получают прежние кубки клана", () => {
  const f = setup(),
    head = f.heads[0],
    member = f.user();
  f.act(member, "apply", { clanId: f.c(head).id });
  for (let i = 0; i < 2; i++) {
    f.c(head).competition.league = 5;
    f.profiles.save(f.profiles.data);
    f.time(f.profiles.data.competition.season.end);
    f.profiles.refreshCompetition();
  }
  const cups = structuredClone(f.p(member).seasonTrophies);
  assert.equal(cups.length, 2);
  const wallet = structuredClone(f.p(member).wallet);
  f.act(member, "leave", { clanId: f.c(head).id });
  const outsider = f.user();
  f.act(outsider, "apply", { clanId: f.c(head).id });
  assert.deepEqual(f.profiles.publicPlayer(f.p(outsider).id).seasonTrophies, []);
  assert.deepEqual(f.profiles.publicPlayer(f.p(member).id).seasonTrophies, cups.toReversed());
  assert.deepEqual(f.p(member).wallet, wallet);
  const response = f.profiles.publicPlayer(f.p(member).id);
  response.seasonTrophies[0].league = 0;
  assert.deepEqual(
    f.p(member).seasonTrophies,
    cups,
    "public projection must not mutate the ledger",
  );
});

test("Миграция кубков: только подтверждённые выплаты, без валюты, повторов и привязки к текущему клану", (t) => {
  const filePath = path.join(temporary(t, "personal-cup-migration"), "profiles.json"),
    f = setup({ filePath }),
    head = f.heads[0],
    oldMember = f.user();
  f.act(oldMember, "apply", { clanId: f.c(head).id });
  f.time(f.profiles.data.competition.season.end);
  f.profiles.refreshCompetition();
  f.act(oldMember, "leave", { clanId: f.c(head).id });
  const newcomer = f.user();
  f.act(newcomer, "apply", { clanId: f.c(head).id });
  const data = structuredClone(f.profiles.data);
  for (const p of Object.values(data.profiles)) delete p.seasonTrophies;
  fs.writeFileSync(filePath, JSON.stringify(data));
  const disk = fs.readFileSync(filePath, "utf8"),
    loaded = new ProfileStore({ filePath, now: f.now });
  assert.equal(loaded.trophyMigrationPending, true);
  const expected = f.c(head).competition.trophies;
  for (const u of [head, oldMember])
    assert.deepEqual(loaded.find(u.token).seasonTrophies, expected);
  assert.deepEqual(loaded.find(newcomer.token).seasonTrophies, []);
  const rename = fs.renameSync;
  const writer = t.mock.method(fs, "renameSync", () => {
    throw Error("test disk full");
  });
  assert.throws(() => loaded.refreshCompetition(), /disk full/);
  assert.equal(fs.readFileSync(filePath, "utf8"), disk);
  assert.equal(loaded.trophyMigrationPending, true);
  writer.mock.restore();
  assert.equal(fs.renameSync, rename);
  loaded.refreshCompetition();
  for (const [key, p] of Object.entries(loaded.data.profiles)) {
    const unchanged = structuredClone(p);
    delete unchanged.seasonTrophies;
    unchanged.revision = data.profiles[key].revision;
    assert.deepEqual(unchanged, data.profiles[key], "migration changes only history and revision");
  }
  const saved = fs.readFileSync(filePath, "utf8"),
    restored = new ProfileStore({ filePath, now: f.now });
  restored.refreshCompetition();
  assert.equal(fs.readFileSync(filePath, "utf8"), saved);
  assert.deepEqual(restored.data, loaded.data);
  const invalid = structuredClone(restored.data);
  Object.values(invalid.profiles)
    .find((p) => p.seasonTrophies.length)
    .seasonTrophies.push(expected[0]);
  fs.writeFileSync(filePath, JSON.stringify(invalid));
  assert.throws(() => new ProfileStore({ filePath, now: f.now }), /Повреждена история/);
});
