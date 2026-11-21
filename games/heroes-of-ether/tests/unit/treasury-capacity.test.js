"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto"),
  path = require("node:path");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const Q = require("../../src/server/progression/personal-quests");
const C = require("../../src/server/clans/clan-chest-rewards");
const T = require("../../src/server/progression/treasury-capacity");
const { temporary } = require("../temp");
function grantReceived(p, tier, at) {
  const c = C.grant(p, tier, at);
  C.act(p, "claim", c.id, at);
  return c;
}
const AT = Date.UTC(2026, 9, 25, 12);
const DAY = 86400000;
const HOUR = DAY / 24;
function queueProfile(vip = false, premium = false) {
  return {
    account: { vipUntil: vip ? AT + 4 * DAY : 0, premiumUntil: premium ? AT + 4 * DAY : 0 },
    quests: { items: [], pending: [] },
    clanChests: { items: [], notices: [] },
    easter: { chests: [] },
  };
}
function addFixture(p, kind, id, at = AT, receive = true) {
  const chest = { id, earnedAt: at, receivedAt: receive ? at : null, reward: { coins: 42 } };
  T.queue(p, chest, at);
  ({ clan: p.clanChests.items, quest: p.quests.pending, easter: p.easter.chests })[kind].push(
    chest,
  );
  return chest;
}

test("каждый вид очереди: 3/24/24/48 часов, включая неподтверждённые сундуки", () => {
  for (const [vip, premium, hours] of [
    [false, false, 3],
    [true, false, 24],
    [false, true, 24],
    [true, true, 48],
  ]) {
    const p = queueProfile(vip, premium);
    const chests = ["clan", "quest", "easter"].map((kind) => addFixture(p, kind, kind, AT, false));
    T.fill(p, AT);
    assert.equal(T.stored(p), 0);
    for (const c of chests) assert.equal(c.expiresAt, AT + hours * HOUR);
    assert.equal(T.needsFill(p, AT + hours * HOUR - 1), false);
    assert.equal(T.fill(p, AT + hours * HOUR - 1), false);
    assert.equal(T.needsFill(p, AT + hours * HOUR), true);
    T.fill(p, AT + hours * HOUR);
    assert.equal(p.clanChests.items.length + p.quests.pending.length + p.easter.chests.length, 0);
    assert.equal(p.clanChests.notices.length, 1);
    assert.equal(
      T.fill(p, AT + hours * HOUR + 1),
      false,
      "повтор не создаёт новую награду или уведомление",
    );
  }
});

test("12 → 10 → 7: наружу выходят последние поступившие сундуки всех видов; возврат по очереди", () => {
  const p = queueProfile(true, true),
    chests = [];
  for (let i = 0; i < 12; i++) {
    const c = addFixture(p, ["quest", "clan", "easter"][i % 3], String(i), AT + i);
    T.fill(p, AT + i);
    chests.push(c);
  }
  const originalRewards = chests.map((c) => structuredClone(c.reward));
  p.account.premiumUntil = AT + 100;
  T.fill(p, AT + 100);
  assert.equal(T.stored(p), 10);
  assert.deepEqual(
    chests.filter((c) => !c.stored).map((c) => c.id),
    ["10", "11"],
  );
  assert.ok(chests.slice(10).every((c) => c.expiresAt === AT + 100 + DAY));
  p.account.vipUntil = AT + 200;
  T.fill(p, AT + 200);
  assert.equal(T.stored(p), 7);
  assert.ok(chests.slice(0, 7).every((c) => c.stored && c.expiresAt === null));
  assert.ok(chests.slice(7, 10).every((c) => c.waitingSince === AT + 200));
  assert.ok(
    chests
      .slice(10)
      .every((c) => c.waitingSince === AT + 100 && c.expiresAt === AT + 100 + 3 * HOUR),
  );
  // Open an old stored chest. The first evicted one comes back first.
  p.quests.pending = p.quests.pending.filter((c) => c !== chests[0]);
  T.fill(p, AT + 300);
  assert.equal(chests[10].stored, true);
  assert.equal(chests[11].stored, false);
  assert.equal(chests[10].expiresAt, null);
  p.account.premiumUntil = AT + DAY;
  T.fill(p, AT + 400);
  assert.equal(T.stored(p), 11);
  assert.deepEqual(
    chests.map((c) => c.reward),
    originalRewards,
    "состав наград не меняется",
  );
  assert.ok(chests.slice(1).every((c) => c.receivedAt !== null));
});

test("срок пересчитывается от начала ожидания, без сброса при покупке, получении и загрузке", () => {
  let p = queueProfile();
  for (let i = 0; i < 12; i++) addFixture(p, "clan", String(i));
  T.fill(p, AT);
  const c = addFixture(p, "quest", "waiting", AT, false);
  p.account.vipUntil = AT + 5 * DAY;
  T.fill(p, AT + HOUR);
  assert.equal(c.expiresAt, AT + DAY);
  p.account.premiumUntil = AT + 5 * DAY;
  T.fill(p, AT + 2 * HOUR);
  assert.equal(c.expiresAt, AT + 2 * DAY);
  c.receivedAt = AT + 2 * HOUR;
  T.fill(p, AT + 2 * HOUR);
  assert.equal(c.stored, false);
  p = structuredClone(p); // persisted/reloaded shape
  assert.equal(T.fill(p, AT + 2 * HOUR + 1), false);
  p.account.vipUntil = 0;
  T.fill(p, AT + 4 * HOUR);
  assert.equal(p.quests.pending[0].expiresAt, AT + DAY);
  p.account.premiumUntil = 0;
  T.fill(p, AT + 4 * HOUR);
  assert.equal(p.quests.pending.length, 0, "после сокращения до 3 ч просроченный сундук сгорает");
  assert.equal(T.stored(p), 7);
  assert.equal(p.clanChests.items.filter((c) => !c.stored).length, 5);
});

test("миграция бесконечной очереди даёт полный срок; старое конечное ожидание и исчезнувшие сундуки не восстанавливаются", () => {
  const p = queueProfile();
  const old = { id: "old-quest", stored: false, at: AT - 30 * DAY, receivedAt: null };
  p.quests.pending.push(old);
  p.quests.items.push({ id: old.id, completedAt: old.at, claimedAt: null });
  p.clanChests.items.push({
    id: "old-clan",
    stored: false,
    earnedAt: AT - DAY,
    expiresAt: AT + DAY,
    receivedAt: null,
  });
  p.clanChests.battleReward = { chestId: "old-clan", status: "available", expiresAt: AT + DAY };
  T.fill(p, AT);
  assert.equal(old.waitingSince, AT);
  assert.equal(old.expiresAt, AT + 3 * HOUR);
  assert.equal(p.clanChests.items.length, 0);
  assert.equal(p.clanChests.battleReward.status, "expired");
  T.fill(p, AT + 3 * HOUR);
  assert.equal(p.quests.items[0].expiredAt, AT + 3 * HOUR);
  p.account.premiumUntil = AT + DAY;
  T.fill(p, AT + 3 * HOUR + 1);
  assert.equal(p.quests.pending.length, 0);
});
function quest(p, stored = true) {
  const reward = {
    ...Q.makeReward("small", AT, true),
    id: randomUUID(),
    questId: "snack",
    title: "Перекус",
    stored,
  };
  p.quests.pending.push(reward);
  return reward;
}

test("клановая очередь автоматически занимает место после открытия задания, без повторной выдачи после перезапуска", (t) => {
  let at = AT;
  const filePath = path.join(temporary(t, "clan-queue"), "profiles.json");
  const store = new ProfileStore({ filePath, now: () => at }),
    auth = store.open();
  const get = () => store.find(auth.token);
  for (let i = 0; i < 7; i++) quest(get());
  const first = grantReceived(get(), "high", AT + 1),
    second = grantReceived(get(), "medium", AT + 2);
  const request = { action: "claim", questId: get().quests.pending[0].id, requestId: randomUUID() };
  store.save(store.data, AT);
  at += HOUR;
  const before = structuredClone(get()),
    save = store.save.bind(store);
  store.save = () => {
    throw Error("disk failure");
  };
  assert.throws(() => store.questAction(auth.token, request), /disk failure/);
  assert.deepEqual(get(), before);
  store.save = save;
  store.questAction(auth.token, request);
  assert.equal(T.stored(get(), at), 7);
  assert.equal(get().clanChests.items.find((c) => c.id === first.id).expiresAt, null);
  assert.equal(get().clanChests.items.find((c) => c.id === second.id).stored, false);
  const wallet = { ...get().wallet };
  assert.equal(store.questAction(auth.token, request).replay, true);
  const reload = new ProfileStore({ filePath, now: () => at });
  assert.equal(reload.questAction(auth.token, request).replay, true);
  assert.deepEqual(reload.find(auth.token).wallet, wallet);
  at = AT + 3 * HOUR + 2;
  reload.refreshCompetition();
  assert.deepEqual(
    reload.find(auth.token).clanChests.items.map((c) => [c.id, c.stored, c.expiresAt]),
    [[first.id, true, null]],
  );
  C.validate(reload.find(auth.token));
});

test("старый срок хранимого сундука снимается атомарно даже после его истечения", (t) => {
  const filePath = path.join(temporary(t, "legacy-safe-chest"), "profiles.json");
  const store = new ProfileStore({ filePath, now: () => AT }),
    auth = store.open();
  const get = () => store.find(auth.token);
  const chest = grantReceived(get(), "high", AT - 3 * DAY);
  chest.expiresAt = chest.earnedAt + 2 * DAY;
  C.act(get(), "prepare", chest.id, AT - 3 * DAY); // Prepare legacy reward without reroll.
  chest.expiresAt = chest.earnedAt + 2 * DAY;
  get().clanChests.battleReward = {
    clanId: "legacy-clan",
    endedAt: chest.earnedAt,
    tier: chest.tier,
    status: "stored",
    chestId: chest.id,
    expiresAt: chest.expiresAt,
  };
  store.save(store.data, AT);
  get().clanChests.items[0].expiresAt = chest.earnedAt + 2 * DAY;
  get().clanChests.battleReward.expiresAt = chest.earnedAt + 2 * DAY;
  const before = structuredClone(get()),
    save = store.save.bind(store);
  store.save = () => {
    throw Error("disk failure");
  };
  assert.throws(() => store.refreshCompetition(), /disk failure/);
  assert.deepEqual(get(), before);
  store.save = save;
  store.refreshCompetition();
  assert.equal(get().clanChests.items[0].expiresAt, null);
  assert.equal(get().clanChests.battleReward.expiresAt, null);
  assert.deepEqual(get().clanChests.items[0].reward, before.clanChests.items[0].reward);
  const reload = new ProfileStore({ filePath, now: () => AT + 100 * DAY });
  reload.refreshCompetition();
  assert.equal(reload.find(auth.token).clanChests.items.length, 1);
  C.validate(reload.find(auth.token));
});

test("рост вместимости заполняет очередь, снижение возвращает последние наружу, просроченные не спасаются", () => {
  const store = new ProfileStore({ now: () => AT }),
    p = store.find(store.open().token);
  for (let i = 0; i < 10; i++) grantReceived(p, "low", AT);
  const expired = p.clanChests.items[9];
  expired.waitingSince = AT - DAY;
  expired.waitingHours = 24;
  expired.expiresAt = AT;
  p.account = { vipUntil: AT + 1000, premiumUntil: 0 };
  assert.equal(C.needsExpiry(p, AT), true);
  C.expire(p, AT);
  assert.equal(T.stored(p, AT), 9);
  assert.ok(p.clanChests.items.every((c) => c.expiresAt === null));
  assert.equal(T.capacity(p, AT + 1000), 7);
  C.expire(p, AT + 3 * DAY);
  assert.equal(T.stored(p, AT + 3 * DAY), 7);
  assert.equal(p.clanChests.items.filter((c) => !c.stored).length, 2);
  assert.ok(
    p.clanChests.items
      .filter((c) => !c.stored)
      .every((c) => c.expiresAt === AT + 3 * DAY + 3 * HOUR),
  );
  C.validate(p);
});
test("общий лимит 7/10/12 учитывает оба типа, получение кланового не обходит его", () => {
  for (const [kind, capacity] of [
    [null, 7],
    ["vip", 10],
    ["premium", 12],
  ]) {
    const store = new ProfileStore({ now: () => AT }),
      auth = store.open(),
      p = store.find(auth.token);
    if (kind) p.account = { vipUntil: 0, premiumUntil: 0, [kind + "Until"]: AT + 86400000 };
    quest(p);
    quest(p);
    grantReceived(p, "low", AT);
    assert.equal(C.view(p, AT).totalStored, 3);
    assert.equal(T.capacity(p, AT), capacity);
    while (T.stored(p, AT) < capacity) quest(p);
    const blocked = grantReceived(p, "low", AT);
    assert.equal(blocked.stored, false);
    C.act(p, "claim", blocked.id, AT);
    assert.equal(blocked.receivedAt, AT);
    assert.equal(T.stored(p, AT), capacity);
  }
});
test("выполнение при полном хранилище сохраняет награду, открытие атомарно переносит очередь, повтор и восстановление безопасны", (t) => {
  const filePath = path.join(temporary(t, "treasury"), "profiles.json");
  const store = new ProfileStore({ filePath, now: () => AT }),
    auth = store.open();
  const get = () => store.find(auth.token);
  for (let i = 0; i < 7; i++) grantReceived(get(), "low", AT);
  get().level = 12;
  get().progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(12);
  const row = get().quests.items[0];
  row.questId = "giant";
  if (get().quests.items[1].questId === "giant") get().quests.items[1].questId = "sky_hunter";
  store.startLife(get().id, "test-life");
  store.applyArenaProgress(
    randomUUID(),
    [{ profileId: get().id, type: "massPeak", mass: 50000 }],
    AT,
  );
  store.questAction(auth.token, { action: "receive", questId: row.id, requestId: randomUUID() });
  const reward = structuredClone(get().quests.pending.find((r) => r.id === row.id));
  assert.equal(reward.stored, false);
  assert.equal(T.stored(get(), AT), 7);
  assert.throws(
    () =>
      store.questAction(auth.token, { action: "claim", questId: row.id, requestId: randomUUID() }),
    /Сначала получи|Освободи место/,
  );
  const chestId = get().clanChests.items[0].id;
  store.clanChestAction(auth.token, { action: "prepare", chestId, requestId: randomUUID() });
  const before = structuredClone(get()),
    save = store.save.bind(store);
  const request = { action: "open", chestId, requestId: randomUUID() };
  store.save = () => {
    throw Error("disk failure");
  };
  assert.throws(() => store.clanChestAction(auth.token, request), /disk failure/);
  assert.deepEqual(get(), before);
  store.save = save;
  store.clanChestAction(auth.token, request);
  assert.deepEqual(
    get().quests.pending.find((r) => r.id === row.id),
    { ...reward, stored: true, expiresAt: null, storedAt: AT, storageOrder: 8 },
  );
  assert.equal(T.stored(get(), AT), 7);
  assert.equal(store.clanChestAction(auth.token, request).replay, true);
  const loaded = new ProfileStore({ filePath, now: () => AT });
  assert.equal(loaded.clanChestAction(auth.token, request).replay, true);
  assert.deepEqual(loaded.find(auth.token).quests, get().quests);
});
test("открытие задания освобождает место; излишки после окончания аккаунта ждут вне хранилища", () => {
  const store = new ProfileStore({ now: () => AT }),
    auth = store.open(),
    p = store.find(auth.token);
  const first = quest(p);
  for (let i = 0; i < 6; i++) quest(p);
  const queued = quest(p, false);
  Q.act(p, { action: "claim", questId: first.id }, AT);
  assert.equal(queued.stored, true);
  assert.equal(T.stored(p, AT), 7);
  p.quests.pending = [];
  for (let i = 0; i < 7; i++) grantReceived(p, "low", AT - 2 * 86400000 + 1);
  const waiting = quest(p, false);
  C.expire(p, AT + 1);
  assert.equal(waiting.stored, false);
  assert.equal(p.clanChests.items.length, 7);
  const id = p.clanChests.items[0].id;
  C.act(p, "prepare", id, AT + 1);
  C.act(p, "open", id, AT + 1);
  assert.equal(waiting.stored, true);
  p.account = { vipUntil: 0, premiumUntil: AT + 1 };
  while (T.stored(p, AT) < 12) {
    const r = quest(p);
    delete r.stored;
  }
  const extra = quest(p, false);
  T.fill(p, AT + 2);
  assert.equal(T.stored(p, AT + 2), 7);
  assert.equal(extra.stored, false);
  Q.validate(p);
  const before = structuredClone(p);
  Q.view(p, AT + 86400000);
  C.view(p, AT + 86400000);
  assert.deepEqual(p, before, "Представления не меняют сохранённое состояние");
});
