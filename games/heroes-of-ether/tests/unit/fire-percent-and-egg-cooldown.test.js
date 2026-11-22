"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS, publicCatalog } = require("../../src/server/boosters/booster-catalog");
const pets = require("../../src/server/pets/arena-pets");
const rules = require("../../public/shared/pet-rules");
const { cooldown } = require("../../public/shared/booster-cooldowns");
function scene(mass = 10000) {
  const arena = new Arena({ etherCount: 0 });
  const a = arena.addPlayer(0, "a"), b = arena.addPlayer(0, "b");
  for (const [p, x] of [[a,1000],[b,1500]]) Object.assign(p, {
    mass, radius: radiusForMass(mass), level: 501, protectedUntil: 0,
    x, y: 2000, targetX: x, targetY: 2000,
  });
  return { arena, a, b };
}
function pet(p, id, games, active = true) {
  p.pet = { id, stats: rules.stats(id, games), vitalityMs: active ? 10000 : 0,
    stock: {fire: 10}, sequence: 0, readyAt: {}, receipts: new Map() };
}
function hit(s, source, now = 5000) {
  const msg = { spawnSerial: s.a.spawnSerial, aimX: 2000, aimY: 2000 };
  if (source === "pet") pets.use(s.arena,s.a,{...msg,ability:"fire",sequence:1,requestId:"fire-test-one"},now);
  else s.arena.prepareBooster(s.a.id,{...msg,boosterId:"fire"},now)();
  const shot = s.arena.combat.shots.at(-1);
  s.arena.combat.impact(shot,s.b,now,s.b);
  return shot;
}
test("Pet and clan fire use identical percentages at every level, including exhausted pets", () => {
  for (const id of ["manya", "drakosha"]) for (const games of [0,...rules.thresholds]) {
    for (const active of [true,false]) for (const source of ["pet","clan"]) {
      const s=scene(); pet(s.a,id,games,active);
      const percent=active?rules.stats(id,games).firePercent:50;
      hit(s,source);
      assert.equal(s.b.mass,10000-100*percent,`${id}/${games}/${active}/${source}`);
      assert.equal(s.b.dead,false);
    }
  }
});
test("Fire applies gift strength as a percentage and shares resistance and potion multipliers", () => {
  for (const source of ["pet","clan"]) for (const [outgoing,incoming,remaining] of [
    [1.25,1,1250], [0.75,1,4750], [1,.75,4750], [1,1.25,1250], [1.25,.75,3438],
  ]) {
    const s=scene();pet(s.a,"manya",5000);
    s.a.giftModifiers={outgoing};s.b.giftModifiers={incoming};
    const shot=hit(s,source);assert.equal(s.b.mass,remaining);assert.equal(shot.speed,200);
    assert.equal(shot.maxDistance,600);
  }
  for (const source of ["pet","clan"]) {
    const s=scene();pet(s.a,"manya",5000);pet(s.b,"manya",5000);
    s.b.potion={accessoryFactor:1,modifiers:{resistance:.2}};
    s.a.potion={id:"test-pulse",readyAt:0,accessoryFactor:1,modifiers:{pulseMs:10000}};
    hit(s,source); // 70% * 2 * 85% * 80% = 95.2%.
    assert.equal(s.b.mass,480);assert.equal(s.b.dead,false);
  }
});
test("Fire destroys parts at or below 300 before or after damage without duplicate death rewards", () => {
  for (const source of ["pet","clan"]) for (const mass of [2,299,300,301,599,600,601,602]) {
    const s=scene(mass);pet(s.a,"drakosha",0);hit(s,source);
    const dead=mass<=600;
    assert.equal(s.b.dead,dead,`${source}/${mass}`);
    if(!dead) assert.equal(s.b.mass,mass-Math.floor(mass/2));
    assert.equal(s.arena.combatEvents.filter(e=>e.type==="burned").length,dead?1:0);
    if(dead) {s.arena.boosterEffects.burn(s.b,s.b,5100);assert.equal(s.arena.combatEvents.length,1);}
  }
  const s=scene();pet(s.a,"manya",5000);s.a.giftModifiers={outgoing:1.25};
  s.a.potion={id:"test-pulse",readyAt:0,accessoryFactor:1,modifiers:{pulseMs:10000}};
  hit(s,"pet");assert.equal(s.b.dead,true);
});
test("Fire changes only the hit part; spawn protection still blocks both sources", () => {
  for(const source of ["pet","clan"]) {
    const s=scene();pet(s.a,"drakosha",0);
    s.b.parts=[{id:s.b.mainPartId,mass:600,x:1500,y:2000,radius:radiusForMass(600)},
      {id:"other",mass:2000,x:2500,y:2000,radius:radiusForMass(2000)}];
    s.arena.syncParts(s.b);
    const shot=s.arena.combat.prepare(s.a,BOOSTERS.get("fire"),{aimX:2000,aimY:2000},5000);shot();
    s.arena.combat.impact(s.arena.combat.shots.at(-1),s.b,5000,s.b.parts[0]);
    assert.equal(s.b.mass,2000);assert.equal(s.b.dead,false);assert.equal(s.arena.bodies(s.b).length,1);
    const protectedScene=scene();pet(protectedScene.a,"drakosha",0);protectedScene.b.protectedUntil=6000;
    hit(protectedScene,source);assert.equal(protectedScene.b.mass,10000);
  }
});
test("Egg alone retains a ten-second cooldown and finishes the last growth tick before reuse", () => {
  const {arena,a}=scene(1000),message={boosterId:"easter_egg",spawnSerial:a.spawnSerial};
  const prepare=(now,accessory=false)=>arena.prepareBooster(a.id,message,now,{accessory});
  const commit=prepare(5000);assert.equal(a.boosterItemReadyAt.easter_egg,undefined);
  commit();assert.equal(a.boosterItemReadyAt.easter_egg,15000);
  const uses=a.boosterUses.easter_egg;
  for(const accessory of [false,true])assert.throws(()=>prepare(14999,accessory),/Подожди/);
  assert.equal(a.boosterUses.easter_egg,uses);
  const catalog=publicCatalog(),egg=catalog.items.find(x=>x.id==="easter_egg");
  const snap=arena.snapshot(6000).players.find(p=>p.id===a.id);
  snap.effects.find(e=>e.id==="easter_egg").remainingMs=20000;
  assert.deepEqual(cooldown(egg,snap,1234,catalog.rules),{ms:7766,duration:10000});
  assert.equal(cooldown(egg,snap,9000,catalog.rules).ms,0);
  arena.prepareBooster(a.id,{...message,boosterId:"speed"},6000)();
  assert.throws(()=>arena.prepareBooster(a.id,{...message,boosterId:"speed"},6499),/Подожди/);
  assert.doesNotThrow(()=>arena.prepareBooster(a.id,{...message,boosterId:"speed"},6500));
  prepare(15000)();assert.equal(a.mass,1250);assert.equal(a.boosterItemReadyAt.easter_egg,25000);
  arena.boosterEffects.tick(a,25000);assert.equal(a.mass,1500);
  arena.resetPlayer(a,26000);assert.equal(a.boosterItemReadyAt.easter_egg,undefined);
});
