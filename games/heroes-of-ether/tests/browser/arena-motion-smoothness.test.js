"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  engines = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { createGameServer } = require("../../src/server/game-server");
const { Arena } = require("../../src/server/arena/arena-simulation");
const output = path.resolve(__dirname, "../../../../artifacts/arena-motion-20261025");
fs.mkdirSync(output, { recursive: true });
const baseline = process.argv.includes("--baseline");
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b),
    mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    n: values.length,
    mean,
    p10: sorted[Math.floor(sorted.length * 0.1)],
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p90: sorted[Math.floor(sorted.length * 0.9)],
    max: sorted.at(-1),
    cv: Math.sqrt(values.reduce((s, n) => s + (n - mean) ** 2, 0) / values.length) / mean,
  };
};
(async () => {
  const reports = [];
  const selected = process.argv.find((a) => a.startsWith("--engine="))?.split("=")[1];
  for (const engine of selected
    ? [selected]
    : baseline
      ? ["chromium"]
      : ["chromium", "firefox", "webkit"]) {
    let seed = 314159;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const profiles = new ProfileStore(),
      arena = new Arena({ random }),
      app = createGameServer({ profiles, arena, autoTick: false, testBots: { enabled: true } });
    let timer, browser;
    const tickMs = [],
      saveMs = [];
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
        const Native = WebSocket;
        window.motionProbe = { received: [], frames: [] };
        const raf = window.requestAnimationFrame;
        window.requestAnimationFrame = (fn) =>
          raf.call(window, (at) => {
            motionProbe.frameAt = at;
            fn(at);
          });
        window.WebSocket = class extends Native {
          constructor(...args) {
            super(...args);
            this.addEventListener("message", (e) => {
              const m = JSON.parse(e.data);
              if (m.type === "welcome") motionProbe.id = m.id;
              if (m.type === "state") {
                const me = m.players.find((p) => p.id === motionProbe.id);
                motionProbe.spawnSerial = me?.spawnSerial;
                motionProbe.partId = me?.parts[0]?.id;
                motionProbe.received.push({
                  at: performance.now(),
                  tick: m.tick,
                  x: me?.parts[0]?.x,
                });
              }
            });
          }
        };
      });
      if (baseline)
        await page.route("**/game-client.js", (route) =>
          route.fulfill({
            contentType: "text/javascript",
            body: fs.readFileSync(
              path.join(output, "../../backups/arena-motion-20261025/game-client.js"),
              "utf8",
            ),
          }),
        );
      await page.goto(`http://127.0.0.1:${app.httpServer.address().port}`);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.locator("#playButton").click();
      await page.locator("#arena").waitFor({ state: "visible" });
      const id = await page.evaluate(() => motionProbe.id),
        player = arena.players.get(id);
      app.tick();
      while (Object.keys(profiles.data.profiles).length < 171) profiles.open();
      for (const p of Object.values(profiles.data.profiles))
        for (let i = 0; i < 125; i++)
          p.receipts[`synthetic-history-${i}`] = JSON.stringify(["fixture", i, "x".repeat(80)]);
      for (const p of arena.players.values()) p.protectedUntil = performance.now() + 120000;
      const fixtureDir = fs.mkdtempSync(path.join(output, "synthetic-"));
      profiles.filePath = path.join(fixtureDir, "profiles.json");
      profiles.save(profiles.data);
      const originalSave = profiles.save.bind(profiles);
      profiles.save = (...args) => {
        const start = performance.now();
        const r = originalSave(...args);
        saveMs.push(performance.now() - start);
        return r;
      };
      Object.assign(player, {
        spawnSerial: player.spawnSerial + 1,
        x: 1800,
        y: 1200,
        targetX: 3300,
        targetY: 1200,
        stopped: false,
        protectedUntil: performance.now() + 120000,
        nextMassDecayAt: Infinity,
      });
      app.broadcast();
      await page.waitForFunction(
        (serial) => motionProbe.spawnSerial === serial,
        player.spawnSerial,
      );
      await page.evaluate(() => {
        const view = KillexArenaView,
          follow = view.followCenter;
        view.followCenter = function (camera, target, dt, ...args) {
          const r = follow.call(this, camera, target, dt, ...args);
          motionProbe.frames.push({
            at: motionProbe.frameAt,
            x: target.x,
            y: target.y,
            dt: dt * 1000,
          });
          return r;
        };
      });
      timer = setInterval(() => {
        const start = performance.now();
        app.tick();
        tickMs.push(performance.now() - start);
      }, 50);
      await page.mouse.move(1250, 450);
      await page.waitForTimeout(2500);
      await page.evaluate(() => {
        motionProbe.frames = [];
        motionProbe.received = [];
      });
      tickMs.length = saveMs.length = 0;
      await page.waitForTimeout(8000);
      const probe = await page.evaluate(() => motionProbe);
      const frames = probe.frames
        .slice(1)
        .map((p, i) => ({ dt: p.at - probe.frames[i].at, dx: p.x - probe.frames[i].x }))
        .filter((p) => p.dt > 2 && p.dt < 250);
      const receives = probe.received.filter((p, i, a) => !i || p.tick !== a[i - 1].tick);
      const report = {
        engine,
        baseline,
        profiles: Object.keys(profiles.data.profiles).length,
        bots: app.bots.status().activeBots,
        saveBytes: fs.statSync(profiles.filePath).size,
        frame: summary(frames.map((p) => p.dt)),
        speed: summary(frames.map((p) => (p.dx / p.dt) * 1000)),
        receive: summary(receives.slice(1).map((p, i) => p.at - receives[i].at)),
        tick: summary(tickMs),
        save: summary(saveMs),
        errors,
      };
      fs.writeFileSync(
        path.join(output, `${baseline ? "baseline" : "current"}-${engine}-samples.json`),
        JSON.stringify(probe),
      );
      reports.push(report);
      console.log(JSON.stringify(report));
      assert.deepEqual(errors, []);
      assert.ok(report.speed.mean > 10);
      assert.ok(report.frame.n > 60);
      if (!baseline)
        assert.ok(
          report.speed.cv < 0.22,
          "Ровное движение без периодического догоняния: " + JSON.stringify(report.speed),
        );
    } finally {
      clearInterval(timer);
      if (browser) await browser.close();
      await app.close();
    }
  }
  fs.writeFileSync(
    path.join(output, baseline ? "baseline.json" : "verified.json"),
    JSON.stringify(reports, null, 2),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
