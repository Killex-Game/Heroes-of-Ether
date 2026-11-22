/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { BOOSTERS, publicCatalog } = require("../../src/server/boosters/booster-catalog");
const {
  Arena,
  radiusForMass,
  canAbsorb,
  boosterLimitForLevel,
} = require("../../src/server/arena/arena-simulation");
const { readCatalog } = require("../../scripts/assets/import-boosters");
const { temporary } = require("../temp");
function scene() {
  const arena = new Arena({ etherCount: 0 });
  const a = arena.addPlayer(0, "a"),
    b = arena.addPlayer(0, "b");
  for (const [p, x] of [
    [a, 500],
    [b, 700],
  ])
    Object.assign(p, { level: 25, x, y: 500, targetX: x, targetY: 500, lastMoveAt: 5000 });
  return { arena, a, b };
}
function command(p, id, target) {
  return { boosterId: id, spawnSerial: p.spawnSerial, aimX: target?.x, aimY: target?.y };
}

test("Атакующие бустеры: повтор без задержки при сохранении лимита применений", () => {
  const { arena, a, b } = scene();
  const ids = [
    "glove",
    "web",
    "freeze",
    "hook",
    "rocket",
    "lock",
    "harpoon",
    "mega_poison",
    "axe",
    "stone",
    "fire",
  ];
  for (const id of ids) {
    const item = publicCatalog().items.find((entry) => entry.id === id);
    assert.equal(item.cooldownMs, 300, id);
    assert.equal(item.sharedCooldownMs, 0, id);
    arena.prepareBooster(a.id, command(a, id, b), 5000)();
    assert.doesNotThrow(() => arena.prepareBooster(a.id, command(a, id, b), 5000), id);
    assert.equal(a.boosterUses[id], 1, id);
  }
  for (const id of ids) {
    arena.prepareBooster(a.id, command(a, id, b), 5300)();
    assert.equal(a.boosterUses[id], 2, id);
  }
  assert.equal(a.boosterReadyAt, 0);
  assert.equal(BOOSTERS.get("candy").cooldownMs, 100);
});

test("Подготовка не запускает таймер до успешного сохранения и применения", () => {
  const { arena, a, b } = scene();
  assert.throws(() => arena.prepareBooster(a.id, command(a, "hook"), 5000));
  assert.equal(a.boosterItemReadyAt.hook, undefined);
  const apply = arena.prepareBooster(a.id, command(a, "hook", b), 5000);
  assert.equal(a.boosterItemReadyAt.hook, undefined);
  apply();
  assert.equal(a.boosterItemReadyAt.hook, undefined);
});
test("Карточки сохраняют правила каталога; PNG и новые SVG доступны", () => {
  const directory = path.join(__dirname, "../../public/assets/boosters");
  const source = readCatalog(path.join(directory, "catalog.html"));
  // Исходный лист рисунков хранит старые подписи; утверждённый баланс живёт в JSON.
  const revisedEffects = {
    glove: "Отталкивает соперника",
    poison:
      "Сжигает 35% общей массы на момент попадания за 10 секунд. Из потерянной массы 15% выбрасывается эфиром.",
    mega_poison:
      "Сжигает 50% общей массы на момент попадания за 15 секунд. Из потерянной массы 15% выбрасывается эфиром.",
    knuckles:
      "При попадании мгновенно делит соперника до максимума частей и исчезает. Отскакивает от любого щита. После первого отражения живёт до 15 секунд.",
  };
  const data = publicCatalog();
  assert.equal(data.items.filter(item => item.tier !== "potion").length, 30);
  assert.equal(data.items.filter((item) => item.ready && item.tier !== "potion").length, 30);
  assert.equal(data.items.find((item) => item.id === "easter_egg").purchasable, false);
  for (const item of source.items) {
    const actual = data.items.find((s) => s.id === item.id);
    assert.equal(actual.effect, revisedEffects[item.id] || item.effect);
    if (["web", "stone"].includes(item.id)) {
      assert.equal(actual.flightMs, item.params.flight_seconds * 1000);
      assert.equal(BOOSTERS.get(item.id).durationMs, item.params.immobilize_seconds * 1000);
    }
    const svg = fs.readFileSync(path.join(directory, "svg", item.tier, item.id + ".svg"), "utf8");
    assert.match(svg, /<svg[^>]+viewBox="0 0 256 256"/);
    assert(svg.includes(`<title id="${item.id}-title">`), item.id);
    assert(!/<script|https?:\/\//.test(svg.replace("http://www.w3.org/2000/svg", "")), item.id);
    const iconPath = actual.icon.split("?")[0];
    assert.equal(iconPath, `assets/boosters/png/${item.id}.png`);
    const png = fs.readFileSync(path.join(__dirname, "../../public", iconPath));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", item.id);
  }
});
test("Стартовый баланс выдаётся один раз; покупка и её ID переживают перезапуск", (t) => {
  const filePath = path.join(temporary(t, "profiles"), "profiles.json");
  const store = new ProfileStore({ filePath }),
    session = store.open(),
    id = randomUUID();
  assert.deepEqual(session.profile.wallet, { coins: 100, crystals: 10, bucks: 0 });
  assert.equal(store.open(session.token).created, false);
  store.buy(session.token, "ice_cream", id);
  const restarted = new ProfileStore({ filePath });
  const replay = restarted.buy(session.token, "ice_cream", id);
  assert.equal(replay.replay, true);
  assert.equal(replay.profile.wallet.coins, 90);
  assert.equal(replay.profile.inventory.ice_cream, 10);
  assert.throws(() => restarted.buy(session.token, "candy", id), /другой операции/);
  assert.equal(restarted.open(session.token).profile.id, session.profile.id);
});
test("Цены комплектов, недостаточный баланс и запрет незавершённых предметов", () => {
  const store = new ProfileStore(),
    { token } = store.open();
  store.find(token).level = 25;
  store.find(token).progress =
    require("../../src/server/progression/experience-progression").freshProgress(25);
  store.find(token).wallet.crystals = 35; // Малый баланс для проверки нехватки валюты.
  const first = store.buy(token, "speed", randomUUID());
  assert.equal(first.profile.wallet.crystals, 25);
  assert.equal(first.profile.inventory.speed, 10);
  const rare = store.buy(token, "meat", randomUUID());
  assert.equal(rare.profile.wallet.crystals, 5);
  assert.equal(rare.profile.inventory.meat, 10);
  assert.throws(() => store.buy(token, "stone", randomUUID()), /Недостаточно/);
  assert.throws(() => store.buy(token, "fire", randomUUID()), /казны/);
  assert.throws(() => store.buy(token, "__proto__", randomUUID()), /Такого бустера/);
  assert.throws(() => store.buy("invalid", "candy", randomUUID()), /открой лобби/);
  assert.deepEqual(store.view(store.find(token)).wallet, { coins: 100, crystals: 5, bucks: 0 });
});
test("Ошибка диска не меняет баланс и количество предметов", () => {
  const store = new ProfileStore({ now: () => Date.UTC(2026, 9, 25, 10) }),
    { token } = store.open();
  store.find(token).level = 25;
  store.find(token).progress =
    require("../../src/server/progression/experience-progression").freshProgress(25);
  const before = store.view(store.find(token));
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => store.buy(token, "candy", randomUUID()), /disk full/);
  assert.deepEqual(store.view(store.find(token)), before);
});

test("Все улучшенные и редкие комплекты: новая цена, 10 штук, отказ записи и повтор после перезапуска", (t) => {
  const filePath = path.join(temporary(t, "new-booster-prices"), "profiles.json");
  const now = () => Date.UTC(2026, 9, 25, 10);
  const store = new ProfileStore({ filePath, now }),
    { token } = store.open();
  store.find(token).level = 25;
  store.find(token).progress =
    require("../../src/server/progression/experience-progression").freshProgress(25);
  store.find(token).wallet.crystals = 500;
  const operations = [];
  for (const item of publicCatalog().items.filter((b) => ["advanced", "rare"].includes(b.tier) && !b.eventOnly)) {
    const amount = item.tier === "advanced" ? 10 : 20;
    assert.deepEqual(item.price, {
      currency: "crystals",
      currency_ru: "кристаллы",
      amount,
      quantity: 10,
    });
    const before = structuredClone(store.find(token)),
      save = store.save;
    const requestId = randomUUID();
    store.save = () => {
      throw Error("disk full");
    };
    assert.throws(() => store.buy(token, item.id, requestId), /disk full/);
    assert.deepEqual(store.find(token), before);
    store.save = save;
    store.buy(token, item.id, requestId);
    assert.equal(store.find(token).wallet.crystals, before.wallet.crystals - amount);
    assert.equal(store.find(token).inventory[item.id], 10);
    operations.push({ id: item.id, requestId });
  }
  assert.equal(operations.length, 15);
  const reopened = new ProfileStore({ filePath, now }),
    before = structuredClone(reopened.find(token));
  for (const op of operations) assert.equal(reopened.buy(token, op.id, op.requestId).replay, true);
  assert.deepEqual(reopened.find(token), before);
  assert.equal(before.wallet.crystals, 270);
});
test("Последний предмет освобождает только свой слот, сохраняет соседние клавиши и переживает перезапуск", (t) => {
  const filePath = path.join(temporary(t, "empty-slot"), "profiles.json");
  const store = new ProfileStore({ filePath }),
    { token } = store.open();
  store.find(token).level = 25;
  store.find(token).progress =
    require("../../src/server/progression/experience-progression").freshProgress(25);
  store.find(token).wallet.crystals = 100; // Multi-purchase fixture.
  store.buy(token, "candy", randomUUID());
  store.buy(token, "speed", randomUUID());
  store.buy(token, "meat", randomUUID());
  store.find(token).inventory.meat = 1; // Проверяем расход последнего предмета, не размер пакета.
  const input = {
    name: "Путник",
    skinId: "moon-dragon",
    quickSlots: ["meat", null, "speed", "candy"],
    requestId: randomUUID(),
  };
  store.setLoadout(token, input);
  const id = randomUUID();
  store.consume(token, "meat", id, "last-meat", () => ({ mass: 710 }));
  const expected = [null, null, "speed", "candy"];
  assert.deepEqual(store.view(store.find(token)).quickSlots, expected);
  const restarted = new ProfileStore({ filePath });
  assert.deepEqual(restarted.find(token).quickSlots, expected);
  assert.equal(
    restarted.consume(token, "meat", id, "last-meat", () => {
      throw Error("Повтор не должен применяться");
    }).replay,
    true,
  );
  assert.throws(
    () => restarted.setLoadout(token, { ...input, requestId: randomUUID() }),
    /имеющихся/,
  );
  restarted.buy(token, "meat", randomUUID());
  assert.deepEqual(restarted.find(token).quickSlots, ["meat", null, "speed", "candy"]);
});
test("Старый пустой слот очищается при загрузке, ошибка диска не удаляет последний предмет", (t) => {
  const filePath = path.join(temporary(t, "old-slot"), "profiles.json"),
    now = () => Date.UTC(2026, 9, 25, 10),
    store = new ProfileStore({ filePath, now }),
    { token } = store.open();
  store.find(token).level = 25;
  store.find(token).progress =
    require("../../src/server/progression/experience-progression").freshProgress(25);
  store.find(token).wallet.crystals = 100; // Multi-purchase fixture.
  store.buy(token, "meat", randomUUID());
  store.buy(token, "speed", randomUUID());
  store.find(token).inventory.meat = 0;
  store.save(store.data);
  const migrated = new ProfileStore({ filePath, now });
  assert.deepEqual(migrated.find(token).quickSlots, [null, "speed"]);
  migrated.buy(token, "meat", randomUUID());
  const before = migrated.view(migrated.find(token));
  migrated.save = () => {
    throw Error("disk full");
  };
  assert.throws(
    () => migrated.consume(token, "meat", randomUUID(), "last", () => ({ mass: 710 })),
    /disk full/,
  );
  assert.deepEqual(migrated.view(migrated.find(token)), before);
});
test("Повреждённое сохранение не заменяется пустым профилем", (t) => {
  const filePath = path.join(temporary(t, "invalid"), "profiles.json");
  fs.writeFileSync(filePath, "broken");
  assert.throws(() => new ProfileStore({ filePath }));
  assert.equal(fs.readFileSync(filePath, "utf8"), "broken");
});
for (const [id, amount] of [
  ["ice_cream", 200],
  ["candy", 150],
  ["donut", 500],
  ["meat", 700],
]) {
  test(`${id}: сервер прибавляет ${amount} массы и обновляет радиус`, () => {
    const { arena, a } = scene();
    arena.prepareBooster(a.id, command(a, id), 5000)();
    assert.equal(a.mass, 20 + amount);
    assert.equal(a.radius, radiusForMass(20 + amount));
    assert.doesNotThrow(() => arena.prepareBooster(a.id, command(a, id), 5000));
    arena.prepareBooster(a.id, command(a, id), 5100)();
    assert.equal(a.mass, 20 + 2 * amount);
  });
}
test("Ускорение даёт ровно +50% и заканчивается через 15 секунд", () => {
  const { arena, a, b } = scene();
  b.y = b.targetY = 1000;
  a.targetX = b.targetX = 1800;
  arena.prepareBooster(a.id, command(a, "speed"), 5000)();
  arena.step(5050);
  assert.ok(Math.abs((a.x - 500) / (b.x - 700) - 1.5) < 1e-8);
  assert.equal(arena.hasEffect(a, "speed", 19999), true);
  assert.equal(arena.hasEffect(a, "speed", 20000), false);
  assert.doesNotThrow(() => arena.prepareBooster(a.id, command(a, "speed"), 6000));
  const x = a.x;
  a.lastMoveAt = 20000;
  arena.step(20000);
  assert.ok(
    Math.abs(
      a.x - x - require("../../src/server/arena/arena-simulation").speedForMass(a.mass) * 0.05,
    ) < 1e-8,
  );
});
for (const [id, flight, duration] of [
  ["web", 1000, 7000],
  ["stone", 4000, 10000],
]) {
  test(`${id}: цель неподвижна ${duration / 1000} секунд, затем снова движется`, () => {
    const { arena, a, b } = scene();
    arena.prepareBooster(a.id, command(a, id, b), 5000)();
    const landing = 5000 + flight;
    b.x = arena.combat.shots[0].x + (flight / 1000) * BOOSTERS.get(id).flightSpeed;
    b.targetX = b.x;
    arena.combat.update(landing);
    const before = b.x;
    arena.handleInput(b.id, { type: "move", x: 100, y: 500 }, landing + duration - 1);
    arena.step(landing + duration - 1);
    assert.equal(b.x, before);
    arena.handleInput(b.id, { type: "move", x: 100, y: 500 }, landing + duration);
    arena.step(landing + duration);
    assert.ok(b.x < before);
  });
}
test("Щиты 20/30 секунд блокируют новые негативные эффекты, не очищая старые", () => {
  for (const [id, duration] of [
    ["colorful_shield", 20000],
    ["sphere", 30000],
    ["golden_shield", 35000],
  ]) {
    const { arena, a, b } = scene();
    b.effects.web = 20000;
    arena.prepareBooster(b.id, command(b, id), 6000)();
    assert.equal(arena.hasEffect(b, "root", 6000), true);
    assert.equal(b.effects[id], 6000 + duration);
    arena.prepareBooster(a.id, command(a, "freeze", b), 7000)();
    arena.combat.update(9000);
    assert.equal(b.effects.freeze, undefined);
    assert.equal(arena.combat.shots.length, 0);
    assert.equal(arena.hasEffect(b, "shield", 6000 + duration), false);
    Object.assign(a, { mass: 1000, radius: radiusForMass(1000), x: b.x, y: b.y });
    assert.equal(canAbsorb(a, b, 7000), true); // Щит бустеров не отменяет поглощение игроков.
  }
});
test("Выстрел требует конечного направления и актуальной жизни, защита появления запрещает запуск", () => {
  const { arena, a, b } = scene();
  assert.throws(() => arena.prepareBooster(a.id, command(a, "web", a), 5000), /центр/);
  for (const aimX of [undefined, NaN, Infinity, "500"])
    assert.throws(
      () => arena.prepareBooster(a.id, { ...command(a, "web", b), aimX }, 5000),
      /направление/,
    );
  a.protectedUntil = 6000;
  assert.throws(() => arena.prepareBooster(a.id, command(a, "web", b), 5000), /защиты/);
  a.protectedUntil = 0;
  const obsolete = command(a, "candy");
  a.spawnSerial++;
  assert.throws(() => arena.prepareBooster(a.id, obsolete, 5000), /возрождения/);
  assert.equal(a.boostersUsed, 0);
});

test("Все границы лимита бустеров: независимый расход слотов и сброс после возрождения", () => {
  for (const [level, limit] of [
    [1, 10],
    [25, 10],
    [26, 15],
    [120, 15],
    [121, 20],
    [500, 20],
    [501, 24],
    [10001, 24],
  ]) {
    const { arena, a } = scene();
    a.level = level;
    assert.equal(boosterLimitForLevel(level), limit);
    for (let i = 0; i < limit; i++)
      arena.prepareBooster(a.id, command(a, "candy"), 5000 + i * 100)();
    const state = arena.snapshot(5000 + limit * 1000).players.find((p) => p.id === a.id);
    assert.equal(state.boosterLimit, limit);
    assert.equal(state.boostersUsed, limit);
    const mass = a.mass;
    assert.equal(state.boosterUses.candy, limit);
    assert.throws(() => arena.prepareBooster(a.id, command(a, "candy"), 5000), /Лимит/);
    assert.equal(a.mass, mass);
    assert.equal(a.boostersUsed, limit);
    arena.prepareBooster(a.id, command(a, "ice_cream"), 5000)();
    assert.equal(a.boosterUses.ice_cream, 1);
    assert.equal(a.boosterUses.candy, limit);
    arena.resetPlayer(a, 6000 + limit * 1000);
    assert.equal(a.boostersUsed, 0);
    assert.deepEqual(a.boosterUses, {});
    arena.prepareBooster(a.id, command(a, "candy"), 6000 + limit * 1000)();
    assert.equal(a.boostersUsed, 1);
  }
});

test("Смена и повтор щитов и яда без ожидания", () => {
  const { arena, a, b } = scene();
  arena.prepareBooster(a.id, command(a, "speed"), 5000)();
  arena.prepareBooster(a.id, command(a, "candy"), 5000)();
  arena.prepareBooster(a.id, command(a, "colorful_shield"), 5000)();
  arena.prepareBooster(a.id, command(a, "sphere"), 5000)();
  assert.doesNotThrow(() => arena.prepareBooster(a.id, command(a, "sphere"), 5000));
  assert.doesNotThrow(() => arena.prepareBooster(a.id, command(a, "poison", b), 5000));
  arena.prepareBooster(a.id, command(a, "poison", b), 6000)();
  arena.prepareBooster(a.id, command(a, "colorful_shield"), 6000)();
  assert.equal(a.effects.sphere, undefined);
  arena.prepareBooster(a.id, command(a, "golden_shield"), 6000)();
  assert.equal(a.effects.colorful_shield, undefined);
  assert.equal(a.effects.golden_shield, 41000);
  arena.prepareBooster(a.id, command(a, "colorful_shield"), 6000)();
  assert.deepEqual(a.shieldReadyAt, { colorful_shield: 6000 });
});

test("Каждый щит повторяется сразу, обновляет защиту и расходует одно применение", () => {
  for (const id of ["colorful_shield", "sphere", "golden_shield", "clan_shield"]) {
    const { arena, a } = scene();
    arena.prepareBooster(a.id, command(a, id), 5000)();
    assert.doesNotThrow(() => arena.prepareBooster(a.id, command(a, id), 5000));
    assert.equal(a.boosterUses[id], 1);
    arena.prepareBooster(a.id, command(a, id), 20000)();
    assert.equal(a.boosterUses[id], 2);
    assert.equal(a.effects[id], 20000 + BOOSTERS.get(id).durationMs);
    assert.equal(a.shieldReadyAt[id], 20000);
    assert.equal(
      arena.snapshot(20000).players.find((p) => p.id === a.id).shieldCooldowns[id],
      undefined,
    );
  }
});
test("Неудачная атака не расходует предмет; повтор успешной команды не расходует второй", () => {
  const store = new ProfileStore(),
    { token } = store.open();
  store.find(token).level = 25;
  store.find(token).progress =
    require("../../src/server/progression/experience-progression").freshProgress(25);
  store.buy(token, "web", randomUUID());
  const { arena, a, b } = scene();
  a.protectedUntil = 6000;
  const operation = command(a, "web", b),
    id = randomUUID();
  let apply;
  const execute = () =>
    store.consume(token, "web", id, "fixed-signature", () => {
      apply = arena.prepareBooster(a.id, operation, 5000);
    });
  assert.throws(execute, /защиты/);
  assert.equal(store.find(token).inventory.web, 10);
  a.protectedUntil = 0;
  const result = execute();
  if (!result.replay) apply();
  assert.equal(store.find(token).inventory.web, 9);
  assert.equal(execute().replay, true);
  assert.equal(store.find(token).inventory.web, 9);
});
test("Возрождение убирает эффекты, сохраняет правило 80% и не раскрывает инвентарь", () => {
  const { arena, a, b } = scene();
  arena.prepareBooster(a.id, command(a, "speed"), 5000)();
  arena.resetPlayer(a, 6000);
  assert.deepEqual(a.effects, {});
  Object.assign(a, { x: 500, y: 500, mass: 400, radius: radiusForMass(400), protectedUntil: 0 });
  Object.assign(b, { x: 500, y: 500, mass: 57, radius: radiusForMass(57), protectedUntil: 0 });
  const events = arena.resolveAbsorptions(7000);
  assert.equal(events[0].gain, 45);
  assert.equal(a.mass, 445);
  const state = arena.snapshot(7000);
  assert.equal(state.players[0].inventory, undefined);
  assert.equal(state.players[0].wallet, undefined);
  for (const id of BOOSTERS.keys()) assert.ok(publicCatalog().items.some((item) => item.id === id));
});
