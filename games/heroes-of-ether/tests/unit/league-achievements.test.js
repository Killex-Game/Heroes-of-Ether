"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const { setup } = require("../fixtures/season-trophies"),
  { temporary } = require("../temp");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const activity = require("../../src/server/progression/activity-achievements"),
  rules = require("../../public/shared/clan-competition-rules");
const { TITLES } = require("../../src/server/progression/title-chest-rewards");
const ids = [
  "league_conqueror",
  "league_fighter",
  "victory_march",
  "cup_keeper",
  "champion_dynasty",
];
function kill(f, u, packet = randomUUID(), victim = randomUUID()) {
  const p = f.p(u);
  if (!p.progress.session) f.profiles.startLife(p.id, randomUUID());
  f.profiles.applyArenaProgress(
    packet,
    [{ type: "absorbed", profileId: p.id, victimProfileId: victim, gain: 1 }],
    f.now(),
  );
  return { packet, victim };
}
test("Лиги: все шесть разных лиг дают одну награду; смена клана, понижение и тестовые фоны не стирают прогресс", () => {
  const f = setup(),
    u = f.heads[0];
  f.profiles.unlockLeagueBackgrounds = f.profiles.unlockLeagueFrames = true;
  f.profiles.save(f.profiles.data);
  assert.deepEqual(f.p(u).activity.leagueVisits, ["bronze"]);
  assert.equal(f.p(u).activity.claimed.league_conqueror, 0);
  for (const rank of [1, 2, 1, 3, 4, 3]) {
    f.c(u).competition.league = rank;
    f.profiles.save(f.profiles.data);
  }
  assert.equal(f.p(u).activity.values.league_conqueror, 5);
  assert.equal(f.p(u).activity.claimed.league_conqueror, 0);
  const before = structuredClone(f.p(u));
  f.c(u).competition.league = 5;
  f.profiles.save(f.profiles.data);
  const p = f.p(u);
  assert.equal(p.activity.claimed.league_conqueror, 1);
  assert.equal(
    p.greatness - before.greatness,
    1000 + TITLES.slice(before.honors.claimed, p.honors.claimed).reduce((n, t) => n + t.reward, 0),
  );
  const earned = p.greatness,
    visits = p.activity.leagueVisits.slice();
  f.profiles.save(f.profiles.data);
  assert.equal(f.p(u).greatness, earned);
  activity.changeClan(f.p(u), null, f.now());
  assert.deepEqual(f.p(u).activity.leagueVisits, visits);
  activity.validateActivity(f.p(u));
});
test("Лиги: точные цели и награды пяти степеней, новый кубок открывает только одну степень", () => {
  const f = setup(),
    p = f.p(f.heads[0]);
  const cases = [
    ["league_fighter", "kills", [1000, 5000, 15000, 50000, 100000], [10, 50, 100, 150, 300]],
    ["victory_march", "victory", [3, 10, 30, 100, 200], [10, 50, 100, 150, 300]],
    ["cup_keeper", "cup", [1, 2, 3, 5, 10], [100, 500, 1000, 1500, 3000]],
  ];
  for (const [id, event, targets, rewards] of cases) {
    const d = activity.EXTRA_ACHIEVEMENTS.find((d) => d.id === id);
    assert.deepEqual(d.thresholds, targets);
    assert.deepEqual(d.rewards, rewards);
    for (let i = 0; i < targets.length; i++) {
      const before = structuredClone(p);
      if (event === "kills") activity.leagueEvent(p, event, targets[i], f.now());
      else
        for (let n = 0; n < targets[i]; n++)
          activity.leagueEvent(p, event, event === "cup" ? 0 : 1, f.now());
      assert.equal(p.activity.claimed[id], i + 1);
      assert.equal(
        p.greatness - before.greatness,
        rewards[i] +
          TITLES.slice(before.honors.claimed, p.honors.claimed).reduce((n, t) => n + t.reward, 0),
      );
      assert.equal(
        activity.publicExtra(p).find((d) => d.id === id).value,
        i === 4 ? targets[i] : 0,
      );
      activity.validateActivity(p);
    }
  }
  for (let i = 0; i < 6; i++) {
    const before = structuredClone(p);
    activity.leagueEvent(p, "cup", 5, f.now());
    assert.equal(p.activity.claimed.champion_dynasty, Math.min(5, i + 1));
    assert.equal(
      p.greatness - before.greatness,
      (i < 5 ? 3000 : 0) +
        TITLES.slice(before.honors.claimed, p.honors.claimed).reduce((n, t) => n + t.reward, 0),
    );
    activity.validateActivity(p);
  }
});
test("Боец лиги: только зачтённые киллы, без повторов пакета, жертвы, вне битвы и новобранца", () => {
  const f = setup({ count: 10, start: "2026-10-19T04:59:00Z" }),
    u = f.heads[0];
  kill(f, u);
  assert.equal(f.p(u).activity.values.league_fighter, 0);
  f.time("2026-10-19T05:01:00Z");
  f.profiles.refreshCompetition();
  const { packet, victim } = kill(f, u);
  kill(f, u, packet, victim);
  kill(f, u, randomUUID(), victim);
  assert.equal(f.p(u).activity.values.league_fighter, 1);
  const recruit = f.user();
  f.act(recruit, "apply", { clanId: f.c(u).id });
  kill(f, recruit);
  assert.equal(f.p(recruit).activity.values.league_fighter, 0);
  f.time("2026-10-19T21:01:00Z");
  f.profiles.refreshCompetition();
  kill(f, u);
  assert.equal(f.p(u).activity.values.league_fighter, 1);
  assert.equal(f.p(u).activity.values.victory_march, 1);
  assert.equal(f.p(recruit).activity.values.victory_march, 0);
});
test("Победный марш: ничья, поражение, выход и отсутствие зачётных киллов не дают победу", () => {
  for (const mode of ["draw", "loss", "left", "win"]) {
    const f = setup({ count: 10, start: "2026-10-19T04:59:00Z" }),
      u = f.heads[0],
      member = f.user(),
      idle = f.user(),
      clanId = f.c(u).id;
    f.act(member, "apply", { clanId });
    f.act(idle, "apply", { clanId });
    f.time("2026-10-19T05:01:00Z");
    f.profiles.refreshCompetition();
    const pair = f.profiles.data.competition.day.pairs.find(
      (p) => p.a === clanId || p.b === clanId,
    );
    const enemy = f.heads.find((h) => f.c(h).id === (pair.a === clanId ? pair.b : pair.a));
    kill(f, member);
    if (mode === "draw" || mode === "loss") kill(f, enemy);
    if (mode === "loss") kill(f, enemy);
    if (mode === "left") f.act(member, "leave", { clanId });
    f.time("2026-10-19T21:01:00Z");
    f.profiles.refreshCompetition();
    assert.equal(f.p(member).activity.values.victory_march, mode === "win" ? 1 : 0, mode);
    assert.equal(f.p(idle).activity.values.victory_march, 0);
    const saved = structuredClone(f.profiles.data);
    f.profiles.refreshCompetition();
    assert.deepEqual(f.profiles.data, saved);
  }
});
test("Кубки: награда учитывается у всех текущих участников один раз, только чемпионская повышает Династию", () => {
  const f = setup(),
    u = f.heads[0],
    idle = f.user(),
    left = f.user();
  for (const who of [idle, left]) f.act(who, "apply", { clanId: f.c(u).id });
  f.act(left, "leave", { clanId: f.c(u).id });
  for (const [i, rank] of [2, 5, 5, 5, 5, 5].entries()) {
    f.c(u).competition.league = rank;
    f.profiles.save(f.profiles.data);
    f.time(f.profiles.data.competition.season.end);
    f.profiles.refreshCompetition();
    for (const who of [u, idle]) {
      assert.equal(f.p(who).activity.values.cup_keeper, i + 1);
      assert.equal(f.p(who).activity.claimed.champion_dynasty, i);
    }
    assert.equal(f.p(left).activity.values.cup_keeper, 0);
    const saved = structuredClone(f.profiles.data);
    f.profiles.refreshCompetition();
    assert.deepEqual(f.profiles.data, saved);
  }
  const newcomer = f.user();
  f.act(newcomer, "apply", { clanId: f.c(u).id });
  assert.equal(f.p(newcomer).activity.values.cup_keeper, 0);
});
test("Миграция достижений сохраняет прежний прогресс; неполные и повреждённые новые данные отклоняются", (t) => {
  const filePath = path.join(temporary(t, "league-migration"), "profiles.json"),
    f = setup({ filePath }),
    u = f.heads[0];
  const raw = structuredClone(f.profiles.data);
  raw.version = 10;
  for (const p of Object.values(raw.profiles)) {
    for (const id of ids) {
      delete p.activity.values[id];
      delete p.activity.claimed[id];
      delete p.activity.stageSpent[id];
    }
    delete p.activity.leagueVisits;
  }
  fs.writeFileSync(filePath, JSON.stringify(raw));
  const migrated = new ProfileStore({ filePath, now: f.now }),
    before = structuredClone(f.p(u));
  assert.equal(migrated.data.version, 13);
  assert.equal(migrated.leagueMigrationPending, true);
  migrated.refreshCompetition();
  const p = migrated.find(u.token);
  assert.deepEqual(p.wallet, before.wallet);
  assert.equal(p.greatness, before.greatness);
  for (const field of ["progress", "honors", "inventory"])
    assert.deepEqual(p[field], before[field]);
  assert.deepEqual(p.activity.leagueVisits, ["bronze"]);
  const restored = new ProfileStore({ filePath, now: f.now });
  assert.deepEqual(restored.data.profiles, migrated.data.profiles);
  for (const corrupt of [
    (p) => {
      delete p.activity.values.cup_keeper;
    },
    (p) => p.activity.leagueVisits.push("bronze"),
    (p) => {
      p.activity.claimed.champion_dynasty = 5;
    },
  ]) {
    const bad = structuredClone(migrated.data);
    corrupt(Object.values(bad.profiles)[0]);
    fs.writeFileSync(filePath, JSON.stringify(bad));
    assert.throws(() => new ProfileStore({ filePath, now: f.now }), /достижен/);
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath)), bad);
  }
});
module.exports = { kill };
