"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  playwright = require("playwright");
const { setup } = require("../fixtures/season-trophies"),
  { createGameServer } = require("../../src/server/game-server");
const activity = require("../../src/server/progression/activity-achievements");
const f = setup(),
  u = f.heads[0],
  p = f.p(u);
activity.leagueEvent(p, "kills", 1000, f.now());
activity.leagueEvent(p, "cup", 5, f.now());
const app = createGameServer({
  profiles: f.profiles,
  clans: f.clans,
  autoTick: false,
  wallNow: f.now,
});
const artifacts = path.resolve(__dirname, "../artifacts/league-achievements");
fs.mkdirSync(artifacts, { recursive: true });
const results = [];
let browser;
(async () => {
  try {
    await new Promise((r) => app.httpServer.listen(0, "127.0.0.1", r));
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    for (const engine of process.env.ENGINE
      ? [process.env.ENGINE]
      : ["chromium", "firefox", "webkit"]) {
      browser = await playwright[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      for (const width of process.env.WIDTH
        ? [Number(process.env.WIDTH)]
        : [1920, 1366, 390, 320]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        await context.addCookies([{ name: "sferorumiya_session", value: u.token, url }]);
        await context.addInitScript((at) => {
          Date.now = () => at;
        }, f.now());
        const page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("response", (r) => {
          if (r.status() >= 400) errors.push(r.status() + " " + r.url());
        });
        await page.goto(url);
        await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
        await page.locator("#achievementsButton").click();
        await page.getByLabel("Раздел достижений").selectOption("league");
        await page.waitForFunction(
          () => document.querySelectorAll(".achievement-card").length === 5,
        );
        await page.waitForFunction(() =>
          [...document.querySelectorAll(".achievement-card img")].every(
            (i) => i.complete && i.naturalWidth,
          ),
        );
        assert.equal(await page.locator(".achievement-card").count(), 5);
        const overflow = () =>
          page.locator("#achievementsDialog").evaluate((n) => n.scrollWidth > n.clientWidth + 2);
        assert.equal(await overflow(), false, engine + " " + width);
        const rows = await page
          .locator(".achievement-card")
          .evaluateAll(
            (ns) => new Set(ns.map((n) => Math.round(n.getBoundingClientRect().top))).size,
          );
        assert.ok(rows <= 5);
        const dynasty = page.locator('[data-achievement="champion_dynasty"]');
        assert.equal(await dynasty.locator(".achievement-stars .achievement-earned").count(), 1);
        await dynasty.click();
        if (width <= 700) {
          await page.getByRole("button", { name: "5–5", exact: true }).click();
          assert.match(await page.locator(".achievement-milestones").textContent(), /Степень V/);
        } else {
          assert.equal(await page.locator(".achievement-milestones li").count(), 5);
          assert.match(await page.locator(".achievement-milestones").textContent(), /Степень V/);
        }
        assert.equal(await overflow(), false);
        await page.screenshot({ path: path.join(artifacts, `${engine}-${width}-league.png`) });
        if (width <= 700)
          await page.locator('.achievement-panel-tabs [data-panel="showcase"]').click();
        await page.locator('[data-achievement="league_conqueror"]').click();
        assert.equal(await page.locator(".achievement-milestones li").count(), 1);
        assert.match(
          (await page.locator(".milestone-reward").textContent()).replace(/\s+/g, " "),
          /1 000/,
        );
        if (width <= 700)
          await page.locator('.achievement-panel-tabs [data-panel="showcase"]').click();
        for (const [category, ids] of [
          ["social", ["strong_love", "loving", "always_together", "valuable", "marriage"]],
          ["loyalty", ["gamer", "regular", "fan"]],
        ]) {
          await page.getByLabel("Раздел достижений").selectOption(category);
          // Check art paths and loaded alpha assets even when the responsive showcase has more than one page.
          const loaded = await page.evaluate(
            async (ids) =>
              Promise.all(
                ids.map(async (id) => {
                  const src = window.KillexProgressionArt.achievement(id);
                  const image = new Image();
                  image.src = src;
                  await image.decode();
                  return { id, src, width: image.naturalWidth };
                }),
              ),
            ids,
          );
          assert.ok(loaded.every((x) => x.src.endsWith("/" + x.id + ".webp") && x.width === 128));
          await page.waitForFunction(() =>
            [...document.querySelectorAll(".achievement-card img")].every(
              (i) => i.complete && i.naturalWidth,
            ),
          );
          if (engine === "chromium" && width === 1920)
            await page.screenshot({ path: path.join(artifacts, `${category}.png`) });
        }
        const jumper = await page.evaluate(() =>
          window.KillexProgressionArt.achievement("jumper"),
        );
        assert.match(jumper, /jumper\.webp$/);
        assert.deepEqual(errors, []);
        results.push({ engine, width, leagueCards: 5, degreeV: true, noOverflow: true });
        await context.close();
      }
      await browser.close();
      browser = null;
    }
    fs.writeFileSync(path.join(artifacts, "checks.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
