"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const catalog = require("../../public/shared/accessory-catalog");
const abilities = require("../../src/server/arena/accessory-abilities");
const passives = require("../../src/server/arena/accessory-passives");
const alchemy = require("../../src/server/arena/alchemy-effects");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
function setup(hat, bow) {
  const arena = new Arena({ etherCount: 0 });
  const p = arena.addPlayer(0, "title");
  Object.assign(p, { level: 100, outfit: { hat, bow }, protectedUntil: 0 });
  const profile = { outfit: p.outfit, honors: { claimed: 10 } };
  abilities.start(p, profile); passives.start(arena, p, 0);
  return { arena, p, profile };
}
test("all title E stocks are per life, share the item cooldown, and cannot be forged or refreshed", () => {
  for (const item of catalog.items.filter(i => i.titleDegree && i.ability)) {
    const { arena, p, profile } = setup(item.id);
    const use = at => abilities.use(arena, p, { accessoryId: item.id, spawnSerial: p.spawnSerial,
      requestId: randomUUID(), aimX: p.x + 300, aimY: p.y }, at);
    const booster = BOOSTERS.get(item.ability.boosterId);
    let at = 1000;
    for (let n = item.ability.count; n > 0; n--, at += booster.cooldownMs) {
      assert.equal(use(at).remaining, n - 1, item.id);
      abilities.start(p, profile);
      assert.equal(abilities.snapshot(p)[0].count, n - 1);
      assert.throws(() => arena.prepareBooster(p.id, { boosterId: booster.id, spawnSerial: p.spawnSerial,
        aimX: p.x + 300, aimY: p.y }, at + booster.cooldownMs - 1), /Подожди/);
    }
    assert.throws(() => use(at), /использован/);
    const stranger = {};
    abilities.start(stranger, { outfit: profile.outfit, honors: { claimed: 1 } });
    assert.deepEqual(abilities.snapshot(stranger), []);
    arena.resetPlayer(p, at); abilities.start(p, profile); passives.start(arena, p, at);
    assert.equal(abilities.snapshot(p)[0].count, item.ability.count);
  }
});
test("title speed is not clipped to the small conditional bonus cap; positive and negative effects apply once", () => {
  const { arena, p } = setup("title_boss_hat", "title_boss_bow");
  assert.equal(passives.speed(p, 1000), .65);
  const before = p.mass;
  arena.prepareBooster(p.id, { boosterId: "meat", spawnSerial: p.spawnSerial }, 1000)();
  assert.equal(p.mass - before, 1155);
  const freeze = passives.incoming(p, BOOSTERS.get("freeze"));
  assert.equal(freeze.durationMs, 3500);
  assert.ok(Math.abs(freeze.multiplier - .895) < 1e-10);
  const master = setup("title_master_hat");
  master.arena.prepareBooster(master.p.id, { boosterId: "fire", spawnSerial: master.p.spawnSerial,
    aimX: master.p.x + 300, aimY: master.p.y }, 1000)();
  assert.equal(master.arena.combat.shots[0].effectBooster.fireFraction, .625);
});
test("spawn mass is granted once and periodic mass uses observed live time, with no dead or stalled payout", () => {
  const { arena, p } = setup("title_prince_hat");
  assert.equal(p.mass, 520);
  passives.start(arena, p, 1000); assert.equal(p.mass, 520);
  const king = setup("title_king_hat");
  for (let at = 50; at <= 60000; at += 50) passives.tick(king.arena, king.p, at);
  assert.equal(king.p.mass, 770);
  passives.tick(king.arena, king.p, 120000); assert.equal(king.p.mass, 770);
  king.p.dead = true;
  for (let at = 120050; at <= 180000; at += 50) passives.tick(king.arena, king.p, at);
  assert.equal(king.p.mass, 770);
});
test("royal hats double potion strength and duration bonuses without doubling pulse frequency", () => {
  const { p } = setup("title_king_hat");
  p.potion = { ids: ["strength", "swiftness", "longevity"], id: "strength", readyAt: 0 };
  assert.equal(alchemy.modifiers(p).speed, .16);
  assert.equal(alchemy.modifiers(p).positiveDuration, .5);
  const cast = alchemy.prepare(p, BOOSTERS.get("speed"), 1000);
  assert.equal(cast.booster.multiplier, 3);
  assert.equal(cast.booster.durationMs, 90000);
  alchemy.commit(p, cast, 1000); assert.equal(p.potion.readyAt, 11000);
  p.potion = { id: "gatherer" };
  assert.equal(alchemy.modifiers(p).ingredientExtra, 2);
  assert.equal(alchemy.modifiers(p).ingredientEvery, 3);
});

test("professional hat grants XP for final opponents only, once despite fragments and retries", () => {
  const { ProfileStore } = require('../../src/server/profiles/profile-store');
  const store = new ProfileStore({now:()=>1000000}), user=store.open();
  const p=store.find(user.token);p.grantedAccessories=['title_pro_hat'];p.outfit={hat:'title_pro_hat',bow:null};
  store.startLife(p.id,'pro-life');
  const events=[];
  for(let i=0;i<4;i++){
    const victimProfileId=randomUUID();
    events.push({type:'absorbed',profileId:p.id,victimProfileId,victimDefeated:false,gain:10,lifeId:'enemy-'+i});
    events.push({type:'absorbed',profileId:p.id,victimProfileId,victimDefeated:true,gain:10,lifeId:'enemy-'+i});
    events.push({...events.at(-1)});
  }
  const id=randomUUID(),before=structuredClone(store.find(user.token)),save=store.save;
  store.save=()=>{throw Error('title XP write failed');};
  assert.throws(()=>store.applyArenaProgress(id,events,1001000),/write failed/);
  assert.deepEqual(store.find(user.token),before);store.save=save;
  store.applyArenaProgress(id,events,1001000);
  assert.equal(store.find(user.token).progress.session.xp,15);
  assert.equal(store.find(user.token).progress.absorptionKills,4);
  store.applyArenaProgress(id,events,1001000);
  assert.equal(store.find(user.token).progress.session.xp,15);
  store.applyArenaProgress(randomUUID(),events,1001001);
  assert.equal(store.find(user.token).progress.session.xp,15);
});
