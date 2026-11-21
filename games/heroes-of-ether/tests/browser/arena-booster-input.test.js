/* Реальная мышь, горячие клавиши и касания на панели арены. */
"use strict";
const assert = require("node:assert/strict"),
  { once } = require("node:events"),
  engines = require("playwright"),
  accounts = require("../../src/server/accounts/account-benefits"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation");
const app = createGameServer({ arena: new Arena({ etherCount: 0 }), testBots: { enabled: false } });
let browser;
const until = async (check) => {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("Сервер не получил ожидаемое действие");
};
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    for (const engine of ["chromium", "firefox", "webkit"]) {
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      for (const touch of [false, true]) {
        const opened = app.profiles.open(),
          profile = app.profiles.find(opened.token);
        profile.inventory.candy = 10;
        profile.inventory.freeze = 10;
        profile.quickSlots = ["candy", "freeze"];
        profile.account = { ...accounts.fresh(), premiumUntil: Date.now() + 86400000 };
        const context = await browser.newContext({
          viewport: { width: touch ? 390 : 1366, height: 900 },
          hasTouch: touch,
        });
        await context.addCookies([{ name: "sferorumiya_session", value: opened.token, url }]);
        const page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(url);
        await page.waitForFunction(() => !document.getElementById("playButton").disabled);
        // Подсказки и кнопки магазина на ПК по-прежнему работают.
        if (!touch) {
          await page.locator("#shopSection").click();
          await page.locator('[data-booster-id="candy"] .booster-art-slot').hover();
          await page.waitForFunction(() =>
            document.getElementById("boosterTooltip").matches(":popover-open"),
          );
          await page.getByRole("button", { name: "Закрыть бустеры" }).click();
        }
        await page.locator("#playButton")[touch ? "tap" : "click"]();
        await page.locator("#arena").waitFor({ state: "visible" });
        const player = [...app.arena.players.values()].find((p) => p.profileId === profile.id),
          slot = page.locator('.booster-quick [data-slot="1"]'),
          projectile = page.locator('.booster-quick [data-slot="2"]'),
          turbo = page.locator("#turboButton"),
          inventory = () => app.profiles.byId(profile.id).inventory.candy;
        assert.ok(player);
        const initialMass = player.mass;
        player.protectedUntil = 0;
        await page.waitForFunction(
          () => !document.querySelector('.booster-quick [data-slot="1"]').disabled,
        );
        if (!touch) {
          for (const width of [1366, 390]) {
            await page.setViewportSize({ width, height: 900 });
            for (const control of [slot, projectile, turbo]) {
              await control.hover();
              assert.equal(
                await page.locator("#boosterTooltip").evaluate((t) => t.matches(":popover-open")),
                false,
              );
              await control.click();
            }
            assert.equal(inventory(), 10);
            assert.equal(player.turbo.active, false);
            assert.equal(await page.locator(".booster-cancel").isVisible(), false);
          }
          assert.equal(await page.locator(".booster-quick [title]").count(), 0);
          assert.equal(
            await page
              .locator(".booster-quick button")
              .evaluateAll((buttons) => buttons.every((b) => b.tabIndex === -1)),
            true,
          );
          await page.keyboard.press("KeyA");
        } else {
          await slot.tap();
        }
        await until(() => inventory() === 9);
        assert.equal(player.mass, initialMass + 150);
        await turbo[touch ? "tap" : "click"]();
        if (!touch) {
          assert.equal(player.turbo.active, false);
          await page.keyboard.press("KeyT");
        }
        await until(() => player.turbo.active);
        if (touch) {
          await page.setViewportSize({ width: 1366, height: 900 });
          await turbo.tap();
          await until(() => !player.turbo.active);
          await projectile.tap();
          await page.locator(".booster-cancel").waitFor({ state: "visible" });
          await page.locator("#game").tap({ position: { x: 900, y: 400 } });
          await until(() => app.profiles.byId(profile.id).inventory.freeze === 9);
        }
        assert.deepEqual(errors, []);
        await context.close();
        console.log(`${engine}: ${touch ? "touch 390/1366" : "mouse 1366/390 + A/T + shop"} OK`);
      }
      await browser.close();
      browser = null;
    }
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
