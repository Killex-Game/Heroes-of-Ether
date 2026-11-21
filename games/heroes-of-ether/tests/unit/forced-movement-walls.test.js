"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { BOOSTER_RULES: R } = require("../../src/server/boosters/booster-catalog");
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

for (const boosterId of ["hook", "glove"]) {
  test(`${boosterId}: real arena steps press each part against walls and corners without stopping siblings`, () => {
    for (let direction = 0; direction < 8; direction++)
      for (const count of [1, 4, 16]) {
        const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } });
        const owner = arena.addPlayer(0, "owner"),
          target = arena.addPlayer(0, "target");
        const dx = Math.round(Math.cos((direction * Math.PI) / 4) * 1e8) / 1e8,
          dy = Math.round(Math.sin((direction * Math.PI) / 4) * 1e8) / 1e8;
        for (const p of [owner, target])
          Object.assign(p, {
            level: 20,
            protectedUntil: 0,
            stopped: true,
            lastMoveAt: 5000,
            nextMassDecayAt: Infinity,
          });
        target.parts = Array.from({ length: count }, (_, i) => {
          const mass = [20, 100, 1000, 75000][i % 4];
          const part = {
            id: i ? `part-${i}` : target.mainPartId,
            mass,
            radius: radiusForMass(mass),
            vx: 10,
            vy: 20,
            mergeAt: 20000,
          };
          const bounds = arena.bodyBounds(part),
            gap = 100 + i * 35;
          part.x = dx > 0 ? bounds.maxX - gap : dx < 0 ? bounds.minX + gap : 5000;
          part.y = dy > 0 ? bounds.maxY - gap : dy < 0 ? bounds.minY + gap : 5000;
          return part;
        });
        arena.syncParts(target);
        const first = arena.bodies(target)[0];
        Object.assign(owner, { x: first.x + dx * 90, y: first.y + dy * 90 });
        arena.prepareBooster(
          owner.id,
          { boosterId, spawnSerial: owner.spawnSerial, aimX: 5000, aimY: 5000 },
          5000,
        )();
        const shot = arena.combat.shots.at(-1);
        Object.assign(shot, { dx, dy });
        arena.combat.impact(shot, target, 5000, first);
        arena.combat.shots = [];
        Object.assign(owner, { x: 5000, y: 5000 });
        const initial = arena.bodies(target).map((p) => ({ ...p })),
          pull = arena.combat.pulls.get(target.id);
        assert.ok(pull);
        near(Math.hypot(pull.dx, pull.dy), 400);
        near(pull.duration, boosterId === "hook" ? (400 / R.HOOK_SPEED) * 1000 : 500);
        const end = 5000 + pull.duration;
        for (let at = 5050; at < end + 50; at += 50) {
          const tick = Math.min(at, end);
          if (at === 5100)
            arena.prepareBooster(
              target.id,
              {
                boosterId: "clan_shield",
                spawnSerial: target.spawnSerial,
              },
              5050,
            )();
          arena.handleInput(target.id, { type: "move", x: 5000, y: 5000 }, tick);
          arena.step(tick);
          const fraction = Math.min(1, (tick - 5000) / pull.duration);
          assert.equal(arena.bodies(target).length, count);
          for (const [i, part] of arena.bodies(target).entries()) {
            const b = arena.bodyBounds(part);
            near(part.x, clamp(initial[i].x + pull.dx * fraction, b.minX, b.maxX));
            near(part.y, clamp(initial[i].y + pull.dy * fraction, b.minY, b.maxY));
            near(part.mass, initial[i].mass);
          }
          assert.equal(arena.combat.pulls.has(target.id), tick < end);
        }
      }
  });
}
