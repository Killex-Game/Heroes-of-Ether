"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const accrual = require("../../src/server/arena/mass-accrual");
const progression = require("../../src/server/progression/experience-progression");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
function fixture(vip = false, premium = false, mass = 50000) {
  const store = new ProfileStore(), opened = store.open(), p = store.find(opened.token);
  p.level = 501;
  p.progress = progression.freshProgress(501);
  p.account = { vipUntil: vip ? 1e9 : 0, premiumUntil: premium ? 1e9 : 0 };
  progression.applyEvent(p, { type: "lifeStarted", lifeId: "life" }, 0);
  const actor = { id: "actor", lifeId: "life", mass, account: { vip, premium } };
  accrual.reset(actor, 0);
  const step = (at, force = false, population = 1) => {
    const event = accrual.sample(actor, at, force, population);
    if (event) progression.applyEvent(p, event, at);
    return event;
  };
  const run = (from, to, population = 1) => {
    let last;
    for (let at = from + 50; at <= to; at += 50) last = step(at, false, population) || last;
    return last;
  };
  return { p, actor, step, run };
}

const round = n => Math.max(0, Math.ceil(n - 0.5));
for (const [vip,premium,factor] of [[false,false,1],[true,false,1],[false,true,2],[true,true,2]]) {
  test('Current mass payout '+vip+'/'+premium,()=>{
    for(const mass of [20,500,501,1500,1550,5000,15000,29999,30000,75000,1000000]) for(const n of [1,17,30]){
      const f=fixture(vip,premium,mass); f.run(0,29950,n);
      assert.equal(f.p.progress.session.xp,0); f.step(30000,false,n);
      assert.equal(f.p.progress.session.xp,round(mass*.001*factor));
      assert.equal(f.p.progress.session.kills,round((mass*.0001+n)*factor));
      progression.validateProgress(f.p);
    }
  });
}
test('Half ties down, above half up, no carry into a later payout',()=>{
  for(const [mass,xp] of [[1499,1],[1500,1],[1501,2],[1550,2],[1600,2]]){
    const f=fixture(false,false,mass); f.run(0,60000); assert.equal(f.p.progress.session.xp,xp*2);
  }
  for(const [mass,kills] of [[4999,1],[5000,1],[5001,2],[5500,2]]){
    const f=fixture(false,false,mass);f.run(0,30000);assert.equal(f.p.progress.session.kills,kills);
  }
});
test('Mass, population and status are sampled at the payout, not averaged',()=>{
  const f=fixture(false,true,20);f.run(0,29950,30);f.actor.mass=50000;f.actor.account={vip:true};
  f.step(30000,false,2);assert.equal(f.p.progress.session.xp,50);assert.equal(f.p.progress.session.kills,7);
  f.actor.mass=10000;f.actor.account={premium:true};f.run(30000,60000,3);
  assert.equal(f.p.progress.session.xp,70);assert.equal(f.p.progress.session.kills,15);
});
test('No catch-up for long pauses, no early payout on death or departure',()=>{
  const f=fixture();f.run(0,29950);assert.equal(f.step(900000),null);assert.equal(f.p.progress.session.xp,0);
  f.step(900050);assert.equal(f.p.progress.session.xp,50);f.step(900100,true);assert.equal(f.actor.massAccrual.observedMs,0);
  f.actor.dead=true;assert.equal(f.step(930000),null);f.actor.dead=false;f.actor.isRemnant=true;assert.equal(f.step(960000),null);
});
test('Duplicate/reordered packets and old lives cannot mint XP; level cap retained',()=>{
  const f=fixture(false,true);const e=f.run(0,30000);const saved=JSON.stringify(f.p.progress);
  progression.applyEvent(f.p,e,30000);progression.applyEvent(f.p,{...e,sequence:2,lifeId:'old'},30000);
  assert.equal(JSON.stringify(f.p.progress),saved);
  f.p.progress.arenaXpTarget=f.p.progress.xp+150;f.run(30000,60000);assert.equal(f.p.progress.session.xp,150);
  const kills=f.p.progress.kills;f.run(60000,90000);assert.equal(f.p.progress.kills,kills);
});
test('Previously persisted v1 units/remainders remain replayable',()=>{
  const f=fixture();const e={type:'massAccrual',lifeId:'life',sequence:1,xpUnits:accrual.XP_DENOMINATOR*1.5,baseXpUnits:0,killUnits:accrual.KILL_DENOMINATOR*1.5};
  progression.applyEvent(f.p,e,1000);assert.equal(f.p.progress.session.xp,1);
  progression.applyEvent(f.p,{...e,sequence:2},2000);assert.equal(f.p.progress.session.xp,3);assert.equal(f.p.progress.session.kills,3);
  assert.throws(()=>progression.applyEvent(f.p,{...e,ruleVersion:999,sequence:3},3000));
});
test('Absorptions are 3/6/3/6 XP; natural kills do not count as actual defeats',()=>{
  for(const [vip,premium,xp] of [[false,false,3],[true,false,6],[false,true,3],[true,true,6]]){
    const f=fixture(vip,premium);progression.applyEvent(f.p,{type:'absorbed',victimProfileId:'v',lifeId:'v',gain:20},1000);
    assert.equal(f.p.progress.session.xp,xp);f.run(0,30000);assert.equal(f.p.progress.session.realAbsorptions,1);
  }
});
test('Room population excludes bots, dead players and remnants, counts split human once',()=>{
  const arena=new Arena({etherCount:0,world:{width:100000,height:100000}});
  for(let i=0;i<5;i++){const p=arena.addPlayer(0,'p'+i);Object.assign(p,{mass:30000,radius:radiusForMass(30000),x:1000+i*5000,y:1000,targetX:1000+i*5000,targetY:1000,stopped:true,nextMassDecayAt:Infinity,protectedUntil:Infinity});}
  arena.players.get('p2').isTestBot=true;arena.players.get('p3').dead=true;Object.assign(arena.players.get('p4'),{isRemnant:true,removeAt:1e9});
  assert.equal(arena.activeHumanCount(),2);
  const p=arena.players.get('p0');p.parts=[10000,20000].map((mass,i)=>({id:'part'+i,mass,radius:radiusForMass(mass),x:1000+i*200,y:1000,vx:0,vy:0,mergeAt:1e9}));arena.syncParts(p);
  for(let at=50;at<=30000;at+=50)arena.step(at);
  const e=arena.progressEvents.find(e=>e.type==='massAccrual'&&e.playerId===p.id);assert.equal(e.xpUnits/accrual.XP_DENOMINATOR,30);assert.equal(e.killUnits/accrual.KILL_DENOMINATOR,5);
});
test('Gift, potion and accessory XP effects still apply to natural awards',()=>{
  const f=fixture(false,true,10000);f.actor.giftModifiers={xp:.5};f.p.wardrobeState.legacyNovice=true;f.p.outfit={hat:'novice_hat'};
  f.run(0,30000);assert.equal(f.p.progress.session.xp,11);assert.equal(f.p.progress.session.kills,4);
});
