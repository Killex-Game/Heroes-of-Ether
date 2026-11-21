"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { ClanService, validateWorld } = require("../../src/server/clans/clan-service");
const { xpForLevel } = require("../../src/server/progression/experience-progression");
const at = Date.parse("2026-11-16T10:00:00Z");
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value); for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function fixture() {
  const store = new ProfileStore({ now: () => at, incrementalSettlement: true });
  const people = Array.from({ length: 7 }, () => store.open());
  for (const who of people) {
    store.transact(who.token, randomUUID(), "fixture", p => {
      p.level = 12; p.progress.xp = xpForLevel(12);
      p.wallet = { coins: 10000, crystals: 10000, bucks: 10000 };
    });
  }
  const [a, b, c, d, e, f, idle] = people, clans = new ClanService(store);
  const act = (who, action, values = {}) => clans.mutate(who.token, { action, requestId: randomUUID(), ...values });
  const create = (who, prefix) => {
    act(who, "create", { name: "Клан " + prefix, prefix, emblem: "grove", privacy: "closed" });
    return store.find(who.token).clanId;
  };
  const own = create(a, "AAA"), other = create(c, "BBB"), unrelated = create(e, "CCC");
  act(b, "apply", { clanId: own }); act(a, "accept", { clanId: own, memberId: b.profile.id });
  act(d, "apply", { clanId: own }); act(d, "apply", { clanId: other });
  store.data.clans[own].competition.recruits = {};
  store.data.clans[own].treasury = 10000;
  store.save(store.data);
  return { store, clans, a, b, c, d, e, f, idle, own, other, unrelated };
}
const scenarios = {
  create: f => [f.d, { action: "create", name: "Новый клан", prefix: "NEW", emblem: "grove" }],
  edit: f => [f.a, { action: "edit", clanId: f.own, name: "Новое имя" }],
  applyClosed: f => [f.f, { action: "apply", clanId: f.own }],
  applyOpen: f => {
    f.clans.mutate(f.d.token, { action: "cancel", clanId: f.other, requestId: randomUUID() });
    f.store.data.clans[f.other].privacy = "open";
    return [f.d, { action: "apply", clanId: f.other }];
  },
  cancel: f => [f.d, { action: "cancel", clanId: f.own }],
  accept: f => [f.a, { action: "accept", clanId: f.own, memberId: f.d.profile.id }],
  reject: f => [f.a, { action: "reject", clanId: f.own, memberId: f.d.profile.id }],
  leave: f => [f.b, { action: "leave", clanId: f.own }],
  kick: f => [f.a, { action: "kick", clanId: f.own, memberId: f.b.profile.id }],
  transfer: f => [f.a, { action: "transfer", clanId: f.own, memberId: f.b.profile.id }],
  role: f => [f.a, { action: "role", clanId: f.own, memberId: f.b.profile.id, role: "manager" }],
  disband: f => [f.a, { action: "disband", clanId: f.own }],
  deposit: f => [f.b, { action: "deposit", clanId: f.own, amount: 100 }],
  buyBooster: f => [f.a, { action: "buyBooster", clanId: f.own, boosterId: "fire" }],
  frame: f => [f.a, { action: "frame", clanId: f.own, frame: null }],
  background: f => [f.a, { action: "background", clanId: f.own, themeId: "default" }],
};
for (const [name, select] of Object.entries(scenarios)) {
  test("bounded clan " + name + " isolates committed state and preserves unrelated records", () => {
    const f = fixture(), [who, input] = select(f);
    const previous = freeze(f.store.data), before = JSON.stringify(previous);
    const outsider = f.store.byId(f.idle.profile.id), unrelated = previous.clans[f.unrelated];
    const save = f.store.save; let prepared;
    f.store.save = function(next, ...args) { prepared = next; return save.call(this, next, ...args); };
    const command = { ...input, requestId: randomUUID() };
    const result = f.clans.mutate(who.token, command);
    assert.equal(result.replay, false);
    assert.equal(JSON.stringify(previous), before);
    assert.strictEqual(f.store.byId(f.idle.profile.id), outsider);
    assert.strictEqual(prepared.clans[f.unrelated], unrelated);
    // Membership changes can legitimately rebuild competition-derived clans
    // during save. The transaction itself must leave them shared and immutable.
    assert.deepEqual(f.store.data.clans[f.unrelated], unrelated);
    validateWorld(f.store.data);
    const after = JSON.stringify(f.store.data);
    assert.equal(f.clans.mutate(who.token, command).replay, true);
    assert.equal(JSON.stringify(f.store.data), after);
  });
  test("bounded clan " + name + " rolls back the entire write set on a failed save", () => {
    const f = fixture(), [who, input] = select(f);
    const previous = freeze(f.store.data), before = JSON.stringify(previous);
    const save = f.store.save;
    f.store.save = () => { throw Error("injected disk failure"); };
    const command = { ...input, requestId: randomUUID() };
    assert.throws(() => f.clans.mutate(who.token, command), /injected disk failure/);
    assert.strictEqual(f.store.data, previous); assert.equal(JSON.stringify(previous), before);
    f.store.save = save;
    assert.equal(f.clans.mutate(who.token, command).replay, false);
  });
  if (name !== "create") test("bounded clan " + name + " matches the complete-world transaction", () => {
    const f = fixture(), [who, input] = select(f), legacy = new ProfileStore({ now: () => at, incrementalSettlement: true });
    legacy.save(structuredClone(f.store.data));
    const transact = legacy.transactWorld;
    legacy.transactWorld = function(token, id, signature, change) { return transact.call(this, token, id, signature, change); };
    const command = { ...input, requestId: randomUUID() };
    new ClanService(legacy).mutate(who.token, command);
    f.clans.mutate(who.token, command);
    const comparable = world => {
      const copy = structuredClone(world);
      for (const p of Object.values(copy.profiles))
        for (const [index, entry] of p.transactions.entries.entries()) entry.id = "history-" + index;
      return copy;
    };
    assert.deepEqual(comparable(f.store.data), comparable(legacy.data));
  });
}

test("clan write set is resolved after refresh, and joining refunds all other applications", () => {
  const f = fixture(), original = f.store.refreshCompetition.bind(f.store);
  let refreshed = false;
  f.store.refreshCompetition = () => {
    original();
    if (!refreshed) {
      refreshed = true;
      f.store.data = { ...f.store.data, clans: structuredClone(f.store.data.clans) };
    }
  };
  const coins = f.store.byId(f.d.profile.id).wallet.coins;
  f.clans.mutate(f.a.token, { action: "accept", clanId: f.own, memberId: f.d.profile.id, requestId: randomUUID() });
  assert.equal(f.store.byId(f.d.profile.id).wallet.coins, coins + 50);
  assert.equal(f.store.byId(f.d.profile.id).clanId, f.own);
  assert.ok(!f.store.data.clans[f.other].applications.includes(f.d.profile.id));
  assert.equal(f.store.data.clans[f.other].applicationFees[f.d.profile.id], undefined);
});

test("bounded clan deposits and purchases recover from fsync failure without duplicate awards", async t => {
  const fs = require("node:fs"), path = require("node:path"), { temporary } = require("../temp");
  const f = fixture(), filePath = path.join(temporary(t, "clan-write-set-wal"), "profiles.json");
  const store = new ProfileStore({ filePath, journal: true, now: () => at, incrementalSettlement: true });
  let restored;
  try {
    store.save(structuredClone(f.store.data));
    const clans = new ClanService(store), previous = store.data;
    const deposit = { action: "deposit", clanId: f.own, amount: 100, requestId: randomUUID() };
    const sync = fs.fsyncSync;
    let failOnce = true;
    const mock = t.mock.method(fs, "fsyncSync", fd => {
      if (failOnce) { failOnce = false; throw Error("injected fsync failure"); }
      return sync(fd);
    });
    assert.throws(() => clans.mutate(f.b.token, deposit), /injected fsync failure/);
    assert.strictEqual(store.data, previous);
    mock.mock.restore(); assert.strictEqual(fs.fsyncSync, sync);
    clans.mutate(f.b.token, deposit);
    const purchase = { action: "buyBooster", clanId: f.own, boosterId: "fire", requestId: randomUUID() };
    clans.mutate(f.a.token, purchase);
    const saved = structuredClone(store.data);
    await store.close();
    restored = new ProfileStore({ filePath, journal: true, now: () => at, incrementalSettlement: true });
    const recovered = structuredClone(restored.data);
    delete saved._journalRevision; delete recovered._journalRevision;
    assert.deepEqual(recovered, saved);
    const reloaded = new ClanService(restored);
    assert.equal(reloaded.mutate(f.b.token, deposit).replay, true);
    assert.equal(reloaded.mutate(f.a.token, purchase).replay, true);
    for (const who of [f.a, f.b]) assert.equal(restored.find(who.token).inventory.fire, 10);
  } finally { await (restored || store).close(); }
});
