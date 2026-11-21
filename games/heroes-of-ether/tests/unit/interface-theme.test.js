"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const theme = require("../../public/shared/interface-theme");
const catalog = require("../../public/shared/league-appearance");

test("По умолчанию — без рамки даже с VIP и Premium; явный выбор сохраняется", () => {
  for (const account of [{}, { vip: true }, { premium: true }, { vip: true, premium: true }]) {
    for (const id of ["default", undefined, "invalid"])
      assert.equal(catalog.resolveFrame(id, account), "default");
    for (const id of ["vip", "premium", ...catalog.themes.map((item) => item.id)])
      assert.equal(catalog.resolveFrame(id, account), id);
  }
});
test("Палитры различимы, золотая и платиновая мягче, прозрачность сохраняется", () => {
  assert.deepEqual(
    Object.keys(theme.palettes),
    [...catalog.themes, ...catalog.interfaceThemes].map((t) => t.id),
  );
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  assert.equal(
    new Set(Object.keys(theme.palettes).map((id) => theme.color("#a15bbd", id))).size,
    Object.keys(theme.palettes).length,
  );
  for (const id of Object.keys(theme.palettes))
    for (const source of ["#fff5dd", "#3c2348", "#a15bbd", "#ffc844", "#25152ee6"]) {
      const actual = theme.color(source, id);
      const before = theme.luminance(rgb(source)),
        after = theme.luminance(rgb(actual));
      if (["gold", "platinum", "glass", "heroic"].includes(id)) {
        assert.ok(Math.abs(after - 0.5) < Math.abs(before - 0.5));
        assert.ok(Math.abs(before - after) < 0.065);
      } else assert.ok(Math.abs(before - after) < 0.008);
      assert.equal(actual.slice(7), source.slice(7));
    }
  assert.equal(theme.color("#fff5dd", "default"), "#fff5dd");
  for (const id of Object.keys(theme.palettes)) {
    assert.equal(theme.color("#ffffff", id), "#ffffff");
    assert.equal(theme.color("#000000", id), "#000000");
  }
});
test("Старый набор получает тему своего фона; явно выбранная тема остаётся независимой", () => {
  assert.equal(catalog.selection({ lobbyBackground: "gold" }).uiTheme, "gold");
  assert.equal(catalog.selection({ lobbyBackground: "gold", uiTheme: "silver" }).uiTheme, "silver");
  assert.equal(
    catalog.selection({ lobbyBackground: "gold", uiTheme: "default" }).uiTheme,
    "default",
  );
  assert.equal(catalog.selection({ uiTheme: "../x" }).uiTheme, "default");
});
