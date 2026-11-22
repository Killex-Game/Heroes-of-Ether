/* Стабильные ID VIP-набора, файлы разных размеров и смена источника портрета. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const identity = require("../../public/shared/player-identity");
test("Каждый набор аватарок содержит ровно пять уникальных персонажей", () => {
  for (const tier of ["vip", "premium"])
    assert.equal(identity.accountSkins.filter((s) => s.tier === tier).length, 5);
  for (const set of identity.themeSkinSets) {
    const skins = identity.themeSkins.filter((s) => s.set === set.id);
    assert.equal(skins.length, 5, set.name);
    assert.equal(new Set(skins.map((s) => s.id)).size, 5);
    for (const skin of skins)
      for (const asset of Object.values(skin.variants))
        assert(fs.existsSync(path.resolve(__dirname, "../../public", asset.split(/[?#]/)[0])), asset);
  }
});
test("Пять сохранённых VIP ID разрешаются в реальные файлы каждого размера", () => {
  const vip = identity.accountSkins.filter((skin) => skin.tier === "vip");
  assert.deepEqual(
    vip.map((skin) => skin.id),
    ["vip-1", "vip-2", "vip-3", "vip-4", "vip-5"],
  );
  for (const skin of vip) {
    assert.deepEqual(Object.keys(skin.variants).map(Number), [64, 128, 256, 512, 1024]);
    for (const asset of Object.values(skin.variants)) {
      const bytes = fs.readFileSync(path.resolve(__dirname, "../../public", asset.split(/[?#]/)[0]));
      assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
      assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
    }
    assert.equal(identity.skinSource(skin, 70), skin.variants[128]);
    assert.equal(identity.skinSource(skin.id, 5000), skin.arena);
  }
});
test("Смена VIP-портрета на обычный заменяет все размеры прозрачного портрета", () => {
  const attributes = new Map();
  const image = {
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key),
  };
  identity.setSkinImage(image, "vip-2", 64);
  assert.match(
    attributes.get("srcset"),
    /transparent-v2\/64\/vip-2\.webp\?art=20261122b 1x, .*128\/vip-2\.webp\?art=20261122b 2x$/,
  );
  identity.setSkinImage(image, "moon-dragon", 64);
  assert.match(attributes.get("srcset"), /64\/moon-dragon\.webp\?art=20261122b 1x, .*128\/moon-dragon\.webp\?art=20261122b 2x$/);
  assert.equal(attributes.get("src"), "assets/skins/transparent-v2/64/moon-dragon.webp?art=20261122b");
  assert.equal(image.dataset.skinId, "moon-dragon");
  identity.setSkinImage(image, "unknown-skin");
  assert.equal(image.dataset.skinId, "moon-dragon");
});
