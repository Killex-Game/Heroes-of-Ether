/* Браузерный сценарий: touch layout. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events");
const { chromium } = require("playwright"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation");
const root = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(root, ".tmp-layout-touch-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
let time = 5000,
  browser;
const app = createGameServer({
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  now: () => time,
  rateNow: () => performance.now(),
});
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      }),
      page = await context.newPage();
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const zoom = async (label) => {
      const view = await page.evaluate(() => ({
        scale: visualViewport.scale,
        x: visualViewport.offsetLeft,
        width: innerWidth,
      }));
      assert.ok(Math.abs(view.scale - 1) < 0.001, label + " retains viewport scale");
      assert.equal(view.x, 0, label + " no horizontal shift");
      assert.equal(view.width, page.viewportSize().width, label + " no virtual overflow");
    };
    await zoom("initial");
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await zoom("resize " + width);
      await page.screenshot({
        path: path.join(root, "artifacts", "layout-touch-lobby-" + width + ".png"),
        fullPage: true,
      });
      await zoom("screenshot " + width);
      await page.locator(".side-nav").scrollIntoViewIfNeeded();
      await page.locator(".lobby-header").scrollIntoViewIfNeeded();
      await zoom("scroll " + width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const id = (await (await context.request.get(url + "/api/profile")).json()).profile.id,
      p = app.profiles.byId(id);
    p.inventory.freeze = 1;
    p.inventory.web = 2;
    p.quickSlots = ["freeze", "web"];
    p.revision++;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await zoom("reload");
    await page.locator("#playButton").tap();
    await zoom("tap");
    await page.locator("#arena").waitFor({ state: "visible" });
    time += 2100;
    app.broadcast();
    await page.waitForTimeout(300);
    await zoom("arena");
    await page.screenshot({ path: path.join(root, "artifacts", "layout-touch-arena.png") });
    await page.locator('[data-slot="1"]').tap({ timeout: 5000 });
    assert.equal(p.inventory.freeze, 1);
    await page.locator("#game").tap({ position: { x: 300, y: 420 } });
    await page.waitForFunction(
      () =>
        document.querySelector('[data-slot="1"]').getAttribute("aria-label") === "Пустой слот A",
    );
    assert.equal(app.profiles.byId(id).inventory.freeze || 0, 0);
    console.log(
      "Touch lobby → arena → projectile OK; viewport scale and tap coordinates preserved.",
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
    if (path.dirname(scratch) !== root || !path.basename(scratch).startsWith(".tmp-layout-touch-"))
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
