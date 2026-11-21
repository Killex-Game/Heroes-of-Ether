/* Браузерный сценарий: group effects. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { chromium } = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation"),
  { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
const tests = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(tests, ".tmp-group-effects-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
const artifacts = path.join(tests, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let time = 5000,
  browser,
  timer;
const app = createGameServer({
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  now: () => time,
  rateNow: () => performance.now(),
});
async function until(check, label) {
  for (let i = 0; i < 180; i++) {
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
    const bounds = () =>
      page.evaluate(() =>
        Object.fromEntries(
          ["skinPreview", "previousSkin", "nextSkin"].map((id) => {
            const b = document.getElementById(id).getBoundingClientRect();
            return [id, { x: b.x, y: b.y, width: b.width, height: b.height }];
          }),
        ),
      );
    const before = await bounds();
    await page.locator("#wardrobeSection").click();
    await page.getByRole("button", { name: "Шапки", exact: true }).click();
    await page.getByRole("button", { name: "Надеть Шапка новичка", exact: true }).click();
    await page.getByRole("button", { name: "Снять Шапка новичка", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    assert.deepEqual(await bounds(), before, "шапка не двигает аватар и стрелки");
    await page.waitForFunction(
      () => document.querySelector("#skinPreview .accessory-hat").complete,
    );
    await page.screenshot({ path: path.join(artifacts, "lobby-stable-hat.png") });
    const plus = await page.locator("#walletStatus .currency-add").evaluateAll((buttons) =>
      buttons.map((button) => {
        const b = getComputedStyle(button),
          h = getComputedStyle(button, "::before"),
          v = getComputedStyle(button, "::after");
        return {
          width: parseFloat(b.width),
          height: parseFloat(b.height),
          x: parseFloat(h.left),
          y: parseFloat(h.top),
          vx: parseFloat(v.left),
          vy: parseFloat(v.top),
          content: h.content,
        };
      }),
    );
    assert.equal(plus.length, 3);
    for (const p of plus) {
      assert.ok(Math.abs(p.x - p.width / 2) < 0.1);
      assert.ok(Math.abs(p.y - (p.height * 30) / 64) < 0.1);
      assert.equal(p.vx, p.x);
      assert.equal(p.vy, p.y);
      assert.equal(p.content, '""');
    }
    await page.locator("#wardrobeSection").click();
    await page.getByRole("button", { name: "Снять Шапка новичка", exact: true }).click();
    await page.getByRole("button", { name: "Надеть Шапка новичка", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    assert.deepEqual(await bounds(), before, "снятие тоже не меняет геометрию");
    console.log(
      "PASS: fixed avatar/arrows on equip and remove; all three plus signs centered on SVG circles.",
    );

    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    const me = [...app.arena.players.values()][0];
    me.level = 501;
    me.stopped = true;
    me.protectedUntil = 0;
    me.nextMassDecayAt = Infinity;
    me.parts = [100, 100].map((mass, i) => ({
      id: i ? "secondary" : me.mainPartId,
      mass,
      radius: radiusForMass(mass),
      x: 800 + i * 800,
      y: 800,
      vx: 0,
      vy: 0,
    }));
    app.arena.syncParts(me);
    me.spawnSerial++;
    app.broadcast();
    await page.evaluate(() => {
      window.centerFrames = [];
      window.zoomFrames = [];
      window.effectDraws = [];
      const view = window.KillexArenaView,
        follow = view.followCenter,
        zoom = view.updateZoom;
      view.followCenter = function (camera, target, dt) {
        const before = { x: camera.x, y: camera.y };
        follow(camera, target, dt);
        window.centerFrames.push({ before, x: camera.x, y: camera.y, scale: camera.scale, dt });
        if (window.centerFrames.length > 400) window.centerFrames.shift();
      };
      view.updateZoom = function (camera, target, dt, minimum) {
        const before = camera.scale;
        zoom(camera, target, dt, minimum);
        window.zoomFrames.push({ before, after: camera.scale, target, dt });
        if (window.zoomFrames.length > 400) window.zoomFrames.shift();
      };
      const proto = CanvasRenderingContext2D.prototype,
        clear = proto.fillRect,
        draw = window.KillexEffects.Renderer.prototype.draw;
      proto.fillRect = function (...args) {
        if (this.canvas.id === "game" && args[0] === 0 && args[1] === 0) window.effectDraws = [];
        return clear.apply(this, args);
      };
      window.KillexEffects.Renderer.prototype.draw = function (ctx, ids, position) {
        window.effectDraws.push({
          ids: [...ids],
          position,
          loaded: ids.every((id) => {
            const image = this.images.get(this.icons.get(id)?.url);
            return (
              image && (image.complete === undefined || (image.complete && image.naturalWidth))
            );
          }),
        });
        return draw.call(this, ctx, ids, position);
      };
    });
    timer = setInterval(() => {
      time += 50;
      app.broadcast();
    }, 50);
    await page.waitForTimeout(1000);
    await page.evaluate(() => (window.centerFrames = []));
    const oldCenter = me.x;
    app.arena.ether = [{ id: "food", x: 1600, y: 800, value: 10, radius: 9, color: "#ffd46e" }];
    app.arena.collectEther(time);
    app.broadcast();
    assert.equal(me.parts[1].mass, 110);
    assert.ok(me.x - oldCenter > 19);
    await page.waitForTimeout(800);
    const foodFrames = await page.evaluate(() => window.centerFrames);
    assert.ok(
      foodFrames.every((f) => Math.abs(f.x - 1200) < 1),
      "еда второй части не сдвигает камеру за центром масс на 19 единиц",
    );
    for (const f of foodFrames)
      assert.ok(Math.hypot(f.x - f.before.x, f.y - f.before.y) * f.scale <= 180 * f.dt + 1e-8);

    me.parts = [2000, 500].map((mass, i) => ({
      id: i ? "effect-secondary" : me.mainPartId,
      mass,
      radius: radiusForMass(mass),
      x: 1000 + i * 350,
      y: 800,
      vx: 0,
      vy: 0,
    }));
    app.arena.syncParts(me);
    app.broadcast();
    await page.waitForTimeout(1500);
    const use = (id) =>
      app.arena.prepareBooster(me.id, { boosterId: id, spawnSerial: me.spawnSerial }, time)();
    use("colorful_shield");
    use("speed");
    app.arena.boosterEffects.apply(me, BOOSTERS.get("cake"), time);
    me.effects.web = time + 7000;
    me.effects.freeze = time + 10000;
    use("candy");
    app.broadcast();
    const ids = () => page.evaluate(() => window.effectDraws.flatMap((d) => d.ids));
    await until(async () => {
      const list = await ids();
      return ["colorful_shield", "speed", "cake", "web", "freeze", "candy"].every((id) =>
        list.includes(id),
      );
    }, "все миниатюры эффектов");
    assert.equal(
      await page.evaluate(() => window.effectDraws.filter((d) => d.ids.length).length),
      me.parts.length,
      "эффекты отображаются на каждой части",
    );
    await until(
      () => page.evaluate(() => window.effectDraws.every((d) => d.loaded)),
      "изображения миниатюр",
    );
    await page.screenshot({ path: path.join(artifacts, "arena-effect-miniatures.png") });
    await page.waitForTimeout(1100);
    assert.ok(!(await ids()).includes("candy"));
    assert.ok((await ids()).includes("cake"));
    use("golden_shield");
    app.broadcast();
    await until(async () => {
      const list = await ids();
      return list.includes("golden_shield") && !list.includes("colorful_shield");
    }, "новый щит заменяет старый значок");
    time += 7000;
    app.broadcast();
    await until(async () => !(await ids()).includes("web"), "истечение паутины");
    me.effects = {};
    me.instantEffects = {};
    app.broadcast();
    await until(async () => (await ids()).length === 0, "снятие всех эффектов");
    const zoom = await page.evaluate(() => window.zoomFrames);
    for (const f of zoom) assert.ok(Math.abs(Math.log(f.after / f.before)) <= 0.18 * f.dt + 1e-9);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: real secondary-part food leaves camera stable; bounded pan/zoom; effects loaded on every part, expire, replace shields and show mass booster for one second.",
    );
  } finally {
    clearInterval(timer);
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== tests ||
      !path.basename(scratch).startsWith(".tmp-group-effects-")
    )
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
