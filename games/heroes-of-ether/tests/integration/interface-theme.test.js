"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs");
const { randomUUID } = require("node:crypto"),
  { temporary } = require("../temp");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
test("Тема и общие рамки: атомарность, повтор, ошибка записи и восстановление без изменения наград", (t) => {
  const filePath = path.join(temporary(t, "interface-theme"), "profiles.json");
  const options = { filePath, unlockLeagueBackgrounds: true, unlockLeagueFrames: true };
  const store = new ProfileStore(options),
    user = store.open(),
    p = () => store.find(user.token);
  const choose = (slot, themeId, requestId = randomUUID()) =>
    store.setAppearance(user.token, { slot, themeId, requestId });
  // Account frames require a real active subscription even in league preview mode.
  p().account = {
    ...require("../../src/server/accounts/account-benefits").fresh(),
    vipUntil: Date.now() + 86400000,
    premiumUntil: Date.now() + 86400000,
  };
  const before = structuredClone(p());
  choose("set", "diamond");
  choose("frames", "bronze");
  assert.equal(p().appearance.avatarFrame, "bronze");
  assert.equal(p().appearance.arenaFrame, "bronze");
  assert.equal(p().appearance.uiTheme, "diamond");
  choose("theme", "silver");
  assert.equal(p().appearance.uiTheme, "silver");
  assert.equal(p().appearance.lobbyBackground, "silver");
  assert.equal(p().appearance.profileBackground, "diamond");
  const id = randomUUID();
  choose("frames", "vip", id);
  assert.equal(choose("frames", "vip", id).replay, true);
  assert.equal(p().appearance.arenaFrame, "vip");
  const committed = structuredClone(p()),
    saved = fs.readFileSync(filePath, "utf8"),
    save = store.save;
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => choose("frames", "gold"), /disk full/);
  assert.throws(() => choose("theme", "gold"), /disk full/);
  assert.deepEqual(p(), committed);
  assert.equal(fs.readFileSync(filePath, "utf8"), saved);
  store.save = save;
  const disk = new ProfileStore(options),
    q = disk.find(user.token);
  assert.deepEqual(q.appearance, committed.appearance);
  for (const field of ["wallet", "greatness", "progress", "inventory", "account", "honors"])
    assert.deepEqual(q[field], before[field]);
  choose("frames", "premium");
  assert.equal(p().appearance.avatarFrame, "premium");
  assert.equal(p().appearance.arenaFrame, "premium");
  choose("frames", "default");
  assert.equal(p().appearance.arenaFrame, "default");
});
test("Групповые действия не обходят доступ и не превращают VIP в тему интерфейса", () => {
  const store = new ProfileStore({ unlockLeagueBackgrounds: true }),
    u = store.open();
  for (const [slot, themeId] of [
    ["frames", "gold"],
    ["theme", "vip"],
    ["uiTheme", "premium"],
  ])
    assert.throws(() => store.setAppearance(u.token, { slot, themeId, requestId: randomUUID() }));
});
