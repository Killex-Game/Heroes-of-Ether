"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  C = require("../../src/server/clans/clan-chest-rewards"),
  T = require("../../src/server/progression/treasury-capacity"),
  titles = require("../../src/server/progression/title-chest-rewards"),
  { temporary } = require("../temp");
const AT = Date.UTC(2026, 10, 1, 12);
test("rank frames require an earned rank even with preview; permanent selection survives restart and account expiry", (t) => {
  const filePath = path.join(temporary(t, "rank-frames"), "profiles.json"),
    store = new ProfileStore({ filePath, now: () => AT, unlockLeagueFrames: true }),
    user = store.open();
  const p = () => store.find(user.token),
    choose = (themeId, slot = "frames", requestId = randomUUID()) =>
      store.setAppearance(user.token, { slot, themeId, requestId });
  assert.throws(() => choose("title_boss"), /соответствующий титул/);
  const old = (p().greatness = 25000);
  titles.awardTitles(p(), AT);
  assert.equal(p().greatness, old + 10); // Six earned title accessories: Fashionista I.
  const id = randomUUID();
  choose("title_expert", "frames", id);
  assert.equal(choose("title_expert", "frames", id).replay, true);
  assert.throws(() => choose("title_sage"), /соответствующий титул/);
  assert.throws(() => choose("title_expert", "uiTheme"));
  const restored = new ProfileStore({ filePath, now: () => AT + 365 * 86400000 });
  assert.equal(restored.view(restored.find(user.token)).appearance.avatarFrame, "title_expert");
  assert.equal(
    restored.view(restored.find(user.token)).appearance.availableUntil.title_expert,
    null,
  );
});
test("clan receipt is explicit, atomic and replay safe; unreceived chests never fill free slots", (t) => {
  const filePath = path.join(temporary(t, "manual-receipt"), "profiles.json"),
    store = new ProfileStore({ filePath, now: () => AT }),
    user = store.open();
  const p = () => store.find(user.token),
    chest = C.grant(p(), "high", AT);
  T.fill(p(), AT);
  assert.equal(T.stored(p(), AT), 0);
  assert.equal(T.needsFill(p(), AT), false);
  store.save(store.data, AT);
  const before = structuredClone(p()),
    save = store.save.bind(store);
  const req = { action: "claim", chestId: chest.id, requestId: randomUUID() };
  store.save = () => {
    throw Error("write denied");
  };
  assert.throws(() => store.clanChestAction(user.token, req), /write denied/);
  assert.deepEqual(p(), before);
  store.save = save;
  store.clanChestAction(user.token, req);
  assert.equal(T.stored(p(), AT), 1);
  assert.equal(p().clanChests.items[0].expiresAt, null);
  assert.equal(store.clanChestAction(user.token, req).replay, true);
  assert.deepEqual(p().wallet, before.wallet);
  const restored = new ProfileStore({ filePath, now: () => AT + 3 * 86400000 });
  assert.equal(restored.clanChestAction(user.token, req).replay, true);
  assert.equal(restored.find(user.token).clanChests.items.length, 1);
});
