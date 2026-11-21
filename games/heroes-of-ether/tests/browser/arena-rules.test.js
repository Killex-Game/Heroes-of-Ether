/* Браузерный сценарий: arena rules. */
"use strict";
const { setNickname } = require("./helpers/profile-controls");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { chromium } = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { xpForLevel } = require("../../src/server/progression/experience-progression"),
  view = require("../../public/shared/arena-camera-and-layout");
const directory = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(directory, ".tmp-arena-rules-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
const artifacts = path.join(directory, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const app = createGameServer({
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => 5000,
    rateNow: () => performance.now(),
  }),
  errors = [];
let browser, timer;
async function until(fn, label) {
  for (let i = 0; i < 240; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error("Timeout: " + label);
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(r.status() + " " + r.url());
    });
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const profile = (await (await context.request.get(url + "/api/profile")).json()).profile,
      stored = app.profiles.byId(profile.id);
    stored.level = 26;
    stored.progress.xp = xpForLevel(26);
    stored.inventory.donut = 5;
    stored.quickSlots = ["donut"];
    stored.revision++;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await setNickname(page, "ДлинноеИмяИгрока");
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    const p = [...app.arena.players.values()].find((p) => p.profileId === profile.id);
    Object.assign(p, {
      x: 1200,
      y: 800,
      targetX: 1200,
      targetY: 800,
      clanPrefix: "ТЕСТ",
      protectedUntil: 0,
    });
    await page.evaluate(() => {
      window.arenaLabels = [];
      window.arenaScales = [];
      const proto = CanvasRenderingContext2D.prototype,
        fillRect = proto.fillRect,
        fillText = proto.fillText,
        scale = proto.scale;
      proto.fillRect = function (...args) {
        if (this.canvas.id === "game" && args[0] === 0 && args[1] === 0) window.arenaLabels = [];
        return fillRect.apply(this, args);
      };
      proto.fillText = function (text, x, y, maxWidth) {
        if (this.canvas.id === "game" && String(text).includes("ДлинноеИмяИгрока"))
          window.arenaLabels.push({ text, x, y, maxWidth, font: this.font });
        return fillText.apply(this, arguments);
      };
      proto.scale = function (x, y) {
        if (this.canvas.id === "game") {
          window.arenaScale = x;
          window.arenaScales.push(x);
        }
        return scale.call(this, x, y);
      };
    });
    app.broadcast();
    timer = setInterval(() => app.broadcast(), 50);
    await page.waitForFunction(() => window.arenaLabels.length === 1);
    const small = await page.evaluate(() => window.arenaLabels[0]),
      base = await page.evaluate(() => window.arenaScale);
    assert.ok(small.maxWidth <= p.radius * base * 2.15);
    assert.ok(!small.text.includes("\n"));
    await page.screenshot({ path: path.join(artifacts, "arena-name-small.png") });
    Object.assign(p, { mass: 1000, radius: radiusForMass(1000) });
    app.broadcast();
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.arenaScale), base, "под 60% обзор не меняется");
    assert.ok(
      parseFloat((await page.evaluate(() => window.arenaLabels[0].font)).match(/[\d.]+px/)[0]) >
        parseFloat(small.font.match(/[\d.]+px/)[0]),
    );
    p.parts = [17999, 17999].map((mass, i) => ({
      id: i ? "other" : p.mainPartId,
      mass,
      radius: radiusForMass(mass),
      x: i ? 1600 : 800,
      y: 800,
      vx: 0,
      vy: 0,
    }));
    app.arena.syncParts(p);
    app.broadcast();
    const target = view.desiredScale(p, 1280, 900, app.arena.world);
    await until(
      () => page.evaluate((t) => Math.abs(window.arenaScale - t) < 1e-6, target),
      "плавный зум до 60%",
    );
    const scales = await page.evaluate(() => window.arenaScales);
    assert.ok(
      scales.every((s, i) => !i || Math.abs(Math.log(s / scales[i - 1])) < 0.0061),
      "без скачков масштаба",
    );
    assert.ok(
      Math.abs(
        (p.parts.reduce((sum, b) => sum + Math.PI * b.radius ** 2, 0) * target ** 2) /
          (1280 * 900) -
          0.6,
      ) < 1e-8,
    );
    assert.equal(
      (await page.evaluate(() => window.arenaLabels)).length,
      1,
      "только один ник на две части",
    );
    assert.equal(
      await page.locator('[data-slot="1"]').isEnabled(),
      true,
      "общая масса больше 18000 не блокирует бустер",
    );
    await page.locator('[data-slot="1"]').click();
    await until(() => p.mass === 35999, "масса до предела главной части");
    await until(
      () => page.locator('[data-slot="1"]').isDisabled(),
      "полный главный шар блокирует расход",
    );
    assert.equal(app.profiles.byId(profile.id).inventory.donut, 4);
    p.parts[1].mass = 10000;
    p.parts[1].radius = radiusForMass(10000);
    app.arena.syncParts(p);
    app.broadcast();
    await page.waitForTimeout(150);
    assert.equal(
      await page.locator('[data-slot="1"]').isDisabled(),
      true,
      "свободное место другой части не принимает бустер",
    );
    p.parts[1].mass = 18000;
    p.parts[1].radius = radiusForMass(18000);
    app.arena.syncParts(p);
    p.clanPrefix = "ТЕСТ";
    app.broadcast();
    await until(
      () =>
        page.evaluate(
          (t) => Math.abs(window.arenaScale - t) < 1e-5,
          view.desiredScale(p, 1280, 900, app.arena.world),
        ),
      "масштаб восстановлен",
    );
    await page.screenshot({ path: path.join(artifacts, "arena-names-split.png") });
    const fixed = await page.evaluate(() => window.arenaScale);
    p.parts[0].x = 400;
    p.parts[1].x = 2000;
    app.arena.syncParts(p);
    app.broadcast();
    await page.waitForTimeout(200);
    assert.ok(
      Math.abs((await page.evaluate(() => window.arenaScale)) - fixed) < 1e-5,
      "разлёт не расширяет обзор",
    );
    // Новая главная часть получает подпись; её прежний владелец подписи лишается.
    p.parts[0].x = 900;
    p.parts[1].x = 1500;
    app.arena.syncParts(p);
    p.mainPartId = "other";
    app.broadcast();
    await page.waitForTimeout(350);
    const labels = await page.evaluate(() => window.arenaLabels);
    assert.equal(labels.length, 1);
    assert.ok(labels[0].x > 640);
    // Мобильный кадр: один длинный ник в одной строке, слот и HUD доступны.
    p.parts[0].x = 1000;
    p.parts[1].x = 1200;
    app.arena.syncParts(p);
    app.broadcast();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const mobileLabels = await page.evaluate(() => window.arenaLabels);
    assert.equal(mobileLabels.length, 1);
    assert.ok(
      mobileLabels[0].x + mobileLabels[0].maxWidth / 2 <= 390,
      "длинный ник не обрезан краем телефона",
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({ path: path.join(artifacts, "arena-names-mobile.png") });
    assert.deepEqual(errors, []);
    console.log(
      "Arena rules browser OK: small/large one-line names, main-only and reassignment, 60% smooth area zoom, no distance zoom, per-part booster limit, desktop/mobile.",
    );
  } finally {
    clearInterval(timer);
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== directory ||
      !path.basename(scratch).startsWith(".tmp-arena-rules-")
    )
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
