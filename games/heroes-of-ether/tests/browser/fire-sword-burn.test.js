/* Браузерный сценарий: fire sword burn. */
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
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const profile = (await (await context.request.get(url + "/api/profile")).json()).profile,
      stored = app.profiles.byId(profile.id);
    stored.level = 121;
    stored.progress.xp = xpForLevel(121);
    stored.inventory.fire_sword = 10;
    stored.quickSlots = ["fire_sword"];
    stored.revision++;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    app.arena.chooseSpawn = () => ({ x: 1200, y: 900 });
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
      name: "Горящий шар",
    });
    b.parts = [
      { id: b.mainPartId, x: 1400, y: 900, mass: 1000, radius: radiusForMass(1000) },
      { id: "safe-part", x: 1450, y: 1200, mass: 500, radius: radiusForMass(500) },
    ];
    app.arena.syncParts(b);
    await page.evaluate(() => {
      const draw = window.KillexEffects.drawBurn;
      window.burnDraws = 0;
      window.KillexEffects.drawBurn = (...args) => {
        window.burnDraws++;
        return draw(...args);
      };
      const drawShots = window.KillexProjectiles.Renderer.prototype.draw;
      window.windPaths = 0;
      window.KillexProjectiles.Renderer.prototype.draw = function (ctx, ...args) {
        const curve = ctx.quadraticCurveTo;
        ctx.quadraticCurveTo = function (...a) {
          window.windPaths++;
          return curve.apply(this, a);
        };
        try {
          return drawShots.call(this, ctx, ...args);
        } finally {
          ctx.quadraticCurveTo = curve;
        }
      };
    });
    app.broadcast();
    timer = setInterval(() => app.broadcast(), 50);
    await page.mouse.move(1100, 450);
    await page.waitForTimeout(150);
    await page.keyboard.press("KeyA");
    await until(() => app.arena.combat.swords.length === 1);
    assert.equal(app.profiles.byId(profile.id).inventory.fire_sword, 9);
    // Freeze aim exactly along the target; server movement is disabled in this fixture.
    a.targetX = 2200;
    a.targetY = 900;
    app.arena.combat.updateSwords(now);
    app.broadcast();
    assert.equal(b.swordBurns.length, 1);
    await page.waitForFunction(() => window.burnDraws > 0);
    await page.waitForFunction(
      () => document.querySelector(".booster-cooldown-seconds")?.textContent === "5",
    );
    now = 7000;
    app.arena.boosterEffects.tick(b, now);
    app.arena.combat.updateSwords(now);
    app.broadcast();
    assert.deepEqual(
      b.parts.map((p) => p.mass),
      [800, 500],
    );
    await page.screenshot({ path: path.join(artifacts, "fire-sword-burning-part.png") });
    a.targetY = 1900;
    a.targetX = 1200;
    app.arena.combat.updateSwords(7100);
    a.targetY = 900;
    a.targetX = 2200;
    now = 7500;
    app.arena.combat.updateSwords(now);
    app.broadcast();
    assert.deepEqual(
      b.swordBurns.map((burn) => burn.until),
      [8000, 8500],
    );
    assert.equal(b.swordBurns.length, 2);
    app.arena.combat.prepare(
      a,
      require("../../src/server/boosters/booster-catalog").BOOSTERS.get("rocket"),
      { aimX: 1200, aimY: 1600 },
      now,
    )();
    app.broadcast();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.windPaths), 0);
    now = 15000;
    app.arena.boosterEffects.tick(b, now);
    app.arena.combat.updateSwords(now);
    app.broadcast();
    assert.equal(app.arena.combat.swords.length, 0);
    assert.equal(b.swordBurns.length, 0);
    assert.equal(b.parts[0].mass, 236);
    assert.equal(b.parts[1].mass, 500);
    await page.emulateMedia({ reducedMotion: "reduce" });
    app.arena.boosterEffects.apply(
      b,
      require("../../src/server/boosters/booster-catalog").BOOSTERS.get("fire_sword"),
      now,
      b.parts[0],
    );
    app.broadcast();
    const previous = await page.evaluate(() => window.burnDraws);
    await page.waitForFunction((n) => window.burnDraws > n, previous);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: real sword activation/inventory, 5s cooldown, 20% single-part burn in 1s, stacked hits, 2s continuous contact, 10s held lifetime, no wind paths, reduced motion.",
    );
  } finally {
    clearInterval(timer);
    await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
