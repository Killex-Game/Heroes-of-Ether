/* Браузерный сценарий: backgrounds greatness. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { chromium } = require("playwright"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { xpForLevel } = require("../../src/server/progression/experience-progression");
const directory = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(directory, ".tmp-backgrounds-")),
  artifacts = path.join(directory, "artifacts");
process.env.TEMP = scratch;
process.env.TMP = scratch;
fs.mkdirSync(artifacts, { recursive: true });
const arena = new Arena({ backgroundRandom: () => 0.99 }),
  app = createGameServer({ arena, autoTick: false, rateNow: () => performance.now() });
let browser, timer;
const errors = [];
async function until(check) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Timeout");
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    async function user() {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (r) => {
        if (r.status() >= 400) errors.push(r.status() + " " + r.url());
      });
      await page.addInitScript(() => {
        window.backgroundPatterns = 0;
        window.lastGround = null;
        const proto = CanvasRenderingContext2D.prototype,
          pattern = proto.createPattern,
          fill = proto.fillRect;
        proto.createPattern = function (img, ...rest) {
          if (this.canvas.id === "game" && img.src?.includes("cobblestone.png"))
            window.backgroundPatterns++;
          return pattern.call(this, img, ...rest);
        };
        proto.fillRect = function (x, y, w, h) {
          if (this.canvas.id === "game" && w === 2400 && h === 1600)
            window.lastGround =
              this.fillStyle instanceof CanvasPattern ? "cobblestone" : this.fillStyle;
          return fill.call(this, x, y, w, h);
        };
      });
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      return page;
    }
    const a = await user(),
      b = await user();
    const profile = (await (await a.request.get(url + "/api/profile")).json()).profile,
      p = app.profiles.byId(profile.id);
    p.level = 12;
    p.progress.xp = xpForLevel(12);
    p.wallet.coins = 3000;
    const auth = app.profiles.open();
    const head = app.profiles.find(auth.token);
    head.level = 12;
    head.progress.xp = xpForLevel(12);
    head.wallet.coins = 3000;
    const clans = new ClanService(app.profiles);
    clans.mutate(auth.token, {
      action: "create",
      name: "Звёздный союз",
      prefix: "ЗВ",
      emblem: "astral",
      privacy: "open",
      requestId: randomUUID(),
    });
    await a.reload();
    await a.waitForFunction(() => !document.getElementById("playButton").disabled);
    const readyIcons = () =>
      a.waitForFunction(() =>
        [...document.querySelectorAll(".greatness-icon")].every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      );
    await readyIcons();
    assert.equal(await a.locator("#progressGreatness .greatness-icon").count(), 1);
    await a.screenshot({ path: path.join(artifacts, "greatness-lobby.png") });
    await a.locator("#rankingsButton").click();
    await a.locator("#topsDialog .clan-ranking-player .greatness-icon").first().waitFor();
    await a.getByRole("button", { name: "Величие за день", exact: true }).click();
    await a.locator("#topsDialog .clan-ranking-player .greatness-icon").first().waitFor();
    await a.getByRole("button", { name: "Киллы за день", exact: true }).click();
    await until(
      async () =>
        (await a.locator("#topsDialog .clan-ranking-player .greatness-icon").count()) === 0,
    );
    await a.getByRole("button", { name: "Топ кланов", exact: true }).click();
    await a.locator("#topsDialog .clan-ranking-row .greatness-icon").waitFor();
    await a.screenshot({ path: path.join(artifacts, "greatness-clan-top.png") });
    await a.getByRole("button", { name: "Вступить · 50 монет", exact: true }).click();
    await until(() => !!app.profiles.byId(profile.id).clanId);
    await a.keyboard.press("Escape");
    await a.locator("#clanSection").click();
    await a.locator(".clan-meta .greatness-icon").waitFor();
    assert.equal(await a.locator(".clan-member-info .greatness-icon").count(), 2);
    await a.keyboard.press("Escape");
    await a.locator("#achievementsButton").click();
    await a.locator('.achievement-card[data-achievement="career"]').click();
    await readyIcons();
    assert.ok((await a.locator(".achievement-milestones .greatness-icon").count()) >= 20);
    await a.screenshot({ path: path.join(artifacts, "greatness-achievement-rewards.png") });
    await a.keyboard.press("Escape");
    await a.locator("#accountButton").click();
    assert.equal(await a.locator(".account-plan .greatness-icon").count(), 4);
    assert.equal(await a.locator(".account-combined .greatness-icon").count(), 2);
    await a.keyboard.press("Escape");
    await a.locator("#shopSection").click();
    await a.getByRole("button", { name: "Сундуки", exact: true }).click();
    assert.ok((await a.locator(".chest-state .greatness-icon").count()) > 0);
    await a.keyboard.press("Escape");
    timer = setInterval(() => app.broadcast(), 50);
    async function enter(page, id) {
      await page.locator("#playButton").click();
      await page.locator("#arena").waitFor({ state: "visible" });
      await page.waitForFunction(
        (id) => document.getElementById("game").dataset.background === id,
        id,
      );
    }
    async function leave(page) {
      await page.locator("#leaveButton").click();
      await page.locator("#leaveYes").click();
      await page.locator("#lifeLobby").click();
      await page.locator("#lobby").waitFor({ state: "visible" });
    }
    await enter(a, "cobblestone");
    await enter(b, "cobblestone");
    for (const page of [a, b]) {
      await page.waitForFunction(() => window.lastGround === "cobblestone");
      assert.equal(await page.evaluate(() => window.backgroundPatterns), 1);
    }
    await a.screenshot({ path: path.join(artifacts, "arena-cobblestone.png") });
    await a.setViewportSize({ width: 844, height: 390 });
    await a.waitForTimeout(150);
    assert.equal(await a.evaluate(() => window.backgroundPatterns), 1);
    await a.screenshot({ path: path.join(artifacts, "arena-cobblestone-small.png") });
    await leave(a);
    assert.equal(arena.backgroundId, "cobblestone");
    await enter(a, "cobblestone");
    await leave(a);
    await leave(b);
    await until(() => arena.players.size === 0);
    await a.setViewportSize({ width: 1366, height: 768 });
    await enter(a, "astral");
    await a.waitForFunction(() => window.lastGround === "#15172c");
    await a.screenshot({ path: path.join(artifacts, "arena-astral-after-empty.png") });
    await enter(b, "astral");
    assert.deepEqual(errors, []);
    console.log(
      "PASS: shared backgrounds in two browsers, cached world-aligned texture, resize, reconnect, empty-arena rotation, greatness icons in lobby/rankings/clan/rewards/chests/accounts.",
    );
  } finally {
    clearInterval(timer);
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== directory ||
      !path.basename(scratch).startsWith(".tmp-backgrounds-")
    )
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
