"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {Arena,speedForMass}=require('../../src/server/arena/arena-simulation');
const {BOOSTERS}=require('../../src/server/boosters/booster-catalog');
const view=require('../../public/shared/arena-camera-and-layout');
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
test('Dizzy camera expires smoothly, respects reduced motion and inverts pointer coordinates',()=>{
  for(const r of [-1,0,5000,6000])assert.equal(view.dizzyRotation(r),0);
  assert.notEqual(view.dizzyRotation(4000),0);assert.equal(view.dizzyRotation(4000,true),0);
  const camera={x:200,y:300,scale:2,rotation:.14},w=900,h=500,x=400,y=350;
  const dx=(x-camera.x)*camera.scale,dy=(y-camera.y)*camera.scale;
  const px=w/2+dx*Math.cos(camera.rotation)-dy*Math.sin(camera.rotation),py=h/2+dx*Math.sin(camera.rotation)+dy*Math.cos(camera.rotation);
  const actual=view.screenToWorld(px,py,camera,w,h);assert(Math.abs(actual.x-x)<1e-10);assert(Math.abs(actual.y-y)<1e-10);
});
