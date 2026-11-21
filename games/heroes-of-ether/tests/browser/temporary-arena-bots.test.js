/* Браузерный сценарий: temporary arena bots. */
"use strict";
// Isolated fixture: no writes to the live player database.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { chromium } = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { createGameServer } = require("../../src/server/game-server"),
  { radiusForMass } = require("../../src/server/arena/arena-simulation");
const accounts = require("../../src/server/accounts/account-benefits");
const profiles = new ProfileStore(),
  opened = profiles.open(),
  hero = profiles.find(opened.token);
hero.name = "Проверка рамки";
hero.personal = { nameSet: true, gender: "male", vkUrl: "" };
hero.outfit = { hat: "novice_hat", bow: "novice_bow" };
hero.account = accounts.fresh();
hero.account.vipUntil = hero.account.premiumUntil = Date.now() + 86400000;
const app = createGameServer({ profiles, testBots: { enabled: true } });
const chooseSpawn = app.arena.chooseSpawn.bind(app.arena);
app.arena.chooseSpawn = (id) => (app.arena.players.size ? chooseSpawn(id) : { x: 1200, y: 800 });
const artifacts = path.join(__dirname, "../artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const errors = [];
let browser;
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
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
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addCookies([{ name: "sferorumiya_session", value: opened.token, url }]);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.stack));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    assert.equal(app.bots.status().activeBots, 0);
    await page.locator("#settingsButton").click();
    const heading = await page.locator(".settings-heading").evaluate((x) => {
      const s = getComputedStyle(x);
      return { bg: s.backgroundImage, border: s.borderTopColor };
    });
    assert.ok(heading.bg.includes("169, 75, 197"));
    assert.equal(heading.border, "rgb(193, 138, 37)");
    await page.locator("#closeSettings").click();
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    await until(() => app.bots.status().activeBots === 15);
    const player = [...app.arena.players.values()].find((p) => !p.isTestBot);
    Object.assign(player, {
      mass: 2000,
      radius: radiusForMass(2000),
      x: 1200,
      y: 800,
      targetX: 1200,
      targetY: 800,
    });
    app.arena.backgroundId = "cobblestone";
    app.broadcast();
    await page.waitForFunction(
      () => Number(document.getElementById("mass").textContent.replace(/\D/g, "")) >= 2000,
    );
    // Check the actual renderer, including reduced-motion fallback and Premium priority.
    const render = await page.evaluate(async () => {
      const frame = window.KillexArenaArt.accountFrame,
        canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext("2d", { willReadFrequently: true }),
        strokes = [],
        stroke = ctx.stroke.bind(ctx);
      ctx.stroke = function () {
        strokes.push(this.strokeStyle);
        stroke();
      };
      frame(ctx, { vip: true, premium: true }, 128, 128, 80, 1, 0);
      function pixels(at, account = { premium: true }, radius = 80) {
        ctx.clearRect(0, 0, 256, 256);
        frame(ctx, account, 128, 128, radius, 1, at);
        return Array.from(ctx.getImageData(0, 0, 256, 256).data);
      }
      const start = pixels(0),
        quarter = pixels(2000),
        loop = pixels(8000),
        both = pixels(0, { vip: true, premium: true });
      return {
        strokes: strokes.slice(0, 3),
        continuous: start.every((n, i) => n === loop[i]),
        moves: start.some((n, i) => n !== quarter[i]),
        premiumPriority: start.every((n, i) => n === both[i]),
      };
    });
    assert.deepEqual(render.strokes, ["#d85aff", "#8b0bca", "#f1baff"]);
    assert.ok(render.continuous && render.moves && render.premiumPriority, JSON.stringify(render));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const staticStrokes = await page.evaluate(() => {
      let count = 0;
      const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true }),
        stroke = ctx.stroke.bind(ctx);
      const draw = (at) => {
        ctx.clearRect(0, 0, 300, 150);
        window.KillexArenaArt.accountFrame(ctx, { vip: true }, 100, 75, 50, 1, at);
        return Array.from(ctx.getImageData(0, 0, 300, 150).data);
      };
      const angles = [],
        rotate = ctx.rotate.bind(ctx);
      ctx.rotate = (n) => {
        angles.push(n);
        rotate(n);
      };
      ctx.stroke = () => {
        count++;
        stroke();
      };
      const a = draw(0),
        b = draw(2000);
      return {
        count,
        angles,
        stable: a.every((n, i) => n === b[i]),
        motion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        maxDiff: a.reduce((m, n, i) => Math.max(m, Math.abs(n - b[i])), 0),
      };
    });
    assert.equal(staticStrokes.count, 6);
    assert.deepEqual(staticStrokes.angles, [0, 0]);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    // Informational measurement only: graphics timing varies with host and headless mode.
    const timing = await page.evaluate(async () => {
      const times = [];
      let previous = performance.now();
      for (let i = 0; i < 90; i++) {
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        times.push(now - previous);
        previous = now;
      }
      times.sort((a, b) => a - b);
      return { medianMs: times[45], p95Ms: times[85] };
    });
    await page.screenshot({ path: path.join(artifacts, "arena-premium-test-bots.png") });
    await page.locator("#leaveButton").click();
    await page.locator("#leaveYes").click();
    await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
    await until(() => app.bots.status().activeBots === 0);
    assert.equal(
      Object.values(profiles.data.profiles).filter((p) => p.testBot && p.progress.session).length,
      0,
    );
    await page.locator("#lifeLobby").click();
    await page.locator("#lobby").waitFor({ state: "visible" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: idle lobby, 15 bots on entry, Premium priority, reduced motion, bright header, bots gone on exit. Frame timing:",
      JSON.stringify(timing),
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})();
