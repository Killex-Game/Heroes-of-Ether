"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { BOOSTER_RULES: R } = require("../../src/server/boosters/booster-catalog");
function scene(angle = 0, distance = 700) {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } });
  const owner = arena.addPlayer(0, "owner"),
    target = arena.addPlayer(0, "target");
  Object.assign(owner, {
    x: 5000,
    y: 5000,
    targetX: 5000,
    targetY: 5000,
    protectedUntil: 0,
    lastMoveAt: 5000,
  });
  Object.assign(target, {
    x: 5000 + Math.cos(angle) * distance,
    y: 5000 + Math.sin(angle) * distance,
    protectedUntil: 0,
    lastMoveAt: 5000,
  });
  const launch = (at = 5000) => {
    arena.prepareBooster(
      owner.id,
      { boosterId: "hook", spawnSerial: owner.spawnSerial, aimX: target.x, aimY: target.y },
      at,
    )();
    return arena.combat.shots.at(-1);
  };
  return { arena, owner, target, launch };
}
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
test("Одинаковая тяга вблизи, внутри группы и вдали, при разных массах и числе частей", () => {
  for (const distance of [0, 1, 40, 150, 400, 700])
    for (const mass of [50, 1000, 40000])
      for (const count of [1, 4, 16]) {
        const { arena, owner, target, launch } = scene(0, distance);
        target.parts = Array.from({ length: count }, (_, i) => ({
          id: i ? `part-${i}` : target.mainPartId,
          x: 5000 + distance,
          y: 5000 + i * 30,
          mass: mass / count,
          radius: radiusForMass(mass / count),
          vx: 0,
          vy: 0,
        }));
        arena.syncParts(target);
        arena.prepareBooster(
          owner.id,
          { boosterId: "hook", spawnSerial: owner.spawnSerial, aimX: 9000, aimY: 5000 },
          5000,
        )();
        const shot = arena.combat.shots.at(-1);
        // For exact centre overlap retain the incoming shot's reverse direction.
        shot.dx = 1;
        shot.dy = 0;
        arena.combat.impact(shot, target, 6000, arena.bodies(target)[0]);
        const start = arena.bodies(target).map((p) => ({ x: p.x, y: p.y }));
        arena.combat.movePull(target, 6100);
        arena.bodies(target).forEach((p, i) => {
          near(p.x, start[i].x - 72);
          near(p.y, start[i].y);
        });
        owner.x += 1000;
        arena.combat.movePull(target, 6000 + (R.HOOK_PULL_DISTANCE / R.HOOK_SPEED) * 1000 + 1);
        arena.bodies(target).forEach((p, i) => {
          near(p.x, start[i].x - 400);
          near(p.y, start[i].y);
        });
      }
});
function splitScene() {
  const f = scene(0, 300);
  Object.assign(f.owner, { mass: 1000, radius: radiusForMass(1000), stopped: true });
  f.target.stopped = true;
  f.target.parts = [
    { id: f.target.mainPartId, x: 5300, y: 5000 },
    { id: "middle", x: 5500, y: 5300 },
    { id: "last", x: 5600, y: 5400 },
  ].map((p) => ({ ...p, mass: 20, radius: radiusForMass(20), vx: 0, vy: 0, mergeAt: 20000 }));
  f.arena.syncParts(f.target);
  f.arena.combat.impact(f.launch(), f.target, 6000, f.target.parts[0]);
  f.arena.combat.shots = [];
  return f;
}
test("Крюк после частичного поглощения сохраняет остаток пути без продления", () => {
  const { arena, owner, target } = splitScene();
  const initial = { ...arena.combat.pulls.get(target.id) };
  let at = 6000,
    events = [];
  while (!events.length && at < 6500) events = arena.step((at += 50));
  assert.equal(events.filter((e) => e.type === "absorbed").length, 1);
  assert.equal(target.parts.length, 2);
  const pull = arena.combat.pulls.get(target.id);
  near(pull.startedAt + pull.duration, initial.startedAt + initial.duration);
  const start = target.parts.map((p) => ({ x: p.x, y: p.y }));
  const end = initial.startedAt + initial.duration,
    absorbedAt = at;
  for (let i = 1; at < end; i++) {
    at = Math.min(end, at + 50);
    owner.x -= 200;
    owner.y -= 100;
    arena.handleInput(target.id, { type: "move", x: 9000, y: 9000 }, at);
    arena.step(at);
    target.parts.forEach((p, n) => {
      near(p.x, start[n].x - (R.HOOK_SPEED * (at - absorbedAt)) / 1000);
      near(p.y, start[n].y);
    });
  }
  assert.equal(arena.combat.pulls.has(target.id), false);
});
test("Поглощение на последнем шаге крюка не запускает дополнительный перенос", () => {
  const { arena, owner, target } = splitScene();
  const at = 6000 + arena.combat.pulls.get(target.id).duration + 30;
  arena.combat.movePull(target, at);
  assert.equal(arena.combat.pulls.has(target.id), false);
  // Fixed travel is now 400 even for the nearby source; meet its endpoint.
  owner.x = target.parts[0].x;
  owner.y = target.parts[0].y;
  assert.equal(arena.resolveAbsorptions(at).length, 1);
  assert.equal(arena.combat.pulls.has(target.id), false);
  const last = target.parts.at(-1),
    origin = { x: last.x, y: last.y };
  arena.combat.movePull(target, at + 100);
  near(last.x, origin.x);
  near(last.y, origin.y);
  Object.assign(owner, { x: target.parts[0].x, y: target.parts[0].y });
  assert.equal(arena.resolveAbsorptions(at + 100).length, 1);
  assert.equal(arena.combat.pulls.has(target.id), false);
  assert.equal(arena.bodies(target).length, 1);
  arena.removePlayer(owner.id);
  assert.equal(arena.combat.movePull(target, at + 150), false);
});
test("Крюк сохраняет прямую траекторию во всех восьми направлениях при движении отправителя", () => {
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4,
      { arena, owner, target, launch } = scene(angle),
      shot = launch();
    arena.combat.impact(shot, target, 6000);
    const origin = { x: target.x, y: target.y },
      end = {
        x: origin.x - Math.cos(angle) * R.HOOK_PULL_DISTANCE,
        y: origin.y - Math.sin(angle) * R.HOOK_PULL_DISTANCE,
      };
    for (let n = 1; n <= 20; n++) {
      owner.x += 30;
      owner.y += 50;
      arena.combat.movePull(target, 6000 + n * 50);
      const distance = Math.min(R.HOOK_PULL_DISTANCE, R.HOOK_SPEED * n * 0.05);
      near(target.x, origin.x - Math.cos(angle) * distance);
      near(target.y, origin.y - Math.sin(angle) * distance);
    }
    near(target.x, end.x);
    near(target.y, end.y);
    assert.equal(arena.combat.pulls.has(target.id), false);
  }
});

test("Раннее частичное поглощение не сокращает оставшуюся тягу Крюка до короткого хвоста", () => {
  const { arena, target, launch } = scene(0, 1000);
  arena.combat.impact(launch(), target, 6000);
  arena.combat.movePull(target, 6050);
  const start = target.x;
  arena.combat.continuePullAfterAbsorption(target.id, "third-player", 6050, "hook");
  const pull = arena.combat.pulls.get(target.id);
  near(pull.duration, (R.HOOK_PULL_DISTANCE / R.HOOK_SPEED) * 1000);
  arena.combat.movePull(target, 6250);
  arena.combat.continuePullAfterAbsorption(target.id, "third-player", 6250, "hook");
  arena.combat.movePull(target, 6450);
  near(target.x, start - 288);
  assert.equal(arena.combat.pulls.has(target.id), true);
  arena.combat.movePull(target, 6000 + (1000 / R.HOOK_SPEED) * 1000 + 0.001);
  near(target.x, 6000 - R.HOOK_PULL_DISTANCE);
  assert.equal(arena.combat.pulls.has(target.id), false);
});
test("Гарпун продолжает движение после поглощения части и не зависит от оставшегося соперника", () => {
  for (const atEnd of [false, true]) {
    const { arena, owner, target } = scene(0, 1000);
    Object.assign(owner, { mass: 1000, radius: radiusForMass(1000), stopped: true });
    const duration = R.PULL_MS,
      at = 6000 + duration * (atEnd ? 1 : 0.8);
    target.parts = [
      { id: target.mainPartId, x: 5000 + (atEnd ? 612 : 489.6), y: 5000 },
      { id: "remaining", x: 6000, y: 5600 },
    ].map((p) => ({ ...p, mass: 20, radius: radiusForMass(20) }));
    arena.syncParts(target);
    arena.combat.pullToPoint({ ownerId: owner.id, ownerLife: owner.lifeId }, 5300, 5000, 6000);
    arena.combat.movePull(owner, at);
    assert.equal(arena.resolveAbsorptions(at).length, 1);
    assert.equal(target.dead, false);
    const pull = arena.combat.pulls.get(owner.id),
      start = owner.x;
    near(pull.startedAt + pull.duration, at + 400);
    arena.removePlayer(target.id);
    for (let i = 1; i <= 4; i++) {
      owner.targetX = 0;
      owner.targetY = 9000;
      arena.combat.movePull(owner, at + i * 100);
      near(owner.x, start + i * R.HARPOON_SPEED * 0.1);
      near(owner.y, 5000);
    }
    assert.equal(arena.combat.pulls.has(owner.id), false);
  }
});

test("Реальное раннее поглощение части Крюком сохраняет полный оставшийся путь остальных частей", () => {
  const { arena, owner, target, launch } = scene(0, 1000);
  owner.stopped = target.stopped = true;
  Object.assign(owner, { mass: 10000, radius: radiusForMass(10000) });
  owner.parts = [
    { id: owner.mainPartId, x: 5000, y: 5000 },
    { id: "forward", x: 5990, y: 5000 },
  ].map((p) => ({ ...p, mass: 5000, radius: radiusForMass(5000), vx: 0, vy: 0, mergeAt: 20000 }));
  target.parts = [
    { id: target.mainPartId, x: 6000, y: 5000 },
    { id: "survivor", x: 6200, y: 5500 },
  ].map((p) => ({ ...p, mass: 20, radius: radiusForMass(20), vx: 0, vy: 0, mergeAt: 20000 }));
  arena.syncParts(owner);
  arena.syncParts(target);
  const shot = launch();
  shot.sourcePartId = owner.mainPartId;
  arena.combat.impact(shot, target, 6000, target.parts[0]);
  arena.combat.shots = [];
  const original = { ...arena.combat.pulls.get(target.id) };
  const events = arena.step(6050);
  assert.equal(events.filter((e) => e.type === "absorbed" && e.victimId === target.id).length, 1);
  assert.equal(arena.bodies(target).length, 1);
  near(arena.combat.pulls.get(target.id).duration, (R.HOOK_PULL_DISTANCE / R.HOOK_SPEED) * 1000);
  for (let at = 6100; at < 6550; at += 50) {
    arena.step(at);
    near(
      arena.bodies(target)[0].x,
      6200 + original.dx * Math.min(1, (at - 6000) / original.duration),
    );
    near(arena.bodies(target)[0].y, 5500);
  }
  arena.step(6560);
  assert.equal(arena.combat.pulls.has(target.id), false);
  near(arena.bodies(target)[0].x, 6200 - R.HOOK_PULL_DISTANCE);
});

test("Повторные попадания Крюка перед фазой движения не обнуляют пройденное время", () => {
  const { arena, target, launch } = scene(0, 1000);
  const shot = launch();
  arena.combat.impact(shot, target, 6000);
  for (let i = 1; i <= 10; i++) {
    const at = 6000 + i * 50;
    arena.combat.impact(shot, target, at);
    arena.combat.movePull(target, at);
    near(target.x, 6000 - R.HOOK_SPEED * i * 0.05);
  }
});
test("Смена и потеря частей не перенаправляют крюк на новый главный шар", () => {
  const { arena, owner, target, launch } = scene();
  owner.parts = [
    { id: owner.mainPartId, x: 5000, y: 5000, mass: 20, radius: radiusForMass(20) },
    { id: "other", x: 4500, y: 5500, mass: 20, radius: radiusForMass(20) },
  ];
  target.parts = [
    { id: target.mainPartId, x: 5700, y: 5000, mass: 20, radius: radiusForMass(20) },
    { id: "sibling", x: 5700, y: 5150, mass: 20, radius: radiusForMass(20) },
  ];
  arena.syncParts(owner);
  arena.syncParts(target);
  const shot = launch();
  arena.combat.impact(shot, target, 6000, target.parts[0]);
  owner.parts.splice(0, 1);
  arena.syncParts(owner);
  target.parts.splice(0, 1);
  arena.syncParts(target);
  arena.combat.movePull(target, 6100);
  near(target.x, 5628);
  near(target.y, 5150);
});
test("Крюк прижимает части к границе отдельно, не обрывая общий срок тяги", () => {
  const { arena, owner, target, launch } = scene();
  Object.assign(owner, { x: 50, y: 50 });
  target.parts = [
    { id: target.mainPartId, x: 400, y: 400, mass: 20, radius: radiusForMass(20) },
    { id: "sibling", x: 100, y: 700, mass: 20, radius: radiusForMass(20) },
  ];
  arena.syncParts(target);
  const shot = launch();
  arena.combat.impact(shot, target, 6000, target.parts[0]);
  const before = target.parts.map((p) => ({ x: p.x, y: p.y }));
  arena.combat.movePull(target, 6500);
  for (let i = 0; i < 2; i++) {
    const edge = arena.bodyBounds(target.parts[i]),
      step = R.HOOK_SPEED * 0.5 * Math.SQRT1_2;
    near(target.parts[i].x, Math.max(edge.minX, before[i].x - step));
    near(target.parts[i].y, Math.max(edge.minY, before[i].y - step));
  }
  assert.equal(arena.combat.pulls.has(target.id), true);
  arena.combat.movePull(target, 6600);
  assert.equal(arena.combat.pulls.has(target.id), false);
});
test("Реальное попадание в Arena.step: встречный ввод цели и движение отправителя не искривляют перенос", () => {
  for (let direction = 0; direction < 8; direction++) {
    const { arena, owner, target, launch } = scene((direction * Math.PI) / 4);
    owner.stopped = target.stopped = true;
    launch();
    let at = 5000;
    while (!arena.combat.pulls.has(target.id) && at < 10000) {
      at += 50;
      arena.step(at);
    }
    assert.ok(arena.combat.pulls.has(target.id));
    const pull = { ...arena.combat.pulls.get(target.id) },
      origin = { x: target.x, y: target.y };
    const end = at + Math.ceil(pull.duration / 50) * 50;
    while (at < end) {
      at += 50;
      arena.handleInput(owner.id, { type: "move", x: owner.x + 1000, y: owner.y - 2000 }, at);
      arena.handleInput(target.id, { type: "move", x: 9000, y: 9000 }, at);
      arena.step(at);
      const fraction = Math.min(1, (at - pull.startedAt) / pull.duration);
      near(target.x, origin.x + pull.dx * fraction);
      near(target.y, origin.y + pull.dy * fraction);
    }
    assert.equal(arena.combat.pulls.has(target.id), false);
  }
});
test("Отражённый крюк привязан к отразившей части и прекращается при уходе отправителя", () => {
  const { arena, owner, target, launch } = scene();
  target.parts = [
    { id: target.mainPartId, x: 5700, y: 5000, mass: 20, radius: radiusForMass(20) },
    { id: "big", x: 5900, y: 5300, mass: 100, radius: radiusForMass(100) },
  ];
  arena.syncParts(target);
  target.effects.clan_shield = 20000;
  const shot = launch(),
    reflector = target.parts[0];
  assert.equal(arena.combat.impact(shot, target, 6000, reflector), "reflected");
  assert.equal(shot.sourcePartId, reflector.id);
  arena.combat.impact(shot, owner, 7000);
  near(arena.combat.pulls.get(owner.id).dx, R.HOOK_PULL_DISTANCE);
  near(arena.combat.pulls.get(owner.id).dy, 0);
  const before = { x: owner.x, y: owner.y };
  arena.removePlayer(target.id);
  assert.equal(arena.combat.movePull(owner, 7050), false);
  near(owner.x, before.x);
  near(owner.y, before.y);
});

test("Дальний соперник требует двух попаданий; один крюк не переносит больше 400", () => {
  const { arena, owner, target, launch } = scene(0, 700);
  const first = launch();
  arena.combat.impact(first, target, 6000);
  arena.combat.movePull(target, 7000);
  near(target.x, 5300);
  const second = launch(7100);
  arena.combat.impact(second, target, 7200);
  arena.combat.movePull(target, 8200);
  near(target.x, 4900);
});

for (const shield of ["colorful_shield", "sphere", "golden_shield", "clan_shield"]) {
  test(shield + ": защищает при попадании, но не отменяет начатую тягу", () => {
    const f = scene();
    f.target.effects[shield] = 20000;
    f.arena.combat.impact(f.launch(), f.target, 6000);
    assert.equal(f.arena.combat.pulls.has(f.target.id), false);
    const g = scene();
    g.arena.combat.impact(g.launch(), g.target, 6000);
    g.arena.combat.movePull(g.target, 6100);
    const x = g.target.x,
      y = g.target.y;
    g.target.effects[shield] = 20000;
    assert.equal(g.arena.combat.movePull(g.target, 6150), true);
    near(g.target.x, x - R.HOOK_SPEED * 0.05);
    near(g.target.y, y);
    assert.equal(g.arena.combat.pulls.has(g.target.id), true);
    const pull = g.arena.combat.pulls.get(g.target.id);
    near(pull.duration, (R.HOOK_PULL_DISTANCE / R.HOOK_SPEED) * 1000);
    g.arena.combat.movePull(g.target, 7000);
    near(g.target.x, x + R.HOOK_SPEED * 0.1 - R.HOOK_PULL_DISTANCE);
    near(g.target.y, y);
    assert.equal(g.target.effects[shield], 20000, "щит сохраняется после переноса");
    assert.equal(g.arena.combat.pulls.has(g.target.id), false);
  });
}
