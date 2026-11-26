"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const playwright = require("playwright");
const fixture = require("../helpers/black-friday-fixture")();
const { createGameServer } = require("../../src/server/game-server");
const { xpForLevel } = require("../../src/server/progression/experience-progression");
const benefits = require("../../src/server/accounts/account-benefits");

async function test() {
  const engine = process.argv[2] || "chromium";
  const player = fixture.p();
  player.name = "Laifer";
  player.personal = { nameSet: true, introPending: false, gender: "male", vkUrl: "" };
  player.level = 16;
  player.greatness = 835;
  Object.assign(player.progress, {maxMass: 2630, humanAbsorptions: 18});
  player.progress.xp = xpForLevel(16);
  Object.assign(player.inventory, { freeze: 16, hook: 6, candy: 19 });
  player.loginReward = { date: benefits.loginRewardDay(fixture.now()), day: 1 };
  const game = createGameServer({ profiles: fixture.store, events: fixture.manager, wallNow: fixture.now, autoTick: true, testBots: { enabled: false } });
  let browser;
  try {
    game.httpServer.listen(0, "127.0.0.1");
    await once(game.httpServer, "listening");
    const url = "http://127.0.0.1:" + game.httpServer.address().port;
    browser = await playwright[engine].launch(engine === "chromium" ? { channel: "chrome" } : {});
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: engine !== "firefox" });
    await context.addCookies([{ name: "sferorumiya_session", value: fixture.user.token, url }]);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.addInitScript(() => {
      document.addEventListener("killex:profile", e => {
        if (e.detail?.id && window.KillexRelease) localStorage.setItem(
          KillexPlatform.storageKey(".releaseNotes.v1." + e.detail.id), KillexRelease.id
        );
      }, true);
    });
    await page.addLocatorHandler(page.locator("#releaseNotesDialog[open]"), async dialog => {
      await dialog.getByRole("button", { name: "Закрыть новости", exact: true }).tap();
    });
    await page.clock.setFixedTime(new Date(fixture.now()));
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/api/clans?*", async route => {
      const response = await route.fetch(), data = await response.json();
      data.clans = Array.from({ length: 10 }, (_, i) => ({
        id: "layout-" + i, rank: i + 1, prefix: ["KILL","X","H4te","Бот","S1","WWW","DiSH","ОРЦ","LSD","Z"][i],
        name: ["Killex","Хулиганы","Хейт","Бот","Север","Wednesday","DISH","Союз клана","Агарные игры","Зигзаг удачи"][i], emblem: "lion",
        progress: { level: 5 }, greatness: 2959079 - i, treasury: 5000, privacy: i % 2 ? "open" : "closed", count: 5, capacity: 15
      }));
      Object.assign(data, { mine: null, applications: [], page: 1, pages: 2 });
      await route.fulfill({ response, json: data });
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => !playButton.disabled && !window.KillexBoot?.active);
    await page.evaluate(id => {
      localStorage.setItem(KillexPlatform.storageKey(".releaseNotes.v1." + id), KillexRelease.id);
      for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
    }, player.id);
    const directory = process.env.KILLEX_TEST_ARTIFACTS;
    if (directory) fs.mkdirSync(directory, { recursive: true });
    for (const [width, height] of [[568,320], [844,390], [390,844], [667,375], [320,568], [1280,597]]) {
      await page.setViewportSize({ width, height });
      for (const [id, trigger, ready] of [
        ["boosterDialog","inventorySection","#boosterGrid .booster-card"],
        ["topsDialog","rankingsButton",".ranking-clans-table .clan-ranking-row"],
        ["questsDialog","questsSection",".quest-card:not([hidden])"],
        ["blackFridayDialog","blackFridayButton",".manya-order"],
        ["playerProfileDialog","openSelfProfile",".public-player-stats"],
        ["rouletteDialog","rouletteButton",".roulette-wheel svg"],
        ["etherGeneratorDialog","etherGeneratorButton","#alchemyExchange"]
      ]) {
        await page.locator("#" + trigger).tap();
        const dialog = page.locator("#" + id + "[open]");
        await dialog.waitFor();
        if (id === "topsDialog") await dialog.getByRole("button", { name: "Топ кланов", exact: true }).tap();
        await dialog.locator(ready).first().waitFor();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const metrics = await dialog.evaluate(el => {
          const rect = node => { const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); };
          const boxes = {};
          for (const selector of [".interface-content",".interface-toolbar",".booster-card",".booster-action",".ranking-clans-table",".clan-ranking-row",".clan-join",".ranking-footer",".quests-grid",".quests-pages",".manya-header",".manya-content",".manya-order",".public-player-hero",".public-player-shelf",".public-player-details",".public-player-stats",".roulette-wheel-frame",".roulette-spin",".alchemy-gauge","#alchemyExchange"]) {
            const node = el.querySelector(selector);
            if (node && node.offsetWidth) boxes[selector] = rect(node);
          }
          return { bounds: rect(el), innerWidth: el.clientWidth, scrollWidth: el.scrollWidth, boxes };
        });
        if (directory) {
          fs.appendFileSync(path.join(directory, engine + "-geometry.jsonl"), JSON.stringify({ width, height, id, ...metrics }) + "\n");
          if (width === 844 || width === 390) await page.screenshot({ path: path.join(directory, engine + "-" + width + "-" + id + ".png") });
        }
        const [left, top, w, h] = metrics.bounds;
        assert(left >= -1 && top >= -1 && left + w <= width + 1 && top + h <= height + 1, id + " outside viewport");
        assert(metrics.scrollWidth <= metrics.innerWidth + 1, id + " scrolls sideways");
        const boxes = metrics.boxes;
        if (id === "playerProfileDialog") {
          const stats = boxes[".public-player-stats"];
          assert(stats[1] + stats[3] <= top + h + 1, "profile stats clipped");
        }
        if (id === "rouletteDialog") {
          const wheel = boxes[".roulette-wheel-frame"];
          assert(wheel[2] >= 144 && wheel[1] + wheel[3] <= top + h, "wheel clipped or too small");
          await dialog.getByRole("button", { name: "Призы", exact: true }).tap();
          await dialog.locator(".roulette-info").waitFor();
        }
        if (id === "etherGeneratorDialog" || id === "boosterDialog") {
          const button = boxes[id === "etherGeneratorDialog" ? "#alchemyExchange" : ".booster-action"];
          assert(button && button[1] + button[3] <= top + h, id + " primary action clipped");
        }
        if (id === "topsDialog") {
          assert(boxes[".clan-ranking-row"][3] >= 40, "compressed clan rows");
          const separate = await dialog.locator(".clan-ranking-row").first().evaluate(row => {
            const score = row.querySelector(".ranking-score").getBoundingClientRect();
            const action = row.querySelector(".clan-join").getBoundingClientRect();
            return score.right <= action.left + 1 || score.bottom <= action.top + 1;
          });
          assert(separate, "score overlapped by the join button");
          const last = dialog.locator(".ranking-clans-table .clan-join").last();
          await last.scrollIntoViewIfNeeded();
          await last.tap();
          await page.locator(".clan-join-dialog[open]").getByRole("button", { name: "Отмена" }).tap();
        }
        if (id === "blackFridayDialog") {
          for (const tab of ["prizes","exchange","achievements"]) await dialog.locator('[data-tab="' + tab + '"]').tap();
        }
        if (id === "questsDialog" && await dialog.locator(".quests-pages").isVisible()) {
          const first = await dialog.locator(".quest-card:visible h3").first().textContent();
          await dialog.getByRole("button", { name: "Следующие задания" }).tap();
          assert.notEqual(await dialog.locator(".quest-card:visible h3").first().textContent(), first);
        }
        await dialog.locator("button.booster-close,button.manya-close,button.personal-close").first().tap();
      }
    }
    fixture.store.confirmMockPurchase(fixture.user.token, { productId: "account:lite", confirmed: true,
      requestId: require("node:crypto").randomUUID(), eventId: fixture.store.view(fixture.p()).roulette.lite.eventId });
    await require("./ranking-navigation-checks.cjs")(page, directory, engine);
    assert.deepEqual(errors, []);
    console.log(engine + ": all seven dialogs checked at six sizes.");
  } finally {
    await browser?.close();
    await game.close();
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
