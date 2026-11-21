"use strict";
const test = require("node:test"), assert = require("node:assert/strict"),
  fs = require("node:fs"), path = require("node:path"), { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  rules = require("../../src/server/progression/experience-progression"),
  { recover } = require("../../src/server/profiles/profile-journal"),
  { temporary } = require("../temp");
function fixture(filePath) {
  const store = new ProfileStore({ filePath }), user = store.open();
  const p = () => store.find(user.token),
    event = (e, id = randomUUID(), at = 1000000) => store.applyArenaProgress(id, [{ profileId: p().id, ...e }], at),
    kill = (extra = {}, id) => event({ type: "absorbed", victimProfileId: randomUUID(), victimDefeated: true, gain: 0, ...extra }, id),
    view = () => rules.publicProgress(p()).achievements.find(a => a.id === "king");
  return { store, user, p, event, kill, view };
}
test("Царь: пять отдельных степеней и точные награды, природные киллы не засчитываются", () => {
  const f = fixture();
  f.event({ type: "lifeStarted", lifeId: "life" });
  f.event({ type: "massBonus", lifeId: "life", sequence: 1, kills: 20 });
  f.event({ type: "massAccrual", lifeId: "life", sequence: 1, xpUnits: 0, killUnits: 600000 });
  assert.ok(f.p().progress.kills > 0);
  assert.equal(f.view().value, 0);
  assert.equal(f.view().claimed, 0);
  const thresholds = [50, 150, 300, 500, 1000], rewards = [25, 50, 75, 100, 150];
  assert.deepEqual(f.view().thresholds, thresholds);
  assert.deepEqual(f.view().rewards, rewards);
  let consumed = 0;
  for (let degree = 0; degree < 5; degree++) {
    f.p().progress.absorptionKills = consumed + thresholds[degree] - 1;
    const greatness = f.p().greatness;
    f.kill();
    consumed += thresholds[degree];
    assert.equal(f.view().claimed, degree + 1);
    assert.equal(f.p().greatness - greatness, rewards[degree]);
    assert.equal(f.p().progress.stageSpent.king, consumed);
    if (degree < 4) assert.equal(f.view().value, 0);
    rules.validateProgress(f.p());
  }
  const greatness = f.p().greatness;
  f.kill();
  assert.equal(f.p().greatness, greatness);
});
test("Царь: только полное поглощение, три минуты на повторную жертву, без повторов пакета", () => {
  const f = fixture(), victimProfileId = randomUUID(), receipt = randomUUID();
  f.kill({ victimProfileId, victimDefeated: false });
  assert.equal(f.view().value, 0);
  f.kill({ victimProfileId }, receipt);
  f.kill({ victimProfileId }, receipt);
  f.kill({ victimProfileId });
  f.kill({ victimProfileId: f.p().id });
  assert.equal(f.view().value, 1);
  f.event({ type: "absorbed", victimProfileId, victimDefeated: true, gain: 0 }, randomUUID(), 1180000);
  assert.equal(f.view().value, 2);
});
test("Царь: подтверждённые поглощения сохраняются после записи, отказ не меняет профиль", (t) => {
  const file = path.join(temporary(t, "king-absorptions"), "profiles.json"), f = fixture(file);
  f.kill();
  const before = structuredClone(f.store.data), save = f.store.save;
  f.store.save = () => { throw Error("disk failure"); };
  assert.throws(() => f.kill(), /disk failure/);
  assert.deepEqual(f.store.data, before);
  f.store.save = save;
  const reloaded = new ProfileStore({ filePath: file });
  assert.equal(reloaded.find(f.user.token).progress.absorptionKills, 1);
});
test("Царь: старые степени и величие сохранены, смешанные киллы не переносятся", (t) => {
  const file = path.join(temporary(t, "king-legacy"), "profiles.json"), f = fixture();
  Object.assign(f.p().progress, { kills: 20000 });
  f.p().progress.claimed.king = 4;
  f.p().progress.stageSpent.king = 360;
  for (const key of ["absorptionKills", "absorptionVictims", "kingLegacyDegrees"]) delete f.p().progress[key];
  f.p().greatness = 1234;
  fs.writeFileSync(file, JSON.stringify(f.store.data));
  const reloaded = new ProfileStore({ filePath: file }), p = reloaded.find(f.user.token);
  assert.equal(p.greatness, 1234);
  assert.equal(p.progress.claimed.king, 4);
  assert.equal(p.progress.absorptionKills, 0);
  assert.equal(p.progress.stageSpent.king, 0);
  p.progress.absorptionKills = 999;
  rules.applyEvent(p, { type: "absorbed", victimProfileId: "new", gain: 0 }, 1000000);
  assert.equal(p.greatness, 1384);
  assert.equal(p.progress.claimed.king, 5);
  rules.validateProgress(p);
  rules.migrateKingProgress(p);
  assert.equal(p.progress.absorptionKills, 1000);
});

test("Царь: миграция и новая награда восстанавливаются из журнала до контрольного снимка", async (t) => {
  const file = path.join(temporary(t, "king-wal"), "profiles.json"), f = fixture();
  f.p().progress.kills = 70;
  f.p().progress.claimed.king = 2;
  f.p().progress.stageSpent.king = 60;
  for (const key of ["absorptionKills", "absorptionVictims", "kingLegacyDegrees"]) delete f.p().progress[key];
  fs.writeFileSync(file, JSON.stringify(f.store.data));
  const store = new ProfileStore({ filePath: file, journal: true });
  t.after(() => store.close());
  const id = store.find(f.user.token).id;
  const events = Array.from({ length: 300 }, () => ({ profileId: id, type: "absorbed", victimProfileId: randomUUID(), victimDefeated: true, gain: 0 }));
  store.applyArenaProgress("king-stage-three", events, 1000000);
  const key = Object.keys(store.data.profiles)[0], restored = recover(file).data.profiles[key];
  assert.deepEqual(restored.progress, store.find(f.user.token).progress);
  assert.equal(restored.progress.claimed.king, 3);
  assert.equal(restored.greatness, 75);
  assert.equal(JSON.parse(fs.readFileSync(file)).profiles[key].progress.claimed.king, 2);
  await store.close();
  const again = new ProfileStore({ filePath: file });
  assert.equal(again.find(f.user.token).progress.absorptionKills, 300);
  assert.equal(again.find(f.user.token).progress.stageSpent.king, 300);
  again.applyArenaProgress("king-stage-three", events, 1000000);
  assert.equal(again.find(f.user.token).greatness, 75);
});
