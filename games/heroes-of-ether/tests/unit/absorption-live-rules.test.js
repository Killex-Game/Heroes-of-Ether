/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");

function fixture(eaterMass, victimMass, indexed = false) {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } });
  function add(id, mass, x, y) {
    const p = arena.addPlayer(0, id);
    Object.assign(p, {
      level: 501,
      mass,
      radius: radiusForMass(mass),
      x,
      y,
      targetX: x,
      targetY: y,
      protectedUntil: 0,
      nextMassDecayAt: Infinity,
      stopped: true,
      lastMoveAt: 5000,
    });
    return p;
  }
  const a = add("attacker", eaterMass, 1000, 1000),
    b = add("victim", victimMass, 1000, 1000);
  if (indexed)
    for (let i = 0; i < 32; i++)
      add("remote-" + i, 10, 4000 + (i % 8) * 500, 4000 + Math.floor(i / 8) * 500);
  return { arena, a, b };
}

test("Полный тик: размер и глубина проверяются одинаково с пространственным индексом и без", () => {
  for (const indexed of [false, true])
    for (const [attackerMass, victimMass] of [
      [1000, 500],
      [30000, 15000],
    ]) {
      for (const offset of [-0.01, 0.01]) {
        const { arena, a, b } = fixture(attackerMass, victimMass, indexed);
        b.x = a.x + a.radius - b.radius / 3 + offset;
        b.targetX = b.x;
        const events = arena.step(5000).filter((e) => e.type === "absorbed");
        assert.equal(
          events.length,
          offset < 0 ? 1 : 0,
          JSON.stringify({ indexed, attackerMass, offset }),
        );
        assert.equal(b.dead, offset < 0);
      }
      const { arena, b } = fixture(550, 500, indexed);
      assert.equal(arena.step(5000).length, 0);
      assert.equal(b.dead, false);
    }
});

test("Движущийся шар поглощает сразу на первом тике с центром жертвы внутри R − r/3 с любой стороны", () => {
  for (let direction = 0; direction < 8; direction++) {
    const { arena, a, b } = fixture(1000, 500, true),
      angle = (direction * Math.PI) / 4;
    a.x = b.x + Math.cos(angle) * 110;
    a.y = b.y + Math.sin(angle) * 110;
    const originalRadius = a.radius;
    let eaten = false;
    for (let tick = 0; tick < 100; tick++) {
      const now = 5000 + tick * 50;
      arena.handleInput(a.id, { type: "move", x: b.x, y: b.y }, now);
      const events = arena.step(now).filter((e) => e.type === "absorbed");
      const inside = Math.hypot(a.x - b.x, a.y - b.y) < originalRadius - b.radius / 3;
      assert.equal(events.length, inside ? 1 : 0, JSON.stringify({ direction, tick, inside }));
      if (events.length) {
        assert.equal(events[0].victimMass, 500);
        eaten = true;
        break;
      }
    }
    assert.ok(eaten, "поглощение не зависает при сближении");
  }
});

test("После настоящего деления используется масса каждой части; все щиты пропускают поглощение", () => {
  for (const shield of [null, "colorful_shield", "golden_shield", "clan_shield", "sphere"]) {
    const { arena, a, b } = fixture(2000, 500);
    arena.splitPlayer(a, { spawnSerial: a.spawnSerial, sequence: 1 }, 5000);
    assert.equal(a.parts.length, 2);
    const eater = a.parts[0];
    Object.assign(eater, { x: 1000, y: 1000, vx: 0, vy: 0 });
    Object.assign(a.parts[1], { x: 2000, y: 2000, vx: 0, vy: 0 });
    b.x = eater.x + eater.radius - b.radius / 3 - 0.01;
    b.targetX = b.x;
    if (shield) b.effects[shield] = 10000;
    arena.syncParts(a);
    const events = arena.step(5000).filter((e) => e.type === "absorbed");
    assert.equal(events.length, 1);
    assert.equal(events[0].eaterPartId, eater.id);
    assert.equal(b.dead, true);
    assert.equal(eater.mass, 1400);
    assert.equal(a.parts[1].mass, 1000);
  }
});
