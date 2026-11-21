"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  WebSocket = require("ws");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  accounts = require("../../src/server/accounts/account-benefits"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation"),
  { createGameServer } = require("../../src/server/game-server");
const NOW = Date.UTC(2026, 9, 22, 12);

function message(ws, type, send) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", receive);
      reject(Error("Missing message: " + type));
    }, 3000);
    function receive(raw) {
      const value = JSON.parse(raw);
      if (value.type !== type) return;
      clearTimeout(timer);
      ws.off("message", receive);
      resolve(value);
    }
    ws.on("message", receive);
    if (send) ws.send(JSON.stringify(send));
  });
}
async function fixture(t, account) {
  let at = NOW;
  const profiles = new ProfileStore({ now: () => at }),
    session = profiles.open(),
    profile = () => profiles.find(session.token),
    arena = new Arena({ etherCount: 0, random: () => 0 });
  profile().account = { ...accounts.fresh(), ...account };
  const app = createGameServer({
    profiles,
    arena,
    autoTick: false,
    now: () => at - NOW,
    wallNow: () => at,
  });
  t.after(() => app.close());
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${app.httpServer.address().port}`, {
      headers: { Cookie: `sferorumiya_session=${session.token}` },
    });
    const snapshot = await message(ws, "state");
    return {
      ws,
      snapshot,
      player: [...arena.players.values()].find((p) => p.profileId === profile().id),
    };
  };
  return { app, profiles, profile, connect, setTime: (time) => (at = time) };
}

for (const [name, vipUntil, premiumUntil, expected] of [
  ["Базовый", 0, 0, 20],
  ["VIP", NOW + 1000, 0, 50],
  ["Premium", 0, NOW + 1000, 100],
  ["VIP и Premium", NOW + 1000, NOW + 1000, 150],
  ["Истёкшие статусы", NOW, NOW, 20],
]) {
  test(`${name}: стартовая масса и радиус в первом снимке арены`, async (t) => {
    const f = await fixture(t, { vipUntil, premiumUntil }),
      { snapshot, player } = await f.connect(),
      visible = snapshot.players.find((p) => p.id === player.id);
    assert.equal(visible.mass, expected);
    assert.equal(visible.radius, radiusForMass(expected));
    assert.equal(visible.parts.length, 1);
    assert.equal(visible.parts[0].mass, expected);
    assert.equal(player.x, visible.radius, "Spawn margin uses the actual starting radius");
    assert.equal(player.y, visible.radius);
    assert.equal(f.profile().progress.session.xp, 0);
  });
}

test("Новая жизнь: актуальные статусы, повтор без добавления массы, сбой записи и переподключение", async (t) => {
  const f = await fixture(t, { vipUntil: NOW + 1000, premiumUntil: NOW + 2000 }),
    { ws, player } = await f.connect();
  f.setTime(NOW + 1000);
  f.app.tick();
  assert.equal(player.mass, 150, "Expiry does not reduce the current life's mass");
  const oldLife = player.lifeId;
  await message(ws, "lifeEnded", { type: "leaveLife", spawnSerial: player.spawnSerial });
  const continueRequest = {
    type: "continueLife",
    lifeId: oldLife,
    mass: 99999,
    account: { startMass: 99999 },
  };
  assert.equal((await message(ws, "continueResult", continueRequest)).ok, true);
  assert.equal(player.mass, 100);
  f.app.arena.gainMass(player, 33);
  const serial = player.spawnSerial;
  assert.equal((await message(ws, "continueResult", continueRequest)).ok, true);
  assert.equal(player.mass, 133);
  assert.equal(player.spawnSerial, serial);

  // No tick refreshes the cached account before this continuation.
  f.setTime(NOW + 2000);
  const nextLife = player.lifeId;
  await message(ws, "lifeEnded", { type: "leaveLife", spawnSerial: player.spawnSerial });
  const request = { type: "continueLife", lifeId: nextLife },
    save = f.profiles.save;
  f.profiles.save = () => {
    throw Error("TEST disk unavailable");
  };
  assert.equal((await message(ws, "continueResult", request)).ok, false);
  assert.equal(player.dead, true);
  assert.equal(player.spawnSerial, serial);
  f.profiles.save = save;
  assert.equal((await message(ws, "continueResult", request)).ok, true);
  assert.equal(player.mass, 20);

  const disconnected = once([...f.app.wss.clients][0], "close");
  ws.close();
  await disconnected;
  f.profile().account.vipUntil = NOW + 5000;
  const reconnected = await f.connect();
  assert.equal(reconnected.player.mass, 50);
  assert.equal(reconnected.snapshot.players.find((p) => p.id === reconnected.player.id).mass, 50);
});
