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
  { Arena, speedForMass, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { applyEvent, xpForLevel } = require("../../src/server/progression/experience-progression"),
  { awardTitles } = require("../../src/server/progression/title-chest-rewards"),
  accounts = require("../../src/server/accounts/account-benefits"),
  turbo = require("../../src/server/arena/turbo-ability"),
  bonus = require("../../src/server/arena/mass-kill-bonus");
const { temporary } = require("../temp"),
  { createGameServer } = require("../../src/server/game-server");
const NOW = Date.UTC(2026, 9, 19, 12);
function setup(filePath = null) {
  let now = NOW;
  const store = new ProfileStore({ filePath, now: () => now }),
    a = store.open(),
    p = () => store.find(a.token);
  const activate = (kind) => store.activateAccount(a.token, { kind, requestId: randomUUID() });
  return {
    store,
    a,
    p,
    activate,
    setTime: (t) => {
      now = t;
    },
  };
}
test("7 дней VIP и 14 дней Premium: бесплатная активация, суммирование, повтор, достижения и истечение", (t) => {
  const filePath = path.join(temporary(t, "accounts"), "profiles.json"),
    { store, a, p, activate, setTime } = setup(filePath);
  const wallet = structuredClone(p().wallet),
    id = randomUUID();
  const op = { kind: "vip", requestId: id };
  store.activateAccount(a.token, op);
  assert.equal(p().account.vipUntil, NOW + accounts.WEEK);
  assert.equal(p().activity.values.vip, 1);
  assert.equal(p().activity.claimed.vip, 1);
  assert.equal(store.activateAccount(a.token, op).replay, true);
  assert.throws(() => activate("vip"), /уже активен/);
  activate("premium");
  assert.deepEqual(p().wallet, wallet);
  assert.equal(p().activity.claimed.premium, 1);
  const b = accounts.benefits(p(), NOW);
  assert.deepEqual(
    [
      b.xpPercent,
      b.greatnessMultiplier,
      b.chestMultiplier,
      b.slotBonus,
      b.turboMs,
      b.clanChestGreatnessBonus,
    ],
    [200, 2, 2, 3, 120000, 15],
  );
  assert.deepEqual(new ProfileStore({ filePath, now: () => NOW }).find(a.token), p());
  setTime(NOW + 2 * accounts.WEEK);
  assert.equal(store.view(p()).account.vip, false);
  assert.equal(store.view(p()).account.premium, false);
  activate("vip");
  assert.equal(p().activity.values.vip, 2);
  assert.equal(p().activity.claimed.vip, 1);
});
test("Ошибка записи активации не выдаёт срок, награды или неделю достижения", () => {
  const { store, a, p } = setup(),
    before = structuredClone(p());
  store.save = () => {
    throw Error("disk");
  };
  assert.throws(
    () => store.activateAccount(a.token, { kind: "vip", requestId: randomUUID() }),
    /disk/,
  );
  assert.deepEqual(p(), before);
});
test("Вход в клане не выдаёт величие VIP/Premium ни повторно, ни на следующий день", () => {
  const { store, a, p, activate, setTime } = setup();
  p().level = 12;
  p().progress.xp = xpForLevel(12);
  p().wallet.coins = 2000;
  const clans = new (require("../../src/server/clans/clan-service").ClanService)(store);
  clans.mutate(a.token, {
    action: "create",
    name: "Тест",
    prefix: "Т",
    emblem: "grove",
    privacy: "open",
    requestId: randomUUID(),
  });
  activate("vip");
  activate("premium");
  const before = p().greatness;
  store.open(a.token);
  assert.equal(p().greatness, before);
  setTime(NOW + 86400000);
  store.open(a.token);
  assert.equal(p().greatness, before + 23); // Первое место и первая степень «Топ» с Premium, не бонус входа.
  assert.equal(p().regalia["greatness-1"].count, 1);
  assert.equal(p().account.dailyAmount, 0);
  assert.equal(clans.state(a.token).mine.greatness, p().greatness);
});
test("Опыт: лучший аккаунт для поглощений, прежние бонусы за массу и минуты, округление и предел", () => {
  const { p } = setup();
  p().account = {
    ...accounts.fresh(),
    vipUntil: NOW + accounts.WEEK,
    premiumUntil: NOW + accounts.WEEK,
  };
  p().outfit = { hat: "novice_hat", bow: null };
  applyEvent(p(), { type: "lifeStarted", lifeId: "life" }, NOW);
  applyEvent(p(), { type: "absorbed", victimProfileId: "victim", gain: 10 }, NOW);
  assert.equal(p().progress.session.xp, 9);
  applyEvent(p(), { type: "massBonus", lifeId: "life", sequence: 1, kills: 2 }, NOW);
  assert.equal(p().progress.session.xp, 27);
  applyEvent(p(), { type: "massBonus", lifeId: "life", sequence: 1, kills: 2 }, NOW);
  assert.equal(p().progress.session.xp, 27);
  applyEvent(p(), { type: "survivalMinute", mass: 200000, minutes: 1 }, NOW);
  assert.equal(p().progress.session.xp, 500);
  applyEvent(p(), { type: "massBonus", lifeId: "life", sequence: 2, kills: 20 }, NOW);
  assert.equal(p().progress.kills, 4);
  assert.equal(p().progress.claimed.king, 0);
  assert.equal(p().progress.session.kills, 24);
  assert.equal(p().progress.session.creditedKills, 4);
  assert.equal(p().progress.session.xp, 500);
});
test("Поглощение: база 3 XP, VIP и оба ×3, Premium ×1; срок проверяется в момент события", () => {
  for (const [vipUntil, premiumUntil, expected] of [
    [0, 0, 3],
    [NOW + accounts.WEEK, 0, 9],
    [0, NOW + accounts.WEEK, 3],
    [NOW + accounts.WEEK, NOW + accounts.WEEK, 9],
    [NOW + accounts.WEEK, NOW, 9],
    [NOW, NOW + accounts.WEEK, 3],
    [NOW, NOW, 3],
  ]) {
    const { p } = setup();
    p().account = { ...accounts.fresh(), vipUntil, premiumUntil };
    applyEvent(p(), { type: "lifeStarted", lifeId: "life" }, NOW);
    for (const [index, gain] of [1, 100000].entries()) {
      applyEvent(p(), { type: "absorbed", victimProfileId: "victim" + index, gain }, NOW);
      assert.equal(p().progress.session.xp, expected * (index + 1));
    }
    assert.equal(p().progress.kills, premiumUntil > NOW ? 4 : 2);
    assert.equal(accounts.publicAccount(p(), NOW).absorptionXpMultiplier, expected / 3);
  }
});

test("Поглощение с VIP и Premium: сбой записи, потерянное подтверждение и восстановление не удваивают 9 XP", (t) => {
  const filePath = path.join(temporary(t, "absorption-xp"), "profiles.json"),
    { store, a, p } = setup(filePath);
  p().account = {
    ...accounts.fresh(),
    vipUntil: NOW + accounts.WEEK,
    premiumUntil: NOW + accounts.WEEK,
  };
  store.startLife(a.profile.id, "life");
  const packet = randomUUID(),
    events = [
      { type: "absorbed", profileId: a.profile.id, victimProfileId: randomUUID(), gain: 10 },
    ],
    before = structuredClone(store.data),
    saved = fs.readFileSync(filePath, "utf8"),
    save = store.save;
  store.save = () => {
    throw Error("TEST disk unavailable");
  };
  assert.throws(() => store.applyArenaProgress(packet, events, NOW), /disk unavailable/);
  assert.deepEqual(store.data, before);
  assert.equal(fs.readFileSync(filePath, "utf8"), saved);
  store.save = save;
  store.applyArenaProgress(packet, events, NOW);
  // Повтор после потерянного подтверждения, в том числе за пределами защиты жертвы.
  store.applyArenaProgress(packet, events, NOW + 180001);
  assert.equal(p().progress.session.xp, 9);
  assert.equal(p().progress.kills, 2);
  let disk = new ProfileStore({ filePath, now: () => NOW + 180001 });
  assert.equal(disk.find(a.token).progress.xp, 9);
  assert.equal(disk.find(a.token).progress.session, null);
  disk.applyArenaProgress(packet, events, NOW + 180001);
  assert.equal(disk.find(a.token).progress.kills, 2);
  disk.startLife(a.profile.id, "next-life");
  // После начала новой жизни запоздалый итог старой не должен начислять опыт повторно.
  disk.applyArenaProgress(
    "old-life-end",
    [
      {
        type: "lifeEnded",
        profileId: a.profile.id,
        lifeId: "life",
        durationSeconds: 0,
        reason: "left",
      },
    ],
    NOW + 180001,
  );
  assert.equal(disk.find(a.token).progress.session.xp, 0);
  assert.equal(disk.find(a.token).progress.kills, 2);
  disk = new ProfileStore({ filePath, now: () => NOW + 180001 });
  assert.equal(disk.find(a.token).progress.xp, 9);
});

test("Платные аватары доступны только с активным статусом; срок не уничтожает выбор", () => {
  const { store, a, p, activate, setTime } = setup(),
    input = { name: "Игрок", skinId: "vip-1", quickSlots: [], requestId: randomUUID() };
  assert.throws(() => store.setLoadout(a.token, input), /активный/);
  activate("vip");
  store.setLoadout(a.token, input);
  assert.equal(store.identity(p()).skinId, "vip-1");
  setTime(NOW + accounts.WEEK);
  assert.equal(store.identity(p()).skinId, "moon-dragon");
  assert.equal(p().skinId, "vip-1");
});
test("Часть замедляется по массе; обычное ускорение и Турбо вместе +80%, замедление отдельно", () => {
  assert.equal(speedForMass(10), 83.3);
  for (const m of [100, 500, 1000, 5000, 10000, 18000, 24000, 30000])
    assert.ok(speedForMass(m) < speedForMass(m - 1));
  assert.equal(speedForMass(1e10), 35);
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "a");
  Object.assign(p, {
    x: 800,
    y: 800,
    targetX: 2000,
    targetY: 800,
    lastMoveAt: 5000,
    stopped: false,
    nextMassDecayAt: Infinity,
  });
  p.account = { turboMs: 60000 };
  p.effects.speed = 20000;
  turbo.set(p, { active: true, sequence: 1, spawnSerial: p.spawnSerial }, 5000);
  const before = p.x;
  arena.step(5000);
  assert.ok(Math.abs(p.x - before - speedForMass(20) * 0.05 * 1.8) < 1e-8);
  p.effects.freeze = 20000;
  const next = p.x;
  arena.step(5050);
  assert.ok(Math.abs(p.x - next - speedForMass(20) * 0.05 * 1.8 * 0.7) < 1e-8);
});
test("Турбо: пауза, точный расход, повторные команды, 3 минуты между подсказками, новая жизнь", () => {
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "a"),
    send = (active, sequence, at) =>
      turbo.set(p, { active, sequence, spawnSerial: p.spawnSerial }, at);
  p.account = { turboMs: 60000 };
  send(true, 1, 1000);
  send(false, 2, 11000);
  assert.equal(turbo.view(p, 90000).remainingMs, 50000);
  send(true, 1, 90000);
  assert.equal(p.turbo.active, false);
  send(true, 3, 90000);
  turbo.update(p, 140000);
  assert.equal(turbo.view(p, 140000).remainingMs, 0);
  assert.equal(send(true, 4, 140000).notice, true);
  assert.equal(send(true, 5, 319999).notice, false);
  assert.equal(send(true, 6, 320000).notice, true);
  const old = p.spawnSerial;
  arena.resetPlayer(p, 330000);
  assert.equal(turbo.view(p, 330000).remainingMs, 60000);
  assert.equal(turbo.set(p, { active: true, sequence: 99, spawnSerial: old }, 330000), null);
  p.dead = true;
  assert.equal(send(true, 7, 330000), null);
  const paused = { active: false, remainingMs: 12500 };
  assert.equal(require("../../public/shared/booster-cooldowns").turbo(paused, 50000), 12500);
});
test("Турбо: базовый аккаунт без способности, VIP 2 минуты, Premium без способности, вместе 2", () => {
  for (const [vip, premium, totalMs] of [
    [false, false, 0],
    [true, false, 120000],
    [false, true, 0],
    [true, true, 120000],
  ]) {
    const arena = new Arena({ etherCount: 0 }),
      p = arena.addPlayer(0, "a");
    assert.equal(turbo.view(p, 0).totalMs, 0);
    p.account = accounts.benefits(
      {
        account: {
          ...accounts.fresh(),
          vipUntil: vip ? NOW + accounts.WEEK : 0,
          premiumUntil: premium ? NOW + accounts.WEEK : 0,
        },
      },
      NOW,
    );
    assert.equal(turbo.view(p, 0).totalMs, totalMs);
    const command = { active: true, sequence: 1, spawnSerial: p.spawnSerial };
    turbo.set(p, command, 1000);
    assert.equal(turbo.view(p, 1000).active, totalMs > 0);
    turbo.set(p, command, 2000);
    turbo.update(p, 11000);
    assert.equal(turbo.view(p, 11000).remainingMs, Math.max(0, totalMs - 10000));
    assert.equal(p.turbo.lastNoticeAt, -Infinity);
  }
});
test("Турбо: истечение статусов и повторная активация не возвращают потраченное время", () => {
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "a");
  p.account = { turboMs: 180000 };
  turbo.set(p, { active: true, sequence: 1, spawnSerial: p.spawnSerial }, 0);
  turbo.update(p, 80000);
  assert.equal(turbo.view(p, 80000).remainingMs, 100000);
  p.account = { turboMs: 60000 };
  turbo.update(p, 80000);
  assert.equal(turbo.view(p, 80000).remainingMs, 0);
  assert.equal(p.turbo.usedMs, 80000);
  p.account = { turboMs: 0 };
  assert.equal(
    turbo.set(p, { active: true, sequence: 2, spawnSerial: p.spawnSerial }, 90000).notice,
    false,
  );
  assert.equal(turbo.view(p, 90000).active, false);
  p.account = { turboMs: 180000 };
  assert.equal(turbo.view(p, 90000).remainingMs, 100000);
  turbo.set(p, { active: true, sequence: 3, spawnSerial: p.spawnSerial }, 90000);
  turbo.update(p, 100000);
  p.account = { turboMs: 0 };
  turbo.update(p, 100000);
  assert.equal(p.turbo.usedMs, 90000);
  assert.equal(p.turbo.active, false);
  p.account = { turboMs: 180000 };
  assert.equal(turbo.view(p, 100000).remainingMs, 90000);
});
test("Бонус за массу: строгие пороги, минимум за минуту, повтор каждую минуту и сброс", () => {
  for (const [mass, kills] of bonus.TIERS) {
    assert.ok(bonus.reward(mass) < kills);
    assert.equal(bonus.reward(mass + 1), kills);
  }
  const p = { id: "a", lifeId: "life", mass: 170000, dead: false };
  bonus.reset(p);
  assert.equal(bonus.sample(p, 0), null);
  p.mass = 21000;
  assert.equal(bonus.sample(p, 59999), null);
  p.mass = 170000;
  assert.equal(bonus.sample(p, 60000).kills, 6);
  assert.equal(bonus.sample(p, 120000).kills, 20);
  p.mass = 5000;
  assert.equal(bonus.sample(p, 150000), null);
  p.mass = 5001;
  assert.equal(bonus.sample(p, 180000), null);
  assert.equal(bonus.sample(p, 240000).kills, 2);
  p.dead = true;
  assert.equal(bonus.sample(p, 300000), null);
});
test("Лимит каждого слота: статусы дают +3 всего; бонус к массе и предел не добавляют", () => {
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "a");
  p.level = 501;
  p.account = { vip: true, premium: true, slotBonus: 3, turboMs: 180000 };
  assert.equal(arena.snapshot(0).players[0].boosterLimit, 27);
  assert.equal(
    require("../../src/server/arena/arena-simulation").massLimitForLevel(p.level),
    30000,
  );
});
test("Сундук: Да готовит награду без начисления; Отлично выдаёт ровно её, включая после перезагрузки и истечения", (t) => {
  const filePath = path.join(temporary(t, "pending-chest"), "profiles.json"),
    { store, a, p, activate } = setup(filePath);
  activate("vip");
  activate("premium");
  const wallet = structuredClone(p().wallet),
    inventory = structuredClone(p().inventory);
  const prepare = randomUUID();
  store.prepareChest(a.token, "novice", prepare);
  assert.deepEqual(p().wallet, wallet);
  assert.deepEqual(p().inventory, inventory);
  assert.equal(p().honors.pending.coins, 500);
  assert.equal(store.prepareChest(a.token, "novice", prepare).replay, true);
  const items = structuredClone(p().honors.pending.items);
  let disk = new ProfileStore({ filePath, now: () => NOW + accounts.WEEK });
  const id = randomUUID();
  const result = disk.openChest(a.token, "novice", id);
  assert.equal(result.profile.wallet.coins, wallet.coins + 500 + 100); // Суточный топ при восстановлении.
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.profile.inventory).filter(([, n]) => n > 0)),
    items,
  );
  assert.equal(result.profile.honors.pending, null);
  disk = new ProfileStore({ filePath, now: () => NOW + accounts.WEEK });
  assert.equal(disk.openChest(a.token, "novice", id).replay, true);
  assert.throws(() => disk.openChest(a.token, "novice", randomUUID()), /уже открыт/);
});
test("Сундук: без Да не начисляется, ошибка сохранения подготовки и получения сохраняет всё", () => {
  const { store, a, p } = setup();
  p().greatness = 100;
  awardTitles(p(), NOW);
  const before = structuredClone(p()),
    save = store.save;
  assert.throws(() => store.openChest(a.token, "novice", randomUUID()), /подтверди/);
  store.save = () => {
    throw Error("disk");
  };
  assert.throws(() => store.prepareChest(a.token, "novice", randomUUID()), /disk/);
  assert.deepEqual(p(), before);
  store.save = save;
  store.prepareChest(a.token, "novice", randomUUID());
  const pending = structuredClone(p());
  store.save = () => {
    throw Error("disk");
  };
  assert.throws(() => store.openChest(a.token, "novice", randomUUID()), /disk/);
  assert.deepEqual(p(), pending);
});
test("Щиты: пресет каждого типа, исчезновение в момент окончания, снятие и замена", () => {
  const { active, Renderer } = require("../../public/arena/shield-renderer"),
    calls = [],
    renderer = Object.create(Renderer.prototype);
  renderer.images = new Map(
    ["golden_shield", "clan_shield", "colorful_shield"].map((id) => [
      id,
      { id, complete: true, naturalWidth: 1254 },
    ]),
  );
  for (const id of renderer.images.keys()) {
    const player = { effects: [{ id, remainingMs: 1000 }] };
    renderer.draw(
      { drawImage: (...a) => calls.push(a) },
      player,
      { x: 100, y: 200, radius: 20 },
      999,
    );
    const rim = 20 * (id === "golden_shield" ? 1.29 : 1.24);
    assert.deepEqual(calls.at(-1).slice(1), [100 - rim, 200 - rim, rim * 2, rim * 2]);
    assert.equal(calls.at(-1)[0].id, id);
    assert.equal(active(player.effects, 1000), null);
  }
  assert.equal(active([]), null);
  assert.equal(
    active([
      { id: "golden_shield", remainingMs: 0 },
      { id: "clan_shield", remainingMs: 20 },
    ]),
    "clan_shield",
  );
});
test("Торт медленно крутится, останавливается у стены и учитывает reduced motion", () => {
  const { Motion, appearance } = require("../../public/shared/projectile-renderer"),
    motion = new Motion();
  const s = { id: "cake", boosterId: "cake", x: 1, y: 1, dx: 1, dy: 0, moving: true };
  for (let t = 0; t <= 1800; t += 50) motion.sync([{ ...s, x: t }], t);
  assert.ok(Math.abs(appearance(motion.values(1800)[0], 1).rotation - Math.PI) < 1e-8);
  assert.equal(appearance(motion.values(1800)[0], 1, true).rotation, 0);
  motion.sync([{ ...s, moving: false }], 1850);
  assert.equal(motion.values(1900)[0].spinMs, motion.values(3000)[0].spinMs);
});
test("HTTP: подготовка и получение сундука, запрет аккаунтов и сундуков на арене; Turbo по WS", async (t) => {
  const profiles = new ProfileStore({ now: () => NOW }),
    arena = new Arena({ etherCount: 0 }),
    app = createGameServer({ profiles, arena, autoTick: false, now: () => 0 });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = "http://127.0.0.1:" + app.httpServer.address().port,
    res = await fetch(url + "/api/profile"),
    cookie = res.headers.get("set-cookie").split(";")[0],
    token = cookie.split("=")[1];
  const post = (endpoint, body) =>
    fetch(url + endpoint, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await post("/api/profile/account", { kind: "vip", requestId: randomUUID() })).status,
    200,
  );
  const before = structuredClone(profiles.find(token).wallet);
  assert.equal(
    (await post("/api/chests/prepare", { chestId: "novice", requestId: randomUUID() })).status,
    200,
  );
  assert.deepEqual(profiles.find(token).wallet, before);
  const ws = new WebSocket(url.replace("http:", "ws:"), { headers: { Cookie: cookie } });
  const messages = [];
  ws.on("message", (b) => messages.push(JSON.parse(b)));
  await once(ws, "open");
  await new Promise((r) => setTimeout(r, 25));
  const p = [...arena.players.values()][0];
  assert.equal(
    (await post("/api/profile/account", { kind: "premium", requestId: randomUUID() })).status,
    409,
  );
  assert.equal(
    (await post("/api/chests/open", { chestId: "novice", requestId: randomUUID() })).status,
    409,
  );
  assert.equal(
    (await post("/api/chests/prepare", { chestId: "novice", requestId: randomUUID() })).status,
    409,
  );
  ws.send(
    JSON.stringify({ type: "setTurbo", active: true, sequence: 1, spawnSerial: p.spawnSerial }),
  );
  for (let i = 0; i < 100 && !messages.some((m) => m.type === "turboResult"); i++)
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(p.turbo.active, true);
  assert.ok(messages.some((m) => m.type === "turboResult" && m.ok));
  const closed = once([...app.wss.clients][0], "close");
  ws.close();
  await closed;
  assert.equal(
    (await post("/api/chests/open", { chestId: "novice", requestId: randomUUID() })).status,
    200,
  );
  assert.equal(profiles.find(token).wallet.coins, before.coins + 500 + 100);
  assert.equal(profiles.find(token).regalia["greatness-1"].count, 1);
});
