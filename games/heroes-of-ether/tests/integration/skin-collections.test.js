"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs");
const { randomUUID } = require("node:crypto"),
  { once } = require("node:events"),
  WebSocket = require("ws");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { temporary } = require("../temp");
const catalog = require("../../public/shared/skin-collection-preview"),
  identity = require("../../public/shared/player-identity");
const { createGameServer } = require("../../src/server/game-server");
const purchase = (s, t, id, requestId = randomUUID()) =>
  s.buySkinCollection(t, { collectionId: id, requestId, price: 0, currency: "coins" });
const equip = (s, t, skinId) =>
  s.setLoadout(t, {
    skinId,
    requestId: randomUUID(),
    name: s.find(t).name,
    quickSlots: s.find(t).quickSlots,
  });
test("Ten collections: approved prices, currency order and five complete portraits each", () => {
  assert.deepEqual(
    catalog.collections.map((c) => [c.id, c.currency, c.price]),
    [
      ["workshop", "coins", 3000],
      ["forest", "coins", 3500],
      ["sea", "coins", 3500],
      ["desert", "coins", 5000],
      ["cloud", "crystals", 500],
      ["twilight", "crystals", 750],
      ["snow", "crystals", 1000],
      ["flame", "bucks", 500],
      ["grove", "bucks", 500],
      ["stars", "bucks", 750],
    ],
  );
  assert.equal(identity.collectionSkins.length, 50);
  for (const c of catalog.collections) {
    assert.equal(c.members.length, 5);
    for (const m of c.members) {
      assert.equal(
        identity.skinAllowed(m.id, { vip: true, premium: true }, ["visual", "prism", "glass"]),
        false,
      );
      assert.equal(identity.skinAllowed(m.id, {}, [], [c.id]), true);
      for (const size of [64, 128, 256, 512, 1024])
        assert.ok(
          fs.existsSync(
            path.join(
              __dirname,
              "../../public/assets/skins/collections-v1",
              String(size),
              m.id + ".webp",
            ),
          ),
        );
    }
  }
});
test("Purchase uses server price, unlocks exactly five skins permanently, replay and restart preserve ownership", (t) => {
  const filePath = path.join(temporary(t, "skin-collections"), "profiles.json"),
    s = new ProfileStore({ filePath }),
    u = s.open();
  s.find(u.token).wallet = { coins: 50000, crystals: 10000, bucks: 10000 };
  const balance = { ...s.find(u.token).wallet },
    owned = [];
  for (const c of catalog.collections) {
    assert.throws(() => equip(s, u.token, c.members[0].id), /купи этот набор/);
    const id = randomUUID();
    purchase(s, u.token, c.id, id);
    assert.equal(purchase(s, u.token, c.id, id).replay, true);
    purchase(s, u.token, c.id);
    balance[c.currency] -= c.price;
    owned.push(c.id);
    assert.deepEqual(s.find(u.token).wallet, balance);
    for (const m of c.members) {
      equip(s, u.token, m.id);
      assert.equal(s.view(s.find(u.token)).skinId, m.id);
    }
  }
  const restored = new ProfileStore({ filePath }),
    p = restored.find(u.token);
  assert.deepEqual(p.wallet, balance);
  assert.deepEqual(restored.view(p).purchasedSkinCollections, owned);
  assert.equal(restored.view(p).skinId, catalog.collections.at(-1).members.at(-1).id);
});
test("Insufficient currency, invalid collection, request reuse and persistence failure never grant free ownership", () => {
  const s = new ProfileStore(),
    u = s.open();
  assert.throws(() => purchase(s, u.token, "workshop"), /Недостаточно/);
  assert.throws(() => purchase(s, u.token, "premium"), /не продаётся/);
  s.find(u.token).wallet.coins = 10000;
  const before = structuredClone(s.find(u.token)),
    save = s.save,
    id = randomUUID();
  s.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => purchase(s, u.token, "workshop", id), /disk full/);
  assert.deepEqual(s.find(u.token), before);
  s.save = save;
  purchase(s, u.token, "workshop", id);
  assert.throws(() => purchase(s, u.token, "forest", id));
  assert.deepEqual(s.find(u.token).purchasedSkinCollections, ["workshop"]);
  assert.equal(s.find(u.token).wallet.coins, 7000);
});
test("HTTP durable purchase: concurrent replay, unowned skin rejection and arena purchase lock", async (t) => {
  const app = createGameServer({ autoTick: false, testBots: { enabled: false } });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = "http://127.0.0.1:" + app.httpServer.address().port,
    r = await fetch(url + "/api/profile"),
    cookie = r.headers.get("set-cookie").split(";")[0],
    auth = await r.json();
  const p = app.profiles.byId(auth.profile.id);
  p.wallet.coins = 15000;
  const post = (route, body) =>
    fetch(url + route, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const skin = catalog.get("workshop").members[0].id;
  assert.equal(
    (
      await post("/api/profile/loadout", {
        skinId: skin,
        quickSlots: p.quickSlots,
        name: p.name,
        requestId: randomUUID(),
      })
    ).status,
    409,
  );
  const operation = { collectionId: "workshop", requestId: randomUUID(), price: 1 };
  const results = await Promise.all(
    Array.from({ length: 3 }, () => post("/api/profile/skin-collection", operation)),
  );
  for (const response of results) {
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.profile.wallet.coins, 12000);
    assert.deepEqual(result.profile.purchasedSkinCollections, ["workshop"]);
  }
  const equipped = await post("/api/profile/loadout", {
    skinId: skin,
    quickSlots: p.quickSlots,
    name: p.name,
    requestId: randomUUID(),
  });
  assert.equal(equipped.status, 200);
  const ws = new WebSocket(url.replace("http:", "ws:"), { headers: { Cookie: cookie } });
  t.after(() => ws.terminate());
  await new Promise((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      if (JSON.parse(raw).type === "state") resolve();
    });
  });
  assert.equal(
    (
      await post("/api/profile/skin-collection", {
        collectionId: "forest",
        requestId: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(app.profiles.byId(p.id).wallet.coins, 12000);
});
