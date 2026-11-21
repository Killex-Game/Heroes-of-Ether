/* Браузерный сценарий: shop section navigation. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { chromium } = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const directory = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(directory, ".tmp-sections-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
const artifacts = path.join(directory, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const app = createGameServer({ arena: new Arena({ etherCount: 0 }), autoTick: false }),
  errors = [];
let browser;
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
    await page.locator("#inventorySection").click();
    assert.equal(await page.locator(".booster-card").count(), 0);
    await page.getByRole("button", { name: "Закрыть бустеры" }).click();
    const profile = (await (await context.request.get(url + "/api/profile")).json()).profile;
    const stored = app.profiles.byId(profile.id);
    stored.inventory = { fire: 10, donut: 2, candy: 5, golden_shield: 1, poison: 0 };
    stored.revision++;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const backgrounds = [];
    for (const mode of ["shop", "inventory", "chests"]) {
      await page.locator(mode === "inventory" ? "#inventorySection" : "#shopSection").click();
      if (mode === "chests")
        await page.getByRole("button", { name: "Сундуки", exact: true }).click();
      assert.equal(await page.locator(".booster-search").count(), 0);
      assert.equal(await page.locator(".booster-count").count(), 0);
      if (mode === "inventory") {
        assert.deepEqual(
          await page
            .locator(".booster-card")
            .evaluateAll((nodes) => nodes.map((n) => n.dataset.boosterId)),
          ["candy", "donut", "golden_shield", "fire"],
        );
        assert.equal(await page.locator(".booster-pack").count(), 0);
      }
      if (mode === "shop") {
        assert.equal(await page.locator(".booster-pack").count(), 29);
        assert.equal(await page.locator(".booster-price-icon").count(), 22);
        const candy = page.locator('[data-booster-id="candy"]');
        assert.equal(await candy.locator(".booster-pack").textContent(), "10 шт.");
        assert.equal(await candy.locator(".booster-action").textContent(), "Купить 10");
        assert.match(
          await candy.locator(".booster-price-icon").getAttribute("src"),
          /currency_coins/,
        );
      }
      backgrounds.push(
        await page.locator("#boosterDialog").evaluate((d) => getComputedStyle(d).backgroundImage),
      );
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#boosterDialog img")].every(
          (i) => i.complete && i.naturalWidth,
        ),
      );
      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        const d = page.locator("#boosterDialog");
        await d.evaluate((n) => (n.scrollTop = 0));
        assert.equal(
          await d.evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
          true,
          "Диалог без переполнения: " + mode + width,
        );
        for (const selector of [
          ".booster-tabs .sf-tab",
          ...(mode !== "chests" ? [".booster-filters .sf-tab"] : []),
        ]) {
          const sizes = await page.locator(selector).evaluateAll((ns) =>
            ns.map((n) => ({
              w: n.getBoundingClientRect().width,
              h: n.getBoundingClientRect().height,
              overflow: n.scrollWidth > n.clientWidth + 1,
            })),
          );
          assert.ok(
            sizes.every((s) => Math.abs(s.w - sizes[0].w) < 1 && s.h === sizes[0].h && !s.overflow),
          );
        }
        await page.screenshot({ path: path.join(artifacts, `sections-${mode}-${width}.png`) });
      }
      await page.getByRole("button", { name: "Закрыть бустеры" }).click();
    }
    assert.equal(new Set(backgrounds).size, 3);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    const player = [...app.arena.players.values()].find((p) => p.profileId === profile.id);
    Object.assign(player, {
      x: 1200,
      y: 800,
      mass: 1000,
      radius: radiusForMass(1000),
      protectedUntil: 0,
    });
    app.broadcast();
    await page.evaluate(() => {
      window.zoomFrames = [];
      window.nameFonts = [];
      const scale = CanvasRenderingContext2D.prototype.scale,
        fill = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.scale = function (x, y) {
        window.zoomFrames.push(x);
        return scale.call(this, x, y);
      };
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        if (text.includes("[1]")) window.nameFonts.push(this.font);
        return fill.call(this, text, ...args);
      };
    });
    // Через 5 с камера достигает нового масштаба; дальние части его не меняют.
    for (let i = 0; i < 5; i++) {
      app.broadcast();
      await page.waitForTimeout(1000);
    }
    const frames = await page.evaluate(() => window.zoomFrames);
    assert.ok(frames.length > 20);
    assert.ok(
      frames.every((v, i) => !i || Math.abs(Math.log(v / frames[i - 1])) <= 0.0061),
      "нет скачка масштаба за кадр",
    );
    const target = frames.at(-1);
    assert.ok(1280 / target <= 1800.01 && 900 / target <= 1200.01);
    const fonts = await page.evaluate(() => window.nameFonts);
    assert.ok(fonts.length > 0);
    player.parts = Array.from({ length: 16 }, (_, i) => ({
      id: i ? `part-${i}` : player.mainPartId,
      mass: i === 0 ? 70 : 62,
      radius: radiusForMass(i === 0 ? 70 : 62),
      x: i % 2 ? 2200 : 200,
      y: i < 8 ? 200 : 1400,
      vx: 0,
      vy: 0,
    }));
    app.arena.syncParts(player);
    app.broadcast();
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => window.zoomFrames.at(-1));
    assert.ok(Math.abs(after - target) < 1e-6, "16 далёких частей не увеличивают обзор");
    await page.screenshot({ path: path.join(artifacts, "camera-split-limited.png") });
    assert.deepEqual(errors, []);
    console.log(
      "Sections browser OK: equal tabs, pack counts, currency icons, owned inventory rarity order, 3 backgrounds, 1280/390/320, smooth bounded camera after 16 splits.",
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== directory ||
      !path.basename(scratch).startsWith(".tmp-sections-")
    )
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
