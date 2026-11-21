"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path");
const { randomUUID } = require("node:crypto");
const fixture = require("../helpers/black-friday-fixture");
const { temporary } = require("../temp");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const Q = require("../../src/server/progression/personal-quests");
const B = require("../../src/server/events/black-friday");
const book = require("../../src/server/events/black-friday-orders");

function select(f, template, questId = "rocket_hit_large") {
  f.p().blackFriday ||= { runs: {} };
  const s = f.p().blackFriday.runs[f.run.id] ||= { tokens: 0, completedOrders: 0, days: {}, purchases: {}, finalAt: null };
  const d = book.ensure(f.p(), s, B.day(f.now()), f.now());
  fixture.forceOrder(d, template);
  const q = f.p().quests, def = Q.CATALOG.find(q => q.id === questId);
  const row = q.items.find(r => r.questId === questId) || q.items.find(r => Q.CATALOG.find(q => q.id === r.questId).tier === def.tier) || q.items.at(-1);
  row.questId = questId; row.progress = 0;
  return { rowId: row.id, current: () => f.p().blackFriday.runs[f.run.id].days[B.day(f.now())].slots[0].current,
    row: () => f.p().quests.items.find(r => r.id === row.id) };
}

test("each hit order counts distinct profiles across repeated impacts, parts, lives and restart", (t) => {
  for (const [metric, template] of [["hazardHits", 5], ["rocketHits", 6], ["freezeHits", 7]]) {
    const filePath = path.join(temporary(t), "profiles.json"), f = fixture({ filePath });
    f.progress({ type: "lifeStarted", lifeId: "life1" });
    const selected = select(f, template, metric === "hazardHits" ? "thorn_hit_large" : "rocket_hit_large");
    let sequence = 0;
    const hit = (targetProfileId, lifeId = "life1") => f.progress({ type: "arenaAction", metric,
      lifeId, sequence: ++sequence, targetProfileId, targetPartId: randomUUID() });
    hit("a"); hit("a"); hit("a"); hit(f.p().id); hit(undefined);
    assert.equal(f.view().orders[0].progress, 1);
    if (metric !== "freezeHits") assert.equal(selected.row().progress, 1);
    f.progress({ type: "lifeEnded", lifeId: "life1", durationSeconds: 1, reason: "exit" });
    f.progress({ type: "lifeStarted", lifeId: "life2" }); sequence = 0;
    hit("a", "life2"); hit("b", "life2");
    assert.equal(f.view().orders[0].progress, 2);
    // A new process with the same profile retains exactly the opponents already counted.
    const loaded = new ProfileStore({ filePath, now: f.now }); loaded.events = f.manager;
    const p = () => loaded.find(f.user.token);
    const send = id => loaded.applyArenaProgress(randomUUID(), [{ profileId: p().id,
      type: "arenaAction", lifeId: "life2", sequence: ++sequence, metric, targetProfileId: id }], f.now());
    send("a"); send("b"); send("c");
    assert.equal(B.view(p(), f.manager, f.now()).orders[0].progress, 3);
    const before = structuredClone(p()), save = loaded.save;
    loaded.save = () => { throw Error("disk failure"); };
    assert.throws(() => send("d"), /disk failure/); assert.deepEqual(p(), before);
    loaded.save = save; send("d"); send("e"); send("e");
    assert.equal(B.view(p(), f.manager, f.now()).orders[0].progress, 5);
    Q.validate(p()); B.validate(p());
    assert.ok(Q.view(p(), f.now(), f.run).items.every(r => !("opponents" in r)));
    assert.ok(B.view(p(), f.manager, f.now()).orders.every(r => !("opponents" in r)));
  }
});

test("kill objectives count whole distinct players; mass objectives still credit every part", () => {
  const f = fixture(); f.progress({ type: "lifeStarted", lifeId: "own-life" });
  const selected = select(f, 3, "ten_in_life");
  const kill = (profile, life, part, defeated = true, spaceSplit = false) => f.progress({ type: "absorbed",
    lifeId: life, victimProfileId: profile, victimPartId: part, victimDefeated: defeated, spaceSplit, gain: 100 });
  kill("a", "a1", "part1", false); kill("a", "a1", "part2");
  kill("a", "a2", "part3"); kill("b", "b1", "part4");
  assert.equal(f.view().orders[0].progress, 2); assert.equal(selected.row().progress, 2);
  f.progress({ type: "lifeEnded", lifeId: "own-life", durationSeconds: 1, reason: "exit" });
  f.progress({ type: "lifeStarted", lifeId: "own-life2" });
  assert.equal(selected.row().progress, 0); assert.equal(selected.row().opponents, undefined);
  kill("a", "a3", "part5");
  assert.equal(f.view().orders[0].progress, 2); assert.equal(selected.row().progress, 1);
  const current = selected.current(); current.template = 8; current.progress = 0; delete current.opponents;
  kill("a", "a4", "part6", false); kill("a", "a4", "part7", false);
  assert.equal(f.view().orders[0].progress, 200);
});

test("replacement and the next day have fresh opponents; legacy progress is kept; histories are bounded", () => {
  const f = fixture(); f.progress({ type: "lifeStarted", lifeId: "life1" });
  const selected = select(f, 7);
  selected.current().progress = 3; // Old saves have no recipient history.
  const hit = (id, seq) => f.progress({ type: "arenaAction", metric: "freezeHits", lifeId: "life1", sequence: seq, targetProfileId: id });
  hit("a", 1); hit("a", 2);
  assert.equal(f.view().orders[0].progress, 4);
  f.act("swap", f.view().orders[0].id);
  selected.current().template = 7;
  assert.equal(selected.current().opponents, undefined);
  hit("a", 3); assert.equal(f.view().orders[0].progress, 1);
  for (let i = 0; i < 12; i++) hit("next-" + i, i + 4);
  assert.equal(selected.current().progress, 5); assert.equal(selected.current().opponents.length, 5);
  B.validate(f.p());
  const malformed = structuredClone(f.p());
  malformed.blackFriday.runs[f.run.id].days[B.day(f.now())].slots[0].current.opponents[1] = "a";
  assert.throws(() => B.validate(malformed));
  f.time(f.now() + 86400000);
  const next = book.ensure(f.p(), f.p().blackFriday.runs[f.run.id], B.day(f.now()), f.now());
  fixture.forceOrder(next, 7);
  hit("a", 100); assert.equal(f.view().orders[0].progress, 1);
});
