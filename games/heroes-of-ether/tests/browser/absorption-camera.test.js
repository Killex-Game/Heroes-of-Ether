/* Браузерный сценарий: absorption camera. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { chromium } = require("playwright"),
  WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { overlapFraction } = require("../../src/server/arena/circle-overlap");
const tests = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(tests, ".tmp-absorption-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
const artifacts = path.join(tests, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let time = 5000,
  browser,
  ticks,
  victimSocket;
const app = createGameServer({
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  now: () => time,
  rateNow: () => performance.now(),
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function position(p, mass, x) {
  Object.assign(p, {
    // Явно обозначаем перенос фикстуры, чтобы камера не летела от случайной точки входа.
    spawnSerial: p.spawnSerial + 1,
    mass,
    radius: radiusForMass(mass),
    x,
    y: 800,
    targetX: x,
    targetY: 800,
    stopped: true,
    protectedUntil: 0,
    nextMassDecayAt: Infinity,
  });
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } }),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    // На 800×600 открытый чат перекрывает цель и намеренно игнорирует наведение.
    await page.getByRole("button", { name: "Свернуть чат", exact: true }).click();
    const a = [...app.arena.players.values()][0];
    const response = await fetch(url + "/api/profile"),
      cookie = response.headers.get("set-cookie").split(";")[0];
    const messages = [];
    const b = await new Promise((resolve, reject) => {
      victimSocket = new WebSocket(url.replace("http:", "ws:"), { headers: { Cookie: cookie } });
      victimSocket.on("error", reject);
      victimSocket.on("message", (raw) => {
        const message = JSON.parse(raw);
        messages.push(message);
        if (message.type === "welcome") resolve(app.arena.players.get(message.id));
      });
    });
    position(a, 1000, 1200);
    position(b, 500, 1300);
    app.broadcast();
    await page.evaluate(() => {
      const view = window.KillexArenaView,
        update = view.updateZoom;
      window.cameraFrames = [];
      view.updateZoom = function (camera, target, dt, minimum) {
        const before = camera.scale;
        update(camera, target, dt, minimum);
        window.testCamera = { x: camera.x, y: camera.y, scale: camera.scale, target };
        window.cameraFrames.push({ before, after: camera.scale, target, dt });
        if (window.cameraFrames.length > 600) window.cameraFrames.shift();
      };
    });
    await page.waitForTimeout(1000);
    ticks = setInterval(() => {
      time += 50;
      app.tick();
    }, 50);
    // Наводим настоящую мышь на неподвижного соперника, пока камера следует
    // за игроком. Проверяем путь ввода браузер -> WebSocket -> полный тик.
    for (let frame = 0; frame < 100 && !b.dead; frame++) {
      const pointer = await page.evaluate(
        ({ x, y }) => ({
          x: innerWidth / 2 + (x - window.testCamera.x) * window.testCamera.scale,
          y: innerHeight / 2 + (y - window.testCamera.y) * window.testCamera.scale,
        }),
        { x: b.x, y: b.y },
      );
      await page.mouse.move(pointer.x, pointer.y);
      await sleep(50);
    }
    const stalled = {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      coverage: overlapFraction(a, b),
      stopped: a.stopped,
    };
    assert.equal(
      b.dead,
      true,
      "cursor must reach the absorption depth without stopping outside it: " +
        JSON.stringify(stalled),
    );
    await sleep(100);
    assert.equal(messages.filter((m) => m.type === "lifeEnded").length, 1);
    assert.equal(a.mass, 1400);
    assert.equal(app.profiles.byId(a.profileId).progress.session.kills, 1);
    clearInterval(ticks);
    ticks = null;
    console.log(
      "PASS: actual mouse follows opponent through the old dead zone; 1000 eats 500, one death and one kill.",
    );

    // При реальных серверных пакетах цель камеры уменьшается и после 25 000,
    // компактная группа больше не требует лишнего отдаления. Кадры плавные.
    await page.setViewportSize({ width: 1366, height: 768 });
    a.level = 501;
    async function scene(total, count) {
      a.parts = Array.from({ length: count }, (_, i) => ({
        id: i ? `camera-${i}` : a.mainPartId,
        mass: total / count,
        radius: radiusForMass(total / count),
        x: 1100 + i * 10,
        y: 800,
        vx: 0,
        vy: 0,
      }));
      app.arena.syncParts(a);
      app.broadcast();
      await page.waitForTimeout(700);
      return page.evaluate(() => window.testCamera.target);
    }
    const low = await scene(2000, 1),
      split = await scene(2000, 8);
    assert.ok(split > low * 0.95 && split < low * 1.3);
    const mass25 = await scene(25000, 1),
      mass50 = await scene(50000, 2),
      mass75 = await scene(75000, 3);
    assert.ok(mass25 > mass50 && mass50 > mass75);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(artifacts, "camera-mass-parts.png") });
    const frames = await page.evaluate(() => window.cameraFrames);
    for (const frame of frames)
      assert.ok(Math.abs(Math.log(frame.after / frame.before)) <= 0.18 * frame.dt + 1e-9);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: camera target reacts to 25k / 50k / 75k and part count, with bounded per-frame speed.",
    );
  } finally {
    clearInterval(ticks);
    victimSocket?.close();
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== tests ||
      !path.basename(scratch).startsWith(".tmp-absorption-")
    )
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
