/* Браузерный сценарий: wardrobe. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { chromium } = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const directory = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(directory, ".tmp-wardrobe-"));
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
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Timeout: " + label);
}
async function observe(page) {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(r.status() + " " + r.url());
  });
  await page.evaluate(() => {
    window.accessoryDraws = [];
    const proto = CanvasRenderingContext2D.prototype,
      draw = proto.drawImage,
      clear = proto.fillRect;
    proto.fillRect = function (...args) {
      if (this.canvas.id === "game" && args[0] === 0 && args[1] === 0) window.accessoryDraws = [];
      return clear.apply(this, args);
    };
    proto.drawImage = function (img, ...args) {
      if (this.canvas.id === "game" && img.src?.includes("/accessories/"))
        window.accessoryDraws.push({
          src: img.src,
          x: args[0],
          y: args[1],
          width: args[2],
          height: args[3],
        });
      return draw.call(this, img, ...args);
    };
  });
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
      page = await context.newPage();
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await observe(page);
    const profile = (await (await context.request.get(url + "/api/profile")).json()).profile;
    await page.locator("#wardrobeSection").click();
    await page.getByRole("button", { name: "Бабочки", exact: true }).click();
    await page.getByRole("button", { name: "Надеть Бабочка новичка", exact: true }).click();
    await page.getByRole("button", { name: "Снять Бабочка новичка", exact: true }).waitFor();
    await page.getByRole("button", { name: "Шапки", exact: true }).click();
    await page.getByRole("button", { name: "Надеть Шапка новичка", exact: true }).click();
    await page.getByRole("button", { name: "Снять Шапка новичка", exact: true }).waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#skinsDialog img:not([hidden])")].every(
        (img) => img.complete && img.naturalWidth,
      ),
    );
    assert.deepEqual(app.profiles.byId(profile.id).outfit, {
      bow: "novice_bow",
      hat: "novice_hat",
    });
    await page.screenshot({ path: path.join(artifacts, "wardrobe-desktop.png") });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page.locator("#skinsDialog").evaluate((d) => d.scrollWidth <= d.clientWidth + 1),
        true,
      );
      await page.screenshot({ path: path.join(artifacts, "wardrobe-" + width + ".png") });
    }
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.equal(await page.locator("#skinPreview .outfit-accessory:not([hidden])").count(), 2);
    await page.screenshot({ path: path.join(artifacts, "wardrobe-lobby.png") });
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await observe(page);
    assert.equal(await page.locator("#skinPreview .outfit-accessory:not([hidden])").count(), 2);
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    const owner = [...app.arena.players.values()].find((p) => p.profileId === profile.id);
    owner.parts = [400, 1600].map((mass, i) => ({
      id: i ? "small-part" : owner.id,
      mass,
      radius: radiusForMass(mass),
      x: 1000 + i * 400,
      y: 800,
      vx: 0,
      vy: 0,
    }));
    owner.stopped = true;
    app.arena.syncParts(owner);
    const otherContext = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
      other = await otherContext.newPage();
    await other.goto(url);
    await other.waitForFunction(() => !document.getElementById("playButton").disabled);
    await observe(other);
    await other.locator("#playButton").click();
    await other.locator("#arena").waitFor({ state: "visible" });
    const observer = [...app.arena.players.values()].find((p) => p.id !== owner.id);
    Object.assign(observer, { x: 1200, y: 800, targetX: 1200, targetY: 800, stopped: true });
    timer = setInterval(() => app.broadcast(), 50);
    for (const target of [page, other]) {
      await until(
        () => target.evaluate(() => window.accessoryDraws.length === 4),
        "по два аксессуара на каждой части",
      );
      const draws = await target.evaluate(() => window.accessoryDraws),
        hats = draws
          .filter((d) => d.src.endsWith("novice_hat.svg"))
          .sort((a, b) => a.width - b.width);
      assert.equal(hats.length, 2);
      assert.ok(hats[1].width > hats[0].width * 1.7);
      assert.ok(draws.filter((d) => d.src.endsWith("novice_bow.svg")).every((d) => d.y > 800));
    }
    await other.screenshot({ path: path.join(artifacts, "wardrobe-arena-other-player.png") });
    await page.locator("#settingsButton").click();
    await page.locator("#massToggle").click();
    await page.locator("#closeSettings").click();
    assert.equal(await page.locator("#massPanel").isVisible(), true);
    assert.equal(
      await page.evaluate(() => window.accessoryDraws.length),
      4,
      "тумблер массы не скрывает аксессуары",
    );
    await page.locator("#leaveButton").click();
    await page.locator("#leaveYes").click();
    await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
    await page.locator("#lifeLobby").click();
    await page.locator("#wardrobeSection").click();
    await page.getByRole("button", { name: "Шапки", exact: true }).click();
    await page.getByRole("button", { name: "Снять Шапка новичка", exact: true }).click();
    await page.getByRole("button", { name: "Надеть Шапка новичка", exact: true }).waitFor();
    assert.deepEqual(app.profiles.byId(profile.id).outfit, { bow: "novice_bow", hat: null });
    assert.deepEqual(errors, []);
    console.log(
      "Wardrobe browser OK: equip both, remove independently, persistent server outfit, desktop/320/390, lobby, duplicated/scaled accessories visible to another player, mass toggle independent.",
    );
  } finally {
    clearInterval(timer);
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== directory ||
      !path.basename(scratch).startsWith(".tmp-wardrobe-")
    )
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
