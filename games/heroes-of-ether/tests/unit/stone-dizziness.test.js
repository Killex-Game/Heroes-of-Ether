"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {Arena,speedForMass}=require('../../src/server/arena/arena-simulation');
const {BOOSTERS}=require('../../src/server/boosters/booster-catalog');
const view=require('../../public/shared/arena-camera-and-layout');
test('Chaotic display trajectories differ per object, stay bounded and do not survive zero strength',()=>{
  for(let t=0;t<5000;t+=17)for(const seed of [1,7,19,100,999]){
    const d=view.dizzyOffset(seed,t,1);
    assert(Math.abs(d.x)<=28&&Math.abs(d.y)<=26&&Math.abs(d.angle)<=.16);
    const off=view.dizzyOffset(seed,t,0);assert.equal(off.x===0&&off.y===0&&off.angle===0,true);
  }
  assert.notDeepEqual(view.dizzyOffset(1,2000),view.dizzyOffset(7,2000));
});
test('Stone allows authoritative confused movement for five seconds and leaves Web immobilization intact',()=>{
  const arena=new Arena({etherCount:0,world:{width:10000,height:10000}}),p=arena.addPlayer(0,'p');
  Object.assign(p,{x:5000,y:5000,targetX:9000,targetY:5000,stopped:false,protectedUntil:0});
  const a=arena.addPlayer(0,'a');a.protectedUntil=0;
  const shot={ownerId:a.id,ownerLife:a.lifeId,boosterId:'stone',x:p.x,y:p.y,dx:1,dy:0,launchedAt:4000};
  arena.combat.impact(shot,p,5000);
  assert.equal(p.effects.stone,10000);assert.equal(p.stopped,false);assert.equal(arena.hasEffect(p,'root',5000),false);
  const target=p.targetX;arena.moveParts(p,5500,1);
  assert(Math.abs(p.y-5000)>0.1);assert(Math.abs(Math.hypot(p.x-5000,p.y-5000)-speedForMass(p.mass)*.05)<1e-8);
  assert.equal(p.targetX,target);assert.equal(p.targetY,5000);
  p.effects.web=9000;const frozen={x:p.x,y:p.y};arena.moveParts(p,6000,1);assert.deepEqual({x:p.x,y:p.y},frozen);
  p.targetY=p.y;const y=p.y;arena.moveParts(p,10000,1);assert.equal(p.y,y);assert(p.x>frozen.x);
  arena.resetPlayer(p,11000);assert(!p.effects.stone);
  assert.equal(BOOSTERS.get('stone').durationMs,5000);
});
test('Pointer mapping remains correct without a spin and for independent rotated cameras',()=>{
  for(const rotation of [0,-Math.PI,Math.PI/2,3*Math.PI/2,4*Math.PI]){
    const camera={x:200,y:300,scale:2,rotation},w=900,h=500,x=400,y=350;
    const dx=(x-camera.x)*camera.scale,dy=(y-camera.y)*camera.scale;
    const px=w/2+dx*Math.cos(rotation)-dy*Math.sin(rotation),py=h/2+dx*Math.sin(rotation)+dy*Math.cos(rotation);
    const actual=view.screenToWorld(px,py,camera,w,h);assert(Math.abs(actual.x-x)<1e-10);assert(Math.abs(actual.y-y)<1e-10);
  }
});
test('Stone retains the exact drift envelope without rotating the camera',()=>{
  const state={rotation:0};
  for(let remaining=5000;remaining>0;remaining-=10){
    const strength=view.dizzyStrength(remaining,false,state);
    assert.equal(strength,Math.max(0,Math.min(1,(5000-remaining)/180,remaining/350)));
    assert.equal(state.rotation,0);
  }
  assert.equal(view.dizzyStrength(0,false,state),0);
  assert.equal(view.dizzyStrength(5000,false,state),0);
  assert.equal(view.dizzyRotation(4000,false,state),0,'Cached clients also stay upright');
});
test('Repeated hits retain drift timing; reduced motion and expiry clear it',()=>{
  const state={};view.dizzyStrength(5000,false,state);assert.equal(view.dizzyStrength(3000,false,state),1);
  assert.equal(view.dizzyStrength(5000,false,state),0);assert.equal(view.dizzyStrength(4820,false,state),1);
  assert.equal(view.dizzyStrength(175,false,state),.5);assert.equal(view.dizzyStrength(0,false,state),0);
  view.dizzyStrength(5000,false,state);assert.equal(view.dizzyStrength(2500,false,state),1);
  assert.equal(view.dizzyStrength(2400,true,state),0);assert.equal(state.dizzyRemaining,0);
});
