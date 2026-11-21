"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  engines = require("playwright");
const { createGameServer } = require("../../src/server/game-server");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { EventManager } = require("../../src/server/events/event-manager");
const out = process.env.HAZARDS_OUTPUT || path.resolve("artifacts/arena-hazards-browser");
fs.mkdirSync(out, { recursive: true });
(async () => {
  const report = [];
  for (const engine of ["chromium", "firefox", "webkit"]) {
    let time = 3000;
    const at = Date.now(),
      profiles = new ProfileStore({ now: () => at + time }),
      events = new EventManager({ now: () => at + time }),
      auth = profiles.open(),
      app = createGameServer({
        profiles,
        events,
        arena: new Arena({ etherCount: 0 }),
        now: () => time,
        wallNow: () => at + time,
        autoTick: false,
        testBots: { enabled: false },
      });
    app.arena.chooseSpawn = () => ({ x: 1800, y: 1200 });
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    let browser;
    try {
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const url = "http://127.0.0.1:" + app.httpServer.address().port,
        context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await context.addCookies([
        { name: "sferorumiya_session", value: auth.token, url, httpOnly: true },
      ]);
      const page = await context.newPage(),
        errors = [],
        missing = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.status() === 404) missing.push(new URL(r.url()).pathname);
      });
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.locator("#playButton").click();
      await page.waitForFunction(() => document.body.dataset.screen === "arena");
      app.tick();
      const p = [...app.arena.players.values()].find((p) => p.profileId === auth.profile.id),
        h = app.arena.hazards;
      assert.equal(h.items.length, 25);
      Object.assign(p, {
        x: 1800,
        y: 1200,
        targetX: 1800,
        targetY: 1200,
        protectedUntil: 0,
        stopped: true,
      });
      app.arena.gainMass(p, 300 - p.mass);
      const parent = h.create(p.x + 170, p.y, time);
      h.items = [parent];
      h.nextAt = Infinity;
      time += 1000;
      app.arena.tick++;
      app.broadcast();
      await page.waitForTimeout(250);
      await page.mouse.move(920, 450);
      for (let i = 0; i < 11; i++) {
        await page.waitForTimeout(350);
        time += 1000;
        await page.keyboard.press("w");
        for (let retry = 0; retry < 200 && !app.arena.ether.length; retry++)
          await page.waitForTimeout(10);
        assert.ok(app.arena.ether.length, "W arrives over websocket, pellet " + (i + 1));
        time += 1000;
        app.tick();
        assert.equal(parent.mass, i === 10 ? 50 : 50 + (i + 1) * 5);
        assert.equal(h.items.length, i === 10 ? 2 : 1);
        assert.equal(p.mass, 300 - (i + 1) * 5);
      }
      assert.equal(h.items.length, 2);
      for (let i = 0; i < 14; i++) {
        time += 50;
        app.tick();
        await page.waitForTimeout(50);
      }
      assert.ok(h.items[1].x > parent.x);
      // Put visible hazards around the player for desktop and narrow-screen inspection.
      h.items = [-1, 1].map((side) => h.create(p.x + side * 150, p.y + 140, time));
      app.broadcast();
      for (const [width, height] of [
        [1366, 900],
        [390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(out, engine + "-" + width + ".png") });
      }
      assert.equal(await page.locator("#easterCounters").isVisible(), false);
      // Observe real canvas painting, including labels, on overlapping player/hazard sprites.
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.evaluate(() => {
        window.__hazardLayerTrace = [];
        const view = window.KillexArenaView,
          follow = view.followCenter;
        view.followCenter = function (...args) {
          window.__lastHazardLayerTrace = window.__hazardLayerTrace;
          window.__hazardLayerTrace = [];
          return follow.apply(this, args);
        };
        const renderer = window.KillexEasterRenderer,
          draw = renderer.draw;
        renderer.draw = function (...args) {
          for (const item of args[1]) window.__hazardLayerTrace.push("hazard");
          return draw.apply(this, args);
        };
        const fillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (...args) {
          if (this.canvas.id === "game" && String(args[0]).includes("Тень"))
            window.__hazardLayerTrace.push("player");
          return fillText.apply(this, args);
        };
      });
      const layering = [];
      for (const eggType of [null, 1]) {
        for (const playerMass of [20, 100, 50]) {
          Object.assign(p, { name: "Тень", mass: playerMass, radius: radiusForMass(playerMass) });
          const cover = h.create(p.x, p.y, time);
          cover.eggType = eggType;
          h.items = [cover];
          // Advance the network clock without physics: the overlapped larger cell must not eat it.
          time += 1000;
          app.arena.tick++;
          app.broadcast();
          const expected = playerMass < 50 ? ["player", "hazard"] : ["hazard", "player"];
          await page.waitForTimeout(400);
          await page.waitForFunction(
            (expected) =>
              JSON.stringify(window.__lastHazardLayerTrace) === JSON.stringify(expected),
            expected,
          );
          if (playerMass !== 50)
            await page.screenshot({
              path: path.join(
                out,
                engine +
                  "-cover-" +
                  (eggType === null ? "thorn" : "egg") +
                  "-" +
                  playerMass +
                  ".png",
              ),
            });
          layering.push({
            eggType,
            playerMass,
            order: await page.evaluate(() => window.__lastHazardLayerTrace),
          });
        }
      }
      Object.assign(p, {
        x: 1800,
        y: 1200,
        targetX: 1800,
        targetY: 1200,
        mass: 300,
        radius: radiusForMass(300),
        stopped: true,
        nextMassDecayAt: Infinity,
      });
      p.effects.golden_shield = time + 10000;
      const covered = h.create(p.x, p.y, time);
      covered.x = p.x + p.radius + 1;
      h.items = [covered];
      h.nextAt = Infinity;
      time += 50;
      app.tick();
      assert.ok(h.items.includes(covered));
      assert.equal(app.arena.bodies(p).length, 1);
      covered.x = p.x + p.radius - 1;
      time += 50;
      app.tick();
      assert.ok(!h.items.includes(covered));
      assert.equal(app.arena.bodies(p).length, 3);
      assert.equal(p.mass, 350);
      assert.ok(p.effects.golden_shield > time);
      for (let frame = 0; frame < 10; frame++) {
        time += 50;
        app.tick();
        await page.waitForTimeout(25);
      }
      assert.equal(app.arena.bodies(p).length, 3);
      assert.equal(p.mass, 350);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(out, engine + "-covered-with-shield.png") });
      assert.deepEqual(errors, []);
      assert.deepEqual(missing, []);
      report.push({
        engine,
        baseline: 25,
        websocketFeeding: true,
        reproduction: true,
        coverageWithShield: true,
        movement: true,
        layering,
        errors,
        missing,
      });
      console.log(engine + ": hazard flow passed");
    } finally {
      await browser?.close();
      await app.close();
    }
  }
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
