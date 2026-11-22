/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { randomUUID } = require("node:crypto"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service");
const { temporary } = require("../temp"),
  { xpForLevel } = require("../../src/server/progression/experience-progression"),
  { TITLES, awardTitles } = require("../../src/server/progression/title-chest-rewards");
const activity = require("../../src/server/progression/activity-achievements"),
  art = require("../../public/shared/progression-asset-paths");
const INITIAL = Date.UTC(2026, 9, 18, 10),
  DAY = activity.DAY;
function setup(filePath = null) {
  let at = INITIAL;
  const store = new ProfileStore({ filePath, now: () => at }),
    a = store.open(),
    b = store.open(),
    clans = new ClanService(store);
  const p = () => store.find(a.token),
    q = () => store.find(b.token);
  for (const user of [p(), q()]) {
    user.level = 12;
    user.progress.xp = xpForLevel(12);
    user.wallet = { coins: 50000, crystals: 20000, bucks: 20000 };
  }
  const action = (who, body, id = randomUUID()) =>
    clans.mutate(who.token, { ...body, requestId: id });
  const create = (privacy = "open") => {
    action(a, {
      action: "create",
      name: "Тестовый клан",
      prefix: "ТСТ",
      description: "",
      emblem: "grove",
      privacy,
    });
    return p().clanId;
  };
  const events = (list, id = randomUUID()) =>
    store.applyArenaProgress(
      id,
      list.map((e) => ({ profileId: a.profile.id, ...e })),
      at,
    );
  return {
    store,
    a,
    b,
    p,
    q,
    clans,
    action,
    create,
    events,
    time: (value) => {
      at = value;
    },
  };
}
test("Витрина содержит 44 цепочки без Карьеры; все иконки существуют, исключённые системы отсутствуют", () => {
  const { store, p } = setup(),
    entries = store.view(p()).progress.achievements;
  assert.equal(entries.length, 44);
  assert.equal(entries.filter((a) => a.available).length, 44);
  assert.equal(entries.filter((a) => !a.available).length, 0);
  assert.equal(new Set(entries.map((a) => a.id)).size, 44);
  for (const a of [...entries, { id: "career" }])
    assert.ok(fs.existsSync(path.resolve(__dirname, "../../public", art.achievement(a.id).split("?")[0])), a.id);
  const by = (id) => entries.find((a) => a.id === id);
  assert.deepEqual(by("vip").rewards, [100, 150, 300, 500]);
  assert.deepEqual(by("premium").rewards, [150, 300, 500, 1000]);
  assert.deepEqual(by("strong_love").thresholds, [30, 60, 120, 240]);
  assert.deepEqual(by("marriage").thresholds, [1]);
  assert.deepEqual(by("not_stingy").rewards, [50, 150, 300, 500]);
  assert.deepEqual(by("gamer").thresholds, [24, 168, 336, 744]);
  assert.equal(
    entries.some((a) => /Фортуна|Любовный месяц|ярмарк/i.test(a.name)),
    false,
  );
  p().activity.values.valuable = 100;
  activity.awardExtra(p());
  assert.ok(p().activity.claimed.valuable > 0);
  assert.doesNotThrow(() => activity.validateActivity(p()));
});
test("Расходы покупки дают отдельные награды, повтор и ошибка сохранения не меняют счётчики", () => {
  const { store, a, p } = setup();
  p().activity.values.spendthrift = 14990;
  const id = randomUUID();
  store.buy(a.token, "candy", id);
  assert.equal(p().activity.values.spendthrift, 15000);
  assert.equal(p().activity.claimed.spendthrift, 1);
  assert.equal(p().greatness, 50);
  const snapshot = structuredClone(p());
  store.buy(a.token, "candy", id);
  assert.deepEqual(p(), snapshot);
  p().activity.values.spendthrift_i = 999;
  const crystal = [...require("../../src/server/boosters/booster-catalog").BOOSTERS.values()].find(
    (b) => b.ready && b.tier !== "clan" && b.price.currency === "crystals",
  );
  store.buy(a.token, crystal.id, randomUUID());
  assert.equal(p().activity.claimed.spendthrift_i, 1);
  assert.equal(p().greatness, 100);
  assert.equal(p().honors.claimed, 1);
  const before = structuredClone(store.data),
    save = store.save;
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => store.buy(a.token, "candy", randomUUID()), /disk full/);
  assert.deepEqual(store.data, before);
  store.save = save;
  assert.equal(p().activity.values.wealthy, 0);
  assert.equal(p().activity.values.miner, 0);
});
test("Заявка: расход только после приёма, отмена и отказ ничего не начисляют; открытый клан и создание учитываются", () => {
  const { create, action, p, q, a, b } = setup(),
    clanId = create("closed");
  assert.equal(p().activity.values.spendthrift, 1500);
  action(b, { action: "apply", clanId });
  assert.equal(q().activity.values.spendthrift, 0);
  action(b, { action: "cancel", clanId });
  assert.equal(q().wallet.coins, 50000);
  action(b, { action: "apply", clanId });
  action(a, { action: "reject", clanId, memberId: q().id });
  assert.equal(q().activity.values.spendthrift, 0);
  action(b, { action: "apply", clanId });
  const id = randomUUID(),
    accept = { action: "accept", clanId, memberId: q().id };
  action(a, accept, id);
  action(a, accept, id);
  assert.equal(q().activity.values.spendthrift, 50);
  action(b, { action: "leave", clanId });
  action(a, {
    action: "edit",
    clanId,
    name: "Тестовый клан",
    prefix: "ТСТ",
    description: "",
    emblem: "grove",
    privacy: "open",
  });
  action(b, { action: "apply", clanId });
  assert.equal(q().activity.values.spendthrift, 100);
});
test("Взносы считают операции, сумму и личный расход атомарно; закупка казной не расход участника", () => {
  const { create, action, p, a, store } = setup(),
    clanId = create();
  const id = randomUUID();
  for (let i = 0; i < 5; i++)
    action(a, { action: "deposit", clanId, amount: 2 }, i === 4 ? id : randomUUID());
  const before = structuredClone(store.data);
  action(a, { action: "deposit", clanId, amount: 2 }, id);
  assert.deepEqual(store.data, before);
  assert.equal(p().activity.values.investment, 5);
  assert.equal(p().activity.claimed.investment, 1);
  assert.equal(p().activity.values.not_stingy, 10);
  assert.equal(p().activity.claimed.not_stingy, 1);
  assert.equal(p().activity.values.spendthrift_ii, 10);
  assert.equal(p().greatness, 60);
  const save = store.save;
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => action(a, { action: "deposit", clanId, amount: 10000 }), /disk full/);
  assert.deepEqual(store.data, before);
  store.save = save;
  action(a, { action: "deposit", clanId, amount: 1000 });
  const spent = p().activity.values.spendthrift_ii;
  const booster = [...require("../../src/server/boosters/booster-catalog").BOOSTERS.values()].find(
    (b) => b.tier === "clan" && b.ready && b.price.amount <= 1010,
  );
  action(a, { action: "buyBooster", clanId, boosterId: booster.id });
  assert.equal(p().activity.values.spendthrift_ii, spent);
});
test("Игроман учитывает секунды живой жизни, повторные снимки не дублируются, после смерти время не идёт", () => {
  const { store, a, p, events } = setup();
  store.startLife(a.profile.id, "life");
  events([{ type: "lifeTime", lifeId: "life", durationSeconds: 86399 }]);
  assert.equal(p().activity.claimed.gamer, 0);
  events([{ type: "lifeTime", lifeId: "life", durationSeconds: 86400 }]);
  assert.equal(p().activity.claimed.gamer, 1);
  events([
    { type: "lifeTime", lifeId: "life", durationSeconds: 86400 },
    { type: "lifeTime", lifeId: "life", durationSeconds: 80000 },
  ]);
  assert.equal(p().activity.arenaSeconds, 86400);
  events([{ type: "lifeEnded", lifeId: "life", durationSeconds: 86407, reason: "absorbed" }]);
  events([
    { type: "lifeTime", lifeId: "life", durationSeconds: 200000 },
    { type: "lifeEnded", lifeId: "life", durationSeconds: 200000, reason: "left" },
  ]);
  assert.equal(p().activity.arenaSeconds, 86407);
  store.startLife(a.profile.id, "new-life", false);
  events([{ type: "lifeEnded", lifeId: "new-life", durationSeconds: 13, reason: "left" }]);
  assert.equal(p().activity.arenaSeconds, 86420);
  assert.equal(p().greatness, 10);
});
test("За клан: жизнь от минуты, одно завершение, смена членства посреди жизни не даёт зачёт", () => {
  const { store, a, b, p, create, action, events } = setup(),
    clanId = create();
  action(b, { action: "apply", clanId });
  store.startLife(a.profile.id, "short");
  events([{ type: "lifeEnded", lifeId: "short", durationSeconds: 59, reason: "left" }]);
  assert.equal(p().activity.values.for_clan, 0);
  for (let i = 0; i < 5; i++) {
    store.startLife(a.profile.id, "life" + i);
    events([{ type: "lifeEnded", lifeId: "life" + i, durationSeconds: 60, reason: "left" }]);
  }
  assert.equal(p().activity.values.for_clan, 5);
  assert.equal(p().activity.claimed.for_clan, 1);
  events([{ type: "lifeEnded", lifeId: "life4", durationSeconds: 60, reason: "left" }]);
  assert.equal(p().activity.values.for_clan, 5);
  action(a, { action: "transfer", clanId, memberId: b.profile.id });
  store.startLife(a.profile.id, "changed");
  action(a, { action: "leave", clanId });
  action(a, { action: "apply", clanId });
  events([{ type: "lifeEnded", lifeId: "changed", durationSeconds: 120, reason: "left" }]);
  assert.equal(p().activity.values.for_clan, 5);
});
test("Серия по Екатеринбургу: граница суток, один зачёт в день, пропуск сбрасывает срок, степени сохраняются", () => {
  const { store, a, p, time } = setup(),
    start = Date.UTC(2026, 9, 18, 18, 59, 59);
  time(start);
  store.open(a.token);
  assert.equal(p().activity.values.regular, 1);
  time(start + 1000);
  store.open(a.token);
  assert.equal(p().activity.values.regular, 2);
  store.open(a.token);
  assert.equal(p().activity.values.regular, 2);
  for (let i = 1; i <= 5; i++) {
    time(start + 1000 + i * DAY);
    store.open(a.token);
  }
  assert.equal(p().activity.values.regular, 7);
  assert.equal(p().activity.claimed.regular, 1);
  time(start + 1000 + 7 * DAY);
  store.open(a.token);
  assert.equal(p().activity.values.regular, 1);
  assert.equal(p().activity.claimed.regular, 1);
  const greatness = p().greatness;
  store.open(a.token);
  assert.equal(p().greatness, greatness);
  activity.validateActivity(p());
});
test("Постоялец учитывает непрерывный срок, уход сбрасывает только срок; Фанат работает без онлайна", () => {
  const { store, a, b, p, create, action, time } = setup(),
    clanId = create();
  action(b, { action: "apply", clanId });
  time(INITIAL + 7 * DAY - 1);
  store.open(a.token);
  assert.equal(p().activity.claimed.resident, 0);
  time(INITIAL + 7 * DAY);
  store.open(a.token);
  assert.equal(p().activity.claimed.resident, 1);
  action(a, { action: "transfer", clanId, memberId: b.profile.id });
  action(a, { action: "leave", clanId });
  assert.equal(p().activity.values.resident, 0);
  assert.equal(p().activity.claimed.resident, 1);
  time(INITIAL + 30 * DAY);
  store.open(a.token);
  assert.equal(p().activity.claimed.fan, 2);
  action(a, { action: "apply", clanId });
  assert.equal(p().activity.values.resident, 0);
  time(INITIAL + 37 * DAY);
  store.open(a.token);
  assert.equal(p().activity.values.resident, 7);
  assert.equal(p().activity.claimed.resident, 1);
  activity.validateActivity(p());
});
test("Миграция v7 переносит звания по степени без повторной награды; старые расходы и время не восстанавливает из баланса", (t) => {
  const filePath = path.join(temporary(t, "achievements-migrate"), "profiles.json"),
    { store, a, p } = setup();
  p().greatness = 100000;
  awardTitles(p());
  const greatness = p().greatness;
  const old = structuredClone(store.data);
  old.version = 7;
  for (const user of Object.values(old.profiles)) {
    delete user.transactions;
    delete user.activity;
    delete user.createdAt;
  }
  const previous = Object.values(old.profiles).find((u) => u.id === a.profile.id);
  previous.honors.chests.master = previous.honors.chests.sage;
  delete previous.honors.chests.sage;
  fs.writeFileSync(filePath, JSON.stringify(old));
  fs.utimesSync(filePath, new Date(INITIAL - DAY), new Date(INITIAL - DAY));
  const backups = path.join(path.dirname(filePath), "backups");
  fs.mkdirSync(backups);
  const firstCopy = path.join(backups, "profiles-first.json");
  fs.writeFileSync(firstCopy, JSON.stringify(old));
  fs.utimesSync(firstCopy, new Date(INITIAL - 2 * DAY), new Date(INITIAL - 2 * DAY));
  const original = fs.readFileSync(filePath, "utf8"),
    disk = new ProfileStore({ filePath, now: () => INITIAL });
  assert.equal(fs.readFileSync(filePath, "utf8"), original);
  assert.equal(disk.data.version, 13);
  assert.equal(disk.find(a.token).greatness, greatness);
  assert.equal(disk.view(disk.find(a.token)).title.name, "Мудрец");
  assert.equal(disk.find(a.token).activity.values.spendthrift, 0);
  assert.equal(disk.find(a.token).activity.arenaSeconds, 0);
  assert.equal(disk.find(a.token).activity.registeredAt, INITIAL - 2 * DAY);
  disk.open(a.token);
  const migrated = structuredClone(disk.find(a.token));
  const again = new ProfileStore({ filePath, now: () => INITIAL });
  assert.deepEqual(again.find(a.token), migrated);
  assert.deepEqual(again.find(a.token).wallet, p().wallet);
  again.find(a.token).activity.claimed.investment = 5;
  fs.writeFileSync(filePath, JSON.stringify(again.data));
  const corrupt = fs.readFileSync(filePath, "utf8");
  assert.throws(() => new ProfileStore({ filePath }), /Повреждены новые/);
  assert.equal(fs.readFileSync(filePath, "utf8"), corrupt);
});
test("Сохранённые секунды переживают перезапуск без учёта простоя и без лишней жизни за клан", (t) => {
  const filePath = path.join(temporary(t, "achievements-recover"), "profiles.json"),
    { store, a, p, create, events } = setup(filePath);
  create();
  store.startLife(a.profile.id, "unfinished");
  events([{ type: "lifeTime", lifeId: "unfinished", durationSeconds: 100 }]);
  const disk = new ProfileStore({ filePath, now: () => INITIAL + 10 * DAY });
  assert.equal(disk.find(a.token).activity.arenaSeconds, 100);
  assert.equal(disk.find(a.token).activity.values.for_clan, 0);
  assert.equal(disk.find(a.token).progress.session, null);
  assert.equal(p().activity.arenaSeconds, 100);
});
