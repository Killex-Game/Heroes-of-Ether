"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const Q = require("../../src/server/progression/personal-quests");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { POOLS } = require("../../src/server/progression/title-chest-rewards");
const { temporary } = require("../temp");
const path = require("node:path");
const AT = Date.UTC(2026, 9, 24, 10);
function fixture(filePath) {
  let at = AT;
  const store = new ProfileStore({ filePath, now: () => at }),
    session = store.open();
  const get = () => store.find(session.token);
  const choose = (id) => {
    const q = get().quests,
      def = Q.CATALOG.find((d) => d.id === id);
    let row = q.items.find((r) => r.questId === id);
    if (!row) {
      row = q.items.find((r) => Q.CATALOG.find((d) => d.id === r.questId).tier === def.tier);
      if (!row && def.tier === "small") row = q.items.at(-1);
      row.questId = id;
    }
    return row.id;
  };
  const event = (e, batch = randomUUID()) =>
    store.applyArenaProgress(batch, [{ profileId: get().id, ...e }], at);
  const start = (id = "own-life") => event({ type: "lifeStarted", lifeId: id });
  const action = (body) => store.questAction(session.token, { requestId: randomUUID(), ...body });
  const sample = (rank, food = 0, lifeId = "own-life") =>
    event({ type: "questSample", lifeId, rank, food });
  const kill = (n, split = false, extra = {}) =>
    event({
      type: "absorbed",
      lifeId: `victim-life-${n}`,
      victimProfileId: `victim-${n}`,
      victimPartId: `part-${n}`,
      gain: 100,
      spaceSplit: split,
      victimDefeated: true,
      ...extra,
    });
  return {
    store,
    session,
    get,
    choose,
    event,
    start,
    action,
    sample,
    kill,
    set: (n) => {
      at = n;
    },
    now: () => at,
  };
}
test("45 compatible definitions; every daily set is stable, unique and has exactly the promised chest mix", () => {
  assert.equal(Q.CATALOG.length, 45);
  assert.equal(new Set(Q.CATALOG.map((q) => q.id)).size, 45);
  const mixes = new Set();
  let smallSets = 0;
  for (let i = 0; i < 1000; i++) {
    const p = { id: `test-player-${i}` };
    const q = Q.ensure(p, AT);
    const tiers = q.items.map((r) => Q.CATALOG.find((d) => d.id === r.questId).tier);
    assert.equal(tiers.filter((t) => t === "large").length, 2);
    assert.ok([1, 2].includes(tiers.filter((t) => t === "medium").length));
    assert.equal(new Set(q.items.map((r) => r.questId)).size, 4);
    assert.deepEqual(Q.ensure({ id: p.id }, AT), q);
    mixes.add(tiers.join());
    if (tiers.includes("small")) smallSets++;
    Q.validate(p);
    q.items[0].progress = 1;
    const assigned = structuredClone(q);
    assert.deepEqual(Q.ensure(p, AT + 3600000), assigned);
  }
  assert.equal(mixes.size, 2);
  assert.ok(
    smallSets >= 750 && smallSets <= 850,
    `Expected about 80% small sets, got ${smallSets}/1000`,
  );
  assert.equal(Q.day(Date.UTC(2026, 9, 24, 20, 59, 59)), "2026-10-24");
  assert.equal(Q.day(Date.UTC(2026, 9, 24, 21)), "2026-10-25");
});
test("all chest random ranges and rarity totals match; event tickets are 3/2/1", () => {
  for (const tier of Object.keys(Q.CHESTS)) {
    const def = Q.CHESTS[tier];
    for (const random of [() => 0, (n) => n - 1]) {
      const reward = Q.makeReward(tier, AT, true, random);
      for (const rarity of ["common", "advanced", "rare"]) {
        const total = POOLS[rarity].reduce((sum, id) => sum + (reward.items[id] || 0), 0);
        assert.ok(total >= def[rarity][0] && total <= def[rarity][1]);
      }
      for (const currency of ["coins", "crystals"])
        assert.ok(reward[currency] >= def[currency][0] && reward[currency] <= def[currency][1]);
      assert.equal(reward.tickets, def.tickets);
      assert.equal(reward.greatness, def.greatness);
    }
    assert.equal(Q.makeReward(tier, AT, false).tickets, 0);
  }
});
test("rerolls preserve the chest mix, use one free attempt per day and never double-charge", () => {
  const f = fixture(),
    first = f.get().quests.items[0],
    firstKind = first.questId,
    balance = f.get().wallet.coins;
  const request = { action: "reroll", questId: first.id, expectedCost: 0, requestId: randomUUID() };
  f.action(request);
  assert.equal(f.get().wallet.coins, balance);
  assert.equal(f.action(request).replay, true);
  let row = f.get().quests.items[0];
  assert.notEqual(row.questId, firstKind);
  assert.equal(row.progress, 0);
  assert.equal(f.get().quests.rerolls, 1);
  assert.throws(() => f.action({ action: "reroll", questId: row.id, expectedCost: 0 }), /Цена/);
  const paid = { action: "reroll", questId: row.id, expectedCost: 100, requestId: randomUUID() };
  f.action(paid);
  f.action(paid);
  assert.equal(f.get().wallet.coins, balance - 100);
  f.get().wallet.coins = 99;
  row = f.get().quests.items[0];
  assert.throws(
    () => f.action({ action: "reroll", questId: row.id, expectedCost: 100 }),
    /100 монет/,
  );
  assert.equal(f.get().quests.rerolls, 2);
  f.set(Date.UTC(2026, 9, 24, 21));
  f.store.open(f.session.token);
  assert.equal(f.get().quests.rerolls, 0);
  assert.equal(f.get().quests.day, "2026-10-25");
  assert.throws(() => f.action({ action: "reroll", questId: row.id, expectedCost: 0 }), /текущее/);
  Q.validate(f.get());
});
test("full defeats count once; partial parts, own parts and mass bonuses never inflate player kills", () => {
  const f = fixture(),
    id = f.choose("ten_in_life");
  f.start();
  f.kill(0, false, { victimDefeated: false });
  f.kill(0, false, { victimDefeated: false });
  f.kill(1, false, { victimProfileId: f.get().id });
  for (let i = 2; i <= 10; i++) {
    f.kill(i);
    f.kill(i);
  }
  assert.equal(f.get().quests.items.find((r) => r.id === id).progress, 9);
  f.event({ type: "massBonus", lifeId: "own-life", sequence: 1, kills: 20 });
  assert.equal(f.get().quests.items.find((r) => r.id === id).progress, 9);
  f.kill(11);
  assert.equal(f.get().quests.items.find((r) => r.id === id).progress, 10);
  assert.equal(f.get().quests.pending.filter((r) => r.id === id).length, 1);
});
test("single-life progress resets on death; cumulative jumping counts actual space-split defeats", () => {
  const f = fixture(),
    id = f.choose("ten_in_life");
  f.start();
  f.kill(1);
  f.event({ type: "lifeEnded", lifeId: "own-life", durationSeconds: 1 });
  assert.equal(f.get().quests.items.find((r) => r.id === id).progress, 0);
  f.start("next-life");
  f.kill(2);
  assert.equal(f.get().quests.items.find((r) => r.id === id).progress, 1);
  const g = fixture(),
    jumpId = g.choose("sky_hunter");
  g.start();
  g.kill(0, false);
  g.kill(1, true, { victimDefeated: false });
  for (let i = 2; i <= 51; i++) g.kill(i, true);
  assert.equal(g.get().quests.items.find((r) => r.id === jumpId).progress, 15);
});
test("top-10 needs ten uninterrupted minutes; leaving the ranking resets the streak", () => {
  const f = fixture(),
    id = f.choose("top_ten");
  f.start();
  f.set(AT + 1000);
  f.sample(10);
  f.set(AT + 300000);
  f.sample(8);
  assert.equal(f.get().quests.items.find((r) => r.id === id).progress, 299);
  f.set(AT + 301000);
  f.sample(11);
  assert.equal(f.get().quests.items.find((r) => r.id === id).progress, 0);
  f.set(AT + 302000);
  f.sample(10);
  f.set(AT + 901999);
  f.sample(1);
  assert.equal(
    f.get().quests.pending.some((r) => r.id === id),
    false,
  );
  f.set(AT + 902000);
  f.sample(1);
  assert.equal(
    f.get().quests.pending.some((r) => r.id === id),
    true,
  );
});
test("food uses cumulative samples without duplicate progress; completed event rewards survive midnight", () => {
  const f = fixture(),
    id = f.choose("snack");
  f.store.events = {
    data: { runs: [] },
    active: () => ({ id: "test-event" }),
    publicView: () => null,
    stamp: () => "test",
    rouletteConfig: (base) => base,
  };
  f.start();
  f.set(AT + 1000);
  f.sample(1, 499);
  f.sample(1, 499);
  assert.equal(f.get().quests.items.find((r) => r.id === id).progress, 499);
  f.set(AT + 2000);
  f.sample(1, 500);
  const reward = structuredClone(f.get().quests.pending.find((r) => r.id === id));
  assert.equal(reward.tickets, 1);
  const stored = Q.view(f.get(), f.store.now(), f.store.events.active()).pending.find(
    (r) => r.id === id,
  );
  assert.deepEqual(stored.chest, { name: "Малый сундук", art: "novice" });
  assert.deepEqual(
    f.get().quests.pending.find((r) => r.id === id),
    reward,
  );
  f.store.events = null;
  f.action({ action: "receive", questId: id });
  const receivedReward = structuredClone(f.get().quests.pending.find((r) => r.id === id));
  f.set(Date.UTC(2026, 9, 24, 21));
  f.store.open(f.session.token);
  assert.deepEqual(
    f.get().quests.pending.find((r) => r.id === id),
    receivedReward,
  );
  const before = structuredClone(f.get());
  f.action({ action: "receive", questId: id });
  const request = { action: "claim", questId: id, requestId: randomUUID() };
  f.action(request);
  f.action(request);
  assert.equal(f.get().wallet.coins, before.wallet.coins + reward.coins);
  assert.equal(f.get().wallet.crystals, before.wallet.crystals + reward.crystals);
  assert.equal(f.get().greatness, before.greatness + reward.greatness);
  assert.equal(f.get().roulette.tickets, before.roulette.tickets + 1);
  for (const [booster, count] of Object.entries(reward.items))
    assert.equal(f.get().inventory[booster], (before.inventory[booster] || 0) + count);
  assert.throws(() => f.action({ action: "claim", questId: id }), /уже получена/);
});
test("chest notice receipt survives reload, day rollover and retry without changing rewards", (t) => {
  const filePath = path.join(temporary(t), "profiles.json"),
    f = fixture(filePath);
  const id = f.choose("growing");
  f.start();
  f.event({ type: "massPeak", mass: 5000 });
  const before = structuredClone(f.get()),
    save = f.store.save.bind(f.store);
  const request = { action: "notice", ids: [id], requestId: randomUUID() };
  f.store.save = () => {
    throw Error("disk failure");
  };
  assert.throws(() => f.action(request), /disk failure/);
  assert.deepEqual(f.get(), before);
  f.store.save = save;
  f.action(request);
  assert.equal(f.get().quests.pending.find((r) => r.id === id).notifiedAt, AT);
  const expected = structuredClone(before.quests.pending);
  expected.find((r) => r.id === id).notifiedAt = AT;
  assert.deepEqual(f.get().quests.pending, expected);
  assert.deepEqual(f.get().wallet, before.wallet);
  assert.deepEqual(f.get().inventory, before.inventory);
  assert.equal(f.get().greatness, before.greatness);
  const reloaded = new ProfileStore({ filePath, now: () => AT + 10000 });
  assert.equal(reloaded.questAction(f.session.token, request).replay, true);
  reloaded.questAction(f.session.token, { ...request, requestId: randomUUID() });
  assert.equal(
    reloaded.view(reloaded.find(f.session.token)).quests.pending.find((r) => r.id === id)
      .notifiedAt,
    AT,
  );
  const other = reloaded.open();
  reloaded.questAction(other.token, { ...request, requestId: randomUUID() });
  assert.deepEqual(reloaded.find(other.token).quests.pending, []);
  Q.ensure(reloaded.find(f.session.token), AT + 86400000);
  assert.equal(
    reloaded.find(f.session.token).quests.pending.find((r) => r.id === id).notifiedAt,
    AT,
  );
  for (const ids of [[], null, [1], [""], ["x".repeat(101)], Array(101).fill(id)])
    assert.throws(() => f.action({ action: "notice", ids }), /Некорректные/);
  f.action({ action: "receive", questId: id });
  f.action({ action: "claim", questId: id });
  assert.equal(
    f.get().wallet.coins,
    before.wallet.coins + before.quests.pending.find((r) => r.id === id).coins,
  );
});

test("every definition completes only after its server-observed target", () => {
  for (const def of Q.activeCatalog) {
    const f = fixture();
    f.get().level = 12;
    f.get().progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(12);
    const id = f.choose(def.id);
    f.start();
    if (["kills", "lifeKills", "jumpKills"].includes(def.metric)) {
      for (let i = 0; i < def.target; i++) f.kill(i, def.metric === "jumpKills");
    } else if (def.metric === "absorbedMass")
      f.kill(1, false, { gain: def.target, victimDefeated: false });
    else if (def.metric === "mass") f.event({ type: "massPeak", mass: def.target });
    else if (["rocketHits", "hazardHits", "lifeHazards", "lifeRocketHits", "lifeHazardHits", "lifeFreezeHits", "lifePushHits", "hookHits", "lifeCandyUses"].includes(def.metric)) {
      const metric = {lifeHazards:'hazards',lifeRocketHits:'rocketHits',lifeHazardHits:'hazardHits',lifeFreezeHits:'freezeHits',lifePushHits:'pushHits',lifeCandyUses:'boosterUses'}[def.metric] || def.metric;
      for (let i = 1; i <= def.target; i++) f.event({ type: "arenaAction", lifeId: "own-life", sequence: i,
        metric, boosterId: 'candy', targetProfileId: `victim-${i}` });
    } else if (def.metric === "food") {
      f.set(AT + 1000);
      f.sample(1, def.target);
    } else {
      f.set(AT + 1000);
      f.sample(1);
      f.set(AT + (def.target + 1) * 1000);
      f.sample(1);
    }
    assert.ok(
      f.get().quests.pending.some((r) => r.id === id),
      def.id,
    );
    Q.validate(f.get());
  }
});
test("failed disk writes cannot charge or grant; committed rewards and receipts survive restart", (t) => {
  const dir = temporary(t),
    f = fixture(path.join(dir, "profiles.json"));
  const id = f.choose("growing");
  f.start();
  f.event({ type: "massPeak", mass: 5000 });
  f.action({ action: "receive", questId: id });
  const before = structuredClone(f.get()),
    write = f.store.save.bind(f.store);
  f.store.save = () => {
    throw Error("simulated disk failure");
  };
  const claim = { action: "claim", questId: id, requestId: randomUUID() };
  assert.throws(() => f.action(claim), /disk failure/);
  assert.deepEqual(f.get(), before);
  f.store.save = write;
  f.action(claim);
  const loaded = new ProfileStore({ filePath: path.join(dir, "profiles.json"), now: () => AT });
  assert.equal(loaded.questAction(f.session.token, claim).replay, true);
  assert.deepEqual(loaded.find(f.session.token).quests, f.get().quests);
  const row = f.get().quests.items.find((r) => r.completedAt === null);
  f.action({ action: "reroll", questId: row.id, expectedCost: 0 });
  const current = structuredClone(f.get());
  f.store.save = () => {
    throw Error("disk failure");
  };
  assert.throws(
    () =>
      f.action({
        action: "reroll",
        questId: f.get().quests.items.find((r) => r.completedAt === null).id,
        expectedCost: 100,
      }),
    /disk failure/,
  );
  assert.deepEqual(f.get(), current);
});
