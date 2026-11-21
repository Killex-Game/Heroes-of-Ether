"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  engines = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager"),
  T = require("../../src/server/progression/title-chest-rewards"),
  C = require("../../src/server/clans/clan-chest-rewards"),
  Q = require("../../src/server/progression/personal-quests"),
  E = require("../../src/server/events/easter-hunt");
const out = path.resolve(__dirname, "../../../../artifacts/balance-ranks-20261101"),
  report = [];
(async () => {
  for (const engine of ["chromium", "firefox", "webkit"]) {
    const now = Math.floor(Date.now() / 60000) * 60000,
      profiles = new ProfileStore({ now: () => now }),
      events = new EventManager({ now: () => now });
    const app = createGameServer({
      profiles,
      events,
      arena: new Arena({ etherCount: 0 }),
      autoTick: false,
      testBots: { enabled: false },
      wallNow: () => now,
    });
    let browser;
    try {
      app.httpServer.listen(0, "127.0.0.1");
      await once(app.httpServer, "listening");
      const url = "http://127.0.0.1:" + app.httpServer.address().port;
      const auth = profiles.open(),
        p = profiles.find(auth.token);
      p.greatness = 100000;
      T.awardTitles(p, now);
      p.honors.notified = p.honors.claimed;
      C.grant(p, "high", now);
      for (const n of p.clanChests.notices) n.notifiedAt = now;
      p.quests.pending.push({
        ...Q.makeReward("small", now, true),
        id: randomUUID(),
        questId: "snack",
        title: "Перекус",
        stored: false,
        receivedAt: null,
        notifiedAt: now,
      });
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      await context.addCookies([{ name: "sferorumiya_session", value: auth.token, url }]);
      const page = await context.newPage(),
        errors = [],
        missing = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.status() === 404) missing.push(r.url());
      });
      await page.goto(url);
      await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
      await page.locator("#achievementsButton").click();
      await page.getByRole("button", { name: "Все звания", exact: true }).click();
      assert.equal(await page.locator(".title-catalog-card").count(), 10);
      assert.equal(
        await page
          .locator(".title-catalog-card")
          .filter({ hasText: "VIP — 90 дн., Premium — 90 дн." })
          .count(),
        1,
      );
      const fits = async (selector) =>
        page.locator(selector).evaluate((e) => {
          const r = e.getBoundingClientRect();
          return {
            fit:
              r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1,
            overflow: e.scrollWidth > e.clientWidth + 1,
            scrollbar: getComputedStyle(e).scrollbarWidth,
          };
        });
      for (const v of [
        { width: 1440, height: 1000 },
        { width: 390, height: 550 },
      ]) {
        await page.setViewportSize(v);
        const f = await fits(".titles-catalog-dialog");
        assert.equal(f.fit, true, engine + JSON.stringify(f));
        assert.equal(f.overflow, false);
        assert.equal(f.scrollbar, "none");
        await page.locator(".title-catalog-card").last().scrollIntoViewIfNeeded();
        await page.locator(".titles-catalog-dialog").evaluate((e) => (e.scrollTop = 0));
        await page.screenshot({ path: path.join(out, `titles-${engine}-${v.width}.png`) });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("button", { name: "Закрыть звания" }).click();
      await page.evaluate(() => document.querySelector("#achievementsDialog")?.close());
      await page.locator("#rankingsButton").click();
      await page.getByRole("button", { name: "Топ событий", exact: true }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Топ событий", exact: true }).isDisabled(),
        true,
      );
      await page.getByRole("button", { name: "Закрыть топы" }).click();
      await page.evaluate(() =>
        document.dispatchEvent(
          new CustomEvent("killex:open-chests", { detail: { category: "treasury" } }),
        ),
      );
      await page.locator(".treasury-waiting-row").first().waitFor();
      assert.equal(await page.locator(".treasury-waiting-row").count(), 2);
      assert.equal(await page.locator(".clan-owned-chests .clan-owned-chest").count(), 0);
      await page.screenshot({ path: path.join(out, `queue-${engine}.png`) });
      await page.setViewportSize({ width: 390, height: 550 });
      assert.equal((await fits("#boosterDialog")).fit, true);
      assert.equal((await fits("#boosterDialog")).overflow, false);
      await page.screenshot({ path: path.join(out, `queue-${engine}-390.png`) });
      await page.setViewportSize({ width: 1440, height: 1000 });
      for (let i = 0; i < 2; i++) {
        await page
          .locator(".treasury-waiting-row")
          .getByRole("button", { name: "Получить", exact: true })
          .first()
          .click();
        await page.waitForFunction(
          (n) => document.querySelectorAll(".treasury-waiting-row").length === n,
          1 - i,
        );
      }
      assert.equal(profiles.find(auth.token).clanChests.items[0].stored, true);
      assert.equal(profiles.find(auth.token).quests.pending[0].stored, true);
      await page.evaluate(() => document.querySelector("#boosterDialog")?.close());
      await page.locator("#shopSection").click();
      await page.locator(".booster-card").first().waitFor();
      const border = await page
        .locator(".booster-card")
        .first()
        .evaluate((e) => ({
          image: getComputedStyle(e).borderImageSource,
          w: e.getBoundingClientRect().width,
        }));
      assert.equal(border.image, "none");
      assert.ok(border.w <= 201);
      await page.screenshot({ path: path.join(out, `shop-${engine}.png`) });
      await page.setViewportSize({ width: 390, height: 550 });
      assert.equal((await fits("#boosterDialog")).fit, true);
      assert.equal((await fits("#boosterDialog")).overflow, false);
      await page.screenshot({ path: path.join(out, `shop-${engine}-390.png`) });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => document.querySelector("#boosterDialog")?.close());
      events.apply("test", "start", {
        eventId: E.manifest.id,
        revision: events.data.revision,
        requestId: randomUUID(),
      });
      await page.reload();
      await page.waitForFunction(() => document.querySelector(".promo-offers.has-event-banner"));
      assert.match(await page.locator(".promo-offers").innerText(), /Пасхальная охота/);
      await page.getByRole("button", { name: "Закрыть объявление об ивенте", exact: true }).click();
      await page.locator("#rankingsButton").click();
      await page.getByRole("button", { name: "Топ искателей", exact: true }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Топ искателей", exact: true }).isDisabled(),
        false,
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(missing, []);
      report.push({
        engine,
        checks:
          "title catalogue desktop/mobile, manual receive, event availability/banner, booster card borders",
      });
      console.log(engine + " OK");
    } finally {
      await browser?.close();
      await app.close();
    }
  }
  fs.writeFileSync(path.join(out, "browser-report.json"), JSON.stringify(report, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
