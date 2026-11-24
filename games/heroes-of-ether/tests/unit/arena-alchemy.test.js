"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { Arena, radiusForMass, massLimitForLevel } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
const effects = require("../../src/server/arena/alchemy-effects");
const pets = require("../../src/server/pets/arena-pets");
function fixture() {
  const arena = new Arena({ etherCount: 0, random: () => 0.5 });
  const p = arena.addPlayer(0, "one");
  Object.assign(p, { profileId: "profile", level: 30, x: 500, y: 500, protectedUntil: 0 });
  const use = (id, at = 3000, extra = {}) => arena.prepareBooster(p.id,
    { boosterId: id, spawnSerial: p.spawnSerial, ...extra }, at)();
  return { arena, p, use };
}
test("up to three distinct potions coexist for a life and reset on respawn", () => {
  const { arena, p, use } = fixture();
  const apply = arena.prepareBooster(p.id, { boosterId: "alchemy_strength", spawnSerial: p.spawnSerial }, 3000);
  assert.equal(p.potion, null);
  apply(); assert.equal(p.potion.id, "strength");
  use("alchemy_swiftness");
  use("alchemy_knowledge");
  assert.deepEqual(p.potion.ids, ["strength", "swiftness", "knowledge"]);
  assert.throws(() => use("alchemy_strength"));
  assert.throws(() => use("alchemy_satiety"));
  assert.throws(() => arena.prepareBooster(p.id, { boosterId: "alchemy_swiftness", spawnSerial: 0 }, 3000));
  arena.resetPlayer(p, 4000); assert.equal(p.potion, null);
  use("alchemy_swiftness", 7000); assert.equal(p.potion.id, "swiftness");
});
test("Strength doubles successful mass, shared ten-second cooldown, no loss on failed shot", () => {
  const { p, use } = fixture(); use("alchemy_strength");
  assert.throws(() => use("hook", 3000), /направление/);
  assert.equal(p.potion.readyAt, 3000);
  const initial = p.mass; use("ice_cream", 3000); assert.equal(p.mass, initial + 400);
  assert.throws(() => use("ice_cream", 3499), /Подожди/);
  use("ice_cream", 3500); assert.equal(p.mass, initial + 600);
  use("ice_cream", 13000); assert.equal(p.mass, initial + 1000);
  assert.equal(p.boosterUses.ice_cream, 3);
});
test("Strength respects mass caps, Sponge does not spend charge", () => {
  const { arena, p, use } = fixture(); use("alchemy_strength");
  p.mass = massLimitForLevel(p.level) - 1; p.radius = radiusForMass(p.mass);
  use("meat"); assert.equal(p.mass, massLimitForLevel(p.level));
  assert.throws(() => use("meat", 14000), /предел массы/);
  arena.splitPlayer(p, { sequence: 1, spawnSerial: p.spawnSerial }, 14000);
  const before = p.potion.readyAt; use("sponge", 14000);
  assert.equal(p.potion.readyAt, before); assert.ok(arena.bodies(p).length <= 16);
});
test("projectile and hook speed/range, beneficial and negative duration, passive neutral path", () => {
  const { p, use } = fixture();
  const hook = BOOSTERS.get("hook"); assert.equal(effects.prepare(p, hook, 3000).booster, hook);
  use("alchemy_strength");
  const power = effects.prepare(p, hook, 3000).booster;
  assert.equal(power.maxDistance, 1500); assert.equal(power.flightSpeed, 400); assert.equal(power.alchemyPullFactor, 2);
  assert.equal(effects.prepare(p, BOOSTERS.get("speed"), 3000).booster.multiplier, 2);
  assert.equal(effects.prepare(p, BOOSTERS.get("sphere"), 3000).booster.durationMs, 60000);
  p.potion = { id: "clarity", readyAt: 0 };
  assert.equal(effects.incoming(p, BOOSTERS.get("freeze")).durationMs, 8000);
});
test("natural ether excludes ejected mass and potion bonuses, fraction bonus accumulates", () => {
  const { arena, p, use } = fixture(); use("alchemy_prosperity");
  arena.ether = Array.from({ length: 4 }, (_, i) => ({ id: "n"+i, x: 500, y: 500, value: 1, radius: 5 }));
  arena.ether.push({ id: "w", x: 500, y: 500, value: 5, radius: 5, ejected: true });
  const before = p.mass; arena.collectEther(4000);
  assert.equal(p.mass - before, 10); assert.equal(p.alchemyNatural, 4);
  const events = arena.progressEvents.filter(e => e.type === "alchemyGather");
  assert.equal(events.length, 1); assert.equal(events[0].natural, 4);
  arena.collectEther(4000); assert.equal(arena.progressEvents.filter(e => e.type === "alchemyGather").length, 1);
});
test("pickups are bounded, awarded once, snapshot immutable, disappear when event ends", () => {
  const { arena, p } = fixture(), field = arena.alchemyField;
  field.setRun({ id: "event1" }, 3000); assert.equal(field.items.length, 24);
  field.items = [{ id: "alchemy:test", alchemyIngredient: "leaf", x: 500, y: 500, radius: 14 }]; field.index = null;
  const snapshot = JSON.stringify(field.snapshot());
  const old = field.snapshot(); arena.collectEther(3000);
  assert.equal(p.alchemyIngredients.leaf, 1); assert.equal(field.items.length, 0);
  assert.equal(JSON.stringify(old), snapshot);
  arena.collectEther(3000); assert.equal(p.alchemyIngredients.leaf, 1);
  const empty = field.snapshot(); Object.freeze(empty);
  field.tick(4000); assert.equal(field.items.length, 2); assert.equal(empty.length, 0);
  field.setRun(null, 5000); field.tick(6000); assert.equal(field.items.length, 0);
});
test("pet carrot shares Strength charge; a repeated request cannot apply twice", () => {
  const { arena, p, use } = fixture(); use("alchemy_strength");
  p.pet = { id: "zaya", stock: { carrot: 2 }, sequence: 0, receipts: new Map(), readyAt: {}, stats: {} };
  const message = { requestId: "pet-request-0001", sequence: 1, ability: "secondary", spawnSerial: p.spawnSerial };
  const before = p.mass;
  pets.use(arena, p, message, 3000); assert.equal(p.mass, before + 1000);
  assert.equal(pets.use(arena, p, message, 3000).replay, true); assert.equal(p.mass, before + 1000);
  use("ice_cream", 3000); assert.equal(p.mass, before + 1200);
});

test("alchemy pickups survive compact state deltas, and only the owner receives potion state", () => {
  const {arena,p,use}=fixture();use("alchemy_strength");
  arena.alchemyField.setRun({id:"test"},3000);
  const wire=require("../../public/shared/arena-wire"),{ArenaStateStream}=require("../../src/server/arena/state-stream");
  for(const playerId of [p.id,"other"]){
    const packets=[],ws={protocol:wire.PROTOCOL,playerId,readyState:1,bufferedAmount:0};
    const stream=new ArenaStateStream(ws,(_,json)=>packets.push(JSON.parse(json)),()=>3000),decoder=new wire.Decoder();
    for(let tick=0;tick<2;tick++){
      arena.tick=tick;const state=arena.snapshot(3000+tick*50);stream.publish(state);
      const decoded=decoder.decode(packets.at(-1));assert.deepEqual(decoded.hazards,state.hazards);
      assert.equal(decoded.players.find(row=>row.id===p.id).potion?.id,playerId===p.id?"strength":undefined);
      stream.acknowledge(stream.sequence);
    }
  }
});

test("XP potion uses the effect active at payout, never bonus kills or unplayed pauses", () => {
  const {arena,p,use}=fixture(), accrual=require("../../src/server/arena/mass-accrual");
  p.mass=10000;p.radius=radiusForMass(p.mass);accrual.reset(p,0);
  for(let at=50;at<=15000;at+=50)arena.accrueMass(p,at);
  use("alchemy_knowledge",15000);
  for(let at=15050;at<=30000;at+=50)arena.accrueMass(p,at);
  const first=arena.progressEvents.find(e=>e.type==="massAccrual");
  assert.equal(first.xpUnits/accrual.XP_DENOMINATOR,11.5);
  assert.equal(first.killUnits/accrual.KILL_DENOMINATOR,2);
  arena.progressEvents=[];
  for(let at=30050;at<=60000;at+=50)arena.accrueMass(p,at);
  assert.equal(arena.progressEvents[0].xpUnits/accrual.XP_DENOMINATOR,11.5);
  arena.progressEvents=[];arena.accrueMass(p,90000);assert.equal(arena.progressEvents.length,0);
});

test("passive potion modifiers preserve neutral behavior and include cake, pickups and pet gifts",()=>{
  const {arena,p,use}=fixture();use("alchemy_longevity");
  assert.equal(effects.prepare(p,BOOSTERS.get("cake"),3000).booster.durationMs,BOOSTERS.get("cake").durationMs*1.25);
  assert.equal(effects.prepare(p,BOOSTERS.get("poison"),3000).booster.durationMs,BOOSTERS.get("poison").durationMs);
  p.potion={id:"gatherer",readyAt:0};arena.alchemyField.setRun({id:"run"},3000);
  arena.alchemyField.items=Array.from({length:3},(_,i)=>({id:"i"+i,alchemyIngredient:"leaf",x:500,y:500,radius:14}));arena.alchemyField.index=null;
  arena.collectEther(3000);assert.equal(p.alchemyIngredients.leaf,4);
  p.potion={id:"magnetism",readyAt:0};
  const x=p.x+p.radius*1.2+5;
  arena.ether=[{id:"natural",x,y:p.y,radius:5,value:1},{id:"ejected",x,y:p.y,radius:5,value:5,ejected:true}];
  arena.collectEther(4000);assert.deepEqual(arena.ether.map(i=>i.id),["ejected"]);
  p.potion={id:"vigor",readyAt:0};assert.equal(effects.prepare(p,{kind:"mass",amount:500},5000).booster.amount,625);
  p.potion={id:"fortitude",readyAt:0};assert.equal(pets.damageFactor(p),.8);assert.equal(effects.incoming(p,BOOSTERS.get("freeze")).durationMs,7000);
});
