"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const view = require("../../public/shared/arena-camera-and-layout");

function launch(mass, direction, nearWall = false) {
  const arena = new Arena({ etherCount: 0, world: { width: 16000, height: 16000 } });
  const p = arena.addPlayer(0, "jump");
  const x = nearWall ? arena.world.width - radiusForMass(mass) : 8000;
  Object.assign(p, { x, y: 8000, targetX: x + direction * 5000, targetY: 8000,
    mass, radius: radiusForMass(mass), stopped: false });
  arena.handleInput(p.id, { type: "split", sequence: 1, spawnSerial: p.spawnSerial }, 5000);
  return { arena, p, x };
}
test("Manual launch leaves the source advancing toward the target at every step", () => {
  for (const mass of [100, 1000, 5000, 20000]) for (const direction of [-1, 1]) {
    const { arena, p, x } = launch(mass, direction);
    const [parent, child] = p.parts;
    assert.equal(child.birth.parentId, parent.id);
    let previous = x;
    for (let step = 1; step <= 13; step++) {
      arena.moveParts(p, 5000 + step * 50, 1);
      assert((parent.x - previous) * direction >= 0);
      assert((child.x - parent.x) * direction > 0);
      assert.equal(parent.mass + child.mass, mass);
      previous = parent.x;
    }
  }
});
test("Manual launch at the wall keeps both circles inside and resolves their overlap", () => {
  const { arena, p } = launch(5000, 1, true);
  for (let i = 1; i < 13; i++) arena.moveParts(p, 5000 + i * 50, 1);
  const [a,b] = p.parts;
  assert(b.x <= arena.bodyBounds(b).maxX);
  assert(a.x >= arena.bodyBounds(a).minX);
  assert(Math.hypot(a.x-b.x,a.y-b.y) >= a.radius+b.radius-0.01);
});
test("Camera follows the displayed split immediately and protects both ends of a vertical chain", () => {
  for (const [width,height] of [[1888,944],[844,390],[390,844]]) for (const fps of [30,60,144]) {
    const inset = 56;
    const camera = {x:1000, y:1000, scale:1};
    const original = {id:"p", x:1000, y:1000, radius:60, mass:500};
    const minimum = view.minimumScale(width,height,{width:6120,height:4080});
    for (let frame=0; frame<=fps*2; frame++) {
      const time=frame/fps;
      const child = {...original, id:"c", y:1000+Math.min(750,time*1200),
        birth:time<1 ? {parentId:"p"} : undefined, launchAge:time*1000};
      const parts = [original,child];
      const group = view.groupFrame({parts});
      assert.equal(group.y,(original.y+child.y)/2);
      view.followCenter(camera,group,1/fps,false,parts,height,inset);
      view.updateZoom(camera,1,1/fps,minimum,group,width,height,inset);
      if (frame===1) assert(camera.y>original.y);
      if (time>=0.1 && time<0.65) assert(Math.abs(group.y-camera.y)*camera.scale < height*0.13);
      for (const part of parts) {
        const y = height/2 + (part.y-camera.y)*camera.scale;
        assert(y-part.radius*camera.scale >= height*0.03-1e-8);
        assert(y+part.radius*camera.scale <= height-inset-8+1e-8);
      }
      assert(camera.scale>=minimum);
    }
    const spreadScale=camera.scale;
    view.updateZoom(camera,1,1/fps,minimum,view.groupFrame({parts:[original]}),width,height);
    assert.equal(camera.framingSplit,false);
    assert(camera.scale>=spreadScale && Math.log(camera.scale/spreadScale)<=0.18/fps+1e-8);
  }
});
test("Consecutive splits keep their framing between launches, then smoothly return to normal", () => {
  for (const fps of [30, 60, 144]) {
    const dt = 1 / fps;
    const camera = { x: 0, y: 0, scale: 0.8, zoomTarget: 1 };
    const group = { x: 0, y: 0, width: 800, height: 800, count: 2, launching: true };
    const step = () => view.updateZoom(camera, 1, dt, 0.2, group, 900, 700, 60);
    step();
    const first = camera.scale;
    group.launching = false;
    group.height = 400;
    for (let i = 0; i < fps / 3; i++) step();
    assert.equal(camera.scale, first);
    group.count = 4;
    group.height = 960;
    group.launching = true;
    step();
    const second = camera.scale;
    assert.ok(second < first);
    group.height = 400;
    group.launching = false;
    for (let i = 0; i < fps / 3; i++) step();
    assert.equal(camera.scale, second);
    for (let i = 0; i < fps; i++) step();
    assert.ok(camera.scale > second && camera.scale < 1);
  }
});
test("A new manual launch eases out before the HUD boundary only when the group needs room", () => {
  for (const fps of [30, 60, 144]) {
    for (const span of [100, 600]) {
      const camera = { x: 0, y: 0, scale: 0.8 };
      const group = { x: 0, y: 0, width: 100, height: span, count: 2, launching: true, youngestSplitMs: 0 };
      view.updateZoom(camera, 0.8, 1 / fps, 0.2, group, 900, 700, 60);
      if (span === 100) assert.equal(camera.scale, 0.8);
      else {
        assert.ok(0.8 * span < 700 * 0.72);
        assert.ok(camera.scale < 0.8 && camera.scale > 0.8 * 0.9);
      }
    }
  }
});

test("An upward split can use the space opposite the booster bar without a scale jump", () => {
  const group = { x: 0, y: -60, width: 150, height: 400, count: 4, launching: true, youngestSplitMs: 50 };
  for (const fps of [30, 60, 144]) {
    const camera = { x: 0, y: 0, scale: 0.68 };
    view.updateZoom(camera, 0.68, 1 / fps, 0.1, group, 844, 390, 56);
    assert.ok(camera.scale <= 0.68 && camera.scale >= 0.68 * Math.exp(-2 / fps));
    assert.ok(195 + (group.y - 200) * camera.scale >= 8);
    assert.ok(195 + (group.y + 200) * camera.scale <= 390 - 56 - 8);
  }
});
