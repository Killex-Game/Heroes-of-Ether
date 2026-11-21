"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { seedTestClans, TestBots, MARKER } = require("../../src/server/testing/arena-test-bots");
const { prepareExtraBattleClans, BATCH } = require("../../src/server/testing/extra-battle-clans");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { createGameServer } = require("../../src/server/game-server");
const { temporary } = require("../temp");
const competition = require("../../src/server/clans/clan-competition-service");
const AT = Date.parse("2026-10-27T12:00:00Z");
function fixture(at = AT) {
  const store = new ProfileStore({ now: () => at });
  seedTestClans(store, at);
  const next = structuredClone(store.data),
    clan = Object.values(next.clans)[0];
  clan.competition.league = 1;
  const pair = next.competition.day?.pairs.find((p) => p.a === clan.id || p.b === clan.id);
  const removed = new Set(pair ? [pair.a, pair.b] : [clan.id, Object.keys(next.clans)[1]]);
  next.competition.week.groups[0].clans = next.competition.week.groups[0].clans.filter(
    (id) => !removed.has(id),
  );
  if (pair) {
    next.competition.day.pairs = next.competition.day.pairs.filter((p) => p !== pair);
    for (const id of removed) delete next.competition.day.rosters[id];
  }
  store.save(next, at);
  return { store, clanId: clan.id };
}
test("Дополнительные лиги: 19 кланов, 190 ботов, реальные составы и пары, повтор безопасен", () => {
  const { store, clanId } = fixture(),
    before = structuredClone(store.data);
  const result = prepareExtraBattleClans(store.data, AT);
  assert.deepEqual(store.data, before, "preparation has no side effects");
  assert.equal(result.summary.addedClans, 19);
  assert.equal(result.summary.addedBots, 190);
  assert.equal(result.summary.addedGroups, 2);
  assert.equal(result.summary.addedPairs, 10);
  assert.ok(result.data.competition.day.pairs.some((p) => p.a === clanId || p.b === clanId));
  for (const c of Object.values(result.data.clans).filter((c) =>
    c.testSeedKey?.startsWith(BATCH),
  )) {
    assert.equal(c.members.length, 10);
    assert.equal(c.testOnly, MARKER);
    assert.deepEqual(c.competition.medals, {});
    for (const id of c.members) {
      assert.ok(competition.eligible(c, id, AT));
      assert.ok(result.data.competition.day.rosters[c.id].includes(id));
      assert.equal(Object.values(result.data.profiles).find((p) => p.id === id).testBot, MARKER);
    }
  }
  const again = prepareExtraBattleClans(result.data, AT);
  assert.equal(again.summary.addedClans, 0);
  assert.equal(again.summary.addedGroups, 0);
  assert.deepEqual(again.data, result.data);
});
test("Новые боты появляются по ротации и реальные киллы идут в битву и неделю", async (t) => {
  const { store } = fixture();
  store.data = prepareExtraBattleClans(store.data, AT).data;
  const arena = new Arena({ etherCount: 0 });
  const bots = new TestBots({ arena, profiles: store, enabled: true });
  arena.addPlayer(0);
  const seen = new Set();
  for (let minute = 0; minute < Object.keys(store.data.clans).length; minute++) {
    bots.update(minute * 60000, AT, 35);
    assert.ok(bots.status().activeBots <= 15);
    for (const p of arena.players.values()) if (p.isTestBot) seen.add(p.clanId);
  }
  for (const c of Object.values(store.data.clans).filter((c) => c.testSeedKey?.startsWith(BATCH)))
    assert.ok(seen.has(c.id));
  let now = 0;
  const app = createGameServer({
    profiles: store,
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => now,
    wallNow: () => AT,
    testBots: { enabled: true },
  });
  t.after(() => app.close());
  app.arena.addPlayer(0);
  now = 16 * 60000;
  app.tick();
  const attacker = [...app.arena.players.values()].find(
    (p) => p.isTestBot && store.data.clans[p.clanId].testSeedKey?.startsWith(BATCH),
  );
  const victim = [...app.arena.players.values()].find(
    (p) => p.isTestBot && p.clanId !== attacker.clanId,
  );
  for (const [p, mass] of [
    [attacker, 500],
    [victim, 10],
  ])
    Object.assign(p, {
      x: 1800,
      y: 1200,
      targetX: 1800,
      targetY: 1200,
      mass,
      radius: radiusForMass(mass),
      protectedUntil: 0,
      stopped: true,
    });
  app.bots.nextThinkAt = now + 10000;
  now += 3000;
  app.tick();
  assert.ok(store.data.competition.day.scores[attacker.clanId].kills > 0);
  assert.ok(store.data.competition.week.scores[attacker.clanId].kills > 0);
});
test("Offline применение: запрет при работающем сервере, отказ записи, восстановление и повтор", (t) => {
  const directory = temporary(t, "extra-clans"),
    file = path.join(directory, "profiles.json");
  const { store } = fixture(Date.now());
  fs.writeFileSync(file, JSON.stringify(store.data));
  const original = fs.readFileSync(file),
    lock = path.join(directory, "server.lock");
  const script = path.resolve(__dirname, "../../scripts/development/seed-extra-battle-clans.js");
  fs.writeFileSync(lock, "1");
  let run = spawnSync(process.execPath, [script, "--apply", "--profiles", file], {
    encoding: "utf8",
  });
  assert.notEqual(run.status, 0);
  assert.ok(fs.readFileSync(file).equals(original));
  fs.unlinkSync(lock);
  run = spawnSync(
    process.execPath,
    [
      "-e",
      "const fs=require('node:fs'); fs.renameSync=()=>{throw Error('disk failure')}; const script=process.argv[1]; process.argv=[process.execPath,...process.argv.slice(1)]; require(script);",
      script,
      "--apply",
      "--profiles",
      file,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /disk failure/);
  assert.ok(fs.readFileSync(file).equals(original));
  assert.equal(fs.existsSync(file + ".extra-clans.tmp"), false);
  run = spawnSync(process.execPath, [script, "--apply", "--profiles", file], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).addedClans, 19);
  new ProfileStore({ filePath: file });
  const applied = fs.readFileSync(file);
  run = spawnSync(process.execPath, [script, "--apply", "--profiles", file], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).addedClans, 0);
  assert.ok(fs.readFileSync(file).equals(applied));
});
