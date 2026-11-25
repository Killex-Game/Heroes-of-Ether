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
  for(const rotation of [-Math.PI,Math.PI/2,3*Math.PI/2,4*Math.PI]){
  const camera={x:200,y:300,scale:2,rotation},w=900,h=500,x=400,y=350;
  const dx=(x-camera.x)*camera.scale,dy=(y-camera.y)*camera.scale;
  const px=w/2+dx*Math.cos(camera.rotation)-dy*Math.sin(camera.rotation),py=h/2+dx*Math.sin(camera.rotation)+dy*Math.cos(camera.rotation);
  const actual=view.screenToWorld(px,py,camera,w,h);assert(Math.abs(actual.x-x)<1e-10);assert(Math.abs(actual.y-y)<1e-10);
  }
});
test('Stone rotates the scene twice and ends upright without a final visual jump',()=>{
  const state={};let previous=0,maxStep=0;
  for(let remaining=5000;remaining>0;remaining-=10){const angle=view.dizzyRotation(remaining,false,state);maxStep=Math.max(maxStep,Math.abs(angle-previous));previous=angle;}
  assert(previous>Math.PI*3.99,'Two visible rotations, not a small wobble');
  assert(maxStep<0.08,'Continuous motion between rendered frames');
  assert(Math.abs(Math.sin(previous))<0.001);assert(Math.cos(previous)>0.999);
  assert.equal(view.dizzyRotation(0,false,state),0);
  assert.equal(view.dizzyRotation(5000,false,state),0,'A new entry starts upright');
});
test('A repeated stone extends the rotation without snapping; reduced motion clears retained orientation',()=>{
  const state={};view.dizzyRotation(5000,false,state);const before=view.dizzyRotation(3000,false,state);
  assert(before>Math.PI);assert.equal(view.dizzyRotation(5000,false,state),before);
  const next=view.dizzyRotation(4980,false,state);assert(Math.abs(next-before)<.01);
  for(let r=4900;r>0;r-=10)view.dizzyRotation(r,false,state);
  assert(Math.cos(state.dizzyAngle)>.999);assert.equal(view.dizzyRotation(0,false,state),0);
  view.dizzyRotation(5000,false,state);assert(view.dizzyRotation(2500,false,state)>0);
  assert.equal(view.dizzyRotation(2400,true,state),0);assert.equal(state.dizzyRemaining,0);
});
