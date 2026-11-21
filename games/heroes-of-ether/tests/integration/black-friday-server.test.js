"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager");
const B = require("../../src/server/events/black-friday");
test("shop HTTP authenticates, replays concurrent request once and rolls back write failure", async (t) => {
  const now = Date.UTC(2026, 10, 8, 12),
    profiles = new ProfileStore({ now: () => now }),
    events = new EventManager({ now: () => now });
  profiles.events = events;
  events.apply("test", "start", { eventId: B.manifest.id, revision: 0, requestId: randomUUID() });
  const auth = profiles.open(),
    run = events.active();
  profiles.find(auth.token).wallet.coins = 2000;
  const app = createGameServer({
    profiles,
    events,
    autoTick: false,
    testBots: { enabled: false },
    wallNow: () => now,
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = "http://127.0.0.1:" + app.httpServer.address().port;
  const body = {
    action: "exchange",
    id: "coins",
    runId: run.id,
    day: B.day(now),
    requestId: randomUUID(),
  };
  const post = (input = body, token = auth.token) =>
    fetch(url + "/api/black-friday/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "sferorumiya_session=" + token },
      body: JSON.stringify(input),
    });
  assert.equal((await post(body, "")).status, 401);
  const replies = await Promise.all([post(), post()]);
  assert.deepEqual(
    replies.map((r) => r.status),
    [200, 200],
  );
  const result = await Promise.all(replies.map((r) => r.json()));
  assert.equal(result.filter((r) => r.replay).length, 1);
  assert.equal(profiles.find(auth.token).wallet.coins, 1500);
  assert.equal(result[0].profile.blackFriday.tokens, 10);
  const save = profiles.save;
  profiles.save = () => {
    throw Error("disk failure");
  };
  assert.equal((await post({ ...body, requestId: randomUUID() })).status, 500);
  profiles.save = save;
  assert.equal(profiles.find(auth.token).wallet.coins, 1500);
  assert.equal((await post({ ...body, requestId: randomUUID(), id: "hacked" })).status, 409);
});
