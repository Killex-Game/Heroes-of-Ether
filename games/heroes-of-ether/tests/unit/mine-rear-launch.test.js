"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {Arena,radiusForMass}=require('../../src/server/arena/arena-simulation');
const {BOOSTERS}=require('../../src/server/boosters/booster-catalog');
function setup(){
  const a=new Arena({etherCount:0});
  const p=a.addPlayer(0,'owner');Object.assign(p,{x:1000,y:1000,targetX:1600,targetY:1000,stopped:false,protectedUntil:0});
  p.parts=[{id:'body',x:1000,y:1000,mass:1000,radius:radiusForMass(1000)}];
  return {a,p};
}
for(const [mx,my]of [[1,0],[-1,0],[0,1],[0,-1],[1,1]])test(`Mine flies behind movement ${mx}/${my}, irrespective of aim or speed`,()=>{
  for(const speed of [false,true]){
    const {a,p}=setup();p.targetX=p.x+mx*600;p.targetY=p.y+my*600;
    if(speed)p.effects.speed=90000;
    a.combat.prepare(p,BOOSTERS.get('mine'),{aimX:1900,aimY:1800},3000)();
    const s=a.combat.shots[0], n=Math.hypot(mx,my);
    assert.ok(Math.abs(s.dx+mx/n)<1e-9);assert.ok(Math.abs(s.dy+my/n)<1e-9);
    assert.ok((s.x-p.x)*mx+(s.y-p.y)*my<0);
    assert.equal(s.landsAt,3000+BOOSTERS.get('mine').flightMs);
    assert.equal(s.effectBooster.damageFraction,BOOSTERS.get('mine').damageFraction);
  }
});
test('Mine exits from the rear part of a split player; other boosters still follow aim',()=>{
  const {a,p}=setup();p.parts.push({...p.parts[0],id:'rear',x:800});
  a.combat.prepare(p,BOOSTERS.get('mine'),{aimX:1900,aimY:1000},3000)();
  assert.equal(a.combat.shots[0].sourcePartId,'rear');assert.ok(a.combat.shots[0].x<800);
  a.combat.prepare(p,BOOSTERS.get('rocket'),{aimX:1900,aimY:1000},3000)();
  assert.equal(a.combat.shots[1].dx,1);
});
test('A stationary player throws a mine opposite to aim',()=>{
  const {a,p}=setup();p.stopped=true;
  a.combat.prepare(p,BOOSTERS.get('mine'),{aimX:1000,aimY:1500},3000)();
  assert.equal(a.combat.shots[0].dy,-1);
});
