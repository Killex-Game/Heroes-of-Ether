/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const kit = require("../../public/shared/clan-crest-rules"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { xpForLevel } = require("../../src/server/progression/experience-progression"),
  { temporary } = require("../temp");
const { clanProgress } = require("../../src/server/clans/clan-level-progress");
function assertSafeArtwork(svg) {
  assert.doesNotMatch(svg, /<(?:script|foreignObject|image)\b|\bon\w+=|href=/i);
  assert.doesNotMatch(svg, /NaN|Infinity/);
}
function clanXp(level) {
  let xp = 0;
  while (clanProgress(xp).level < level) xp += clanProgress(xp).nextLevelXp;
  return xp;
}
function setup(filePath = null, options = {}) {
  const store = new ProfileStore({ filePath, ...options }),
    clans = new ClanService(store),
    u = store.open(),
    p = store.find(u.token);
  p.level = 12;
  p.progress.xp = xpForLevel(12);
  p.wallet.coins = 5000;
  p.wallet.crystals = 100; // Creation and paid-edit fixture.
  const act = (action, extra = {}) =>
    clans.mutate(u.token, {
      action,
      clanId: store.find(u.token).clanId,
      requestId: randomUUID(),
      ...extra,
    });
  act("create", {
    name: "Аметист",
    prefix: "AM",
    emblem: "astral",
    crest: kit.DEFAULT,
    privacy: "open",
  });
  return {
    store,
    clans,
    u,
    act,
    p: () => store.find(u.token),
    clan: () => store.data.clans[store.find(u.token).clanId],
  };
}
test("Название и префикс стоят вместе 50: повтор, нормализация, бесплатные детали и сохранение", (t) => {
  const filePath = path.join(temporary(t, "clan-rename"), "profiles.json"),
    f = setup(filePath);
  const request = {
    action: "edit",
    clanId: f.clan().id,
    name: "Новое имя",
    prefix: "NEW",
    requestId: randomUUID(),
  };
  f.clans.mutate(f.u.token, request);
  assert.equal(f.p().wallet.crystals, 50);
  assert.equal(f.clan().name, "Новое имя");
  assert.equal(f.clan().prefix, "NEW");
  assert.equal(f.clans.mutate(f.u.token, request).replay, true);
  f.act("edit", {
    name: " Новое имя ",
    prefix: " NEW ",
    description: "Бесплатно",
    privacy: "closed",
  });
  assert.equal(f.p().wallet.crystals, 50);
  const disk = new ProfileStore({ filePath });
  new ClanService(disk).mutate(f.u.token, request);
  assert.equal(disk.find(f.u.token).wallet.crystals, 50);
  f.act("edit", { prefix: "NEXT" });
  assert.equal(f.p().wallet.crystals, 0);
});
test("Переименование и герб оплачиваются атомарно; недостаток и отказ записи ничего не меняют", () => {
  const f = setup(),
    crest = { ...kit.DEFAULT, color: kit.colors[2].id };
  f.p().wallet.crystals = 99;
  let before = JSON.stringify(f.store.data);
  assert.throws(() => f.act("edit", { name: "Новое", crest }), /100 кристаллов/);
  assert.equal(JSON.stringify(f.store.data), before);
  f.p().wallet.crystals = 100;
  before = JSON.stringify(f.store.data);
  const save = f.store.save.bind(f.store);
  f.store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => f.act("edit", { name: "Новое", crest }), /disk full/);
  assert.equal(JSON.stringify(f.store.data), before);
  f.store.save = save;
  f.act("edit", { name: "Новое", crest });
  assert.equal(f.p().wallet.crystals, 0);
});
test("Конструктор: 21 форма, 32 цвета, 24 золотых символа и безопасные данные", () => {
  assert.equal(kit.frames.length, 21);
  assert.equal(kit.colors.length, 32);
  assert.equal(kit.symbols.length, 24);
  assert.equal(kit.patterns.length, 18);
  for (const frame of kit.frames)
    for (const symbol of kit.symbols) {
      const c = { ...kit.DEFAULT, frame: frame.id, symbol: symbol.id };
      assert.deepEqual(kit.normalize(c), c);
      const svg = kit.fieldSvg(c);
      const fs = require("node:fs");
      assert(fs.existsSync(path.resolve(__dirname, "../../public", kit.symbolSource(symbol.id).split("?")[0])));
      const frameSource = kit.frameSource(frame.id);
      if (frameSource.startsWith("assets/")) assert(fs.existsSync(path.resolve(__dirname, "../../public", frameSource)));
      else assertSafeArtwork(decodeURIComponent(frameSource.split(",")[1]));
      assert.match(svg, /<svg/);
      assertSafeArtwork(svg);
    }
  for (const bad of [
    { ...kit.DEFAULT, frame: "__proto__" },
    { ...kit.DEFAULT, color: "<script>" },
    { ...kit.DEFAULT, symbol: "https://example.com" },
    { ...kit.DEFAULT, svg: "bad" },
    { ...kit.DEFAULT, pattern: "<script>" },
    { ...kit.DEFAULT, secondary: "#fff" },
    { ...kit.DEFAULT, metal: "url(external)" },
    { ...kit.DEFAULT, symbolColor: "red" },
    [],
    "x",
    {},
  ])
    assert.throws(() => kit.normalize(bad));
  assert.equal(kit.normalize(null), null);
  assert.match(kit.defaultSource("grove"), /clan_grove/);
  for (const [old, replacement] of Object.entries({
    f04_broad: "f03_heater",
    f06_diamond: "f07_octagon",
    f20_triangle: "f16_gothic",
    f21_tourney: "f11_french",
  })) {
    assert.ok(!kit.frames.some((f) => f.id === old));
    assert.equal(kit.normalize({ ...kit.DEFAULT, frame: old }).frame, replacement);
  }
  for (const level of [1, 9, 10, 50]) {
    const list = kit.framesForLevel(level);
    for (let i = 1; i < list.length; i++)
      assert.ok(kit.requiredLevel(list[i - 1].id) <= kit.requiredLevel(list[i].id));
    const firstLocked = list.findIndex((f) => kit.requiredLevel(f.id) > level);
    if (firstLocked >= 0)
      assert.ok(list.slice(firstLocked).every((f) => kit.requiredLevel(f.id) > level));
  }
  assert.deepEqual(
    kit.normalize({ ...kit.DEFAULT, pattern: "solid", secondary: "c21_snow", metal: "gold" }),
    { frame: kit.DEFAULT.frame, color: kit.DEFAULT.color, symbol: kit.DEFAULT.symbol },
  );
  for (const pattern of kit.patterns)
    for (const metal of kit.metals) {
      const c = { ...kit.DEFAULT, pattern: pattern.id, metal: metal.id, secondary: "c21_snow" };
      assertSafeArtwork(kit.fieldSvg(c));
      assert.ok(kit.fieldSvg(c).includes("<svg"));
    }
  for (const preset of kit.presets)
    assert.doesNotThrow(() =>
      kit.normalize({
        ...kit.DEFAULT,
        color: preset.color,
        secondary: preset.secondary,
        pattern: preset.pattern,
      }),
    );
});
test("Герб включён в создание, изменение стоит ровно 50; повтор не списывает дважды", () => {
  const f = setup();
  assert.equal(f.p().wallet.coins, 3500);
  assert.equal(f.p().wallet.crystals, 100);
  const request = {
    action: "edit",
    clanId: f.clan().id,
    crest: { ...kit.DEFAULT, color: kit.colors[2].id },
    requestId: randomUUID(),
  };
  f.clans.mutate(f.u.token, request);
  f.clans.mutate(f.u.token, request);
  assert.equal(f.p().wallet.crystals, 50);
  assert.deepEqual(f.clan().crest, request.crest);
  f.act("edit", { description: "Новое описание", crest: request.crest });
  assert.equal(f.p().wallet.crystals, 50);
  assert.deepEqual(f.clans.state(f.u.token).mine.crest, request.crest);
  assert.deepEqual(f.store.identity(f.p()).clanCrest, request.crest);
});
test("Недостаточный баланс, неверный герб и ошибка записи не меняют клан или кошелёк", () => {
  const f = setup();
  f.p().wallet.crystals = 49;
  let before = JSON.stringify(f.store.data);
  assert.throws(() => f.act("edit", { crest: { ...kit.DEFAULT, symbol: null } }), /50 кристаллов/);
  assert.equal(JSON.stringify(f.store.data), before);
  assert.throws(
    () => f.act("edit", { crest: { ...kit.DEFAULT, symbol: "invalid" } }),
    /конструктора/,
  );
  assert.equal(JSON.stringify(f.store.data), before);
  f.p().wallet.crystals = 100;
  before = JSON.stringify(f.store.data);
  f.store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => f.act("edit", { crest: { ...kit.DEFAULT, symbol: null } }), /disk full/);
  assert.equal(JSON.stringify(f.store.data), before);
});
test("Герб и однократное списание сохраняются после перезапуска", (t) => {
  const filePath = path.join(temporary(t, "crest"), "profiles.json"),
    f = setup(filePath),
    crest = {
      ...kit.DEFAULT,
      frame: "f25_bastion",
      symbol: "s25_rose",
      color: "c23_navy",
      pattern: "quarterly",
      secondary: "c21_snow",
      metal: "silver",
    };
  f.clan().xp = clanXp(10);
  const request = { action: "edit", clanId: f.clan().id, crest, requestId: randomUUID() };
  f.clans.mutate(f.u.token, request);
  const reloaded = new ProfileStore({ filePath });
  new ClanService(reloaded).mutate(f.u.token, request);
  assert.deepEqual(reloaded.data.clans[f.clan().id].crest, crest);
  assert.equal(reloaded.find(f.u.token).wallet.crystals, 50);
});
test("Управляющий меняет описание бесплатно, но не герб", () => {
  const f = setup(),
    u = f.store.open(),
    p = f.store.find(u.token);
  p.level = 12;
  p.progress.xp = xpForLevel(12);
  f.clans.mutate(u.token, { action: "apply", clanId: f.clan().id, requestId: randomUUID() });
  f.act("role", { memberId: p.id, role: "manager" });
  const act = (extra) =>
    f.clans.mutate(u.token, {
      action: "edit",
      clanId: f.clan().id,
      requestId: randomUUID(),
      ...extra,
    });
  assert.throws(() => act({ crest: { ...kit.DEFAULT, symbol: null } }), /только глава/);
  act({ description: "Описание управляющего" });
  assert.equal(f.store.find(u.token).wallet.crystals, 10);
  assert.deepEqual(f.clan().crest, kit.DEFAULT);
});

test("Удалённый ключ исчезает из выбора, старый герб сохраняет оформление и прогресс", (t) => {
  const fs = require("node:fs");
  assert.ok(!kit.symbols.some((symbol) => symbol.id === "s19_key"));
  const filePath = path.join(temporary(t, "retired-key"), "profiles.json"),
    f = setup(filePath);
  f.clan().xp = clanXp(3);
  f.clan().crest = { ...kit.DEFAULT, symbol: "s19_key", pattern: "cross", secondary: "c21_snow" };
  const profile = structuredClone(f.p()),
    old = structuredClone(f.clan().crest);
  fs.writeFileSync(filePath, JSON.stringify(f.store.data));
  const loaded = new ProfileStore({ filePath });
  assert.deepEqual(loaded.data.clans[f.clan().id].crest, { ...old, symbol: "s21_lily" });
  assert.deepEqual(loaded.find(f.u.token), profile);
  assert.deepEqual(kit.normalize(old), kit.normalize({ ...old, symbol: "s21_lily" }));
});

test("Удалённые рамки в старом сохранении заменяются бесплатно, остальные параметры и прогресс сохраняются", (t) => {
  const fs = require("node:fs");
  for (const [old, replacement] of Object.entries({
    f04_broad: "f03_heater",
    f06_diamond: "f07_octagon",
    f20_triangle: "f16_gothic",
    f21_tourney: "f11_french",
  })) {
    const filePath = path.join(temporary(t, "retired-crest"), "profiles.json"),
      f = setup(filePath);
    f.clan().xp = clanXp(3);
    f.clan().crest = { ...kit.DEFAULT, frame: old, pattern: "cross", secondary: "c21_snow" };
    const before = structuredClone(f.p());
    fs.writeFileSync(filePath, JSON.stringify(f.store.data));
    const loaded = new ProfileStore({ filePath });
    assert.deepEqual(loaded.data.clans[f.clan().id].crest, {
      ...f.clan().crest,
      frame: replacement,
    });
    assert.deepEqual(loaded.find(f.u.token), before);
  }
});

const unlocks = {
  frame: {
    3: [
      "f11_french",
      "f12_spanish",
      "f13_norman",
      "f14_english",
      "f15_polish",
      "f16_gothic",
      "f17_concave",
    ],
    7: [
      "f18_trefoil",
      "f19_drop",
      "f22_byzantine",
      "f23_varangian",
      "f24_renaissance",
      "f25_bastion",
    ],
    10: ["f08_cartouche", "f09_royal", "f10_grand"],
  },
  metal: { 1: ["steel"], 3: ["copper"], 5: ["bronze"], 7: ["silver"], 10: ["gold"] },
  symbol: { 10: ["s22_bear", "s23_unicorn", "s24_kraken", "s25_rose"] },
};

test("Каталог: уровни форм, рамок и символов совпадают с разметкой владельца, сортировка возрастает", () => {
  for (const groups of Object.values(unlocks))
    for (const [level, ids] of Object.entries(groups))
      for (const id of ids) assert.equal(kit.requiredLevel(id), Number(level), id);
  assert.deepEqual(
    kit
      .choicesForLevel("frames", 1)
      .filter((x) => kit.requiredLevel(x.id) === 1)
      .map((x) => x.id),
    ["f01_round", "f02_oval", "f03_heater", "f05_kite", "f07_octagon"],
  );
  for (const level of [1, 2, 3, 4, 5, 6, 7, 9, 10, 15])
    for (const category of ["frames", "metals", "symbols", "colors", "patterns"]) {
      const list = kit.choicesForLevel(category, level);
      for (let i = 1; i < list.length; i++)
        assert.ok(kit.requiredLevel(list[i - 1].id) <= kit.requiredLevel(list[i].id));
    }
  assert.deepEqual(
    kit.choicesForLevel("metals", 1).map((x) => x.id),
    ["steel", "copper", "bronze", "silver", "gold"],
  );
  assert.equal(kit.requiredCrestLevel(kit.DEFAULT), 1);
});

test("Сервер проверяет каждую границу уровня до списания, повтор разрешённого запроса не списывает дважды", () => {
  for (const [key, groups] of Object.entries(unlocks))
    for (const [rawLevel, ids] of Object.entries(groups)) {
      const level = Number(rawLevel);
      if (level === 1) continue;
      for (const id of ids) {
        const f = setup(),
          crest = { ...kit.DEFAULT, [key]: id };
        f.clan().xp = clanXp(level) - 1;
        const before = structuredClone(f.store.data);
        assert.throws(
          () => f.act("edit", { crest, clanLevel: 15 }),
          new RegExp(`${level} уровня`),
          id,
        );
        assert.deepEqual(f.store.data, before, id);
        f.clan().xp = clanXp(level);
        const request = { action: "edit", clanId: f.clan().id, crest, requestId: randomUUID() };
        f.clans.mutate(f.u.token, request);
        f.clans.mutate(f.u.token, request);
        assert.deepEqual(f.clan().crest, kit.normalize(crest), id);
        assert.equal(f.p().wallet.crystals, 50, id);
      }
    }
  const f = setup(),
    { metal, ...implicitGold } = kit.DEFAULT;
  assert.throws(() => f.act("edit", { crest: implicitGold }), /10 уровня/);
  assert.equal(f.p().wallet.crystals, 100);
});

test("Новый клан не получает закрытые элементы через создание, доступная сталь сохраняется", () => {
  const store = new ProfileStore(),
    clans = new ClanService(store),
    user = store.open(),
    p = store.find(user.token);
  p.level = 12;
  p.progress.xp = xpForLevel(12);
  p.wallet.coins = 5000;
  p.wallet.crystals = 100; // Creation and paid-edit fixture.
  const create = (crest) =>
    clans.mutate(user.token, {
      action: "create",
      name: "Стальной щит",
      prefix: "STAL",
      emblem: "astral",
      privacy: "open",
      crest,
      requestId: randomUUID(),
    });
  for (const crest of [
    { ...kit.DEFAULT, frame: "f11_french" },
    { ...kit.DEFAULT, metal: "gold" },
    { ...kit.DEFAULT, symbol: "s25_rose" },
  ]) {
    const before = structuredClone(store.data);
    assert.throws(() => create(crest), /уровня клана/);
    assert.deepEqual(store.data, before);
  }
  create(kit.DEFAULT);
  assert.equal(store.data.clans[store.find(user.token).clanId].crest.metal, "steel");
  assert.equal(store.find(user.token).wallet.coins, 3500);
});

test("Отключение теста заменяет только недоступные части герба, бесплатно и атомарно", (t) => {
  const fs = require("node:fs"),
    filePath = path.join(temporary(t, "crest-unlocks-migration"), "profiles.json"),
    f = setup(filePath, { unlockClanCrests: true }),
    crest = {
      ...kit.DEFAULT,
      frame: "f25_bastion",
      symbol: "s25_rose",
      metal: "gold",
      color: "c23_navy",
      pattern: "quarterly",
      secondary: "c21_snow",
    };
  f.act("edit", { crest });
  const before = structuredClone(f.store.data),
    saved = fs.readFileSync(filePath),
    disk = new ProfileStore({ filePath }),
    expected = { ...kit.DEFAULT, color: "c23_navy", pattern: "quarterly", secondary: "c21_snow" };
  assert.deepEqual(disk.data.clans[f.clan().id].crest, expected);
  assert.equal(disk.appearanceMigrationPending, true);
  assert.deepEqual(disk.find(f.u.token), f.p());
  const rename = fs.renameSync;
  fs.renameSync = () => {
    throw Error("crest disk full");
  };
  try {
    assert.throws(() => disk.open(f.u.token), /crest disk full/);
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(fs.readFileSync(filePath), saved);
  disk.open(f.u.token);
  const restarted = new ProfileStore({ filePath });
  assert.equal(restarted.appearanceMigrationPending, false);
  assert.deepEqual(restarted.data.clans[f.clan().id].crest, expected);
  assert.deepEqual(restarted.data.profiles, before.profiles);
  assert.equal(restarted.data.clans[f.clan().id].xp, 0);
});

test("Тестовый доступ открывает все формы без повышения уровня и сохраняется после перезапуска", (t) => {
  const filePath = path.join(temporary(t, "crest-test-access"), "profiles.json"),
    f = setup(filePath, { unlockClanCrests: true });
  f.p().wallet.crystals = 1000;
  assert.equal(f.clans.state(f.u.token).rules.testCrests, true);
  for (const frame of kit.frames.filter((x) => kit.requiredLevel(x.id) > 1)) {
    const crest = { ...kit.DEFAULT, frame: frame.id },
      request = { action: "edit", clanId: f.clan().id, crest, requestId: randomUUID() },
      before = f.p().wallet.crystals;
    f.clans.mutate(f.u.token, request);
    f.clans.mutate(f.u.token, request);
    assert.equal(f.p().wallet.crystals, before - kit.EDIT_COST);
    assert.deepEqual(f.clan().crest, crest);
    const restored = new ProfileStore({ filePath, unlockClanCrests: true });
    assert.deepEqual(restored.data.clans[f.clan().id].crest, crest);
    new ClanService(restored).mutate(f.u.token, request);
    assert.equal(restored.find(f.u.token).wallet.crystals, before - kit.EDIT_COST);
  }
  assert.equal(f.clan().xp, 0);
  const before = structuredClone(f.store.data);
  f.store.save = () => {
    throw Error("disk full");
  };
  assert.throws(
    () => f.act("edit", { crest: { ...kit.DEFAULT, frame: "f08_cartouche" } }),
    /disk full/,
  );
  assert.deepEqual(f.store.data, before);
  const locked = setup();
  assert.equal(locked.clans.state(locked.u.token).rules.testCrests, false);
  assert.throws(
    () => locked.act("edit", { crest: { ...kit.DEFAULT, frame: "f08_cartouche" } }),
    /10 уровня/,
  );
});
