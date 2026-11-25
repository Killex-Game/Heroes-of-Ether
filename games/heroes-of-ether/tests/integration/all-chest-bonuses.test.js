"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const { randomUUID } = require("node:crypto"),
  { temporary } = require("../temp");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager"),
  E = require("../../src/server/events/easter-hunt"),
  Q = require("../../src/server/progression/personal-quests"),
  T = require("../../src/server/progression/title-chest-rewards"),
  C = require("../../src/server/clans/clan-chest-rewards"),
  B = require("../../src/server/progression/chest-bonuses"),
  lite = require("../../src/server/accounts/lite-account"),
  products = require("../../public/shared/virtual-product-catalog");
const NOW = Date.UTC(2026, 9, 27, 12),
  DAY = 86400000;
function fixture(vip = false, premium = false, withLite = true, filePath) {
  let at = NOW;
  const events = new EventManager({ now: () => at }),
    store = new ProfileStore({ filePath, now: () => at });
  store.events = events;
  events.apply("test", "start", { eventId: E.manifest.id, revision: 0, requestId: randomUUID() });
  const auth = store.open(),
    p = () => store.find(auth.token),
    runId = events.active().id;
  p().greatness = 2000000;
  T.awardTitles(p(), at);
  p().account = require("../../src/server/accounts/account-benefits").fresh();
  p().account.vipUntil = vip ? at + DAY : 0;
  p().account.premiumUntil = premium ? at + DAY : 0;
  if (withLite) lite.activate(p(), store.rouletteConfig, at, runId);
  function chest(kind, tier) {
    let id;
    // Test one promised reward at a time; unrelated title chests now occupy
    // ordinary Treasury slots and must not fill this bonus fixture.
    for (const title of T.TITLES)
      if (kind !== "title" || title.id !== tier) p().honors.chests[title.id] = "opened";
    require("../../src/server/progression/treasury-capacity").fill(p(),at);
    if (kind === "title") id = tier;
    else if (kind === "clan") id = C.grant(p(), tier, at).id;
    else if (kind === "quest") {
      const def = Q.CATALOG.find((q) => q.tier === tier);
      id = randomUUID();
      p().quests.pending.push({
        ...Q.makeReward(tier, at, true, () => 0),
        id,
        questId: def.id,
        title: def.name,
        stored: true,
      });
    } else {
      E.progress(p(), events, { type: "easterPickup", eggType: 0, runId }, at);
      p().easter.runs[runId].eggs = [10, 10, 10, 10];
      p().easter.runs[runId].found = [10, 10, 10, 10];
      E.act(p(), events, { action: "exchange", runId }, at, () => 0);
      id = p().easter.chests.at(-1).id;
    }
    const act = (action, requestId = randomUUID(), extra = {}) => {
      if (kind === "title")
        return store[action === "prepare" ? "prepareChest" : "openChest"](
          auth.token,
          id,
          requestId,
        );
      if (kind === "clan")
        return store.clanChestAction(auth.token, { action, chestId: id, requestId, ...extra });
      if (kind === "quest")
        return store.questAction(auth.token, {
          action: action === "open" ? "claim" : action,
          questId: id,
          requestId,
          ...extra,
        });
      return E.mutate(store, auth.token, { action, chestId: id, requestId, ...extra });
    };
    const view = () => {
      const v = store.view(p());
      if (kind === "title") return v.honors.pending;
      if (kind === "clan") return v.clanChests.items.find((c) => c.id === id)?.reward;
      if (kind === "quest") return v.quests.pending.find((c) => c.id === id);
      return v.easter.chests.find((c) => c.id === id)?.reward;
    };
    return { id, act, view };
  }
  return { store, events, auth, p, chest, runId, setTime: (n) => (at = n) };
}
const kinds = [
  ...T.TITLES.map((t) => ["title", t.id]),
  ...["high", "medium", "low"].map((t) => ["clan", t]),
  ...Object.keys(Q.CHESTS).map((t) => ["quest", t]),
  ["easter", "easter"],
];
for (const [vip, premium, factor] of [
  [false, false, 1],
  [true, false, 2],
  [false, true, 1],
  [true, true, 2],
])
  for (const withLite of [false, true])
    test(`Все 17 сундуков: VIP=${vip}, Premium=${premium}, Lite=${withLite}; показ совпадает с выдачей`, () => {
      for (const [kind, tier] of kinds) {
        const f = fixture(vip, premium, withLite),
          c = f.chest(kind, tier),
          ticketBefore = f.p().roulette.tickets;
        if (kind === "clan") c.act("claim");
        c.act("prepare", randomUUID(), {
          multiplier: 999,
          tickets: 999,
          reward: { coins: 999999 },
        });
        const r = c.view();
        assert.equal(f.p().roulette.tickets, ticketBefore);
        assert.equal(r.multiplier, kind === "title" ? 1 : factor);
        if (kind === "title") {
          const spec = T.TITLES.find((t) => t.id === tier);
          assert.equal(r.coins, spec.coins);
          assert.equal(r.bucks, spec.bucks);
          assert.equal(
            Object.values(r.items).reduce((a, b) => a + b, 0),
            spec.boosters,
          );
        }
        if (kind === "quest") {
          assert.equal(r.greatness, Q.CHESTS[tier].greatness * (premium ? 2 : 1));
          assert.equal(r.coins, Q.CHESTS[tier].coins[0] * factor);
          assert.equal(
            Object.values(r.items).reduce((a, b) => a + b, 0),
            ["common", "advanced", "rare"].reduce((n, k) => n + Q.CHESTS[tier][k][0], 0) * factor,
          );
        }
        if (kind === "easter") {
          assert.equal(r.greatness, 5 * (premium ? 2 : 1));
          assert.equal(r.coins, 100 * factor);
          assert.equal(r.items.easter_egg, 3 * factor);
        }
        assert.equal(
          r.tickets || 0,
          (kind === "quest" ? Q.CHESTS[tier].tickets : 0) + Number(withLite && kind !== "title"),
        );
        c.act("prepare");
        assert.deepEqual(c.view(), r);
        const before = structuredClone(f.p()),
          req = randomUUID();
        c.act("open", req);
        for (const currency of ["coins", "crystals", "bucks"])
          assert.equal(f.p().wallet[currency] - before.wallet[currency], r[currency] || 0);
        for (const [id, n] of Object.entries(r.items))
          assert.equal((f.p().inventory[id] || 0) - (before.inventory[id] || 0), n);
        assert.equal(f.p().roulette.tickets - ticketBefore, r.tickets || 0);
        // Fixture avoids any new achievements; only the chest itself adds greatness.
        assert.equal(f.p().greatness - before.greatness, r.greatness || 0);
        if (kind === "easter") {
          assert.equal(f.p().easter.runs[f.runId].fragments, 1);
          E.validate(f.p());
        }
        const after = structuredClone(f.p());
        assert.equal(c.act("open", req).replay, true);
        assert.deepEqual(f.p(), after);
        assert.throws(() => c.act("open"));
        assert.deepEqual(f.p(), after);
      }
    });

for (const kind of ["quest", "easter"])
  test(`${kind}: сохранённый состав, истечение аккаунтов, ошибка записи и восстановление`, (t) => {
    const filePath = path.join(temporary(t, "all-chests"), "profiles.json"),
      f = fixture(true, true, true, filePath),
      c = f.chest(kind, "large");
    c.act("prepare");
    const reward = c.view();
    const before = structuredClone(f.p()),
      save = f.store.save,
      req = randomUUID();
    f.store.save = () => {
      throw Error("disk failure");
    };
    assert.throws(() => c.act("open", req), /disk failure/);
    assert.deepEqual(f.p(), before);
    f.store.save = save;
    f.setTime(NOW + DAY);
    c.act("prepare");
    assert.deepEqual(c.view(), reward);
    const disk = new ProfileStore({ filePath, now: () => NOW + DAY });
    disk.events = f.events;
    assert.deepEqual(disk.find(f.auth.token), f.p());
    // Crossing midnight may pay an independent daily event leaderboard reward.
    const beforeOpen = structuredClone(disk.find(f.auth.token));
    if (kind === "quest")
      disk.questAction(f.auth.token, { action: "claim", questId: c.id, requestId: req });
    else E.mutate(disk, f.auth.token, { action: "open", chestId: c.id, requestId: req });
    assert.equal(disk.find(f.auth.token).wallet.coins - beforeOpen.wallet.coins, reward.coins);
    assert.equal(
      disk.find(f.auth.token).roulette.tickets - beforeOpen.roulette.tickets,
      reward.tickets,
    );
    const restored = new ProfileStore({ filePath, now: () => NOW + DAY });
    assert.deepEqual(restored.find(f.auth.token), disk.find(f.auth.token));
  });

test("Lite истёк: старый сундук доступен, новый билет не обещается и не выдаётся", () => {
  const f = fixture(false, false, true),
    c = f.chest("easter");
  c.act("prepare");
  f.setTime(NOW + 8 * DAY);
  // Settle the independent event-top prize before measuring this chest's tickets.
  f.store.refreshCompetition();
  const before = f.p().roulette.tickets;
  assert.equal(c.view().tickets || 0, 0);
  c.act("open");
  assert.equal(f.p().roulette.tickets, before);
  assert.equal(f.p().inventory.easter_egg, 3);
});
test("Старый подготовленный пасхальный состав сохраняется, новый получает бонус", () => {
  const f = fixture(true, true, true),
    c = f.chest("easter");
  const old = f.p().easter.chests[0];
  old.prepared = true;
  old.reward = { coins: 159, crystals: 20, fragmentId: 0 };
  c.act("prepare");
  assert.equal(c.view().coins, 159);
  assert.equal(c.view().items.easter_egg, 1);
  c.act("open");
  assert.equal(f.p().inventory.easter_egg, 1);
});
test("Сундуки званий: карточка и подготовленная награда совпадают после смены аккаунта и для старых наград", () => {
  const f = fixture(true, false, true),
    c = f.chest("title", "boss");
  c.act("prepare");
  const old = f.p().honors.pending;
  old.version = 5;
  old.accountDays = { vip: 180, premium: 180 };
  f.p().account.premiumUntil = NOW + DAY;
  const v = f.store.view(f.p()),
    card = v.honors.tiers.at(-1);
  assert.equal(card.coins, old.coins);
  assert.equal(
    card.boosters,
    Object.values(old.items).reduce((a, b) => a + b, 0),
  );
  assert.deepEqual(card.accountDays, old.accountDays);
  assert.equal(card.tickets || 0, 0);
  assert.deepEqual(v.honors.pending.accountDays, card.accountDays);
  const n = fixture(true, true, true),
    fresh = n.store.view(n.p());
  assert.equal(fresh.honors.tiers.at(-1).accountDays.vip, 90);
});
test("Покупные пакеты валют за голоса: ровно состав каталога, без множителей и билетов сундука", () => {
  for (const product of products.products.filter((p) => p.type === "currency")) {
    const f = fixture(true, true, true);
    const before = structuredClone(f.p()),
      req = randomUUID();
    f.store.confirmMockPurchase(f.auth.token, {
      productId: product.id,
      confirmed: true,
      requestId: req,
    });
    assert.equal(f.p().wallet[product.currency] - before.wallet[product.currency], product.amount);
    assert.equal(f.p().roulette.tickets, before.roulette.tickets);
    const after = structuredClone(f.p());
    f.store.confirmMockPurchase(f.auth.token, {
      productId: product.id,
      confirmed: true,
      requestId: req,
    });
    assert.deepEqual(f.p(), after);
  }
});
test("Общий расчёт будущих сундуков: величие, валюта и бустеры умножаются; билеты и фрагменты нет", () => {
  const base = {
    coins: 10,
    crystals: 20,
    bucks: 30,
    items: { easter_egg: 10 },
    greatness: 5,
    tickets: 3,
    accountDays: { vip: 3 },
    fragmentId: 7,
  };
  assert.deepEqual(B.scale(base, 3), {
    ...base,
    coins: 30,
    crystals: 60,
    bucks: 90,
    greatness: 15,
    items: { easter_egg: 30 },
  });
  assert.throws(() => B.scale({ coins: Number.MAX_SAFE_INTEGER }, 3), /размер/);
});
