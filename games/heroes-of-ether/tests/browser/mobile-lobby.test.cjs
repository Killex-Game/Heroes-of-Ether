"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");
const fixture = require("../helpers/black-friday-fixture")();
const benefits = require("../../src/server/accounts/account-benefits");
const { createGameServer } = require("../../src/server/game-server");

async function verify() {
  const engine = process.argv[2] || "chromium";
  const player = fixture.p();
  player.name = "Laifer";
  player.personal = { nameSet: true, introPending: false, gender: "male", vkUrl: "" };
  player.level = 16;
  player.progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(16);
  player.wallet = { coins: 6620, crystals: 562, bucks: 75 };
  player.inventory.freeze = 10;
  player.quickSlots = ["freeze"];
  player.account = { ...benefits.fresh(), vipUntil: fixture.now() + 86400000, premiumUntil: fixture.now() + 86400000 };
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
    const errors = [];
    page.on("pageerror", err => errors.push(err.message));
    await page.goto(url);
    await page.waitForFunction(() => !document.querySelector("#playButton").disabled && !window.KillexBoot?.active);
    await page.evaluate(id => {
      localStorage.setItem(KillexPlatform.storageKey(".releaseNotes.v1." + id), KillexRelease.id);
      for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
    }, player.id);
    await page.locator(".effi-lobby-dismiss").tap();
    const directory = process.env.KILLEX_TEST_ARTIFACTS;
    if (directory) fs.mkdirSync(directory, { recursive: true });
    const results = [];
    for (const [width, height] of [[844,390], [390,844], [320,568], [667,375], [1280,597], [768,1024], [1366,900]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await page.evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect();
        const menu = box(".lobby-sections"), arena = box(".showcase");
        const tiles = [...document.querySelectorAll(".side-nav button")].filter(button => button.offsetHeight);
        return {
          viewport: [innerWidth, innerHeight], scrollWidth: document.documentElement.scrollWidth,
          mobile: !!document.querySelector(".mobile-menu-heading").offsetHeight,
          menuRightOfArena: menu.left >= arena.right - 1, menuBelowArena: menu.top >= arena.bottom - 1,
          playBottom: box("#playButton").bottom,
          accessibleTiles: tiles.length > 0 && tiles.every(button => {
            const bounds = button.getBoundingClientRect(), label = button.querySelector("strong")?.getBoundingClientRect();
            return bounds.width >= 44 && bounds.height >= 44 && label?.height > 0 && label.bottom <= bounds.bottom + 1;
          })
        };
      });
      assert.deepEqual(geometry.viewport, [width, height]);
      assert.equal(geometry.scrollWidth, width, "horizontal overflow at " + width);
      assert.equal(geometry.mobile, width !== 1366);
      if (geometry.mobile) {
        assert(geometry.playBottom <= height, "play below first screen at " + width);
        assert(geometry.accessibleTiles, "tap targets or labels at " + width);
        assert(width > height ? geometry.menuRightOfArena : geometry.menuBelowArena, "menu position at " + width);
      }
      results.push(geometry);
      if (directory && [390, 844, 1280].includes(width)) {
        await page.screenshot({ path: path.join(directory, engine + "-" + width + ".png"), animations: "disabled" });
      }
    }
    await page.setViewportSize({ width: 844, height: 390 });
    for (const [selector, dialog] of [
      ["#etherGeneratorButton", "#etherGeneratorDialog"], ["#shopSection", "#boosterDialog"],
      ["#accountButton", "#accountDialog"], ["[data-accessory-slot=hat]", "#skinsDialog"],
      ["#arenaPickerButton", "#arenaPickerDialog"]
    ]) {
      await page.locator(selector).tap();
      await page.locator(dialog + "[open]").waitFor();
      await page.locator(dialog).evaluate(el => el.close());
    }
    await page.locator("#playButton").tap();
    await page.waitForFunction(() => document.body.dataset.screen === "arena");
    assert.deepEqual(errors, []);
    if (directory) fs.writeFileSync(path.join(directory, engine + "-verified.json"), JSON.stringify(results, null, 2));
    console.log(engine + ": 7 viewports, 5 dialogs and arena entry passed.");
  } finally {
    await browser?.close();
    await game.close();
  }
}

verify().catch(err => { console.error(err); process.exitCode = 1; });
