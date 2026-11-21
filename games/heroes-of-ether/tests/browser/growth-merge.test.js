/* Браузерный сценарий: growth merge. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { chromium } = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const tests = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(tests, ".tmp-growth-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
const artifacts = path.join(tests, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const app = createGameServer({
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  now: () => 5000,
  rateNow: () => performance.now(),
});
let browser, snapshots;
async function until(check, label) {
  for (let i = 0; i < 160; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw Error("Timeout: " + label);
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${app.httpServer.address().port}`);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    const me = [...app.arena.players.values()][0],
      mainId = me.mainPartId;
    Object.assign(me, {
      level: 501,
      mass: 100,
      radius: radiusForMass(100),
      x: 1200,
      y: 800,
      targetX: 1200,
      targetY: 800,
      stopped: true,
      protectedUntil: 0,
    });
    snapshots = setInterval(() => app.broadcast(), 50);
    await page.waitForTimeout(1000);
    await page.evaluate((mainId) => {
      window.growthFrames = [];
      window.zoomFrames = [];
      window.renderOps = [];
      const view = window.KillexArenaView,
        radius = view.animateRadius,
        zoom = view.updateZoom;
      view.animateRadius = function (body, target, dt) {
        radius(body, target, dt);
        if (body.id === mainId) {
          window.growthFrames.push({ radius: body.radius, target });
          if (window.growthFrames.length > 300) window.growthFrames.shift();
        }
      };
      view.updateZoom = function (camera, target, dt, minimum) {
        const before = camera.scale;
        zoom(camera, target, dt, minimum);
        window.zoomFrames.push({ before, after: camera.scale, target, dt });
        if (window.zoomFrames.length > 300) window.zoomFrames.shift();
      };
      const proto = CanvasRenderingContext2D.prototype,
        rect = proto.fillRect,
        text = proto.fillText,
        arc = proto.arc,
        fill = proto.fill;
      proto.fillRect = function (...args) {
        if (this.canvas.id === "game" && args[0] === 0 && args[1] === 0) window.renderOps = [];
        return rect.apply(this, args);
      };
      proto.fillText = function (value, ...args) {
        if (this.canvas.id === "game" && /^\d[\d\s]*$/.test(String(value)))
          window.renderOps.push({ kind: "mass", value: String(value).replace(/\s/g, "") });
        return text.call(this, value, ...args);
      };
      proto.arc = function (x, y, r, ...args) {
        this.testCircle = { x, y, r };
        return arc.call(this, x, y, r, ...args);
      };
      proto.fill = function (...args) {
        if (this.canvas.id === "game" && this.testCircle)
          window.renderOps.push({ kind: "circle", ...this.testCircle });
        return fill.apply(this, args);
      };
    }, mainId);
    me.mass = 5000;
    me.radius = radiusForMass(5000);
    app.broadcast();
    await until(
      () =>
        page.evaluate(
          (target) =>
            window.growthFrames.some(
              (frame) => frame.target === target && frame.radius < target - 1,
            ),
          me.radius,
        ),
      "intermediate growth frames",
    );
    await until(
      () =>
        page.evaluate(() =>
          window.renderOps.some((op) => op.kind === "mass" && op.value === "5000"),
        ),
      "current mass during animation",
    );
    await page.waitForTimeout(650);
    const motion = await page.evaluate(() => ({
      growth: window.growthFrames,
      zoom: window.zoomFrames,
    }));
    assert.ok(
      motion.growth.some(
        (frame) => frame.target === me.radius && Math.abs(frame.radius - me.radius) < 0.1,
      ),
    );
    assert.ok(
      motion.zoom.some((frame) => frame.after < frame.before && frame.after > frame.target),
    );
    for (const frame of motion.zoom)
      assert.ok(
        Math.abs(Math.log(frame.after / frame.before)) <= 0.18 * frame.dt + 1e-10,
        "bounded zoom on actual rendered frames",
      );
    assert.equal(me.mass, 5000);
    await page.screenshot({ path: path.join(artifacts, "growth-smooth-camera.png") });

    me.parts = [
      { id: "merge-small", mass: 700, radius: radiusForMass(700), x: 1170, y: 800, vx: 0, vy: 0 },
      { id: mainId, mass: 1300, radius: radiusForMass(1300), x: 1200, y: 800, vx: 0, vy: 0 },
    ];
    app.arena.syncParts(me);
    me.mergeAt = 0;
    app.broadcast();
    await page.waitForTimeout(1500);
    const operations = await page.evaluate(() => window.renderOps),
      small = operations.findIndex((op) => op.kind === "mass" && op.value === "700");
    const largeBody = operations.findIndex(
      (op) =>
        op.kind === "circle" &&
        Math.abs(op.x - 1200) < 0.1 &&
        Math.abs(op.y - 800) < 0.1 &&
        Math.abs(op.r - radiusForMass(1300)) < 0.1,
    );
    const largeMass = operations.findIndex((op) => op.kind === "mass" && op.value === "1300");
    assert.ok(
      small >= 0 && largeBody > small && largeMass > largeBody,
      `the foreground body covers the smaller body's mass: ${JSON.stringify({ small, largeBody, largeMass })}`,
    );
    await page.screenshot({ path: path.join(artifacts, "merge-mass-occlusion.png") });
    await page.getByRole("button", { name: "Открыть настройки", exact: true }).click();
    await page.getByRole("switch", { name: "Показывать массу" }).click();
    await until(
      () => page.evaluate(() => !window.renderOps.some((op) => op.kind === "mass")),
      "mass hidden by toggle",
    );
    assert.equal(await page.locator("#massPanel").isVisible(), true);
    await page.getByRole("switch", { name: "Показывать массу" }).click();
    await page.locator("#closeSettings").click();
    me.parts[0].x = me.parts[1].x + me.parts[1].radius - me.parts[0].radius / 3 - 0.001;
    app.arena.moveParts(me, 5000, 0);
    app.broadcast();
    assert.equal(me.parts, null);
    assert.equal(me.mass, 2000);
    await until(
      () =>
        page.evaluate(
          () =>
            window.renderOps.some((op) => op.kind === "mass" && op.value === "2000") &&
            !window.renderOps.some(
              (op) => op.kind === "mass" && ["700", "1300"].includes(op.value),
            ),
        ),
      "merged mass replaces old labels",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: animated growth/current mass, bounded smooth camera, mass occluded by foreground body, toggle/HUD, merged total.",
    );
  } finally {
    clearInterval(snapshots);
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== tests ||
      !path.basename(scratch).startsWith(".tmp-growth-")
    )
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
