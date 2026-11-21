/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  levelProgress,
  xpForLevel,
  minuteXp,
  freshProgress,
  validateProgress,
} = require("../../src/server/progression/experience-progression");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { temporary } = require("../temp");
const { grantCoins } = require("../../scripts/development/grant-coins");
function setup() {
  const store = new ProfileStore(),
    a = store.open(),
    b = store.open();
  const events = (list, at = 1000000, id = randomUUID()) => {
    const items = list.map((e) => ({ profileId: a.profile.id, ...e })),
      ids = [...new Set(items.map((e) => e.profileId))];
    return store.applyArenaProgress(
      id,
      [
        ...ids.map((profileId) => ({ type: "lifeStarted", profileId, lifeId: id + profileId })),
        ...items,
        ...ids.map((profileId) => ({
          type: "lifeEnded",
          profileId,
          lifeId: id + profileId,
          durationSeconds: 0,
          reason: "left",
        })),
      ],
      at,
    );
  };
  const kill = (gain = 45, victimProfileId = b.profile.id) => ({
    type: "absorbed",
    gain,
    victimProfileId,
  });
  return { store, a, b, events, kill, p: () => store.find(a.token) };
}
test("Все границы уровней: стоимость относится к текущему уровню, остаток сохраняется", () => {
  for (const [level, cost] of [
    [1, 500],
    [25, 500],
    [26, 1000],
    [120, 1000],
    [121, 3000],
    [500, 3000],
    [501, 5000],
    [5000, 5000],
    [5001, 10000],
    [10000, 10000],
    [10001, 15000],
    [15000, 15000],
  ]) {
    const base = xpForLevel(level);
    assert.deepEqual(levelProgress(base), { level, totalXp: base, levelXp: 0, nextLevelXp: cost });
    assert.equal(levelProgress(base + cost - 1).level, level);
    assert.equal(levelProgress(base + cost).level, level + 1);
    assert.equal(levelProgress(base + cost + 7).levelXp, 7);
  }
  assert.equal(levelProgress(1515).level, 4);
  assert.equal(levelProgress(1515).levelXp, 15);
  assert.throws(() => levelProgress(-1));
  assert.throws(() => levelProgress(0.5));
});
test("Минутный опыт: граница 75000 включительно и округление каждой награды вниз", () => {
  for (const [mass, xp] of [
    [10, 0],
    [499, 0],
    [500, 1],
    [999, 1],
    [74999, 149],
    [75000, 150],
    [75001, 93],
    [75199, 93],
    [75200, 94],
    [150000, 187],
  ])
    assert.equal(minuteXp(mass), xp);
  const { events, p } = setup();
  events([{ type: "survivalMinute", mass: 999, minutes: 2 }]);
  assert.equal(p().progress.xp, 2);
});
test("Минутный XP ограничен остатком уровня на всех диапазонах; неполная жизнь сохраняет остаток захода", () => {
  for (const level of [1, 25, 26, 120, 121, 500, 501, 5000, 5001, 10000, 10001]) {
    const { store, a, p } = setup(),
      base = xpForLevel(level),
      cost = levelProgress(base).nextLevelXp;
    p().progress.xp = base + cost - 20;
    p().level = level;
    store.startLife(a.profile.id, "first");
    const apply = (id, events) =>
      store.applyArenaProgress(
        id,
        events.map((e) => ({ profileId: a.profile.id, ...e })),
        1000000,
      );
    apply("earn-first", [
      { type: "survivalMinute", mass: 5000, minutes: 1 },
      { type: "lifeEnded", lifeId: "first", durationSeconds: 60, reason: "absorbed" },
    ]);
    store.startLife(a.profile.id, "second", false);
    apply("earn-second", [{ type: "survivalMinute", mass: 10000, minutes: 100 }]);
    assert.equal(p().progress.session.xp, 10);
    assert.equal(store.view(p()).progress.arenaXpMax, true);
    apply("end-second", [
      { type: "lifeEnded", lifeId: "second", durationSeconds: 6000, reason: "left" },
    ]);
    assert.equal(p().progress.xp, base + cost);
    assert.equal(p().level, level + 1);
    store.startLife(a.profile.id, "new-entry");
    assert.equal(store.view(p()).progress.arenaXpMax, false);
  }
});

test("Старое сохранение v6 без предела опыта загружается без потери накопленного XP", (t) => {
  const filePath = path.join(temporary(t, "xp-limit"), "profiles.json"),
    { store, a, p } = setup();
  delete p().progress.arenaXpTarget;
  p().progress.session = { id: "old", xp: 650, kills: 0 };
  fs.writeFileSync(filePath, JSON.stringify(store.data));
  const disk = new ProfileStore({ filePath });
  assert.equal(disk.find(a.token).progress.xp, 650);
  disk.startLife(a.profile.id, "new");
  assert.equal(disk.find(a.token).progress.arenaXpTarget, 1000);
});

test("Поглощение даёт 3 XP, частицы и рекорд массы не дают XP; одна жертва раз в 3 минуты", () => {
  const { events, kill, p } = setup();
  events([{ type: "massPeak", mass: 500 }, kill()], 1000000);
  assert.equal(p().progress.xp, 3);
  assert.equal(p().progress.kills, 1);
  assert.equal(p().progress.absorbedMass, 45);
  events([kill(200)], 1179999);
  assert.equal(p().progress.xp, 3);
  assert.equal(p().progress.lastLife.kills, 0);
  events([kill(8)], 1180000);
  assert.equal(p().progress.xp, 6);
  assert.equal(p().progress.absorbedMass, 53);
  assert.equal(p().progress.lastLife.kills, 1);
  events([kill(8, randomUUID())], 1180001);
  assert.equal(p().progress.xp, 9);
  events([kill(8, p().id), kill(8, null)], 1180002);
  assert.equal(p().progress.xp, 9);
});
test("Достижения: все пересечённые степени выдаются по одному разу; максимум не сумма жизней", () => {
  const { events, kill, p } = setup();
  // Каждая новая жизнь здесь начинается после лобби: лимит XP не обрезает цепочку.
  for (let i = 0; i < 360; i++) events([kill(250, randomUUID())]);
  assert.equal(p().progress.kills, 360);
  assert.equal(p().progress.absorbedMass, 90000);
  assert.equal(p().greatness, 265);
  assert.equal(p().progress.claimed.king, 2);
  assert.equal(p().progress.claimed.eaten, 4);
  assert.equal(p().honors.claimed, 1); // 265 за две цепочки; титул без величия.
  events([
    { type: "massPeak", mass: 24000 },
    { type: "massPeak", mass: 24000 },
  ]);
  assert.equal(p().greatness, 265);
  events([{ type: "massPeak", mass: 375000 }]);
  assert.equal(p().greatness, 455);
  events([{ type: "massPeak", mass: 375000 }]);
  assert.equal(p().greatness, 455);
  assert.equal(p().progress.maxMass, 375000);
});
test("Максимум: после первой степени 200000+ за жизнь выдаёт сразу остальные награды без повторов", () => {
  const { events, p } = setup();
  events([{ type: "massPeak", mass: 25000 }]);
  assert.equal(p().progress.claimed.maximum, 1);
  assert.equal(p().greatness, 10);
  // Остаток старой последовательной схемы не вычитается из рекорда.
  p().progress.stageSpent.maximum = 25000;
  events([{ type: "massPeak", mass: 200001 }]);
  assert.equal(p().progress.claimed.maximum, 4);
  assert.equal(p().greatness, 190); // 190 за степени; звание без величия.
  events([{ type: "massPeak", mass: 210000 }]);
  events([{ type: "massPeak", mass: 20000 }]);
  assert.equal(p().progress.claimed.maximum, 4);
  assert.equal(p().greatness, 190);
  validateProgress(p());
});
test("Максимум: точные границы рекорда и повтор после сохранения не дублируют величие", (t) => {
  const filePath = path.join(temporary(t, "maximum-record"), "profiles.json");
  let store = new ProfileStore({ filePath });
  const user = store.open();
  for (const [mass, claimed, greatness] of [
    [24999, 0, 0],
    [25000, 1, 10],
    [49999, 1, 10],
    [50000, 2, 40],
    [99999, 2, 40],
    [100000, 3, 90],
    [199999, 3, 90],
    [200000, 4, 190],
  ]) {
    store.applyArenaProgress(
      randomUUID(),
      [{ type: "massPeak", profileId: user.profile.id, mass }],
      Date.now(),
    );
    assert.equal(store.find(user.token).progress.claimed.maximum, claimed);
    assert.equal(store.find(user.token).greatness, greatness);
  }
  store = new ProfileStore({ filePath });
  store.applyArenaProgress(
    randomUUID(),
    [{ type: "massPeak", profileId: user.profile.id, mass: 200000 }],
    Date.now(),
  );
  assert.equal(store.find(user.token).greatness, 190);
});
test("Успешные бустеры: расход и награда атомарны, повтор/ошибка не дают прогресса или XP", () => {
  const { store, a, p } = setup();
  store.buy(a.token, "candy", randomUUID());
  p().progress.boosterUses = 99;
  const id = randomUUID(),
    use = () => store.consume(a.token, "candy", id, "test-use", () => ({ mass: 25000 }));
  use();
  use();
  assert.equal(p().progress.boosterUses, 100);
  assert.equal(p().inventory.candy, 9);
  assert.equal(p().greatness, 20);
  assert.equal(p().progress.xp, 0);
  assert.throws(() =>
    store.consume(a.token, "candy", randomUUID(), "bad-use", () => {
      throw Error("Bad target");
    }),
  );
  assert.equal(p().progress.boosterUses, 100);
});
test("Ошибка записи прогресса откатывает XP, награды, ограничение жертвы; повтор пакета безопасен", () => {
  const { store, events, kill, p } = setup(),
    id = randomUUID(),
    save = store.save;
  const before = JSON.stringify(store.data);
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => events([kill()], 1000000, id), /disk full/);
  assert.equal(JSON.stringify(store.data), before);
  store.save = save;
  events([kill()], 1000000, id);
  events([kill()], 1300000, id);
  assert.equal(p().progress.xp, 3);
  assert.equal(p().progress.kills, 1);
});
test("Миграция v2, перезапуск и сохранение наград и ограничения жертвы", (t) => {
  const filePath = path.join(temporary(t, "progress"), "profiles.json"),
    { store, a, b } = setup();
  store.find(a.token).wallet = { coins: 100, crystals: 20, bucks: 0 };
  store.buy(a.token, "candy", randomUUID());
  const old = structuredClone(store.data);
  old.version = 2;
  for (const p of Object.values(old.profiles)) delete p.progress;
  fs.writeFileSync(filePath, JSON.stringify(old));
  let disk = new ProfileStore({ filePath });
  assert.equal(disk.data.version, 13);
  assert.equal(disk.find(a.token).wallet.coins, 90);
  assert.equal(disk.find(a.token).inventory.candy, 10);
  const event = {
    type: "absorbed",
    profileId: a.profile.id,
    victimProfileId: b.profile.id,
    gain: 1000,
  };
  disk.startLife(a.profile.id, randomUUID());
  disk.applyArenaProgress("first", [event], 1000000);
  disk = new ProfileStore({ filePath });
  disk.applyArenaProgress("second", [event], 1000001);
  assert.equal(disk.find(a.token).progress.xp, 3);
  assert.equal(disk.find(a.token).greatness, 10);
  assert.equal(disk.find(a.token).progress.claimed.eaten, 1);
  const corrupt = structuredClone(disk.data);
  Object.values(corrupt.profiles)[0].progress.xp = -1;
  fs.writeFileSync(filePath, JSON.stringify(corrupt));
  const text = fs.readFileSync(filePath, "utf8");
  assert.throws(() => new ProfileStore({ filePath }), /прогресс/);
  assert.equal(fs.readFileSync(filePath, "utf8"), text);
});
test("Рейтинги по величию и уровню, страницы и личное место; выход из клана пересчитывает сумму", () => {
  const { store, a, b, events } = setup(),
    clans = new ClanService(store);
  const action = (who, kind, fields) =>
    clans.mutate(who.token, { action: kind, requestId: randomUUID(), ...fields });
  for (const who of [a, b]) {
    const p = store.find(who.token);
    p.level = 12;
    p.progress.xp = xpForLevel(12);
  }
  grantCoins(store, a.profile.id, 1500);
  action(a, "create", { name: "Лес", prefix: "Л", emblem: "grove", privacy: "closed" });
  const clanId = store.find(a.token).clanId;
  action(b, "apply", { clanId });
  action(a, "accept", { clanId, memberId: b.profile.id });
  events([
    { type: "massPeak", mass: 75000 },
    { type: "survivalMinute", mass: 500, minutes: 1 },
  ]);
  events(
    [
      { type: "massPeak", mass: 25000 },
      { type: "survivalMinute", mass: 75000, minutes: 2 },
    ].map((e) => ({ ...e, profileId: b.profile.id })),
  );
  assert.equal(clans.state(a.token).playerLeaders[0].id, a.profile.id);
  assert.equal(clans.state(a.token, "", 1, "", "level").playerLeaders[0].id, b.profile.id);
  assert.equal(clans.state(a.token).mine.greatness, 50);
  action(b, "leave", { clanId });
  assert.equal(clans.state(a.token).mine.greatness, 40);
  assert.equal(store.find(b.token).greatness, 10);
  for (let i = 0; i < 12; i++) store.open();
  const top = clans.state(a.token, "", 1, "", "level", 2);
  assert.equal(top.playerLeaders.length, 4);
  assert.equal(top.playerLeaders[0].rank, 11);
  assert.equal(top.myRank, 2);
  assert.equal(top.playerTotal, 14);
  assert.equal(top.playerLeaders[0].progress, undefined);
  assert.equal(top.playerLeaders[0].wallet, undefined);
});
test("Проверка сохранения отвергает неверную степень и несогласованный уровень", () => {
  const p = { level: 1, progress: freshProgress() };
  validateProgress(p);
  p.progress.claimed.king = 1;
  assert.throws(() => validateProgress(p));
  p.progress.claimed.king = 0;
  p.level = 2;
  assert.throws(() => validateProgress(p));
});

test("Миграция v5 сокращает окно жертвы до 3 минут ровно один раз и сохраняет имущество", (t) => {
  const filePath = path.join(temporary(t, "cooldown-v6"), "profiles.json"),
    { store, a, b } = setup();
  store.buy(a.token, "candy", randomUUID());
  const old = structuredClone(store.data);
  old.version = 5;
  Object.values(old.profiles).find((p) => p.id === a.profile.id).progress.recentVictims[
    b.profile.id
  ] = 1300000;
  fs.writeFileSync(filePath, JSON.stringify(old));
  let disk = new ProfileStore({ filePath });
  assert.equal(disk.data.version, 13);
  assert.equal(disk.find(a.token).progress.recentVictims[b.profile.id], 1180000);
  assert.deepEqual(disk.find(a.token).wallet, store.find(a.token).wallet);
  assert.deepEqual(disk.find(a.token).inventory, store.find(a.token).inventory);
  disk.save(disk.data);
  disk = new ProfileStore({ filePath });
  assert.equal(disk.find(a.token).progress.recentVictims[b.profile.id], 1180000);
  disk.startLife(a.profile.id, "new-life");
  const event = {
    type: "absorbed",
    profileId: a.profile.id,
    victimProfileId: b.profile.id,
    gain: 8,
  };
  disk.applyArenaProgress("too-early", [event], 1179999);
  assert.equal(disk.view(disk.find(a.token)).progress.arenaKills, 0);
  disk.applyArenaProgress("ready", [event], 1180000);
  assert.equal(disk.view(disk.find(a.token)).progress.arenaKills, 1);
});

test("Миграция v3 и восстановление накопленного XP после перезапуска без удвоения", (t) => {
  const filePath = path.join(temporary(t, "life-recovery"), "profiles.json"),
    { store, a } = setup();
  const old = structuredClone(store.data);
  old.version = 3;
  for (const p of Object.values(old.profiles)) {
    delete p.progress.session;
    delete p.progress.lastLife;
  }
  Object.values(old.profiles).find((p) => p.id === a.profile.id).progress.xp = 490;
  fs.writeFileSync(filePath, JSON.stringify(old));
  let disk = new ProfileStore({ filePath });
  assert.equal(disk.data.version, 13);
  assert.equal(disk.find(a.token).progress.session, null);
  disk.startLife(a.profile.id, "before-restart");
  disk.applyArenaProgress(
    "minute",
    [{ type: "survivalMinute", profileId: a.profile.id, mass: 10000, minutes: 1 }],
    1000000,
  );
  assert.equal(disk.find(a.token).progress.xp, 490);
  assert.equal(disk.find(a.token).level, 1);
  disk = new ProfileStore({ filePath });
  assert.equal(disk.find(a.token).progress.xp, 500);
  assert.equal(disk.find(a.token).level, 2);
  assert.equal(disk.find(a.token).progress.session, null);
  assert.equal(disk.find(a.token).progress.lastLife.earnedXp, 10);
  disk.save(disk.data);
  disk = new ProfileStore({ filePath });
  assert.equal(disk.find(a.token).progress.xp, 500);
  disk.startLife(a.profile.id, "after-restart");
  disk.applyArenaProgress(
    "old-end",
    [
      {
        type: "lifeEnded",
        profileId: a.profile.id,
        lifeId: "before-restart",
        durationSeconds: 60,
        reason: "left",
      },
    ],
    1000001,
  );
  assert.equal(disk.find(a.token).progress.session.id, "after-restart");
  assert.equal(disk.find(a.token).progress.xp, 500);
});
