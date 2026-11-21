"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs"),
  { once } = require("node:events"),
  engines = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  titles = require("../../src/server/progression/title-chest-rewards");
const app = createGameServer({
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    testBots: { enabled: false },
  }),
  out = path.resolve(__dirname, "../../../../artifacts/game-polish-20261101");
let browser;
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    for (const engine of ["chromium", "firefox", "webkit"]) {
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const auth = app.profiles.open(),
        profile = app.profiles.find(auth.token);
      profile.greatness = 100000;
      titles.awardTitles(profile, Date.UTC(2026, 10, 1, 10, 15));
      profile.honors.notified = profile.honors.claimed;
      const context = await browser.newContext({
        viewport: { width: 1366, height: 900 },
        timezoneId: "Asia/Yekaterinburg",
      });
      await context.addCookies([{ name: "sferorumiya_session", value: auth.token, url }]);
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(url);
      await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
      await page.evaluate((id) => KillexPlayerProfile.open(id), profile.id);
      await page.locator("#playerProfileDialog .title-trophy").first().waitFor();
      assert.equal(await page.locator("#playerProfileDialog .title-trophy").count(), 4);
      const medal = page.locator("#playerProfileDialog .title-trophy").first();
      await medal.hover();
      await page.waitForFunction(() =>
        document.querySelector("#boosterTooltip")?.matches(":popover-open"),
      );
      assert.match(await page.locator("#boosterTooltip").innerText(), /01\.11\.2026.*15:15/);
      await page.locator("#playerProfileDialog .personal-close").click();
      await page.locator("#shopSection").click();
      await page.locator("#boosterDialog[open]").waitFor();
      for (const viewport of [
        { width: 1366, height: 900 },
        { width: 390, height: 550 },
      ]) {
        await page.setViewportSize(viewport);
        for (const theme of ["default", "bronze", "champions", "visual", "prism", "glass"]) {
          await page.evaluate((t) => KillexUITheme.apply(t), theme);
          const info = await page.locator("#boosterDialog .booster-close").evaluate((el) => {
            const s = getComputedStyle(el),
              p = getComputedStyle(el, "::after"),
              r = el.getBoundingClientRect();
            return {
              w: r.width,
              h: r.height,
              b: s.backgroundImage,
              icon: p.backgroundImage,
              pw: p.width,
              ph: p.height,
              x: r.x,
              y: r.y,
            };
          });
          assert.equal(info.w, viewport.height < 560 ? 30 : 34);
          assert.equal(info.h, info.w);
          assert.match(info.b, /svg/);
          assert.match(info.icon, /icon_close/);
          assert.equal(parseFloat(info.pw), info.w);
          assert.ok(info.x >= 0 && info.x + info.w <= viewport.width);
        }
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.locator("#boosterDialog .booster-close").click();
      app.maintenance.set(true);
      await page.evaluate(() => KillexMaintenance.check());
      await page.locator("#maintenanceDialog[open]").waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#maintenanceDialog").evaluate((d) => d.open), true);
      assert.equal((await context.request.post(url + "/api/arenas/reserve")).status(), 503);
      await page.screenshot({ path: path.join(out, "maintenance-" + engine + ".png") });
      await page.setViewportSize({ width: 390, height: 550 });
      const fits = await page.locator("#maintenanceDialog").evaluate((d) => {
        const r = d.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      });
      assert.ok(fits);
      // New arrivals receive the same page; no profile created while blocked.
      const newcomer = await context.newPage();
      assert.equal((await newcomer.goto(url)).status(), 503);
      await newcomer.locator("#maintenanceDialog[open]").waitFor();
      await newcomer.close();
      app.maintenance.set(false);
      await page.evaluate(() => KillexMaintenance.check());
      await page.getByRole("button", { name: "Вернуться в игру" }).waitFor();
      assert.equal(await page.evaluate(() => KillexMaintenance.blocked), true);
      await page.getByRole("button", { name: "Вернуться в игру" }).click();
      await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
      assert.deepEqual(errors, []);
      await browser.close();
      browser = null;
      console.log(
        engine + ": medals/date, themed close controls, desktop/mobile maintenance and return OK",
      );
    }
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
