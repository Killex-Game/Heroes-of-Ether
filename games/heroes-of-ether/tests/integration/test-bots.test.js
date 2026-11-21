/* Интеграционные проверки сервера и протокола. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { randomUUID } = require("node:crypto"),
  { once } = require("node:events"),
  WebSocket = require("ws");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service");
const { freshProgress } = require("../../src/server/progression/experience-progression"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const {
    TestBots,
    seedTestClans,
    fillTestGroupRosters,
    MARKER,
  } = require("../../src/server/testing/arena-test-bots"),
  { createGameServer } = require("../../src/server/game-server");
const { temporary } = require("../temp");
const WALL = Date.parse("2026-10-20T06:00:00Z");
function realClan(store) {
  const u = store.open(),
    p = store.find(u.token);
  p.level = 12;
  p.progress = freshProgress(12);
  p.wallet.coins = 2000;
  new ClanService(store).mutate(u.token, {
    requestId: randomUUID(),
    action: "create",
    name: "Настоящий клан",
    prefix: "REAL",
    emblem: "grove",
    privacy: "open",
  });
  return u;
}
function setup(options = {}) {
  const profiles = new ProfileStore({ now: () => WALL }),
    arena = new Arena({ etherCount: 20 });
  return { profiles, arena, bots: new TestBots({ profiles, arena, enabled: true, ...options }) };
}
test("Тестовые кланы: одна атомарная запись, 16 кланов, реальные игроки сохранены, повтор без дублей", (t) => {
  const filePath = path.join(temporary(t, "bots"), "profiles.json"),
    store = new ProfileStore({ filePath, now: () => WALL });
  const user = realClan(store),
    before = structuredClone(store.find(user.token));
  let saves = 0;
  const save = store.save.bind(store);
  store.save = (...args) => {
    saves++;
    return save(...args);
  };
  assert.equal(seedTestClans(store, WALL), true);
  assert.equal(saves, 1);
  assert.equal(Object.keys(store.data.clans).length, 16);
  assert.equal(Object.keys(store.data.profiles).length, 151);
  assert.deepEqual(store.find(user.token), before);
  assert.equal(store.data.competition.week.groups[0].clans.length, 14);
  assert.equal(store.data.competition.day.pairs.length, 7);
  assert.equal(seedTestClans(store, WALL), false);
  assert.equal(saves, 1);
  const reloaded = new ProfileStore({ filePath, now: () => WALL });
  assert.equal(
    Object.values(reloaded.data.profiles).filter((p) => p.testBot === MARKER).length,
    150,
  );
  assert.equal(seedTestClans(reloaded, WALL), false);
});
test("Ошибка записи не оставляет половину тестовых кланов", () => {
  const { profiles } = setup(),
    before = JSON.stringify(profiles.data);
  profiles.save = () => {
    throw Error("disk");
  };
  assert.throws(() => seedTestClans(profiles, WALL), /disk/);
  assert.equal(JSON.stringify(profiles.data), before);
});
test("Пополнение группы: 10 ботов своему клану, остальные до 10, без дублей и изменений существующих профилей", () => {
  const at = WALL - 2 * 3600000,
    store = new ProfileStore({ now: () => at }),
    owner = realClan(store),
    clanId = store.find(owner.token).clanId;
  const member = store.open(),
    p = store.find(member.token);
  p.level = 12;
  p.progress = freshProgress(12);
  new ClanService(store).mutate(member.token, { requestId: randomUUID(), action: "apply", clanId });
  seedTestClans(store, at);
  const before = structuredClone(store.data),
    save = store.save.bind(store);
  let saves = 0;
  store.save = (...args) => {
    saves++;
    return save(...args);
  };
  assert.deepEqual(fillTestGroupRosters(store, { clanId }, at), { added: 10 });
  assert.equal(saves, 1);
  for (const [key, profile] of Object.entries(before.profiles))
    assert.deepEqual(store.data.profiles[key], profile);
  for (const clan of Object.values(store.data.clans)) {
    const old = before.clans[clan.id];
    assert.equal(clan.members.length, clan.id === clanId ? 12 : 10);
    for (const key of ["ownerId", "treasury", "xp", "crest", "testOnly"])
      assert.deepEqual(clan[key], old[key]);
    for (const id of clan.members) {
      assert.equal(clan.roles[id], old.roles[id] || "member");
      assert.equal(store.byId(id).clanId, clan.id);
      if (!old.members.includes(id)) assert.equal(store.byId(id).testBot, MARKER);
    }
  }
  const filled = JSON.stringify(store.data);
  assert.deepEqual(fillTestGroupRosters(store, { clanId }, at), { added: 0 });
  assert.equal(saves, 1);
  assert.equal(JSON.stringify(store.data), filled);
});
test("Пополнение группы атомарно: проверка вместимости и ошибка записи сохраняют исходный состав", () => {
  const { profiles } = setup(),
    owner = realClan(profiles),
    clanId = profiles.find(owner.token).clanId;
  seedTestClans(profiles, WALL);
  const before = JSON.stringify(profiles.data);
  assert.throws(
    () => fillTestGroupRosters(profiles, { clanId, clanBotCount: 15 }),
    /Недостаточно мест/,
  );
  assert.equal(JSON.stringify(profiles.data), before);
  profiles.save = () => {
    throw Error("disk");
  };
  assert.throws(() => fillTestGroupRosters(profiles, { clanId }), /disk/);
  assert.equal(JSON.stringify(profiles.data), before);
});
test("Боты обычного клана выходят на арену только при человеке и соблюдают статус новобранца", () => {
  const { profiles, arena, bots } = setup(),
    owner = realClan(profiles),
    clanId = profiles.find(owner.token).clanId;
  seedTestClans(profiles, WALL);
  // The ongoing battle starts with ten members; newcomers then join mid-battle.
  for (let i = 0; i < 9; i++) {
    const u = profiles.open(), p = profiles.find(u.token);
    p.level = 12; p.progress = freshProgress(12); p.clanId = clanId;
    profiles.data.clans[clanId].members.push(p.id);
    profiles.data.clans[clanId].roles[p.id] = "member";
  }
  profiles.data.competition.week = null;
  profiles.data.competition.day = null;
  profiles.data.competition.lastScheduledDay = null;
  profiles.save(profiles.data, WALL);
  fillTestGroupRosters(profiles, { clanId, clanBotCount: 2, peerMemberCount: 10 }, WALL);
  const clan = profiles.data.clans[clanId],
    ids = clan.members.filter((id) => profiles.byId(id).testBot === MARKER);
  assert.equal(clan.testOnly, undefined);
  for (const id of ids)
    assert.equal(clan.competition.recruits[id], profiles.data.competition.day.end);
  bots.update(0, WALL, 32);
  assert.equal(arena.players.size, 0);
  arena.addPlayer(50);
  bots.update(50, WALL, 32);
  const bot = [...arena.players.values()].find((p) => p.isTestBot && p.clanId === clanId);
  assert.ok(bot);
  assert.ok(ids.includes(bot.profileId));
  assert.notEqual(bot.profileId, profiles.find(owner.token).id);
  assert.equal(bots.status().activeBots, 15);
});
test("Боты появляются только при живом человеке; лимит, ротация и очистка после смерти", () => {
  const { arena, bots } = setup();
  assert.deepEqual(bots.update(0, WALL, 32), []);
  assert.equal(arena.players.size, 0);
  const human = arena.addPlayer(0);
  const start = bots.update(50, WALL, 32);
  assert.equal(bots.status().activeBots, 15);
  assert.equal(start.filter((e) => e.type === "lifeStarted").length, 15);
  const bot = [...arena.players.values()].find((p) => p.isTestBot),
    oldProfile = bot.profileId;
  bot.dead = true;
  bots.update(100, WALL, 32);
  assert.equal(bots.status().activeBots, 14);
  bots.update(7100, WALL, 32);
  assert.equal(bots.status().activeBots, 15);
  assert.ok(![...arena.players.values()].some((p) => p.profileId === oldProfile));
  bots.update(7150, WALL, 5);
  assert.equal(bots.status().activeBots, 4);
  human.dead = true;
  const ended = bots.update(7200, WALL, 32);
  assert.equal(ended.filter((e) => e.type === "lifeEnded").length, 4);
  assert.equal(arena.players.size, 1);
  bots.update(90000, WALL, 32);
  assert.equal(bots.status().activeBots, 0);
});
test("Живой второй игрок удерживает ботов; конфигурация off убирает их без перезапуска", (t) => {
  const configPath = path.join(temporary(t, "bots-config"), "test-bots.json");
  fs.writeFileSync(configPath, '{"enabled":true}');
  const { arena, bots } = setup({ configPath });
  const a = arena.addPlayer(0),
    b = arena.addPlayer(0);
  bots.update(0, WALL, 32);
  a.dead = true;
  assert.deepEqual(bots.clearIfIdle(100), []);
  fs.writeFileSync(configPath, '{"enabled":false}');
  bots.update(1001, WALL, 32);
  assert.equal(bots.status().activeBots, 0);
  assert.equal(arena.players.size, 2);
  assert.equal(b.dead, false);
  fs.writeFileSync(configPath, '{"enabled":true}');
  bots.update(2002, WALL, 32);
  assert.equal(bots.status().activeBots, 15);
  assert.equal(bots.status().testClans, 16);
});
test("Боты используют обычные киллы, битвы и XP; после смерти последнего человека сессии закрыты", async (t) => {
  let at = 0,
    wallAt = Date.parse("2026-10-20T04:00:00Z");
  const profiles = new ProfileStore({ now: () => wallAt });
  const app = createGameServer({
    profiles,
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => at,
    wallNow: () => wallAt,
    testBots: { enabled: true },
  });
  t.after(() => app.close());
  const human = app.arena.addPlayer(at);
  human.x = 2300;
  human.y = 1500;
  app.tick();
  at = 3000;
  wallAt = WALL;
  const [attacker, victim] = [...app.arena.players.values()].filter((p) => p.isTestBot);
  for (const [p, mass] of [
    [attacker, 500],
    [victim, 10],
  ])
    Object.assign(p, {
      x: 400,
      y: 400,
      targetX: 400,
      targetY: 400,
      mass,
      radius: radiusForMass(mass),
      protectedUntil: 0,
    });
  app.bots.nextThinkAt = 10000;
  const events = app.tick();
  assert.ok(
    events.some(
      (e) => e.type === "absorbed" && e.eaterId === attacker.id && e.victimId === victim.id,
    ),
  );
  assert.ok(profiles.byId(attacker.profileId).progress.kills > 0);
  assert.ok(profiles.data.competition.day.scores[attacker.clanId].kills > 0);
  human.dead = true;
  at += 50;
  app.tick();
  assert.equal(app.bots.status().activeBots, 0);
  assert.equal(Object.values(profiles.data.profiles).filter((p) => p.progress.session).length, 0);
});
test("Обычный сервер без опции тестового режима не создаёт кланы и ботов", async (t) => {
  const app = createGameServer({ autoTick: false });
  t.after(() => app.close());
  app.arena.addPlayer(0);
  app.tick();
  assert.equal(Object.keys(app.profiles.data.clans).length, 0);
  assert.equal(app.bots.status().activeBots, 0);
});
test("Уход по WebSocket очищает ботов и сохранённые жизни сразу", async (t) => {
  const profiles = new ProfileStore({ now: () => WALL }),
    app = createGameServer({
      profiles,
      autoTick: false,
      wallNow: () => WALL,
      testBots: { enabled: true },
    });
  t.after(() => app.close());
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const ws = new WebSocket("ws://127.0.0.1:" + app.httpServer.address().port);
  await once(ws, "open");
  app.tick();
  assert.equal(app.bots.status().activeBots, 15);
  ws.close();
  await once(ws, "close");
  for (let n = 0; n < 20 && app.bots.status().activeBots; n++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(app.bots.status().activeBots, 0);
  assert.equal(app.bots.status().humanPlayers, 0);
  assert.equal(app.arena.players.size, 1);
  assert.equal([...app.arena.players.values()][0].isRemnant, true);
  assert.equal(Object.values(profiles.data.profiles).filter((p) => p.progress.session).length, 0);
});

test("Live bot configuration enables twelve bots and twenty supplies without duplicating profiles", (t) => {
  const configPath = path.join(temporary(t, "bots-config"), "bots.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({ enabled: true, maxActive: 12, boostersEnabled: true }),
  );
  const { arena, profiles, bots } = setup({ configPath });
  arena.addPlayer(0);
  bots.update(0, WALL, 35);
  assert.equal(bots.status().activeBots, 12);
  assert.equal(bots.brain.boostersEnabled, true);
  for (const life of bots.brain.lives.values()) assert.equal(life.bag.length, 20);
  const count = Object.keys(profiles.data.profiles).length;
  bots.update(1200, WALL + 1200, 35);
  assert.equal(Object.keys(profiles.data.profiles).length, count);
  fs.writeFileSync(
    configPath,
    JSON.stringify({ enabled: true, maxActive: 12, boostersEnabled: false }),
  );
  bots.update(2400, WALL + 2400, 35);
  assert.equal(bots.brain.boostersEnabled, false);
  bots.update(3600, WALL + 3600, 5);
  assert.equal(bots.status().activeBots, 4);
});

test("Thirty bots fit with five humans, yield room capacity and retain twenty-use life supplies", (t) => {
  const configPath = path.join(temporary(t, "bots-thirty"), "bots.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({ enabled: true, maxActive: 30, boostersEnabled: true }),
  );
  const { arena, profiles, bots } = setup({ configPath, maxActive: 30 });
  seedTestClans(profiles, WALL);
  // Test-only fixtures: enough distinct clans for the one-bot-per-clan policy.
  const source = Object.values(profiles.data.clans);
  const expandedProfiles = { ...profiles.data.profiles };
  for (let i = 0; i < 18; i++) {
    const template = source[i % source.length];
    const id = "extra-clan-" + i;
    const members = template.members.map((member, j) => {
      const pid = "extra-bot-" + i + "-" + j;
      expandedProfiles[pid] = {
        ...structuredClone(profiles.byId(member)),
        id: pid,
        clanId: id,
      };
      return pid;
    });
    profiles.data.clans[id] = { ...structuredClone(template), id, members, ownerId: members[0] };
  }
  profiles.data.profiles = expandedProfiles;
  const profileCount = Object.keys(profiles.data.profiles).length;
  for (let i = 0; i < 5; i++) arena.addPlayer(0);
  bots.update(0, WALL, 35);
  assert.equal(bots.status().activeBots, 30);
  assert.equal(arena.players.size, 35);
  for (const life of bots.brain.lives.values()) assert.equal(life.bag.length, 20);
  arena.addPlayer(100);
  bots.update(100, WALL + 100, 35);
  assert.equal(bots.status().activeBots, 29);
  assert.equal(arena.players.size, 35);
  // A reservation/remnant reduces the capacity supplied by the room manager.
  bots.update(200, WALL + 200, 34);
  assert.equal(bots.status().activeBots, 28);
  assert.equal(Object.keys(profiles.data.profiles).length, profileCount);
  for (const p of [...arena.players.values()]) if (!p.isTestBot) arena.removePlayer(p.id);
  bots.update(300, WALL + 300, 35);
  assert.equal(arena.players.size, 0);
  assert.equal(bots.brain.lives.size, 0);
});


test("Боты появляются только в своей группе; повышение уровня действует со следующей жизни", () => {
  const { profiles, arena, bots } = setup({ isLevelEligible: p => p.level < 12 });
  seedTestClans(profiles, WALL);
  const all = Object.values(profiles.data.profiles).filter(p => p.testBot === MARKER);
  for (const p of all) p.level = 12;
  const allowed = all[0]; allowed.level = 11;
  const human = arena.addPlayer(0); human.profileId = profiles.open().profile.id;
  bots.update(0, WALL, 35);
  const spawned = [...arena.players.values()].filter(p => p.isTestBot);
  assert.equal(spawned.length, 1); assert.equal(spawned[0].profileId, allowed.id);
  allowed.level = 12;
  bots.update(100, WALL + 100, 35);
  assert.equal(arena.players.get(spawned[0].id), spawned[0]); assert.equal(spawned[0].dead, false);
  spawned[0].dead = true;
  bots.update(200, WALL + 200, 35);
  bots.update(10000, WALL + 10000, 35);
  assert.equal([...arena.players.values()].filter(p => p.isTestBot && !p.dead).length, 0);
});
