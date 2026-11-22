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


test("Retired theme skins migrate once without altering earned rewards or purchased themes", (t) => {
  const migration = require('../../src/server/profiles/retired-theme-skins');
  assert.equal(identity.themeSkins.length, 0);
  assert.equal(Object.keys(identity.retiredSkinReplacements).length, 15);
  for (const [oldId, replacement] of Object.entries(identity.retiredSkinReplacements)) {
    assert.equal(identity.validSkin(oldId), false);
    assert.equal(identity.skinAllowed(oldId, {}, ['visual','prism','glass']), false);
    assert.equal(identity.skinAllowed(replacement, {}), true);
    assert.equal(identity.skinSource(oldId, 256), identity.skinSource(replacement, 256));
    const profile = {skinId:oldId,grantedSkins:[oldId,'gift-winged-guardian',replacement],wallet:{coins:37},appearance:{purchasedThemes:{visual:1}},history:[{skinId:oldId}]};
    const before = structuredClone(profile);
    assert.equal(migration.migrate(profile), true);
    assert.equal(profile.skinId, replacement);
    assert.deepEqual(profile.grantedSkins, [replacement,'gift-winged-guardian']);
    for (const k of ['wallet','appearance','history']) assert.deepEqual(profile[k],before[k]);
    assert.equal(migration.migrate(profile), false);
  }
  assert.equal(identity.currentSkinId('__proto__'), '__proto__');
  const options = {filePath:path.join(temporary(t,'retired-skins'),'profiles.json'),now:()=>Date.UTC(2026,10,23,12)};
  const store = new ProfileStore(options), user=store.open(), p=store.find(user.token);
  p.skinId='prism-star-lion';p.grantedSkins=['glass-moon-dragon','gift-winged-guardian'];
  p.appearance.purchasedThemes={prism:options.now()};store.save(store.data);
  const before=structuredClone(p), restarted=new ProfileStore(options), q=restarted.find(user.token);
  const expected={...before,skinId:'snow-leopard',grantedSkins:['moon-dragon','gift-winged-guardian'],revision:before.revision+1};
  assert.deepEqual(q,expected);
  assert.equal(restarted.identity(q).skinId,'snow-leopard');
  assert.equal(restarted.arenaAppearance(q).skinId,'snow-leopard');
  restarted.save(restarted.data);
  assert.deepEqual(new ProfileStore(options).find(user.token),q);
});

test("Retired selections and forged ownership are rejected without mutating the profile", (t) => {
  const options={filePath:path.join(temporary(t,'retired-access'),'profiles.json'),unlockLeagueFrames:true,unlockLeagueBackgrounds:true};
  const store=new ProfileStore(options),user=store.open(),p=store.find(user.token),before=structuredClone(p);
  const disk=fs.readFileSync(options.filePath,'utf8');
  for(const skinId of Object.keys(identity.retiredSkinReplacements)) assert.throws(()=>store.setLoadout(user.token,{
    skinId,name:'Путник',quickSlots:[],requestId:randomUUID(),appearance:{unlocked:['visual','prism','glass']}
  }),/доступный скин/);
  assert.deepEqual(store.find(user.token),before);
  assert.equal(fs.readFileSync(options.filePath,'utf8'),disk);
});

test("Theme purchase retains atomic ownership and charges without granting retired avatars", (t) => {
  const options={filePath:path.join(temporary(t,'theme-without-avatars'),'profiles.json')};
  const store=new ProfileStore(options),user=store.open(),profile=()=>store.find(user.token);
  profile().wallet.crystals=15000;
  const purchase={slot:'theme',themeId:'prism',action:'buy',requestId:randomUUID()},save=store.save;
  store.save=()=>{throw Error('write failed');};
  assert.throws(()=>store.setAppearance(user.token,purchase),/write failed/);
  assert(!store.view(profile()).appearance.unlocked.includes('prism'));
  assert.equal(profile().wallet.crystals,15000);store.save=save;
  store.setAppearance(user.token,purchase);
  assert.equal(store.setAppearance(user.token,purchase).replay,true);
  assert.equal(profile().wallet.crystals,0);
  const access=store.view(profile()).appearance.unlocked;
  assert(access.includes('prism'));
  assert.equal(identity.skinAllowed('vip-1',{},access),false);
  assert.equal(identity.skinAllowed('premium-1',{},access),false);
  assert.equal(identity.skinAllowed('prism-star-lion',{},access),false);
  store.setLoadout(user.token,{skinId:'snow-leopard',name:'Путник',quickSlots:[],requestId:randomUUID()});
  const restored=new ProfileStore(options);
  assert.equal(restored.find(user.token).skinId,'snow-leopard');
  assert.deepEqual(restored.find(user.token).appearance,profile().appearance);
});

test("Personal previews never resurrect retired avatars or create ownership", () => {
  const store=new ProfileStore(),user=store.open(),p=store.find(user.token),config=require('../../config/appearance-testing.json');
  for(const key of ['allAppearanceProfileIds','allPersonalAppearanceProfileIds']){
    config[key].push(p.id);
    try{
      const access=store.view(p).appearance.unlocked;
      assert.equal(identity.skinAllowed('visual-star-lion',{},access),false);
      assert.equal(identity.skinAllowed('snow-leopard',{},access),true);
      assert.equal(p.appearance.purchasedThemes,undefined);
    }finally{config[key].splice(config[key].indexOf(p.id),1);}
  }
});
