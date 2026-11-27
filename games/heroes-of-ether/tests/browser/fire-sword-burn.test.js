/* Браузерный сценарий: бросок Меча. */
"use strict";
// Isolated profiles and arena; never touches live saves.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events");
const { chromium } = require("playwright"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { xpForLevel } = require("../../src/server/progression/experience-progression");
const artifacts = path.resolve(__dirname, "../artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let now = 5000,
  browser,
  timer;
const app = createGameServer({
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  now: () => now,
  rateNow: () => performance.now(),
});
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Timed out");
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(r.status() + " " + r.url());
    });
    await page.addInitScript(() => performance.setResourceTimingBufferSize(6000));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const profile = (await (await context.request.get(url + "/api/profile")).json()).profile,
      stored = app.profiles.byId(profile.id);
    stored.level = 121;
    stored.progress.xp = xpForLevel(121);
    stored.personal = { nameSet: true, introPending: false, gender: "male", vkUrl: "" };
    stored.loginReward = {date: require("../../src/server/accounts/account-benefits").loginRewardDay(Date.now()), day: 1};
    stored.inventory.fire_sword = 10;
    stored.quickSlots = ["fire_sword"];
    stored.revision++;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    app.arena.chooseSpawn = () => ({ x: 1200, y: 900 });
    await page.getByRole("button", {name: "Закрыть новости", exact: true}).click();
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    const a = [...app.arena.players.values()].find((p) => p.profileId === profile.id),
      b = app.arena.addPlayer(0, "target");
    Object.assign(a, {
      x: 1200,
      y: 900,
      targetX: 2200,
      targetY: 900,
      mass: 1000,
      radius: radiusForMass(1000),
      protectedUntil: 0,
    });
    Object.assign(b, {
      x: 1400,
      y: 900,
      targetX: 1400,
      targetY: 900,
      protectedUntil: 0,
      skinId: "moon-dragon",
      name: "Цель",
    });
    b.parts = [
      { id: b.mainPartId, x: 1400, y: 900, mass: 1000, radius: radiusForMass(1000) },
      { id: "safe-part", x: 1450, y: 1200, mass: 500, radius: radiusForMass(500) },
    ];
    app.arena.syncParts(b);
    app.broadcast();
    timer = setInterval(() => app.broadcast(), 50);
    await page.mouse.move(1100, 450);
    await page.waitForTimeout(150);
    await page.keyboard.press("KeyA");
    await until(() => app.arena.combat.shots.some(s => s.boosterId === "fire_sword"));
    assert.equal(app.profiles.byId(profile.id).inventory.fire_sword, 9);
    const shot = app.arena.combat.shots.find(s => s.boosterId === "fire_sword");
    // Position the first target on the actual aiming vector sent by the browser.
    b.parts[0].x = shot.x + shot.dx * 180;
    b.parts[0].y = shot.y + shot.dy * 180;
    app.arena.syncParts(b);
    app.broadcast();
    await page.waitForFunction(() => performance.getEntriesByType("resource").some(r => r.name.includes("/sword.webp")));
    now = 6500;
    app.arena.combat.update(now);
    app.broadcast();
    assert.deepEqual(b.parts.map(p => p.mass), [300, 500, 700]);
    assert.equal(b.mass, 1500);
    assert.equal(app.arena.combat.shots.length, 0);
    const packet = app.arena.snapshot(now).players.find(p => p.id === b.id);
    assert.ok(packet.parts.every(p => !p.burnMs));
    await page.screenshot({ path: path.join(artifacts, "sword-split.png") });
    assert.deepEqual(errors, []);
    console.log("PASS: activation from saved inventory, one charge consumed, sword sprite loaded, hit part split 30/70.");
  } finally {
    clearInterval(timer);
    await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
