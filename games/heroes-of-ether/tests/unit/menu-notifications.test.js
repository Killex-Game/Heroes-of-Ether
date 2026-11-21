"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Notices } = require("../../public/shared/menu-notifications");
const base = () => ({
  id: "a",
  revision: 1,
  inventory: { fire: 5 },
  wardrobe: { owned: ["hat"] },
  appearance: { unlocked: ["bronze"] },
  progress: { achievements: [{ id: "maximum", claimed: 1 }] },
  pets: { owned: { zaya: { level: 0 } } },
  quests: { items: [], pending: [] },
});
function storage() {
  const data = new Map();
  return { getItem: (id) => data.get(id), setItem: (id, value) => data.set(id, value) };
}
test("Старые предметы не создают индикаторов, новые сохраняются до просмотра нужного окна", () => {
  const disk = storage(),
    n = new Notices(disk),
    p = base();
  n.update(p);
  assert.ok(Object.values(n.attention()).every((v) => !v));
  p.revision++;
  p.inventory.fire++;
  p.pets.owned.zaya.level++;
  p.wardrobe.owned.push("bow");
  p.appearance.unlocked.push("silver");
  p.progress.achievements[0].claimed++;
  n.update(p);
  for (const group of ["inventory", "pets", "wardrobe", "skins", "achievements"])
    assert.equal(n.attention()[group], true);
  n.seen("inventory");
  assert.equal(n.attention().inventory, false);
  const restored = new Notices(disk);
  restored.update(p);
  assert.equal(restored.attention().pets, true);
  assert.equal(restored.attention().inventory, false);
  restored.seen("pets");
  restored.update(p);
  assert.ok(!restored.attention().pets);
  restored.update({ ...p, id: "b" });
  assert.ok(Object.values(restored.attention()).every((v) => !v));
});
test("Задание отмечается до просмотра, сундук и заявка — до обработки", () => {
  const n = new Notices(storage()),
    p = base();
  n.update(p);
  p.quests.items = [{ id: "today", completedAt: 0, claimedAt: null }];
  p.quests.pending = [{ id: "today" }];
  p.menuNotifications = { clanApplications: 1 };
  n.update(p);
  assert.equal(n.attention().quests, true);
  n.seen("quests");
  n.seen("clan");
  assert.ok(!n.attention().quests);
  assert.equal(n.attention().inventory, true);
  assert.equal(n.attention().clan, true);
  p.quests.items[0].claimedAt = 10;
  p.quests.pending = [];
  p.menuNotifications.clanApplications = 0;
  n.update(p);
  assert.ok(!n.attention().quests);
  assert.equal(n.attention().inventory, false);
  assert.equal(n.attention().clan, false);
  p.quests.pending.push({ id: "yesterday" });
  n.update(p);
  assert.equal(n.attention().quests, true);
});
test("Расход не считается новинкой, новое пополнение считается; старый ответ не меняет состояние", () => {
  const n = new Notices(storage()),
    p = base();
  n.update(p);
  n.update({ ...p, revision: 2, inventory: { fire: 3 } });
  assert.ok(!n.attention().inventory);
  n.update({ ...p, revision: 1, inventory: { fire: 99 } });
  assert.ok(!n.attention().inventory);
  n.update({ ...p, revision: 3, inventory: { fire: 4 } });
  assert.equal(n.attention().inventory, true);
});

test("Индикаторы показывают путь к нужному разделу и не смешивают бустеры с сундуками", () => {
  const n = new Notices(storage()),
    p = base();
  n.update(p);
  p.inventory.fire++;
  p.quests.pending.push({ id: "reward", stored: true });
  n.update(p);
  for (const id of ["inventory", "inventoryItems", "chests", "treasury"])
    assert.equal(n.attention()[id], true);
  assert.equal(n.attention().titleChests, false);
  n.seen("inventory");
  assert.equal(n.attention().inventoryItems, false);
  assert.equal(n.attention().treasury, true);
  assert.equal(n.attention().inventory, true);
  p.honors = { tiers: [{ state: "closed", reason: null }] };
  p.quests.pending = [];
  n.update(p);
  assert.equal(n.attention().treasury, false);
  assert.equal(n.attention().titleChests, true);
  assert.equal(n.attention().chests, true);
  p.honors.tiers[0].state = "opened";
  n.update(p);
  assert.equal(n.attention().inventory, false);
});
test("Магазин отмечает появление доступных товаров, сбои хранения не мешают игре", () => {
  const n = new Notices({
      getItem() {
        throw Error();
      },
      setItem() {
        throw Error();
      },
    }),
    p = base();
  n.update(p, {
    items: [
      { id: "fire", ready: true },
      { id: "hook", ready: false },
    ],
  });
  assert.ok(!n.attention().shop);
  n.update(p, {
    items: [
      { id: "fire", ready: true },
      { id: "hook", ready: true },
    ],
  });
  assert.equal(n.attention().shop, true);
  n.seen("shop");
  assert.ok(!n.attention().shop);
});
