/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Arena } = require("../../src/server/arena/arena-simulation"),
  { BOOSTERS } = require("../../src/server/boosters/booster-catalog"),
  view = require("../../public/shared/booster-effect-renderer");
function scene() {
  const arena = new Arena({ etherCount: 0 }),
    p = arena.addPlayer(0, "p");
  p.level = 501;
  const use = (id, now) =>
    arena.prepareBooster(p.id, { boosterId: id, spawnSerial: p.spawnSerial }, now)();
  const snapshot = (now) => arena.snapshot(now).players[0];
  return { arena, p, use, snapshot };
}
test("Разовый массовый бустер виден ровно секунду; пакеты не продлевают значок", () => {
  const { use, snapshot } = scene();
  use("candy", 3000);
  assert.deepEqual(view.active(snapshot(3000)), ["candy"]);
  const state = snapshot(3500);
  assert.deepEqual(view.active(state, 499), ["candy"]);
  assert.deepEqual(view.active(state, 500), []);
  assert.deepEqual(view.active(snapshot(4000)), []);
  assert.deepEqual(snapshot(3500).effects, [], "значок не создаёт игровой эффект");
});
test("Неудача не показывает значок; повтор обновляет секунду; новая жизнь очищает его", () => {
  const { arena, p, use, snapshot } = scene();
  use("candy", 3000);
  use("candy", 3500);
  assert.deepEqual(view.active(snapshot(4499)), ["candy"]);
  p.mass = 30000;
  assert.throws(() => use("meat", 4000));
  assert.deepEqual(view.active(snapshot(4000)), ["candy"]);
  arena.resetPlayer(p, 4200);
  assert.deepEqual(view.active(snapshot(4200)), []);
});
test("Постоянные эффекты: замена/снятие щита, перезапуск Торта, истечение и отрицательные эффекты", () => {
  const { arena, p, use, snapshot } = scene();
  use("colorful_shield", 3000);
  use("golden_shield", 3100);
  p.effects.cake = 5000;
  p.effects.web = 6000;
  p.effects.freeze = 7000;
  p.effects.speed = 8000;
  assert.deepEqual(view.active(snapshot(4000)), [
    "cake",
    "freeze",
    "golden_shield",
    "speed",
    "web",
  ]);
  arena.boosterEffects.apply(p, BOOSTERS.get("cake"), 5000);
  delete p.effects.golden_shield;
  assert.deepEqual(view.active(snapshot(7000)), ["cake", "speed"]);
  assert.deepEqual(view.active(snapshot(45000)), []);
});
test("Миниатюры не дублируются, Турбо видно только при включении; ряд укладывается по размеру", () => {
  assert.deepEqual(
    view.active({
      effects: [{ id: "cake", remainingMs: 500 }],
      instantEffects: [{ id: "cake", remainingMs: 600 }],
      turbo: { active: true, remainingMs: 1000 },
    }),
    ["cake", "turbo"],
  );
  assert.deepEqual(view.active({ turbo: { active: false, remainingMs: 1000 } }), []);
  for (const radius of [24, 100, 450])
    for (const count of [1, 5, 12]) {
      const row = view.layout(count, radius, 0.8);
      assert.ok(row.size >= 14 && row.size <= 25);
      assert.ok(row.columns <= 6 && row.height > 0);
    }
});

test("Effect tiles reuse CPU surfaces, refresh loaded artwork and bound memory across themes", (t) => {
  const originalDocument = globalThis.document,
    originalImage = globalThis.Image;
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  });
  let paints = 0;
  const paint = new Proxy({}, { get: () => () => {} });
  globalThis.document = {
    createElement() {
      paints++;
      return {
        width: 0,
        height: 0,
        getContext(type, options) {
          assert.equal(type, "2d");
          assert.equal(
            options.willReadFrequently,
            true,
            "avoid GPU readbacks from intermediate surfaces",
          );
          return paint;
        },
      };
    },
  };
  globalThis.Image = class {
    complete = false;
    naturalWidth = 128;
    naturalHeight = 128;
  };
  const renderer = new view.Renderer();
  renderer.setCatalog([{ id: "sphere", name: "Сфера", icon: "sphere.webp" }]);
  const first = renderer.badge("sphere", 20, "#261433da", 2);
  for (let i = 0; i < 560; i++) assert.equal(renderer.badge("sphere", 20, "#261433da", 2), first);
  assert.equal(paints, 1, "560 split parts share one complete icon surface");
  renderer.images.get("sphere.webp").onload();
  assert.equal(renderer.badges.size, 0, "placeholder must be replaced after artwork loads");
  assert.notEqual(renderer.badge("sphere", 20, "#261433da", 2), first);
  for (let i = 0; i < 600; i++)
    renderer.badge("sphere", 25, `rgb(${i % 256},${Math.floor(i / 256)},0)`, 2);
  assert.equal(renderer.badges.size, 256);
  assert.ok([...renderer.badges.values()].every((tile) => tile.width <= 54 && tile.height <= 54));
});
