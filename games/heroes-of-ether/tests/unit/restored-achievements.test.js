"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs"),
  { randomUUID } = require("node:crypto");
const { temporary } = require("../temp"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ChatService } = require("../../src/server/chat/chat-service"),
  { ClanService } = require("../../src/server/clans/clan-service");
const { xpForLevel } = require("../../src/server/progression/experience-progression"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const calendar = require("../../src/server/progression/social-calendar"),
  daily = require("../../src/server/rankings/daily-leaderboards");
function fixture(t) {
  let at = Date.UTC(2026, 9, 23, 20, 59),
    filePath = path.join(temporary(t, "restored-achievements"), "profiles.json"),
    store = new ProfileStore({ filePath, now: () => at });
  const a = store.open(),
    b = store.open();
  const p = () => store.find(a.token),
    q = () => store.find(b.token);
  for (const v of [p(), q()]) {
    v.wallet = { coins: 100000, crystals: 100000, bucks: 10000 };
    v.level = 12;
    v.progress.xp = xpForLevel(12);
  }
  const marry = () => {
    p().social = {
      marriage: { partnerId: q().id, at },
      invitations: [],
      gifts: [],
      inviteReadyAt: 0,
    };
    q().social = {
      marriage: { partnerId: p().id, at },
      invitations: [],
      gifts: [],
      inviteReadyAt: 0,
    };
    store.save(store.data);
  };
  const act = (who, input) =>
    new ClanService(store).mutate(who.token, { requestId: randomUUID(), ...input });
  return {
    get store() {
      return store;
    },
    a,
    b,
    p,
    q,
    marry,
    act,
    now: () => at,
    time: (n) => (at = n),
    restore() {
      store = new ProfileStore({ filePath, now: () => at });
    },
  };
}
test("both spouses gain Moscow days at midnight, shared clan days stop on leaving and restart without loss; disk failure and restore", (t) => {
  const f = fixture(t);
  f.marry();
  f.act(f.a, {
    action: "create",
    name: "Общий клан",
    prefix: "DAY",
    emblem: "grove",
    privacy: "open",
  });
  const clanId = f.p().clanId;
  f.act(f.b, { action: "apply", clanId });
  const midnight = Date.UTC(2026, 9, 23, 21);
  f.time(midnight - 1);
  f.store.refreshCompetition();
  assert.equal(f.p().activity.values.strong_love, 0);
  f.time(midnight);
  const before = structuredClone(f.p()),
    rename = fs.renameSync;
  fs.renameSync = () => {
    throw Error("test disk");
  };
  try {
    assert.throws(() => f.store.refreshCompetition(), /test disk/);
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(f.p(), before);
  f.store.refreshCompetition();
  for (const p of [f.p(), f.q()]) {
    assert.equal(p.activity.values.strong_love, 1);
    assert.equal(p.activity.values.always_together, 1);
  }
  f.store.refreshCompetition();
  f.restore();
  f.store.refreshCompetition();
  assert.equal(f.p().activity.values.always_together, 1);
  f.act(f.b, { action: "leave", clanId });
  f.time(midnight + 3 * 86400000);
  f.store.refreshCompetition();
  for (const p of [f.p(), f.q()]) {
    assert.equal(p.activity.values.strong_love, 4);
    assert.equal(p.activity.values.always_together, 1);
  }
  f.act(f.b, { action: "apply", clanId });
  f.time(midnight + 4 * 86400000);
  f.store.refreshCompetition();
  for (const p of [f.p(), f.q()]) assert.equal(p.activity.values.always_together, 2);
});
test("sociable counts each accepted arena/clan message, durable receipts survive trimming/restart, failed writes and rejected text never count", (t) => {
  const f = fixture(t),
    file = path.join(temporary(t, "chat-achievements"), "chat.json");
  let now = f.now();
  let chat = new ChatService({ filePath: file, now: () => now });
  const bind = () => (chat.onAccepted = (id, n) => f.store.chatAccepted(id, n));
  bind();
  const first = { requestId: randomUUID(), text: "Первое" };
  chat.send(f.p(), null, null, first);
  assert.equal(f.p().activity.values.sociable, 1);
  chat.send(f.p(), null, null, first);
  assert.equal(f.p().activity.values.sociable, 1);
  for (let i = 0; i < 4; i++) {
    now += 3000;
    chat.send(f.p(), { prefix: "DAY" }, i % 2 ? "clan" : null, {
      requestId: randomUUID(),
      text: "Привет " + i,
    });
  }
  assert.equal(f.p().activity.values.sociable, 5);
  assert.equal(f.p().activity.claimed.sociable, 1);
  assert.throws(() => chat.send(f.p(), null, null, { requestId: randomUUID(), text: " " }));
  assert.equal(f.p().activity.values.sociable, 5);
  now += 3000;
  const fail = { requestId: randomUUID(), text: "Диск" },
    rename = fs.renameSync;
  fs.renameSync = () => {
    throw Error("test disk");
  };
  try {
    assert.throws(() => chat.send(f.p(), null, null, fail), /сохранить/);
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(f.p().activity.values.sociable, 5);
  chat.onAccepted = () => {
    throw Error("profile disk");
  };
  now += 3000;
  assert.equal(chat.send(f.p(), null, null, fail).duplicate, false);
  assert.equal(f.p().activity.values.sociable, 5);
  // The accepted message counter is durable even when profile persistence fails.
  chat = new ChatService({ filePath: file, now: () => now });
  bind();
  chat.syncProgress();
  assert.equal(f.p().activity.values.sociable, 6);
  chat.send(f.p(), null, null, fail);
  chat.send(f.p(), null, null, first);
  assert.equal(f.p().activity.values.sociable, 6);
  assert.throws(() => chat.send(f.p(), null, "other", first), /использован/);
  const saved = fs.readFileSync(file, "utf8");
  assert.ok(!saved.includes("Первое"));
  assert.ok(!saved.includes("Диск"));
  f.restore();
  chat.syncProgress();
  assert.equal(f.p().activity.values.sociable, 6);
});
test("gift sender and recipient progress only for gifts to another player, including replay", (t) => {
  const f = fixture(t);
  const gifts = require("../../src/server/profiles/player-social").gifts;
  const gift = gifts.find((g) => g.currency === "bucks");
  const action = {
    action: "gift",
    targetId: f.q().id,
    giftId: gift.id,
    confirmed: true,
    requestId: randomUUID(),
  };
  f.store.socialAction(f.a.token, action);
  f.store.socialAction(f.a.token, action);
  assert.equal(f.p().activity.values.generous, 1);
  assert.equal(f.q().activity.values.needed, 1);
  f.store.socialAction(f.a.token, { ...action, targetId: f.p().id, requestId: randomUUID() });
  assert.equal(f.p().activity.values.generous, 1);
  assert.equal(f.p().activity.values.needed, 0);
});
test("top counts every daily podium, including several boards for one player, once", (t) => {
  const f = fixture(t),
    before = f.p().activity.values.top;
  f.p().daily = { day: daily.dayAt(f.now()), kills: 5, arenaSeconds: 600, greatness: 50 };
  f.store.data.dailyPrizes = { day: daily.dayAt(f.now()) };
  f.time(Date.UTC(2026, 9, 23, 21));
  f.store.refreshCompetition();
  assert.equal(f.p().activity.values.top, before + 3);
  f.store.refreshCompetition();
  f.restore();
  f.store.refreshCompetition();
  assert.equal(f.p().activity.values.top, before + 3);
});
test("Space split marks only propelled child collisions and jumper counts full opponents despite XP cap; normal and duplicate kills do not count", (t) => {
  const f = fixture(t),
    arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } }),
    p = arena.addPlayer(0, "splitter"),
    q = arena.addPlayer(0, "victim");
  Object.assign(p, {
    mass: 5000,
    radius: radiusForMass(5000),
    x: 5000,
    y: 5000,
    targetX: 6000,
    targetY: 5000,
    protectedUntil: 0,
  });
  arena.splitPlayer(p, { spawnSerial: p.spawnSerial, sequence: 1 }, 5000);
  const child = p.parts[1];
  Object.assign(q, {
    mass: 20,
    radius: radiusForMass(20),
    x: child.x,
    y: child.y,
    protectedUntil: 0,
  });
  // Isolate the launched part from the stationary parent for the collision.
  p.parts[0].x = 1000;
  p.parts[0].y = 1000;
  const hits = arena.resolveAbsorptions(5001);
  const hit = hits.find((e) => e.victimId === q.id);
  assert.equal(hit.spaceSplit, true);
  assert.equal(hit.victimDefeated, true);
  const life = randomUUID(),
    progress = (e) =>
      f.store.applyArenaProgress(
        randomUUID(),
        e.map((v) => ({ profileId: f.p().id, ...v })),
        f.now(),
      );
  progress([
    { type: "lifeStarted", lifeId: life },
    { type: "survivalMinute", minutes: 10000, mass: 10000 },
  ]);
  const event = { ...hit, victimProfileId: f.q().id };
  progress([event]);
  progress([event]);
  assert.equal(f.p().activity.values.jumper, 1);
  progress([{ ...event, lifeId: randomUUID(), spaceSplit: false }]);
  assert.equal(f.p().activity.values.jumper, 1);
  progress([{ ...event, lifeId: randomUUID(), victimDefeated: false }]);
  assert.equal(f.p().activity.values.jumper, 1);
});
