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
test("Camera frames the source during launch and eases back to the group, keeping full zoom bounds", () => {
  const original = {localId:"p", x:100, y:100, mass:50, radius:24};
  const child = {localId:"c", birth:{parentId:"p"}, x:240, y:100, mass:50, radius:24};
  const frame = age => view.groupFrame({parts:[original,{...child, launchAge:age}]});
  assert.equal(frame(150).x,100);
  assert(frame(425).x > 100 && frame(425).x < 170);
  assert.equal(frame(650).x,170);
  assert.equal(frame(150).width,frame(650).width);
  assert.equal(view.groupFrame({parts:[original,{...child,birth:{},launchAge:1}]}).x,170);
});
