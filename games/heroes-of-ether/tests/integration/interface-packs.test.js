"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { temporary } = require("../temp");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const catalog = require("../../public/shared/league-appearance");
// Heroic is earned by title, not purchased. Its access has a separate suite.
const paidThemes = catalog.interfaceThemes.filter(t => Number.isFinite(t.price));
assert.equal(paidThemes.length, 3);
const identity = require("../../public/shared/player-identity");

test("Paid themes charge the exact server price once, persist, and never grant league rewards", (t) => {
  const options = {
    filePath: path.join(temporary(t, "interface-packs"), "profiles.json"),
  };
  const store = new ProfileStore(options),
    user = store.open();
  const profile = () => store.find(user.token);
  Object.assign(profile().wallet, {
    coins: 50000,
    crystals: 15000,
    bucks: 3000,
  });
  const before = structuredClone(profile());
  for (const { id, currency, price } of paidThemes) {
    const selection = { slot: "theme", themeId: id, requestId: randomUUID() };
    assert.throws(() => store.setAppearance(user.token, selection), /Сначала купи/);
    const request = {
      ...selection,
      action: "buy",
      price: 1,
      currency: "coins",
    };
    store.setAppearance(user.token, request);
    assert.equal(profile().wallet[currency], before.wallet[currency] - price);
    assert.equal(store.setAppearance(user.token, request).replay, true);
    store.setAppearance(user.token, { ...request, requestId: randomUUID() });
    assert.equal(profile().wallet[currency], before.wallet[currency] - price);
    store.setAppearance(user.token, { ...selection, requestId: randomUUID() });
    const saved = new ProfileStore(options).view(profile());
    assert.equal(saved.appearance.uiTheme, id);
    assert.equal(saved.appearance.lobbyBackground, id);
    assert.equal(saved.appearance.availableUntil[id], null);
    // Previously purchased interfaces unlock every matching part without another charge.
    for (const slot of ["set", "frames", "avatarFrame", "arenaFrame", "profileBackground"])
      store.setAppearance(user.token, { ...selection, slot, requestId: randomUUID() });
    for (const slot of catalog.slots) assert.equal(profile().appearance[slot], id);
    store.setAppearance(user.token, { ...request, slot: "set", requestId: randomUUID() });
    assert.equal(profile().wallet[currency], before.wallet[currency] - price);
    assert.deepEqual(new ProfileStore(options).find(user.token).appearance, profile().appearance);
  }
  assert.equal(catalog.themes.length, 6);
  const committed = structuredClone(profile()),
    disk = fs.readFileSync(options.filePath, "utf8"),
    save = store.save;
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(
    () =>
      store.setAppearance(user.token, {
        slot: "theme",
        themeId: "visual",
        requestId: randomUUID(),
      }),
    /disk full/,
  );
  assert.deepEqual(profile(), committed);
  assert.equal(fs.readFileSync(options.filePath, "utf8"), disk);
  store.save = save;
  store.setAppearance(user.token, {
    slot: "theme",
    themeId: "default",
    requestId: randomUUID(),
  });
  assert.equal(profile().appearance.uiTheme, "default");
  assert.deepEqual(profile().wallet, { coins: 0, crystals: 0, bucks: 0 });
  for (const key of ["greatness", "progress", "account", "honors", "inventory"])
    assert.deepEqual(profile()[key], before[key]);
  assert.deepEqual(profile().appearance.grants, before.appearance.grants);
});

test("Theme purchase rejects insufficient funds and invalid requests; failed writes can be safely retried", (t) => {
  const options = {
    filePath: path.join(temporary(t, "theme-purchase"), "profiles.json"),
    unlockLeagueBackgrounds: true,
  };
  const store = new ProfileStore(options),
    user = store.open();
  const profile = () => store.find(user.token);
  for (const { id, price, currency } of paidThemes) {
    const request = {
      action: "buy",
      slot: "theme",
      themeId: id,
      requestId: randomUUID(),
    };
    profile().wallet[currency] = price - 1;
    const initial = structuredClone(profile());
    assert.throws(() => store.setAppearance(user.token, request), /Недостаточно/);
    assert.deepEqual(profile(), initial);
    assert.throws(
      () => store.setAppearance(user.token, { ...request, action: "select" }),
      /Сначала купи/,
    );
    profile().wallet[currency] = price;
    store.save(store.data);
    const before = structuredClone(profile()),
      disk = fs.readFileSync(options.filePath, "utf8"),
      save = store.save;
    for (const bad of [
      { slot: "unknown" },
      { slot: "profileBackground" },
      { themeId: "gold" },
      { action: "free" },
    ])
      assert.throws(() => store.setAppearance(user.token, { ...request, ...bad }));
    assert.deepEqual(profile(), before);
    store.save = () => {
      throw Error("disk full");
    };
    assert.throws(() => store.setAppearance(user.token, request), /disk full/);
    assert.deepEqual(profile(), before);
    assert.equal(fs.readFileSync(options.filePath, "utf8"), disk);
    store.save = save;
    store.setAppearance(user.token, request);
    assert.equal(profile().wallet[currency], 0);
    const restarted = new ProfileStore(options);
    assert.equal(restarted.setAppearance(user.token, request).replay, true);
    assert.equal(restarted.find(user.token).wallet[currency], 0);
    assert(
      profile().transactions.entries.some(
        (entry) => entry.label === "Тема интерфейса: " + catalog.interfaceTheme(id).name,
      ),
    );
  }
});

test("Free preview selection does not become ownership; Killex's explicit access stays free", () => {
  const store = new ProfileStore(),
    user = store.open(),
    p = store.find(user.token);
  const appearance = require("../../src/server/profiles/league-appearance"),
    overrides = require("../../config/appearance-testing.json");
  p.appearance.uiTheme = p.appearance.lobbyBackground = "visual";
  assert.equal(appearance.capture(p, {}, Date.now()).appearance.uiTheme, "default");
  overrides.allPersonalAppearanceProfileIds.push(p.id);
  try {
    const wallet = structuredClone(p.wallet);
    for (const { id } of paidThemes) {
      store.setAppearance(user.token, {
        slot: "theme",
        themeId: id,
        action: "buy",
        requestId: randomUUID(),
      });
      assert.equal(store.view(store.find(user.token)).appearance.availableUntil[id], null);
    }
    assert.deepEqual(store.find(user.token).wallet, wallet);
    assert.equal(store.find(user.token).appearance.purchasedThemes, undefined);
  } finally {
    overrides.allPersonalAppearanceProfileIds.splice(
      overrides.allPersonalAppearanceProfileIds.indexOf(p.id),
      1,
    );
  }
});

test("All fifteen paid pack avatars retain one identity across size variants; loadout survives restart", (t) => {
  const options = {
    filePath: path.join(temporary(t, "pack-avatars"), "profiles.json"),
  };
  const store = new ProfileStore(options),
    user = store.open();
  const p = store.find(user.token);
  Object.assign(p.wallet, { coins: 50000, crystals: 15000, bucks: 3000 });
  for (const { id } of paidThemes)
    store.setAppearance(user.token, {
      slot: "theme",
      themeId: id,
      action: "buy",
      requestId: randomUUID(),
    });
  store.setAppearance(user.token, {
    slot: "theme",
    themeId: "default",
    requestId: randomUUID(),
  });
  assert.equal(identity.themeSkins.length, 15);
  for (const skin of identity.themeSkins) {
    assert.equal(identity.skinAllowed(skin.id, {}), false);
    assert(
      identity.skinAllowed(skin.id, {}, store.view(store.find(user.token)).appearance.unlocked),
    );
    assert.equal(identity.skinSource(skin, 128), skin.variants[128]);
    assert.equal(identity.skinSource(skin, 1024), skin.arena);
    assert(fs.existsSync(path.resolve(__dirname, "../../public", skin.arena)));
    store.setLoadout(user.token, {
      skinId: skin.id,
      name: "Путник",
      quickSlots: [null, null, null, null, null, null],
      requestId: randomUUID(),
    });
    assert.equal(new ProfileStore(options).find(user.token).skinId, skin.id);
  }
  assert.equal(identity.skinAllowed("vip-1", {}), false);
  assert.equal(identity.skinAllowed("glass-unknown", {}), false);
});

test("Theme avatars reject unowned, forged and legacy preview selections without changing progress", (t) => {
  const options = {
    filePath: path.join(temporary(t, "skin-access"), "profiles.json"),
    unlockLeagueBackgrounds: true,
    unlockLeagueFrames: true,
  };
  const store = new ProfileStore(options),
    user = store.open();
  const p = store.find(user.token);
  p.account = {
    ...require("../../src/server/accounts/account-benefits").fresh(),
    vipUntil: Date.now() + 86400000,
    premiumUntil: Date.now() + 86400000,
  };
  // Old unrestricted selection must neither grant ownership nor leak into the arena.
  p.skinId = "glass-moon-dragon";
  p.appearance.uiTheme = p.appearance.lobbyBackground = "glass";
  store.save(store.data);
  assert.equal(store.identity(p).skinId, "moon-dragon");
  assert.equal(store.arenaAppearance(p).skinId, "moon-dragon");
  assert.equal(store.view(p).skinId, "moon-dragon");
  const before = structuredClone(store.data),
    disk = fs.readFileSync(options.filePath, "utf8");
  for (const skin of identity.themeSkins) {
    assert.throws(
      () =>
        store.setLoadout(user.token, {
          skinId: skin.id,
          name: "Путник",
          quickSlots: [null, null, null, null, null, null],
          requestId: randomUUID(),
          appearance: {
            unlocked: [skin.set],
            purchasedThemes: { [skin.set]: Date.now() },
          },
        }),
      /купи соответствующую тему/,
    );
  }
  assert.deepEqual(store.data, before);
  assert.equal(fs.readFileSync(options.filePath, "utf8"), disk);
  assert.equal(new ProfileStore(options).identity(p).skinId, "moon-dragon");
});

test("Buying one theme unlocks only its five avatars, never another theme or account avatars", (t) => {
  const options = {
    filePath: path.join(temporary(t, "skin-purchase"), "profiles.json"),
  };
  const store = new ProfileStore(options),
    user = store.open();
  const profile = () => store.find(user.token);
  profile().wallet.crystals = 15000;
  const purchase = {
    slot: "theme",
    themeId: "prism",
    action: "buy",
    requestId: randomUUID(),
  };
  const save = store.save;
  store.save = () => {
    throw Error("write failed");
  };
  assert.throws(() => store.setAppearance(user.token, purchase), /write failed/);
  assert(!store.view(profile()).appearance.unlocked.includes("prism"));
  assert.equal(profile().wallet.crystals, 15000);
  store.save = save;
  store.setAppearance(user.token, purchase);
  assert.equal(store.setAppearance(user.token, purchase).replay, true);
  assert.equal(profile().wallet.crystals, 0);
  const access = store.view(profile()).appearance.unlocked;
  assert.equal(identity.themeSkins.filter((s) => identity.skinAllowed(s.id, {}, access)).length, 5);
  assert.equal(identity.skinAllowed("vip-1", {}, access), false);
  assert.equal(identity.skinAllowed("premium-1", {}, access), false);
  store.setLoadout(user.token, {
    skinId: "prism-star-lion",
    name: "Путник",
    quickSlots: [],
    requestId: randomUUID(),
  });
  assert.equal(new ProfileStore(options).view(profile()).skinId, "prism-star-lion");
});

test("Only explicit personal preview opens theme avatars; revocation falls back without deleting selection", () => {
  const store = new ProfileStore(),
    user = store.open(),
    p = store.find(user.token);
  const config = require("../../config/appearance-testing.json");
  for (const key of ["allAppearanceProfileIds", "allPersonalAppearanceProfileIds"]) {
    config[key].push(p.id);
    try {
      const access = store.view(p).appearance.unlocked;
      assert.equal(
        identity.themeSkins.filter((s) => identity.skinAllowed(s.id, {}, access)).length,
        15,
      );
      p.skinId = "visual-star-lion";
      assert.equal(store.identity(p).skinId, p.skinId);
      assert.equal(p.appearance.purchasedThemes, undefined);
    } finally {
      config[key].splice(config[key].indexOf(p.id), 1);
    }
    assert.equal(store.identity(p).skinId, "moon-dragon");
    assert.equal(p.skinId, "visual-star-lion");
  }
});
