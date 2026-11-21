/* Браузерный сценарий: progression. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { chromium } = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const directory = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(directory, ".tmp-progression-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
const artifacts = path.join(directory, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let now = 5000,
  browser,
  timer;
const app = createGameServer({
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => now,
    rateNow: () => performance.now(),
  }),
  errors = [];
async function until(fn, label) {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error("Timeout: " + label);
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(r.status() + " " + r.url());
    });
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const profile = (await (await context.request.get(url + "/api/profile")).json()).profile;
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    const p = [...app.arena.players.values()].find((p) => p.profileId === profile.id);
    await page.evaluate(() => {
      window.massLabels = [];
      const proto = CanvasRenderingContext2D.prototype,
        fill = proto.fillText,
        clear = proto.fillRect;
      proto.fillRect = function (...args) {
        if (this.canvas.id === "game" && args[0] === 0 && args[1] === 0) window.massLabels = [];
        return clear.apply(this, args);
      };
      proto.fillText = function (text, x, y, maxWidth) {
        if (this.canvas.id === "game")
          window.massLabels.push({ text: String(text), x, y, maxWidth });
        return fill.apply(this, arguments);
      };
    });
    p.parts = [3000, 2800].map((mass, i) => ({
      id: i ? "other" : p.mainPartId,
      mass,
      radius: radiusForMass(mass),
      x: i ? 1450 : 950,
      y: 800,
      vx: 0,
      vy: 0,
    }));
    app.arena.syncParts(p);
    app.broadcast();
    timer = setInterval(() => app.broadcast(), 50);
    const masses = () =>
      page.evaluate(() =>
        window.massLabels
          .filter((l) => /^[\d\s]+$/u.test(l.text))
          .map((l) => Number(l.text.replace(/\s/g, "")))
          .sort((a, b) => a - b),
      );
    await until(async () => JSON.stringify(await masses()) === "[2800,3000]", "масса каждой части");
    await until(
      () =>
        page.evaluate(
          () => window.massLabels.filter((l) => l.text.includes("Путник")).length === 1,
        ),
      "ник игрока отрисован один раз",
    );
    await page.locator("#settingsButton").click();
    await page.locator("#massToggle").click();
    await until(async () => (await masses()).length === 0, "числа массы скрыты одним тумблером");
    assert.equal(await page.locator("#massPanel").isVisible(), true);
    assert.equal((await page.locator("#mass").textContent()).replace(/\s/g, ""), "5800");
    await page.locator("#massToggle").click();
    await page.locator("#closeSettings").click();
    await until(
      async () => JSON.stringify(await masses()) === "[2800,3000]",
      "числа массы восстановлены",
    );
    await page.screenshot({ path: path.join(artifacts, "progression-split-mass.png") });
    p.stopped = true;
    for (const part of p.parts) {
      part.x = 1200;
      part.y = 800;
    }
    app.arena.moveParts(p, 35000, 0);
    app.broadcast();
    assert.equal(p.mass, 5000);
    assert.equal(p.parts, null);
    await until(
      async () => JSON.stringify(await masses()) === "[5000]",
      "после слияния отображена масса без избытка",
    );
    // Сервер получает накопленный счётчик, выдаёт степень и передаёт профиль по WebSocket.
    app.profiles.byId(profile.id).progress.boosterUses = 100;
    app.tick();
    await until(
      () => app.profiles.byId(profile.id).progress.claimed.boosters === 1,
      "награда сервера",
    );
    assert.equal(
      await page.locator("#achievementNotice").isVisible(),
      false,
      "на арене уведомление отложено",
    );
    await page.locator("#leaveButton").click();
    await page.locator("#leaveYes").click();
    await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
    assert.equal(
      await page.locator("#achievementNotice").isVisible(),
      false,
      "итог жизни ещё не лобби",
    );
    await page.locator("#lifeLobby").click();
    await page.locator("#achievementNotice").waitFor({ state: "visible" });
    assert.equal(await page.locator(".achievement-notice-name").textContent(), "По назначению");
    assert.equal(await page.locator(".achievement-notice-stars").textContent(), "★");
    assert.equal(await page.locator("#achievementNotice [role=progressbar]").count(), 0);
    await page.waitForFunction(() => {
      const i = document.querySelector(".achievement-notice-icon img");
      return i.complete && i.naturalWidth;
    });
    assert.match(
      await page.locator(".achievement-notice-icon img").getAttribute("src"),
      /on_target.webp$/,
    );
    await page.screenshot({ path: path.join(artifacts, "progression-notice-lobby.png") });
    await page.locator(".achievement-notice-close").click();
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    assert.equal(
      await page.locator("#achievementNotice").isVisible(),
      false,
      "после закрытия и обновления не повторяется",
    );
    // Вторая степень требует 500 новых применений после уже полученной первой.
    const progress = app.profiles.byId(profile.id).progress;
    progress.boosterUses = progress.stageSpent.boosters + 500;
    app.profiles.applyArenaProgress(
      "second-degree",
      [{ type: "massPeak", profileId: profile.id, mass: 5000 }],
      Date.now(),
    );
    await page.locator("#achievementsButton").click();
    await page.waitForFunction(
      () => document.querySelector(".achievement-notice-stars").textContent === "★★",
    );
    await page.getByRole("button", { name: "Закрыть достижения" }).click();
    await page.setViewportSize({ width: 320, height: 800 });
    const box = await page.locator("#achievementNotice").boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 320);
    await page.screenshot({ path: path.join(artifacts, "progression-notice-mobile.png") });
    await page.locator(".achievement-notice-close").click();
    // Значение единого тумблера сохраняется после перезагрузки.
    await page.locator("#settingsButton").click();
    await page.locator("#massToggle").click();
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    assert.equal(await page.locator("#massToggle").getAttribute("aria-checked"), "false");
    assert.equal(await page.locator("#massPanel").isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(
      "Progression browser OK: per-part live mass, one persisted toggle, merge excess burned, arena-to-lobby achievement notice, correct icon/stars, no repeat after reload, next degree, 1280/320.",
    );
  } finally {
    clearInterval(timer);
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== directory ||
      !path.basename(scratch).startsWith(".tmp-progression-")
    )
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
