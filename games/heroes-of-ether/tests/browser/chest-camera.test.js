/* Браузерный сценарий: chest camera. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events");
const { chromium } = require("playwright"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation"),
  { ProfileStore } = require("../../src/server/profiles/profile-store");
const { TITLES, awardTitles } = require("../../src/server/progression/title-chest-rewards");
const directory = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(directory, ".tmp-chest-camera-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
const artifacts = path.join(directory, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const wall = Date.UTC(2026, 9, 19, 12),
  profiles = new ProfileStore({ now: () => wall });
let time = 5000,
  browser,
  timer;
const app = createGameServer({
    profiles,
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => time,
    wallNow: () => wall,
    rateNow: () => performance.now(),
  }),
  errors = [];
async function until(fn, label) {
  for (let i = 0; i < 180; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Timeout: " + label);
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } }),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(r.status() + " " + r.url());
    });
    const ready = async () => {
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    };
    await ready();
    const profile = (await (await context.request.get(url + "/api/profile")).json()).profile,
      p = () => profiles.byId(profile.id);
    p().greatness = 2000000;
    awardTitles(p(), wall);
    await ready();
    await page.locator("#shopSection").click();
    await page
      .locator("#boosterDialog")
      .getByRole("button", { name: "Сундуки", exact: true })
      .click();
    assert.equal(await page.locator(".chest-card button:enabled").count(), 10);
    const themes = new Set();
    for (const title of TITLES) {
      await page.locator(`.chest-card[data-chest-id="${title.id}"] button`).click();
      await page
        .locator("#chestConfirmDialog")
        .getByRole("button", { name: "Да", exact: true })
        .click();
      const dialog = page.locator("#chestRewardDialog");
      await dialog.waitFor({ state: "visible" });
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#chestRewardDialog img")].every(
          (i) => i.complete && i.naturalWidth,
        ),
      );
      const reward = structuredClone(p().honors.pending);
      assert.equal(await dialog.getAttribute("data-chest-theme"), title.id);
      themes.add(
        await dialog.evaluate((e) => getComputedStyle(e).getPropertyValue("--chest-accent")),
      );
      assert.equal(
        Object.values(reward.items).reduce((a, b) => a + b, 0),
        title.boosters * reward.multiplier,
      );
      assert.equal(
        await dialog.locator(".chest-reward-item").count(),
        Object.keys(reward.items).length + 3 + Object.keys(reward.accountDays || {}).length,
      );
      if (["novice", "master", "boss"].includes(title.id))
        await page.screenshot({ path: path.join(artifacts, `new-${title.id}-reward.png`) });
      if (title.id === "boss")
        for (const [width, height] of [
          [844, 390],
          [568, 320],
          [320, 844],
        ]) {
          await page.setViewportSize({ width, height });
          const bounds = await dialog.evaluate((e) => {
            const r = e.getBoundingClientRect(),
              g = e.querySelector(".chest-reward-grid"),
              b = e.querySelector(".chest-claim").getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              right: r.right,
              bottom: r.bottom,
              buttonBottom: b.bottom,
              overflow: e.scrollHeight - e.clientHeight,
              gridScrollable: g.scrollHeight > g.clientHeight,
            };
          });
          assert.ok(
            bounds.x >= 0 &&
              bounds.y >= 0 &&
              bounds.right <= width &&
              bounds.bottom <= height &&
              bounds.buttonBottom <= height,
          );
          assert.ok(bounds.overflow <= 1, "only reward grid scrolls");
          if (height < 500) assert.ok(bounds.gridScrollable);
          await page.screenshot({
            path: path.join(artifacts, `new-boss-reward-${width}x${height}.png`),
          });
        }
      await dialog.getByRole("button", { name: "Отлично", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(p().honors.chests[title.id], "opened");
    }
    assert.equal(themes.size, 10);
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1366, height: 768 });
    p().inventory.warheads = 1;
    p().quickSlots = ["warheads", null, null, null];
    p().revision++;
    await ready();
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    const me = [...app.arena.players.values()].find((v) => v.profileId === profile.id);
    me.parts = [700, 1300].map((mass, i) => ({
      id: i ? "second" : me.id,
      mass,
      radius: radiusForMass(mass),
      x: 1100 + i * 250,
      y: 800,
      vx: 0,
      vy: 0,
    }));
    me.stopped = true;
    app.arena.syncParts(me);
    const enemy = app.arena.addPlayer(time, "enemy");
    Object.assign(enemy, {
      name: "Соперник",
      mass: 1234,
      radius: radiusForMass(1234),
      x: 1450,
      y: 1020,
      stopped: true,
    });
    await page.evaluate(() => {
      window.massLabels = [];
      const proto = CanvasRenderingContext2D.prototype,
        fill = proto.fillText,
        clear = proto.fillRect;
      proto.fillRect = function (...args) {
        if (this.canvas.id === "game" && args[0] === 0 && args[1] === 0) window.massLabels = [];
        return clear.apply(this, args);
      };
      proto.fillText = function (text, ...args) {
        if (this.canvas.id === "game" && /^\d[\d\s]*$/.test(String(text)))
          window.massLabels.push(String(text).replace(/\s/g, ""));
        return fill.call(this, text, ...args);
      };
    });
    timer = setInterval(() => app.broadcast(), 50);
    await until(
      () =>
        page.evaluate(
          () => window.massLabels.includes("700") && window.massLabels.includes("1300"),
        ),
      "own mass labels",
    );
    assert.equal(await page.evaluate(() => window.massLabels.includes("1234")), false);
    await page.getByRole("button", { name: "Открыть настройки", exact: true }).click();
    await page.getByRole("switch", { name: "Показывать массу" }).click();
    await until(
      () =>
        page.evaluate(
          () => !window.massLabels.includes("700") && !window.massLabels.includes("1300"),
        ),
      "mass toggle",
    );
    assert.equal(await page.locator("#massPanel").isVisible(), true);
    await page.getByRole("switch", { name: "Показывать массу" }).click();
    await page.locator("#closeSettings").click();
    assert.equal(await page.locator("#settingsMenu").isHidden(), true);
    me.protectedUntil = 0;
    await page.locator("#game").focus();
    await page.mouse.move(1100, 380);
    await page.keyboard.press("KeyA");
    await until(() => app.arena.combat.shots.length === 7, "warheads salvo");
    assert.equal(p().inventory.warheads, 0);
    assert.equal(
      new Set(app.arena.combat.shots.map((s) => Math.atan2(s.dy, s.dx).toFixed(6))).size,
      7,
    );
    for (let i = 0; i < 10; i++) {
      time += 50;
      app.arena.combat.update(time);
      app.broadcast();
      await page.waitForTimeout(50);
    }
    await page.screenshot({ path: path.join(artifacts, "new-warheads-salvo.png") });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: all 10 chest themes/rewards/claims, landscape popup scroll, own-only mass and toggle, 1 warheads item => 7 distinct angles.",
    );
  } finally {
    clearInterval(timer);
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== directory ||
      !path.basename(scratch).startsWith(".tmp-chest-camera-")
    )
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
