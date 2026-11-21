"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  activity = require("../../src/server/progression/activity-achievements"),
  catalog = require("../../public/shared/accessory-catalog"),
  { temporary } = require("../temp");
const AT = Date.UTC(2026, 10, 2, 12);
function fixture(filePath = null) {
  const store = new ProfileStore({ filePath, now: () => AT }),
    session = store.open();
  const get = () => store.find(session.token);
  get().wardrobeState.legacyNovice = true;
  get().wallet = { coins: 100000, crystals: 100000, bucks: 10000 };
  const buy = (id, requestId = randomUUID()) =>
    store.setAccessory(session.token, { action: "buy", accessoryId: id, requestId });
  return { store, session, get, buy };
}
test("Модник: постоянное владение суммируется, тестовая примерка и повторы не считаются", () => {
  const f = fixture();
  f.get().accessoryPreviewAccess = true;
  activity.awardExtra(f.get(), AT);
  assert.equal(f.get().activity.values.fashionista, 2);
  for (const item of catalog.items.filter((i) => i.price).slice(0, 2)) f.buy(item.id);
  const before = f.get().greatness,
    id = randomUUID();
  f.buy("striped_bow", id);
  assert.equal(f.get().activity.values.fashionista, 5);
  assert.equal(f.get().activity.claimed.fashionista, 1);
  assert.equal(f.get().greatness, before + 10);
  f.buy("striped_bow", id);
  f.buy("striped_bow");
  assert.equal(f.get().greatness, before + 10);
  for (const item of catalog.items.filter((i) => i.price)) f.buy(item.id);
  assert.equal(f.get().activity.values.fashionista, 10);
  assert.equal(f.get().activity.claimed.fashionista, 2);
  assert.equal(f.get().activity.stageSpent.fashionista, 0);
});
test("Модник: все пять накопительных порогов и наград выдаются по одному разу", () => {
  const f = fixture(),
    p = f.get(),
    start = p.greatness;
  for (const [count, total, claimed] of [
    [4, 0, 0],
    [5, 10, 1],
    [10, 40, 2],
    [15, 90, 3],
    [20, 190, 4],
    [25, 440, 5],
  ]) {
    // Simulates durable historical ownership when the catalog later gains more accessories.
    p.activity.values.fashionista = count;
    activity.awardExtra(p, AT);
    assert.equal(p.greatness, start + total);
    assert.equal(p.activity.claimed.fashionista, claimed);
    activity.awardExtra(p, AT);
    assert.equal(p.greatness, start + total);
  }
});
test("Модник: отказ записи откатывает покупку и награду, повтор после восстановления безопасен", (t) => {
  const filePath = path.join(temporary(t, "fashionista"), "profiles.json"),
    f = fixture(filePath);
  f.buy("viking_hat");
  f.buy("sombrero_hat");
  const before = structuredClone(f.get()),
    id = randomUUID(),
    save = f.store.save;
  f.store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => f.buy("striped_bow", id), /disk full/);
  assert.deepEqual(f.get(), before);
  f.store.save = save;
  f.buy("striped_bow", id);
  const reload = new ProfileStore({ filePath, now: () => AT }),
    p = reload.find(f.session.token);
  assert.equal(p.activity.claimed.fashionista, 1);
  assert.equal(p.greatness, before.greatness + 10);
  const result = reload.setAccessory(f.session.token, {
    action: "buy",
    accessoryId: "striped_bow",
    requestId: id,
  });
  assert.equal(result.replay, true);
  assert.equal(reload.find(f.session.token).greatness, p.greatness);
});
test("Модник: старые профили мигрируют без потери прогресса, повреждённая часть не скрывается", (t) => {
  const f = fixture();
  f.buy("viking_hat");
  f.buy("sombrero_hat");
  f.buy("striped_bow");
  const p = f.get();
  p.greatness -= 10;
  delete p.activity.values.fashionista;
  delete p.activity.claimed.fashionista;
  delete p.activity.stageSpent.fashionista;
  const before = p.greatness;
  assert.equal(activity.migrateAccessories(p), true);
  assert.equal(p.activity.values.fashionista, 5);
  activity.validateActivity(p);
  activity.awardExtra(p, AT);
  assert.equal(p.greatness, before + 10);
  assert.equal(activity.migrateAccessories(p), false);
  delete p.activity.claimed.fashionista;
  assert.equal(activity.migrateAccessories(p), false);
  assert.throws(() => activity.validateActivity(p));
});
