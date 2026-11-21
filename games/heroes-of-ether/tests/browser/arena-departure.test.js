"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { once } = require("node:events"),
  engines = require("playwright"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation"),
  { createGameServer } = require("../../src/server/game-server");
const artifacts = path.resolve(__dirname, "../artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let browser;
(async () => {
  for (const engine of ["chromium", "firefox", "webkit"]) {
    let time = 5000;
    const arena = new Arena({ etherCount: 0 }),
      app = createGameServer({
        arena,
        autoTick: false,
        now: () => time,
        testBots: { enabled: false },
      });
    try {
      app.httpServer.listen(0, "127.0.0.1");
      await once(app.httpServer, "listening");
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        window.departureDraws = [];
        const Socket = window.WebSocket;
        window.WebSocket = class extends Socket {
          constructor(...args) {
            super(...args);
            this.addEventListener("message", ({ data }) => {
              const message = JSON.parse(data);
              if (message.type === "state") window.departureState = message;
            });
          }
        };
        const arc = CanvasRenderingContext2D.prototype.arc;
        CanvasRenderingContext2D.prototype.arc = function (x, y, radius, ...rest) {
          if (this.canvas.id === "game") {
            departureDraws.push({ radius, alpha: this.globalAlpha });
            if (departureDraws.length > 200) departureDraws.shift();
          }
          return arc.call(this, x, y, radius, ...rest);
        };
      });
      await page.goto(`http://127.0.0.1:${app.httpServer.address().port}`);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.locator("#playButton").click();
      await page.locator("#arena").waitFor({ state: "visible" });
      const viewer = [...arena.players.values()][0],
        leaving = arena.addPlayer(time, "leaving-model");
      Object.assign(leaving, {
        name: "Ушедший игрок",
        x: viewer.x + 200,
        y: viewer.y,
        mass: 1000,
        radius: radiusForMass(1000),
        protectedUntil: 0,
      });
      arena.clampPlayer(leaving);
      arena.leaveRemnant(leaving, time);
      arena.removePlayer(leaving.id);
      app.broadcast();
      await page.waitForFunction(
        (radius) => departureDraws.some((d) => d.radius === radius && d.alpha === 1),
        leaving.radius,
      );
      await page.screenshot({ path: path.join(artifacts, `${engine}-departure-visible.png`) });
      await page.evaluate(() => {
        departureDraws.length = 0;
      });
      time = 20500;
      app.broadcast();
      await page.waitForFunction(
        (radius) =>
          departureDraws.some((d) => d.radius === radius && d.alpha > 0.15 && d.alpha < 0.6),
        leaving.radius,
      );
      assert.equal(
        await page.evaluate(
          (radius) => departureDraws.some((d) => d.radius === radius && d.alpha === 1),
          viewer.radius,
        ),
        true,
        "живой игрок сохраняет непрозрачность",
      );
      await page.screenshot({ path: path.join(artifacts, `${engine}-departure-fading.png`) });
      time = 21000;
      app.tick();
      await page.waitForFunction(() => departureState.players.every((p) => !p.departure));
      await page.evaluate(() => {
        departureDraws.length = 0;
      });
      await page.waitForTimeout(200);
      assert.equal(
        await page.evaluate(
          (radius) => departureDraws.some((d) => d.radius === radius),
          leaving.radius,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      console.log(`${engine}: visible → fading → removed, other player opaque OK`);
    } finally {
      if (browser) await browser.close();
      browser = null;
      await app.close();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
