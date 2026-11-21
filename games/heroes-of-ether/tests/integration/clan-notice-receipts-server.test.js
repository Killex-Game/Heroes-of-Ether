"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  chests = require("../../src/server/clans/clan-chest-rewards");

test("Profile API removes notices at 24 hours and accepts a stale Read action without claiming the chest", async (t) => {
  let now = Date.UTC(2026, 9, 26, 10);
  const profiles = new ProfileStore({ now: () => now }),
    auth = profiles.open(),
    get = () => profiles.find(auth.token);
  get().account = {
    dailyDay: null,
    dailyAmount: 0,
    vipUntil: now + 3 * 86400000,
    premiumUntil: now + 3 * 86400000,
  };
  chests.grant(get(), "high", now, { claimRequired: true });
  const before = structuredClone(get().clanChests),
    app = createGameServer({ profiles, autoTick: false, testBots: { enabled: false } });
  app.wallNow = () => now;
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`,
    headers = { Cookie: `sferorumiya_session=${auth.token}`, "Content-Type": "application/json" },
    profile = async () => (await (await fetch(url + "/api/profile", { headers })).json()).profile;
  now += 86400000 - 1;
  assert.equal((await profile()).clanChests.notices.length, 1);
  now++;
  assert.deepEqual((await profile()).clanChests.notices, []);
  assert.deepEqual(get().clanChests.notices, []);
  const body = JSON.stringify({
    action: "dismiss",
    chestId: before.notices[0].id,
    requestId: randomUUID(),
  });
  for (const replay of [false, true]) {
    const response = await fetch(url + "/api/clan-chests/action", {
      method: "POST",
      headers,
      body,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).replay, replay);
  }
  assert.deepEqual(get().clanChests.items, before.items);
});
test("Clan display acknowledgements require the owner's session and retain chest claims", async (t) => {
  const profiles = new ProfileStore(),
    auth = profiles.open(),
    get = () => profiles.find(auth.token);
  chests.grant(get(), "high", profiles.now(), { claimRequired: true });
  const before = structuredClone(get().clanChests);
  const app = createGameServer({ profiles, autoTick: false, testBots: { enabled: false } });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  const request = {
    action: "notice",
    ids: before.notices.map((n) => n.id),
    requestId: randomUUID(),
  };
  const post = (headers = {}) =>
    fetch(url + "/api/clan-chests/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `sferorumiya_session=${auth.token}`,
        ...headers,
      },
      body: JSON.stringify(request),
    });
  assert.equal((await post({ Cookie: "" })).status, 401);
  assert.equal((await post({ Origin: "https://outside.invalid" })).status, 403);
  assert.equal(get().clanChests.notices[0].notifiedAt, undefined);
  assert.equal((await post()).status, 200);
  assert.equal((await (await post()).json()).replay, true);
  assert.ok(Number.isSafeInteger(get().clanChests.notices[0].notifiedAt));
  assert.deepEqual(get().clanChests.items, before.items);
});
