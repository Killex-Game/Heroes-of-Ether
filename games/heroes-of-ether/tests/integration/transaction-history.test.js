"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  history = require("../../src/server/profiles/transaction-history"),
  { OwnerService } = require("../../src/server/admin/owner-service"),
  { temporary } = require("../temp");
function fixture(filePath = null) {
  let at = Date.UTC(2026, 9, 23, 8);
  const store = new ProfileStore({ filePath, now: () => at }),
    a = store.open(),
    b = store.open();
  const get = () => store.find(a.token),
    entries = () => get().transactions.entries;
  const buy = (productId, requestId = randomUUID()) =>
    store.confirmMockPurchase(a.token, { productId, requestId, confirmed: true });
  const owner = new OwnerService({
    profiles: store,
    access: new (require("../../src/server/admin/owner-access").OwnerAccess)({ownerId:b.profile.id}),
    now: () => at,
  });
  return { store, a, b, get, entries, buy, owner, advance: (ms) => (at += ms) };
}
test("Currency, account purchases, bonuses and gift spending have exact balances; retries do not duplicate", () => {
  const f = fixture(),
    id = randomUUID();
  assert.equal(f.entries()[0].kind, "registration");
  f.buy("bucks:change", id);
  f.buy("bucks:change", id);
  assert.equal(f.entries().filter((e) => e.requestId === id).length, 1);
  const payment = f.entries().at(-1);
  assert.equal(payment.after.bucks - payment.before.bucks, 20);
  assert.deepEqual(payment.payment, {
    provider: "mock",
    simulated: true,
    status: "confirmed",
    productId: "bucks:change",
    votes: 1,
  });
  assert.throws(() => f.buy("account:vip", id), /другой операции/);
  f.buy("account:vip");
  f.buy("account:premium");
  assert.ok(f.entries().at(-1).after.premiumUntil > 0);
  assert.ok(f.entries().at(-1).before.vipUntil > 0);
  f.store.claimAccountCurrencyBonus(f.a.token, {
    kind: "vip",
    currency: "bucks",
    requestId: randomUUID(),
  });
  assert.equal(f.entries().at(-1).after.bucks - f.entries().at(-1).before.bucks, 5);
  const gift = require("../../src/server/profiles/player-social").gifts.find(
    (g) => g.currency === "bucks" && g.price <= 25,
  );
  assert.ok(gift);
  f.store.socialAction(f.a.token, {
    action: "gift",
    targetId: f.a.profile.id,
    giftId: gift.id,
    confirmed: true,
    requestId: randomUUID(),
  });
  assert.equal(f.entries().at(-1).after.bucks - f.entries().at(-1).before.bucks, -gift.price);
  assert.match(f.entries().at(-1).label, /Подарок/);
  history.validate(f.get());
  assert.equal(f.store.view(f.get()).transactions, undefined);
  assert.equal(f.store.publicPlayer(f.a.profile.id).transactions, undefined);
});
test("Owner edits and server rewards are recorded, with per-player filters and pagination", () => {
  const f = fixture();
  for (let i = 0; i < 23; i++)
    f.owner.apply(f.store.find(f.b.token), {
      action: "wallet",
      targetId: f.a.profile.id,
      revision: f.get().revision,
      currency: "coins",
      amount: i % 2 ? -1 : 2,
      reason: "Проверка журнала",
      requestId: randomUUID(),
    });
  assert.equal(f.entries().at(-1).kind, "admin");
  assert.equal(f.entries().at(-1).detail, "Проверка журнала");
  f.owner.apply(f.store.find(f.b.token), {
    action: "account",
    targetId: f.a.profile.id,
    revision: f.get().revision,
    kind: "vip",
    days: 7,
    reason: "Компенсация сбоя",
    requestId: randomUUID(),
  });
  assert.equal(f.owner.transactions(f.a.profile.id, 1, "account").total, 1);
  assert.equal(f.owner.transactions(f.a.profile.id, 1, "coins").entries.length, 10);
  assert.equal(f.owner.transactions(f.a.profile.id, 2, "coins").entries.length, 10);
  assert.equal(f.owner.transactions(f.a.profile.id, 3, "coins").entries.length, 4);
  assert.equal(f.owner.transactions(f.b.profile.id).total, 1);
  assert.throws(() => f.owner.transactions("missing"), /не найден/);
  assert.throws(() => f.owner.transactions(f.a.profile.id, 1, "bad"), /фильтр/);
  history.validate(f.get());
});

test("Clan creation and application refund remain separate entries in the same committed action", () => {
  const f = fixture(),
    { ClanService } = require("../../src/server/clans/clan-service"),
    { xpForLevel } = require("../../src/server/progression/experience-progression"),
    clans = new ClanService(f.store);
  for (const token of [f.a.token, f.b.token]) {
    const p = f.store.find(token);
    p.level = 12;
    p.progress.xp = xpForLevel(12);
    p.wallet.coins = 6000;
  }
  f.store.save(f.store.data);
  clans.mutate(f.b.token, {
    action: "create",
    name: "Первый клан",
    prefix: "ONE",
    privacy: "closed",
    description: "",
    emblem: "astral",
    requestId: randomUUID(),
  });
  const clanId = f.store.find(f.b.token).clanId;
  clans.mutate(f.a.token, { action: "apply", clanId, requestId: randomUUID() });
  const count = f.entries().length;
  clans.mutate(f.a.token, {
    action: "create",
    name: "Второй клан",
    prefix: "TWO",
    privacy: "closed",
    description: "",
    emblem: "astral",
    requestId: randomUUID(),
  });
  const created = f.entries().slice(count);
  assert.equal(created.length, 2);
  assert.equal(created[0].label, "Создание клана");
  assert.equal(created[0].after.coins - created[0].before.coins, -1500);
  assert.equal(created[1].label, "Возврат платы за заявку в клан");
  assert.ok(created[1].after.coins > created[1].before.coins);
  history.validate(f.get());
});

test("Each daily leaderboard award is logged separately and settlement replay is harmless", () => {
  const f = fixture();
  Object.assign(f.get().daily, { kills: 1, arenaSeconds: 60, greatness: 1 });
  f.store.save(f.store.data);
  const count = f.entries().length;
  f.advance(86400000);
  f.store.refreshCompetition();
  const awards = f.entries().slice(count);
  assert.equal(awards.length, 3);
  assert.ok(
    awards.every((e) => e.label.startsWith("Рейтинг") && e.after.coins - e.before.coins === 100),
  );
  f.store.refreshCompetition();
  assert.equal(f.entries().length, count + 3);
  history.validate(f.get());
});
test("Write failure rolls back balance and journal; retry and restore retain exactly one purchase", (t) => {
  const tmp = temporary(t, "transaction-write"),
    file = path.join(tmp, "profiles.json");
  const f = fixture(file),
    before = structuredClone(f.store.data),
    disk = fs.readFileSync(file),
    rename = fs.renameSync,
    id = randomUUID();
  fs.renameSync = () => {
    throw Error("disk unavailable");
  };
  try {
    assert.throws(() => f.buy("account:premium", id), /disk unavailable/);
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(f.store.data, before);
  assert.deepEqual(fs.readFileSync(file), disk);
  f.buy("account:premium", id);
  const restored = new ProfileStore({ filePath: file, now: f.store.now });
  restored.confirmMockPurchase(f.a.token, {
    productId: "account:premium",
    confirmed: true,
    requestId: id,
  });
  assert.deepEqual(restored.find(f.a.token).transactions, f.get().transactions);
  history.validate(restored.find(f.a.token));
});
test("Existing saves start with an opening balance, without inventing historic transactions", (t) => {
  const tmp = temporary(t, "transaction-upgrade"),
    file = path.join(tmp, "profiles.json");
  const f = fixture();
  f.buy("bucks:change");
  const old = structuredClone(f.store.data);
  for (const p of Object.values(old.profiles)) delete p.transactions;
  fs.writeFileSync(file, JSON.stringify(old));
  const restored = new ProfileStore({ filePath: file, now: f.store.now }),
    p = restored.find(f.a.token);
  assert.equal(p.transactions.entries.length, 0);
  assert.equal(p.transactions.opening.bucks, 20);
  restored.confirmMockPurchase(f.a.token, {
    productId: "bucks:change",
    confirmed: true,
    requestId: randomUUID(),
  });
  assert.equal(restored.find(f.a.token).transactions.entries.length, 1);
  const bad = JSON.parse(fs.readFileSync(file));
  Object.values(bad.profiles).find((p) => p.id === f.a.profile.id).transactions.entries[0].before
    .bucks++;
  fs.writeFileSync(file, JSON.stringify(bad));
  assert.throws(() => new ProfileStore({ filePath: file }), /журнал транзакций/);
});
