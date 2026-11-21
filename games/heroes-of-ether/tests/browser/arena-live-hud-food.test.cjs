"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const engines = require("playwright");
const { createGameServer } = require("../../src/server/game-server");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { EventManager } = require("../../src/server/events/event-manager");
const { Arena } = require("../../src/server/arena/arena-simulation");
const E = require("../../src/server/events/easter-hunt");
const out = path.resolve(__dirname, "../../../../artifacts/compact-camera-20261101/browser-live");
fs.mkdirSync(out, { recursive: true });
(async () => {
  for (const engine of ["chromium", "firefox", "webkit"].filter(
    (n) => !process.env.HUD_BROWSER || n === process.env.HUD_BROWSER,
  )) {
    let at = 0;
    const start = Math.floor(Date.now() / 60000) * 60000,
      profiles = new ProfileStore({ now: () => start + at }),
      events = new EventManager({ now: () => start + at });
    events.apply("test", "start", { eventId: E.manifest.id, revision: 0, requestId: randomUUID() });
    profiles.events = events;
    const user = profiles.open();
    // Existing balance must not appear as the collection of this new life.
    profiles.applyArenaProgress(
      randomUUID(),
      Array.from({ length: 8 }, (_, i) => ({
        type: "easterPickup",
        eggType: i % 4,
        runId: events.active().id,
        profileId: user.profile.id,
      })),
      start,
    );
    const app = createGameServer({
      profiles,
      events,
      arena: new Arena({ etherCount: 0 }),
      autoTick: false,
      testBots: { enabled: false },
      now: () => at,
      wallNow: () => start + at,
    });
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    let browser;
    try {
      browser = await engines[engine].launch({
        headless: true,
        ...(process.env.HUD_BROWSER_PATH ? { executablePath: process.env.HUD_BROWSER_PATH } : {}),
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const url = "http://127.0.0.1:" + app.httpServer.address().port;
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await context.addCookies([
        { name: "sferorumiya_session", value: user.token, url, httpOnly: true },
      ]);
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      const notice = page.getByRole("button", { name: "Закрыть объявление об ивенте" });
      if (await notice.isVisible()) await notice.click();
      await page.locator("#playButton").click();
      await page.waitForFunction(() => document.body.dataset.screen === "arena");
      const values = () => page.locator("#easterCounters b").allTextContents();
      assert.deepEqual(await values(), ["0", "0", "0", "0"]);
      await page.evaluate(() => {
        window.liveHudEvents = { lobby: 0, arena: 0 };
        document.addEventListener("killex:profile", () => window.liveHudEvents.lobby++);
        document.addEventListener("killex:arena-profile", () => window.liveHudEvents.arena++);
      });
      const player = [...app.arena.players.values()].find((p) => p.profileId === user.profile.id);
      assert.ok(player);
      app.arena.gainMass(player, 30000 - player.mass);
      player.protectedUntil = 0;
      app.tick();
      app.arena.hazards.items = Array.from({ length: 4 }, (_, i) => ({
        ...app.arena.hazards.create(player.x, player.y, at),
        eggType: i,
      }));
      at = 1000;
      app.tick();
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#easterCounters b")].every((n) => n.textContent === "1"),
      );
      assert.deepEqual(await values(), ["1", "1", "1", "1"]);
      // Run the real mass accrual clock. Nothing is credited before its 30s boundary.
      for (; at < 29950; at += 50) app.tick();
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(await page.locator("#arenaXp").textContent(), "0");
      for (; at < 32000; at += 50) app.tick();
      await page.waitForFunction(
        () => Number(document.getElementById("arenaXp").textContent.replace(/\s/g, "")) > 0,
      );
      const xp = profiles.view(profiles.find(user.token)).progress.arenaXp;
      assert.equal(Number((await page.locator("#arenaXp").textContent()).replace(/\s/g, "")), xp);
      const eventCounts = await page.evaluate(() => window.liveHudEvents);
      assert.equal(eventCounts.lobby, 0, "arena counters must not redraw the hidden lobby");
      assert.ok(eventCounts.arena > 0);
      await page
        .locator("#massPanel")
        .screenshot({ path: path.join(out, engine + "-live-hud.png") });
      const rendering = await page.evaluate(async () => {
        const food = new window.KillexArenaArt.FoodRenderer();
        while (!food.tiles.size) await new Promise((r) => setTimeout(r, 10));
        const orb = { id: "edge", x: 128, y: 128, radius: 5.5, value: 1 };
        food.sync([orb], 1000);
        food.sync([], 1050);
        food.advance(1049);
        const before = food.food.size;
        food.advance(1050);
        const after = food.food.size;
        food.sync([orb]);
        // Whole sprite must match direct painting at its tile's corner, at every zoom.
        const differences = [];
        for (const scale of [0.37, 0.73, 1, 1.25, 1.91]) {
          const cached = document.createElement("canvas"),
            direct = document.createElement("canvas");
          cached.width = direct.width = cached.height = direct.height = 400;
          const a = cached.getContext("2d"),
            b = direct.getContext("2d");
          a.setTransform(scale, 0, 0, scale, 0.37, 0.63);
          b.setTransform(scale, 0, 0, scale, 0.37 + 64 * scale, 0.63 + 64 * scale);
          food.drawVisible(a, { left: 0, top: 0, right: 400, bottom: 400 });
          // Moving a droplet from the middle to a tile corner must not cut its art.
          const centered = new window.KillexArenaArt.FoodRenderer();
          centered.tiles = food.tiles;
          centered.sync([{ ...orb, x: 64, y: 64 }]);
          centered.drawVisible(b, { left: 0, top: 0, right: 400, bottom: 400 });
          const ap = a.getImageData(0, 0, 400, 400).data,
            bp = b.getImageData(0, 0, 400, 400).data;
          let changed = 0,
            error = 0,
            alpha = 0;
          for (let i = 0; i < ap.length; i++) {
            if (ap[i] !== bp[i]) changed++;
            error += Math.abs(ap[i] - bp[i]);
            if (i % 4 === 3) alpha += bp[i];
          }
          differences.push({ changed, error, alpha, ratio: error / alpha });
        }
        const bg = new window.KillexArenaBackgrounds.Renderer();
        bg.select("easter-meadow");
        await bg.images.get("easter-meadow").decode();
        const sample = document.createElement("canvas");
        sample.id = "foodSeamsSample";
        sample.width = 900;
        sample.height = 600;
        sample.style.cssText = "position:fixed;inset:0;z-index:2147483647;width:900px;height:600px";
        document.body.append(sample);
        const samplePaint = sample.getContext("2d");
        samplePaint.setTransform(0.73, 0, 0, 0.73, 0.37, 0.63);
        bg.draw(
          samplePaint,
          { width: 6000, height: 6000 },
          { left: 0, top: 0, right: 900 / 0.73, bottom: 600 / 0.73, scale: 0.73 },
        );
        const samples = Array.from({ length: 9 }, (_, i) => ({
          ...orb,
          id: String(i),
          x: 128 + (i % 3) * 256,
          y: 128 + Math.floor(i / 3) * 256,
        }));
        const sampleFood = new window.KillexArenaArt.FoodRenderer();
        sampleFood.tiles = food.tiles;
        sampleFood.sync(samples);
        sampleFood.drawVisible(samplePaint, { left: 0, top: 0, right: 1300, bottom: 900 });
        // A uniform texture makes even a one-pixel gap between repeated tiles measurable.
        const texture = document.createElement("canvas");
        texture.width = texture.height = 32;
        texture.getContext("2d").fillStyle = "#ff0000";
        texture.getContext("2d").fillRect(0, 0, 32, 32);
        bg.texture = () => ({ source: texture, width: 28, height: 28, gutter: 2 });
        let gaps = 0;
        for (const scale of [0.37, 0.73, 1.25]) {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 700;
          const ctx = canvas.getContext("2d");
          ctx.setTransform(scale, 0, 0, scale, 0.37, 0.63);
          bg.draw(
            ctx,
            { width: 6000, height: 6000 },
            { left: 0, top: 0, right: 700 / scale, bottom: 700 / scale, scale },
          );
          const pixels = ctx.getImageData(4, 4, 690, 690).data;
          for (let i = 0; i < pixels.length; i += 4)
            if (pixels[i] !== 255 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0) gaps++;
        }
        return { before, after, differences, gaps, cells: food.cells.size };
      });
      assert.equal(rendering.before, 1);
      assert.equal(rendering.after, 0);
      assert.equal(rendering.cells, 1);
      console.log(JSON.stringify(rendering));
      assert.ok(rendering.differences.every((n) => n.ratio < 0.02));
      assert.equal(rendering.gaps, 0);
      await page
        .locator("#foodSeamsSample")
        .screenshot({ path: path.join(out, engine + "-food-seams.png") });
      assert.deepEqual(errors, []);
      console.log(
        engine +
          ": live eggs and 30s XP via WebSocket, no hidden-lobby updates, food timeline and fractional tile seams passed; XP=" +
          xp,
      );
    } finally {
      await browser?.close();
      await app.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
