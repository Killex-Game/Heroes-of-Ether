/* Браузерный сценарий: mass feeding. */
"use strict";
// Isolated in-memory world. No live accounts or saved profiles are changed.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { once } = require("node:events"),
  { performance } = require("node:perf_hooks");
const { chromium } = require("playwright"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation"),
  { createGameServer } = require("../../src/server/game-server");
const profiles = new ProfileStore(),
  opened = profiles.open(),
  hero = profiles.find(opened.token);
hero.name = "Проверка кормления";
hero.personal = { nameSet: true, gender: "male", vkUrl: "" };
const arena = new Arena({ etherCount: 0 }),
  app = createGameServer({ profiles, arena, autoTick: false });
arena.chooseSpawn = () => ({ x: 1200, y: 800 });
const artifacts = path.resolve(__dirname, "../artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let browser, heartbeat;
const errors = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await pause(30);
  }
  throw Error("Condition timed out");
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
    await page.keyboard.press("KeyW");
    assert.equal(arena.players.size, 0);
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    const p = [...arena.players.values()][0];
    Object.assign(p, {
      mass: 200,
      radius: radiusForMass(200),
      x: 1200,
      y: 800,
      targetX: 1200,
      targetY: 800,
    });
    app.broadcast();
    // Keep player positions fixed so keyboard tests cannot recover their own food.
    heartbeat = setInterval(() => {
      arena.moveFeed(performance.now());
      app.broadcast();
    }, 50);
    await page.waitForFunction(() => document.getElementById("mass").textContent === "200");
    await page.mouse.move(1000, 384);
    await page.keyboard.press("Space");
    await until(() => p.parts?.length === 2);
    p.parts.forEach((part, i) => {
      part.x = 1200;
      part.y = 700 + i * 200;
      part.vx = part.vy = 0;
    });
    arena.syncParts(p);
    app.broadcast();
    await page.keyboard.press("KeyW");
    await until(() => arena.ether.length === 2);
    assert.deepEqual(
      p.parts.map((part) => part.mass),
      [99, 99],
    );
    assert.ok(arena.ether.every((food) => food.vx > 0));
    await pause(250);
    const initial = arena.ether.length;
    await page.keyboard.down("KeyW");
    await pause(650);
    await page.keyboard.up("KeyW");
    assert.ok(arena.ether.length >= initial + 6, "Holding W repeats feeding from both parts");
    const released = arena.ether.length;
    await pause(300);
    assert.equal(arena.ether.length, released);
    for (let i = 0; i < 10; i++) {
      const bot = arena.addPlayer(performance.now(), "rank-test-" + i);
      bot.name = "Тестовый игрок " + (i + 1);
      bot.mass = 241 - i * 8;
      bot.radius = radiusForMass(bot.mass);
      bot.x = 2000;
      bot.y = 1300;
    }
    app.broadcast();
    await page.waitForFunction(() => document.querySelectorAll(".leader-row").length === 10);
    const layout = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".leader-row")],
        a = rows[0].getBoundingClientRect(),
        b = rows[1].getBoundingClientRect();
      return {
        gap: b.top - a.bottom,
        rankSize: parseFloat(getComputedStyle(rows[0].querySelector(".leader-rank")).fontSize),
        background: getComputedStyle(document.querySelector(".leaderboard")).backgroundColor,
      };
    });
    assert.ok(layout.gap >= 0 && layout.gap <= 4);
    assert.ok(layout.rankSize >= 13);
    assert.match(layout.background, /rgba\(.+, 0\.[0-9]+\)/);
    await page.screenshot({ path: path.join(artifacts, "feeding-two-spheres.png") });
    await page
      .locator(".leaderboard")
      .screenshot({ path: path.join(artifacts, "arena-top-compact.png") });
    // Physical key works with a Russian character as well.
    await page.locator("#game").dispatchEvent("keydown", { key: "ц", code: "KeyW", bubbles: true });
    await page.locator("#game").dispatchEvent("keyup", { key: "ц", code: "KeyW", bubbles: true });
    await until(() => arena.ether.length === released + 2);
    await pause(250);
    await page.keyboard.down("KeyW");
    await pause(80);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    const blurred = arena.ether.length;
    await pause(300);
    assert.equal(arena.ether.length, blurred);
    await page.keyboard.up("KeyW");
    await page.locator("#settingsButton").click();
    const settings = arena.ether.length;
    await page.keyboard.press("KeyW");
    await pause(250);
    assert.equal(arena.ether.length, settings);
    await page.locator("#closeSettings").click();
    await page.evaluate(() => {
      const field = document.createElement("input");
      field.id = "feedTypingTest";
      field.style.cssText = "position:fixed;top:0;left:0;z-index:9999";
      document.body.append(field);
      field.focus();
    });
    await page.keyboard.press("KeyW");
    await pause(250);
    assert.equal(arena.ether.length, settings);
    await page.locator("#feedTypingTest").evaluate((el) => el.remove());
    await page.locator("#leaveButton").click();
    await page.keyboard.press("KeyW");
    await pause(250);
    assert.equal(arena.ether.length, settings);
    await page.locator("#leaveYes").click();
    await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
    await page.keyboard.press("KeyW");
    assert.equal(arena.ether.length, settings);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: W/Ц, split spheres, direction, holding/release/blur, settings/dialog/typing/lobby guards, server mass reflected in browser.",
    );
  } finally {
    clearInterval(heartbeat);
    await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
