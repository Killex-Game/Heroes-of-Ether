/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService, prefixValue } = require("../../src/server/clans/clan-service"),
  { temporary } = require("../temp");
const { grantCoins } = require("../../scripts/development/grant-coins"),
  { acquireServerLock } = require("../../src/server/runtime/process-lock");
const { label } = require("../../public/shared/player-identity");
const eligible = (store, who) => {
  const p = store.find(who.token);
  p.level = 12;
  p.progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(12);
};
function setup() {
  const store = new ProfileStore(),
    clans = new ClanService(store),
    a = store.open(),
    b = store.open(),
    c = store.open();
  for (const who of [a, b, c]) {
    eligible(store, who);
    store.find(who.token).wallet.crystals = 100; // Paid clan edits in this fixture.
  }
  const act = (who, action, data = {}) =>
    clans.mutate(who.token, { action, requestId: randomUUID(), ...data });
  const create = (who, prefix = "ЛЕС") => {
    grantCoins(store, who.profile.id, 1500);
    act(who, "create", {
      name: "Лесной союз",
      prefix,
      description: "Вместе",
      emblem: "grove",
      privacy: "closed",
    });
    return store.find(who.token).clanId;
  };
  return { store, clans, a, b, c, act, create };
}
test("Казна: повторный взнос и покупка атомарны; выдача всем, но не будущим участникам", () => {
  const { store, clans, a, b, c, act, create } = setup(),
    clanId = create(a);
  act(b, "apply", { clanId });
  act(a, "accept", { clanId, memberId: b.profile.id });
  store.find(b.token).wallet.bucks = 550;
  const deposit = { action: "deposit", clanId, amount: 530, requestId: randomUUID() };
  clans.mutate(b.token, deposit);
  clans.mutate(b.token, deposit);
  assert.equal(store.find(b.token).wallet.bucks, 20);
  assert.equal(clans.state(a.token).mine.treasury, 530);
  assert.throws(() => clans.mutate(b.token, { ...deposit, amount: 531 }), /другой операции/);
  assert.throws(() => act(b, "buyBooster", { clanId, boosterId: "fire" }), /главе/);
  assert.throws(() => act(c, "deposit", { clanId, amount: 1 }), /участнику/);
  for (const amount of [0, -1, 1.5, "10", 21])
    assert.throws(() => act(b, "deposit", { clanId, amount }));
  const buy = { action: "buyBooster", clanId, boosterId: "fire", requestId: randomUUID() };
  clans.mutate(a.token, buy);
  clans.mutate(a.token, buy);
  assert.equal(store.data.clans[clanId].treasury, 30);
  for (const p of [a, b]) assert.equal(store.find(p.token).inventory.fire, 10);
  assert.throws(() => act(a, "buyBooster", { clanId, boosterId: "fire" }), /Недостаточно/);
  assert.throws(() => act(a, "buyBooster", { clanId, boosterId: "candy" }), /магазина клана/);
  act(c, "apply", { clanId });
  act(a, "accept", { clanId, memberId: c.profile.id });
  assert.equal(store.find(c.token).inventory.fire, undefined);
  act(b, "leave", { clanId });
  assert.equal(store.find(b.token).inventory.fire, 10);
  assert.equal(store.find(b.token).wallet.bucks, 20);
  assert.equal(store.data.clans[clanId].treasury, 30);
});
test("Покупка клана откатывает казну и все выдачи при ошибке записи; сохраняется после перезапуска", (t) => {
  const filePath = path.join(temporary(t, "treasury"), "profiles.json"),
    store = new ProfileStore({ filePath }),
    clans = new ClanService(store),
    a = store.open();
  eligible(store, a);
  grantCoins(store, a.profile.id, 1500);
  store.find(a.token).wallet.bucks = 2300;
  const act = (action, fields = {}) =>
    clans.mutate(a.token, { action, requestId: randomUUID(), ...fields });
  act("create", { name: "Тест", prefix: "T", emblem: "grove" });
  const clanId = store.find(a.token).clanId;
  act("deposit", { clanId, amount: 2300 });
  const before = JSON.stringify(store.data),
    save = store.save.bind(store);
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => act("buyBooster", { clanId, boosterId: "cake" }), /disk full/);
  assert.equal(JSON.stringify(store.data), before);
  store.save = save;
  for (const b of clans.state(a.token).shop) act("buyBooster", { clanId, boosterId: b.id });
  const reloaded = new ProfileStore({ filePath });
  assert.equal(reloaded.data.clans[clanId].treasury, 300);
  for (const b of clans.state(a.token).shop)
    assert.equal(reloaded.find(a.token).inventory[b.id], 10);
  act("disband", { clanId });
  assert.equal(store.find(a.token).inventory.clan_shield, 10);
  assert.equal(store.find(a.token).wallet.bucks, 0);
});
test("Семь клановых наборов: новая цена списывается один раз и выдаёт по 10 всем участникам", () => {
  const { store, clans, a, b, act, create } = setup(),
    clanId = create(a);
  act(b, "apply", { clanId });
  act(a, "accept", { clanId, memberId: b.profile.id });
  const prices = {
    fire: 500,
    cake: 300,
    warheads: 100,
    vortex: 200,
    awl: 400,
    clan_shield: 200,
    fire_sword: 300,
  };
  assert.equal(clans.state(a.token).shop.length, 7);
  for (const [boosterId, amount] of Object.entries(prices)) {
    const quote = clans.state(a.token).shop.find((item) => item.id === boosterId);
    assert.deepEqual(quote.price, { amount, currency: "bucks", quantity: 10 });
    assert.equal(quote.basePrice, amount);
    store.data.clans[clanId].treasury = amount - 1;
    assert.throws(() => act(a, "buyBooster", { clanId, boosterId, amount: 0 }), /Недостаточно/);
    for (const who of [a, b]) assert.equal(store.find(who.token).inventory[boosterId], undefined);
    store.data.clans[clanId].treasury = amount;
    const purchase = { clanId, boosterId, amount: 0, discount: 100, requestId: randomUUID() };
    act(a, "buyBooster", purchase);
    act(a, "buyBooster", purchase);
    assert.equal(store.data.clans[clanId].treasury, 0);
    for (const who of [a, b]) assert.equal(store.find(who.token).inventory[boosterId], 10);
  }
});
test("Клан: ровно 1500 монет, атомарность, повтор и уникальность префикса", () => {
  const { store, clans, a, b, act } = setup();
  assert.throws(() => act(a, "create", { name: "Лес", prefix: "A", emblem: "astral" }), /1500/);
  grantCoins(store, a.profile.id, 1500);
  grantCoins(store, b.profile.id, 1500);
  const input = {
    action: "create",
    requestId: randomUUID(),
    name: "Лес",
    prefix: "лес",
    emblem: "grove",
  };
  clans.mutate(a.token, input);
  assert.equal(store.find(a.token).wallet.coins, 100);
  assert.equal(clans.mutate(a.token, input).replay, true);
  assert.equal(Object.keys(store.data.clans).length, 1);
  assert.throws(
    () => act(b, "create", { ...input, requestId: randomUUID(), prefix: "ЛЕС" }),
    /занят/,
  );
  assert.equal(store.find(b.token).wallet.coins, 1600);
  const before = JSON.stringify(store.data);
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(
    () => act(b, "create", { ...input, requestId: randomUUID(), prefix: "NEW" }),
    /disk full/,
  );
  assert.equal(JSON.stringify(store.data), before);
});
test("Префикс 1–4 символа: нормализация и недопустимые символы", () => {
  for (const good of ["A", "ЛЕС", "AB12", "★"]) assert.equal(prefixValue(good), good);
  for (const bad of ["", "ABCDE", "a b", "[A]", "a\u200bb", "\n\t"])
    assert.throws(() => prefixValue(bad));
  assert.equal(prefixValue("Ａ"), "A");
});
test("Заявки принимает глава; вступление закрывает другие заявки и не раскрывает заявки чужим", () => {
  const { store, clans, a, b, c, act, create } = setup(),
    clanId = create(a),
    otherId = create(c, "SUN");
  act(b, "apply", { clanId });
  act(b, "apply", { clanId: otherId });
  assert.equal(clans.state(b.token, "", 1, clanId).selected, null);
  assert.throws(() => act(c, "accept", { clanId, memberId: b.profile.id }), /главе/);
  act(a, "accept", { clanId, memberId: b.profile.id });
  assert.equal(store.find(b.token).clanId, clanId);
  assert.equal(store.data.clans[otherId].applications.length, 0);
  assert.throws(() => act(b, "apply", { clanId: otherId }), /уже состоишь/);
  assert.throws(
    () => act(b, "edit", { clanId, name: "Чужой", prefix: "XX", emblem: "grove" }),
    /главе/,
  );
  act(a, "edit", { clanId, name: "Новый лес", prefix: "TREE", emblem: "astral" });
  assert.equal(store.view(store.find(b.token)).clanPrefix, "TREE");
});
test("Выход, исключение, передача главы и роспуск сохраняют личный инвентарь", () => {
  const { store, a, b, act, create } = setup(),
    clanId = create(a);
  store.buy(b.token, "candy", randomUUID());
  act(b, "apply", { clanId });
  act(a, "accept", { clanId, memberId: b.profile.id });
  assert.throws(() => act(a, "leave", { clanId }), /передай/);
  assert.throws(() => act(b, "disband", { clanId }), /главе/);
  act(a, "transfer", { clanId, memberId: b.profile.id });
  assert.throws(() => act(a, "kick", { clanId, memberId: b.profile.id }), /главе/);
  act(a, "leave", { clanId });
  act(b, "disband", { clanId });
  assert.equal(store.find(b.token).inventory.candy, 10);
  assert.equal(store.find(b.token).clanId, null);
  assert.equal(Object.keys(store.data.clans).length, 0);
});
test("Лимит 15 участников и отказ от переполнения при принятии старой заявки", () => {
  const { store, a, act, create } = setup(),
    clanId = create(a);
  const applicants = Array.from({ length: 15 }, () => store.open());
  for (const p of applicants) {
    eligible(store, p);
    act(p, "apply", { clanId });
  }
  for (const p of applicants.slice(0, 14)) act(a, "accept", { clanId, memberId: p.profile.id });
  assert.throws(
    () => act(a, "accept", { clanId, memberId: applicants[14].profile.id }),
    /свободных мест/,
  );
  assert.equal(store.data.clans[clanId].members.length, 15);
});
test("Рейтинг по сумме величия и поиск префикса; чужие кошельки не выдаются", () => {
  const { store, clans, a, b, create } = setup(),
    first = create(a, "A"),
    second = create(b, "B");
  store.find(b.token).greatness = 25;
  const top = clans.state(a.token);
  assert.equal(top.clans[0].id, second);
  assert.equal(top.clans[1].id, first);
  assert.equal(top.clans[0].greatness, 25);
  assert.equal(top.playerLeaders[0].wallet, undefined);
  assert.equal(clans.state(a.token, "b").total, 1);
});
test("Миграция v1 и перезапуск сохраняют кошелёк, предметы, ID покупок и клан", (t) => {
  const filePath = path.join(temporary(t, "clans"), "profiles.json"),
    old = new ProfileStore(),
    a = old.open(),
    purchaseId = randomUUID();
  old.find(a.token).wallet = { coins: 100, crystals: 20, bucks: 0 }; // Сохранение прежнего стартового баланса.
  old.buy(a.token, "candy", purchaseId);
  const legacy = JSON.parse(JSON.stringify(old.data));
  legacy.version = 1;
  delete legacy.clans;
  for (const p of Object.values(legacy.profiles))
    for (const field of ["name", "skinId", "level", "greatness", "clanId", "quickSlots"])
      delete p[field];
  fs.writeFileSync(filePath, JSON.stringify(legacy));
  const store = new ProfileStore({ filePath });
  assert.equal(store.find(a.token).wallet.coins, 90);
  assert.equal(store.buy(a.token, "candy", purchaseId).replay, true);
  eligible(store, a);
  grantCoins(store, a.profile.id, 1500);
  new ClanService(store).mutate(a.token, {
    action: "create",
    requestId: randomUUID(),
    name: "Лес",
    prefix: "Л",
    emblem: "grove",
  });
  const restarted = new ProfileStore({ filePath });
  assert.equal(restarted.find(a.token).wallet.coins, 90);
  assert.equal(restarted.view(restarted.find(a.token)).clanPrefix, "Л");
  assert.equal(restarted.find(a.token).inventory.candy, 10);
  const corrupt = JSON.parse(fs.readFileSync(filePath));
  Object.values(corrupt.clans)[0].ownerId = "missing";
  fs.writeFileSync(filePath, JSON.stringify(corrupt));
  assert.throws(() => new ProfileStore({ filePath }), /Повреждены/);
});
test("Скин и уровень: серверный список, сохранение слотов, формат подписи", () => {
  const { store, a } = setup();
  store.buy(a.token, "candy", randomUUID());
  const input = {
    requestId: randomUUID(),
    name: "Путник",
    skinId: "forest-spirit",
    quickSlots: ["candy"],
    level: 999,
    clanPrefix: "FAKE",
  };
  const p = store.setLoadout(a.token, input).profile;
  assert.equal(p.skinId, "forest-spirit");
  assert.equal(p.level, 12);
  assert.equal(p.clanPrefix, "");
  assert.equal(label(p), "Путник [12]");
  assert.equal(label({ ...p, clanPrefix: "ЛЕС" }), "[ЛЕС] Путник [12]");
  assert.throws(
    () =>
      store.setLoadout(a.token, {
        ...input,
        requestId: randomUUID(),
        skinId: "https://bad.invalid/skin.png",
      }),
    /доступный/,
  );
  assert.throws(
    () => store.setLoadout(a.token, { ...input, requestId: randomUUID(), quickSlots: ["web"] }),
    /имеющихся/,
  );
});
test("Локальная выдача валюты ограничена и блокировка не допускает двух писателей", (t) => {
  const { store, a } = setup();
  assert.throws(() => grantCoins(store, a.profile.id, -1));
  const p = grantCoins(store, a.profile.id, 1500);
  assert.equal(p.wallet.coins, 1600);
  const lock = path.join(temporary(t, "lock"), "server.lock"),
    release = acquireServerLock(lock);
  assert.throws(() => acquireServerLock(lock), /уже работает/);
  release();
  assert.equal(fs.existsSync(lock), false);
});
test("Отзыв, отклонение и исключение участника; редактирование не занимает чужой префикс", () => {
  const { store, clans, a, b, c, act, create } = setup(),
    clanId = create(a, "A");
  create(c, "C");
  act(b, "apply", { clanId });
  act(b, "cancel", { clanId });
  assert.equal(store.data.clans[clanId].applications.length, 0);
  act(b, "apply", { clanId });
  act(a, "reject", { clanId, memberId: b.profile.id });
  assert.equal(store.find(b.token).clanId, null);
  act(b, "apply", { clanId });
  act(a, "accept", { clanId, memberId: b.profile.id });
  act(a, "kick", { clanId, memberId: b.profile.id });
  assert.equal(store.find(b.token).clanId, null);
  assert.equal(store.data.clans[clanId].members.length, 1);
  const balance = store.find(a.token).wallet.coins;
  assert.throws(
    () => act(a, "edit", { clanId, name: "Клан", prefix: "c", emblem: "astral" }),
    /занят/,
  );
  assert.equal(store.data.clans[clanId].prefix, "A");
  assert.equal(store.find(a.token).wallet.coins, balance);
  assert.equal(clans.state(a.token, "", 1, "__proto__").selected, null);
  assert.throws(() => act(b, "apply", { clanId: "__proto__" }), /не существует/);
});
