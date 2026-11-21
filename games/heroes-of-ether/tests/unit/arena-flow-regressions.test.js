"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Arena, radiusForMass, RULES } = require("../../src/server/arena/arena-simulation");
const {
  BOOSTERS,
  BOOSTER_RULES,
  publicCatalog,
} = require("../../src/server/boosters/booster-catalog");
const { cooldown } = require("../../public/shared/booster-cooldowns");
const view = require("../../public/shared/arena-camera-and-layout");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { ClanService } = require("../../src/server/clans/clan-service");
const { xpForLevel } = require("../../src/server/progression/experience-progression");
function scene() {
  const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } });
  const p = arena.addPlayer(0, "a"),
    q = arena.addPlayer(0, "b");
  for (const [player, x] of [
    [p, 2000],
    [q, 2600],
  ])
    Object.assign(player, { x, y: 2000, targetX: x, targetY: 2000, level: 25, protectedUntil: 0 });
  return { arena, p, q };
}
test("Все 11 атак применяются подряд, не наследуют и не создают общую перезарядку", () => {
  const ids = [
    "glove",
    "web",
    "freeze",
    "hook",
    "rocket",
    "lock",
    "harpoon",
    "mega_poison",
    "axe",
    "stone",
    "fire",
  ];
  for (const id of ids) {
    const { arena, p, q } = scene();
    const use = (now) =>
      arena.prepareBooster(
        p.id,
        { boosterId: id, spawnSerial: p.spawnSerial, aimX: q.x, aimY: q.y },
        now,
      )();
    p.boosterReadyAt = 6000;
    use(5000);
    assert.throws(() => use(5299), /мгновение/);
    use(5300);
    assert.equal(p.boosterUses[id], 2, id);
    assert.equal(p.boosterReadyAt, 6000, id + " must not change another cooldown");
    p.boosterReadyAt = 0;
    use(5600);
    assert.equal(p.boosterReadyAt, 0);
    const catalog = publicCatalog();
    assert.equal(
      cooldown(
        catalog.items.find((b) => b.id === id),
        { boosterCooldownMs: 1000 },
        0,
        catalog.rules,
      ).ms,
      0,
      id,
    );
  }
});
test("После 16 → 15 → 16 старые части продолжают сливаться, новая пара ждёт 30 секунд", () => {
  const { arena, p } = scene();
  p.parts = Array.from({ length: 16 }, (_, i) => ({
    id: "part" + i,
    x: 1000 + i * 200,
    y: 2000,
    mass: 20,
    radius: radiusForMass(20),
    mergeAt: 10000,
    vx: 0,
    vy: 0,
  }));
  p.mainPartId = "part0";
  p.mergeAt = 10000;
  p.parts[1].x = p.parts[0].x;
  arena.syncParts(p);
  arena.moveParts(p, 10000, 0);
  assert.equal(p.parts.length, 15);
  const readyIds = p.parts.filter((x) => x.mass === 20).map((x) => x.id);
  arena.splitPlayer(p, { sequence: 1, spawnSerial: p.spawnSerial }, 10001);
  assert.equal(p.parts.length, 16);
  assert.equal(p.mergeAt, 10000);
  assert.ok(p.parts.filter((x) => readyIds.includes(x.id)).every((x) => x.mergeAt === 10000));
  const newPair = p.parts.filter((x) => !readyIds.includes(x.id));
  assert.equal(newPair.length, 2);
  assert.ok(newPair.every((x) => x.mergeAt === 10001 + RULES.MERGE_DELAY_MS));
  const pair = p.parts.filter((x) => readyIds.includes(x.id)).slice(0, 2);
  pair[1].x = pair[0].x;
  pair[1].y = pair[0].y;
  arena.moveParts(p, 10002, 0);
  assert.equal(p.parts.length, 15);
  assert.equal(p.mass, 320);
  assert.ok(newPair.every((x) => p.parts.includes(x)));
});
test("Крюк переносит весь набор частей с одной скоростью на короткой и дальней дистанции", () => {
  for (const distance of [300, 1100]) {
    const { arena, p, q } = scene();
    q.parts = [-50, 50].map((y, i) => ({
      id: "q" + i,
      x: p.x + distance,
      y: p.y + y,
      mass: 20,
      radius: radiusForMass(20),
      vx: 0,
      vy: 0,
    }));
    q.mainPartId = "q0";
    arena.syncParts(q);
    arena.prepareBooster(
      p.id,
      { boosterId: "hook", spawnSerial: p.spawnSerial, aimX: q.x, aimY: q.parts[0].y },
      5000,
    )();
    const shot = arena.combat.shots[0];
    const impactAt = 5000 + (distance / 200) * 1000;
    arena.combat.impact(shot, q, impactAt, q.parts[0]);
    const before = { x: q.x, y: q.y },
      spread = q.parts[1].y - q.parts[0].y;
    arena.combat.movePull(q, impactAt + 100);
    assert.ok(
      Math.abs(Math.hypot(q.x - before.x, q.y - before.y) - BOOSTER_RULES.HOOK_SPEED / 10) < 1e-8,
    );
    assert.equal(
      arena.snapshot(impactAt + 100).players.find((x) => x.id === q.id).forcedMovement,
      true,
    );
    for (let elapsed = 200; elapsed < 5000 && arena.combat.pulls.has(q.id); elapsed += 100)
      arena.combat.movePull(q, impactAt + elapsed);
    assert.equal(arena.combat.pulls.has(q.id), false);
    // Fixed 400-unit pull can pass the owner's original position at short range.
    const remainingDistance = Math.abs(Math.hypot(distance, 50) - BOOSTER_RULES.HOOK_PULL_DISTANCE);
    assert.ok(
      Math.abs(Math.hypot(q.parts[0].x - p.x, q.parts[0].y - p.y) - remainingDistance) < 1e-8,
    );
    assert.ok(Math.abs(q.parts[1].y - q.parts[0].y - spread) < 1e-8);
    assert.equal(q.mass, 40);
  }
});
test("Камера догоняет крюк при 30, 60 и 144 FPS без длительного отставания", () => {
  for (const fps of [30, 60, 144]) {
    const camera = { x: 0, y: 0, scale: 1 };
    for (let i = 1; i <= fps * 2; i++) {
      const target = { x: (i * BOOSTER_RULES.HOOK_SPEED) / fps, y: 0 };
      view.followCenter(camera, target, 1 / fps, true);
      assert.ok(target.x - camera.x < 60);
      assert.ok(camera.x <= target.x);
    }
  }
});
test("Глава распускает полный клан атомарно: возврат заявок, личные предметы и повтор операции", () => {
  const store = new ProfileStore(),
    clans = new ClanService(store);
  const users = Array.from({ length: 4 }, () => store.open());
  for (const u of users) {
    const p = store.find(u.token);
    p.level = 25;
    p.progress.xp = xpForLevel(25);
    p.wallet.coins = 10000;
    p.inventory.candy = 8;
  }
  const act = (u, action, extra = {}) =>
    clans.mutate(u.token, { action, requestId: randomUUID(), ...extra });
  act(users[0], "create", { name: "Проверка", prefix: "TEST", emblem: "grove", privacy: "closed" });
  const clanId = store.find(users[0].token).clanId;
  for (const u of users.slice(1)) act(u, "apply", { clanId });
  for (const u of users.slice(1, 3)) act(users[0], "accept", { clanId, memberId: u.profile.id });
  assert.throws(() => act(users[1], "disband", { clanId }), /главе/);
  const operation = { action: "disband", clanId, requestId: randomUUID() };
  const before = structuredClone(store.data),
    save = store.save;
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => clans.mutate(users[0].token, operation), /disk full/);
  assert.deepEqual(store.data, before);
  store.save = save;
  const fee = store.data.clans[clanId].applicationFees[users[3].profile.id];
  const coins = store.find(users[3].token).wallet.coins;
  clans.mutate(users[0].token, operation);
  assert.equal(clans.mutate(users[0].token, operation).replay, true);
  assert.equal(store.data.clans[clanId], undefined);
  assert.equal(store.find(users[3].token).wallet.coins, coins + fee);
  for (const u of users) {
    assert.equal(store.find(u.token).clanId, null);
    assert.equal(store.find(u.token).inventory.candy, 8);
  }
});
