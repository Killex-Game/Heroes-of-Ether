const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const fixture = require("../helpers/black-friday-fixture");
const B = require("../../src/server/events/black-friday"),
  book = require("../../src/server/events/black-friday-orders");
const album = require("../../src/server/events/event-album");
test("pure views, daily 4/4/4 quotas and exact 240 tokens, no stale claims", () => {
  const f = fixture(),
    before = JSON.stringify(f.p()),
    v = f.view();
  assert.equal(JSON.stringify(f.p()), before);
  assert.equal(v.orders.length, 4);
  assert.ok(v.orders.every(o => o.quota === 4 && o.tokens === ({common:10, important:20, secret:30})[o.tier]));
  assert.equal(f.run.endsAt - f.run.startsAt, 7 * 86400000);
  f.complete();
  assert.equal(f.view().tokens, 240 + 5 * (f.p().blackFriday.runs[f.run.id].arenaLevels || 0));
  assert.equal(f.view().completedOrders, 12);
  assert.deepEqual(
    f.view().orders.map((o) => o.done),
    [4, 4, 4, 4],
  );
  assert.ok(f.view().orders.every((o) => o.claimed));
  assert.throws(() => f.act("order", v.orders[0].id));
  B.validate(f.p());
  assert.equal(f.store.arenaView(f.p()).blackFriday, undefined);
});
test("one free replacement across book, then 3 ether; tier, quota and replay preserved", () => {
  const f = fixture();
  f.p().wallet.bucks = 10;
  const o = f.view().orders[0],
    i = f.input("swap", o.id);
  B.mutate(f.store, f.user.token, i, () => 0);
  const n = f.view().orders[0];
  assert.notEqual(n.id, o.id);
  assert.notEqual(n.name, o.name);
  assert.equal(n.tier, o.tier);
  assert.equal(n.tokens, o.tokens);
  assert.equal(n.done, 0);
  assert.equal(f.p().wallet.bucks, 10);
  assert.equal(f.p().activity?.values?.spendthrift_ii || 0, 0);
  assert.equal(f.view().swapCost, 3);
  assert.equal(B.mutate(f.store, f.user.token, i).replay, true);
  assert.throws(() => f.act("swap", o.id));
  f.act("swap", f.view().orders[1].id);
  assert.equal(f.p().wallet.bucks, 7);
  assert.equal(f.p().activity.values.spendthrift_ii, 3);
  f.p().wallet.bucks = 0;
  assert.throws(() => f.act("swap", f.view().orders[2].id));
  f.time((B.day(f.now()) + 1) * 86400000 - 10800000);
  assert.equal(f.view().swapCost, 0);
  f.act("swap", f.view().orders[2].id);
  assert.equal(f.view().tokens, 0);
  assert.equal(f.view().completedOrders, 0);
});
test("progress ignores stale samples, other life and food before day/assignment; swaps reset it", () => {
  const f = fixture(),
    lifeId = randomUUID();
  f.progress({ type: "lifeStarted", lifeId });
  let s = f.p();
  s.blackFriday = {
    runs: { [f.run.id]: { tokens: 0, completedOrders: 0, purchases: {}, finalAt: null, days: {} } },
  };
  let d = book.ensure(s, s.blackFriday.runs[f.run.id], B.day(f.now()), f.now());
  fixture.forceOrder(d, 0);
  f.time(f.now() + 1000);
  f.progress({ type: "questSample", lifeId, food: 30, rank: 20 });
  assert.equal(f.view().orders[0].progress, 30);
  f.progress({ type: "questSample", lifeId, food: 30, rank: 20 });
  assert.equal(f.view().orders[0].progress, 30);
  f.progress({ type: "questSample", lifeId: "other", food: 500, rank: 20 });
  assert.equal(f.view().orders[0].progress, 30);
  f.act("swap", f.view().orders[0].id);
  assert.equal(f.view().orders[0].progress, 0);
  const stale = f.input("swap", f.view().orders[0].id);
  f.time((B.day(f.now()) + 1) * 86400000 - 10800000);
  assert.throws(() => B.mutate(f.store, f.user.token, stale), /новый день/);
  assert.ok(f.view().orders.every((o) => o.progress === 0));
  const current = f.p(),
    state = current.blackFriday.runs[f.run.id],
    next = book.ensure(current, state, B.day(f.now()), f.now());
  fixture.forceOrder(next, 0);
  f.time(f.now() + 1000);
  f.progress({ type: "questSample", lifeId, food: 1000, rank: 20 });
  assert.equal(f.view().orders[0].progress, 0);
  f.time(f.now() + 1000);
  f.progress({ type: "questSample", lifeId, food: 1010, rank: 20 });
  assert.equal(f.view().orders[0].progress, 10);
});
test("unlimited ether exchange, fixed other limits, spent tokens stay in earned score, exact booster grants", () => {
  const f = fixture();
  Object.assign(f.p().wallet, { coins: 5000, crystals: 500, bucks: 300 });
  for (const id of ["coins", "crystals"]) {
    for (let i = 0; i < 10; i++) f.act("exchange", id);
    assert.throws(() => f.act("exchange", id));
  }
  for (let i = 0; i < 10; i++) f.act("exchange", "bucks");
  assert.equal(f.view().tokens, 350);
  assert.equal(f.p().wallet.bucks, 0);
  assert.equal(f.p().activity.values.spendthrift, 5000);
  assert.equal(f.p().activity.values.spendthrift_i, 500);
  assert.equal(f.p().activity.values.spendthrift_ii, 300);
  assert.throws(() => f.act("exchange", "bucks"));
  const before = Object.values(f.p().inventory).reduce((a, b) => a + b, 0);
  f.act("buy", "common", { tokens: 0, count: 9999 });
  assert.equal(Object.values(f.p().inventory).reduce((a, b) => a + b, 0) - before, 30);
  assert.equal(f.p().blackFriday.runs[f.run.id].days[B.day(f.now())].earned, 350);
  assert.equal(f.view().tokens, 340);
  assert.equal(f.view().completedOrders, 0);
  assert.throws(() => f.act("final"));
  f.act("buy", "vip");
  assert.equal(f.p().account.vipUntil, f.now() + 3600000);
  f.act("buy", "vip");
  assert.equal(f.p().account.vipUntil, f.now() + 7200000);
  assert.equal(f.p().activity.values.spendthrift_ii, 300, "Token purchases are not ether spending");
  B.validate(f.p());
});
test("50 orders: final once, permanent regalia and picture, single 100-ether album reward", () => {
  const f = fixture();
  for (let d = 0; d < 5; d++) {
    if (d) f.time(f.now() + 86400000);
    f.complete();
    if (d < 4) assert.throws(() => f.act("final"));
  }
  const i = f.input("final");
  B.mutate(f.store, f.user.token, i);
  const after = f.p().greatness;
  assert.equal(B.mutate(f.store, f.user.token, i).replay, true);
  assert.equal(f.p().greatness, after);
  assert.throws(() => f.act("final"));
  assert.equal(B.regalia(f.p()).length, 1);
  assert.equal(f.view().achievements.find((a) => a.id === "friday_trophy").claimed, 1);
  f.time(f.run.endsAt + 1);
  assert.equal(f.view().active, false);
  assert.throws(() => f.act("exchange", "coins"));
  const old = f.p().wallet.bucks,
    q = { eventId: B.manifest.id, requestId: randomUUID() };
  album.claim(f.store, f.user.token, q);
  album.claim(f.store, f.user.token, q);
  assert.equal(f.p().wallet.bucks - old, 100);
  assert.throws(() => album.claim(f.store, f.user.token, { ...q, requestId: randomUUID() }));
  B.validate(f.p());
});
test("seven books cap weekly orders at 84 even when the run crosses eight Moscow dates", () => {
  const f = fixture(),
    start = f.now();
  for (let d = 0; d < 7; d++) {
    f.time(start + d * 86400000);
    f.complete();
  }
  f.time(f.run.endsAt - 60000);
  assert.equal(f.view().ordersComplete, true);
  assert.equal(f.view().completedOrders, 84);
  assert.ok(f.view().orders.every((o) => o.claimed));
  assert.throws(() => f.act("order", f.view().orders[0].id), /84 заказа/);
  assert.throws(() => f.act("swap", f.view().orders[0].id), /84 заказа/);
  f.p().wallet.bucks = 30;
  f.act("exchange", "bucks");
  assert.equal(f.view().completedOrders, 84);
  B.validate(f.p());
});
test("legacy received rewards survive migration without retroactive tokens", () => {
  const f = fixture(),
    date = B.day(f.now()),
    days = {};
  for (let i = 0; i < 5; i++)
    days[date - i] = {
      food: 150,
      mass: 5000,
      life: 1,
      claimed: ["food", "mass", "life"],
      exchanges: { coins: 2 },
    };
  f.p().blackFriday = {
    runs: {
      [f.run.id]: { tokens: 150, completedOrders: 15, days, purchases: {}, finalAt: f.now() - 1 },
    },
  };
  const before = JSON.stringify(f.p());
  assert.equal(f.view().finalClaimed, true);
  assert.equal(f.view().dailyCompleted, 3);
  assert.equal(JSON.stringify(f.p()), before);
  f.act("swap", f.view().orders[0].id);
  assert.equal(f.view().tokens, 150);
  assert.equal(f.view().completedOrders, 15);
  assert.equal(f.p().blackFriday.runs[f.run.id].days[date].earned, 0);
  assert.equal(B.regalia(f.p())[0].awardedAt, f.now() - 1);
  B.validate(f.p());
});
test("failed save rolls back wallet, achievements and receipt; retry and invalid request protection", () => {
  const f = fixture();
  f.p().wallet.coins = 1000;
  const before = JSON.stringify(f.p()),
    i = f.input("exchange", "coins"),
    save = f.store.save;
  f.store.save = () => {
    throw Error("disk failure");
  };
  assert.throws(() => B.mutate(f.store, f.user.token, i), /disk failure/);
  assert.equal(JSON.stringify(f.p()), before);
  f.store.save = save;
  B.mutate(f.store, f.user.token, i);
  assert.equal(f.view().tokens, 10);
  assert.throws(() => f.act("exchange", "coins", { runId: "wrong" }));
  assert.throws(() => f.act("grant", "tokens"));
});
test("journal and checkpoint retain current orders, final prizes and receipt", async (t) => {
  const fs = require("node:fs"),
    path = require("node:path"),
    os = require("node:os"),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-v2-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "profiles.json"),
    f = fixture({ filePath, journal: true });
  try {
    for (let d = 0; d < 5; d++) {
      if (d) f.time(f.now() + 86400000);
      f.complete();
    }
    const i = f.input("final");
    B.mutate(f.store, f.user.token, i);
    const saved = structuredClone(f.p());
    const recovered = require("../../src/server/profiles/profile-journal").recover(filePath);
    assert.deepEqual(
      Object.values(recovered.data.profiles).find((p) => p.id === saved.id).blackFriday,
      saved.blackFriday,
    );
    await f.store.close();
    const { ProfileStore } = require("../../src/server/profiles/profile-store"),
      reload = new ProfileStore({ filePath, journal: true, now: f.now });
    reload.events = f.manager;
    try {
      assert.deepEqual(reload.find(f.user.token).blackFriday, saved.blackFriday);
      assert.equal(B.mutate(reload, f.user.token, i).replay, true);
    } finally {
      await reload.close();
    }
  } finally {
    await f.store.close();
  }
});
