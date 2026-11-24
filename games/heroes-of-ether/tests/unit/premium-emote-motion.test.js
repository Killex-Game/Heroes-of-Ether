"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const {Renderer, placement, motion, PREMIUM_SIZE} = require("../../public/arena/emote-renderer");
test("approved Premium motion keeps the artwork, +20% size and emotion-specific keyframes", () => {
  const body = {x: 200, y: 200, radius: 100};
  const basic = placement({}, body, 1), premium = placement({}, body, 1, PREMIUM_SIZE);
  assert.equal(premium.width, basic.width * 1.2);
  assert.equal(premium.x + premium.width / 2, body.x);
  const sample = {};
  assert.equal(motion(1, .22, sample).angle, -7 * Math.PI / 180);
  assert.equal(motion(3, .24, sample).lift, -7);
  assert.equal(motion(5, .30, sample).scale, 1.06);
  assert.equal(motion(9, 0, sample).alpha, 0);
  assert.equal(motion(9, 1, sample).alpha, 0);
  for (let i=1;i<=9;i++) assert.deepEqual(motion(i,.30,{},true), {scale:1,angle:0,lift:0,alpha:1});
});
test("motion is bounded at all ages and reuses its output", () => {
  for(let i=1;i<=9;i++) for(let ms=-100;ms<=3100;ms+=5) {
    const out={}, m=motion(i,ms/3000,out); assert.equal(m,out);
    assert(m.alpha>=0&&m.alpha<=1); assert(m.scale>=.85&&m.scale<=1.06);
    assert(Math.abs(m.angle)<=7*Math.PI/180); assert(m.lift>=-7&&m.lift<=8);
  }
});
test("Premium split cells share the frame sample and restore Canvas state; expiry still suppresses drawing", () => {
  let loaded=0,drawn=0;
  const r=new Renderer(()=>{loaded++;return {complete:true,naturalWidth:128};});
  const stack=[],ctx={globalAlpha:.4,save(){stack.push(this.globalAlpha)},restore(){this.globalAlpha=stack.pop()},
    translate(){},rotate(){},scale(){},drawImage(){drawn++;}};
  r.receive({playerId:"p",spawnSerial:1,index:1,variant:"pets"},0);
  const p={id:"p",spawnSerial:1},body={x:50,y:100,radius:40};
  for(let i=0;i<16;i++)r.draw(ctx,p,body,1,660);
  assert.equal(loaded,2);assert.equal(drawn,16);assert.equal(ctx.globalAlpha,.4);assert.equal(stack.length,0);
  assert.equal(r.active.get("p").sampledAt,660);
  r.draw(ctx,p,body,1,3000);assert.equal(drawn,16);
  r.prune(3000);assert.equal(r.active.size,0);
});
test("software-rendering budget keeps size and motion without additional rotated copies", () => {
  const r=new Renderer(()=>({complete:true,naturalWidth:960}));
  r.receive({playerId:'p',spawnSerial:1,index:1,variant:'pets'},0);
  let clock=0;r.clock=()=>clock+=3;
  const calls=[],ctx={globalAlpha:1,drawImage(...args){calls.push(args)}};
  const p={id:'p',spawnSerial:1},body={x:10,y:100,radius:100};
  r.draw(ctx,p,body,1,660);r.draw(ctx,p,body,1,660);
  assert.equal(calls[0].length,9);assert.equal(calls[1].length,5);
  assert.equal(calls[1][3],76.8);assert.equal(ctx.globalAlpha,1);
  assert(calls[1][1]<body.x-76.8/2,'The simplified shake is still visibly moving');
  r.draw(ctx,p,body,1,661);assert.equal(calls[2].length,9,'Budget resets next frame');
});
