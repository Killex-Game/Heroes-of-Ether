/* Браузерный сценарий: expanded achievements. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { chromium } = require("playwright"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { xpForLevel } = require("../../src/server/progression/experience-progression");
const directory = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(directory, ".tmp-expanded-achievements-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
const artifacts = path.join(directory, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let time = 5000;
const app = createGameServer({
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  now: () => time,
});
let browser;
const errors = [];
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 } }),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(r.status() + " " + r.url());
    });
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const open = async () => {
      await page.locator("#achievementsButton").click();
      await page.waitForFunction(
        () =>
          document.querySelector("#achievementsDialog .clan-status").textContent ===
          "Прогресс сохраняется на сервере.",
      );
    };
    const close = () => page.getByRole("button", { name: "Закрыть достижения" }).click();
    await open();
    assert.equal(await page.locator(".showcase-count").textContent(), "30 / 30");
    const all = [];
    const pageCount = await page.locator(".achievement-pages button").count();
    for (let n = 1; n <= pageCount; n++) {
      await page.getByRole("button", { name: "Страница " + n, exact: true }).click();
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".achievement-card img")].every(
          (i) => i.complete && i.naturalWidth,
        ),
      );
      all.push(
        ...(await page
          .locator(".achievement-card")
          .evaluateAll((ns) => ns.map((n) => n.dataset.achievement))),
      );
    }
    assert.equal(new Set(all).size, 30);
    await page.getByLabel("Раздел достижений").selectOption("status");
    assert.equal(await page.locator(".achievement-card").count(), 2);
    await page.locator('[data-achievement="vip"]').hover();
    assert.notEqual(await page.locator(".achievement-state").textContent(), "Пока недоступно");
    assert.deepEqual(
      (await page.locator(".achievement-milestones li small:first-of-type").allTextContents()).map(
        (s) => s.replace(/\s+/g, " "),
      ),
      ["+100 величия", "+150 величия", "+300 величия", "+500 величия"],
    );
    await page.screenshot({ path: path.join(artifacts, "expanded-achievements-vip.png") });
    await page.getByLabel("Раздел достижений").selectOption("social");
    await page.locator('[data-achievement="marriage"]').click();
    assert.equal(await page.locator(".achievement-milestones li").count(), 1);
    assert.match(await page.locator(".achievement-milestones").textContent(), /\+10\s+величия/);
    await page.getByLabel("Раздел достижений").selectOption("all");
    await page.getByLabel("Пока недоступны", { exact: true }).uncheck();
    assert.equal(await page.locator(".showcase-count").textContent(), "17 / 30");
    await page.getByRole("button", { name: "Страница 2", exact: true }).click();
    assert.equal(await page.locator(".achievement-card").count(), 5);
    await page.getByLabel("Раздел достижений").selectOption("loyalty");
    assert.equal(await page.locator(".achievement-card").count(), 3);
    await page.locator('[data-achievement="gamer"]').hover();
    assert.match(await page.locator(".achievement-description").textContent(), /живым игроком/);
    await close();
    const profile = (await (await context.request.get(url + "/api/profile")).json()).profile,
      p = app.profiles.byId(profile.id);
    p.level = 12;
    p.progress.xp = xpForLevel(12);
    p.wallet.coins = 1500;
    p.wallet.bucks = 10;
    const command = (body) =>
      context.request.post(url + "/api/clans/action", {
        data: { ...body, requestId: randomUUID() },
      });
    assert.equal(
      (
        await command({
          action: "create",
          name: "Новый клан",
          prefix: "НВ",
          emblem: "grove",
          description: "",
          privacy: "open",
        })
      ).status(),
      200,
    );
    const clanId = app.profiles.byId(profile.id).clanId;
    const deposit = await command({ action: "deposit", clanId, amount: 10 });
    assert.equal(deposit.status(), 200);
    const earned = (await deposit.json()).profile;
    assert.equal(earned.progress.achievements.find((a) => a.id === "not_stingy").claimed, 1);
    assert.equal(earned.greatness, 26);
    await open();
    await close();
    await page.locator("#achievementNotice").waitFor({ state: "visible" });
    assert.equal(await page.locator(".achievement-notice-name").textContent(), "Не жалко");
    assert.equal(await page.locator(".achievement-notice-stars").textContent(), "★");
    await page.screenshot({ path: path.join(artifacts, "expanded-achievement-notice.png") });
    await open();
    await page.getByLabel("Раздел достижений").selectOption("clan");
    await page.locator('[data-achievement="not_stingy"]').hover();
    assert.equal(await page.locator(".achievement-value").textContent(), "0 / 100");
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#achievementsDialog img")].every(
        (i) => i.complete && i.naturalWidth,
      ),
    );
    await page.screenshot({ path: path.join(artifacts, "expanded-achievements-clan.png") });
    await close();
    // Живое время учитывается сервером, клиентские счётчики не принимаются.
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    time += 60000;
    app.tick();
    assert.equal(app.profiles.byId(profile.id).activity.arenaSeconds, 60);
    await page.locator("#leaveButton").click();
    await page.locator("#leaveYes").click();
    await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
    assert.equal(app.profiles.byId(profile.id).activity.values.for_clan, 1);
    time += 60000;
    app.tick();
    assert.equal(app.profiles.byId(profile.id).activity.arenaSeconds, 60);
    await page.locator("#lifeLobby").click();
    for (const width of [390, 320]) {
      const mobile = await browser.newContext({
        viewport: { width, height: 900 },
        storageState: await context.storageState(),
        hasTouch: true,
        isMobile: true,
      });
      const mp = await mobile.newPage();
      mp.on("pageerror", (e) => errors.push(e.message));
      await mp.goto(url);
      await mp.waitForFunction(() => !document.getElementById("playButton").disabled);
      await mp.locator("#achievementsButton").tap();
      await mp.getByLabel("Раздел достижений").selectOption("clan");
      await mp.locator('[data-achievement="not_stingy"]').tap();
      assert.equal(
        await mp.locator("#achievementsDialog").evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        true,
      );
      assert.equal(await mp.locator(".achievement-value").textContent(), "0 / 100");
      await mp.screenshot({ path: path.join(artifacts, `expanded-achievements-${width}.png`) });
      await mobile.close();
    }
    assert.deepEqual(errors, []);
    console.log(
      "Expanded achievements browser OK: all 30 icons, pages/categories, unavailable descriptions, real clan deposit/reward/notice, server life time, 390/320 layouts.",
    );
  } finally {
    await browser?.close();
    await app.close();
    const resolved = path.resolve(scratch);
    if (path.dirname(resolved) !== directory || !path.basename(resolved).startsWith(".tmp-"))
      throw Error("Unsafe temporary path");
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
