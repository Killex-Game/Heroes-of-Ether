"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  engines = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager"),
  { createGameServer } = require("../../src/server/game-server"),
  daily = require("../../src/server/rankings/daily-leaderboards");
const out =
  process.env.DAILY_TOP_OUTPUT ||
  path.resolve(__dirname, "../../../../artifacts/event-seekers-daily-20261028/daily-tops-browser");
fs.mkdirSync(out, { recursive: true });
(async () => {
  const report = [];
  for (const engine of ["chromium", "firefox", "webkit"]) {
    let now = Math.floor(Date.now() / 60000) * 60000;
    const profiles = new ProfileStore({ now: () => now }),
      events = new EventManager({ now: () => now });
    profiles.events = events;
    const auth = profiles.open();
    for (let i = 0; i < 12; i++) {
      const p = profiles.find(i === 0 ? auth.token : profiles.open().token);
      p.name = "Искатель " + (i + 1);
      p.daily = {
        day: daily.dayAt(now),
        kills: 120 - i,
        arenaSeconds: 1200 - i,
        greatness: 90 - i,
      };
    }
    const app = createGameServer({
      profiles,
      events,
      autoTick: false,
      testBots: { enabled: false },
      wallNow: () => now,
    });
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    let browser;
    try {
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const url = "http://127.0.0.1:" + app.httpServer.address().port,
        context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await context.addCookies([
        { name: "sferorumiya_session", value: auth.token, url, httpOnly: true },
      ]);
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addLocatorHandler(page.locator("#titleEarnedDialog[open]"), async () => {
        await page
          .locator("#titleEarnedDialog")
          .getByRole("button", { name: "Отлично", exact: true })
          .click();
      });
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.locator("#rankingsButton").click();
      const dialog = page.locator("#topsDialog");
      for (const name of ["Киллы за день", "Время за день", "Величие за день"]) {
        await dialog.getByRole("button", { name, exact: true }).click();
        await page.waitForFunction(
          () =>
            document.querySelectorAll(".daily-ranking-prize").length === 3 &&
            !document.querySelector(".tops-sort button").disabled,
        );
        assert.equal(await dialog.locator(".clan-ranking-player").count(), 10);
        assert.equal(await dialog.locator('.daily-ranking-prize img[alt="билетов"]').count(), 0);
        const values = await dialog
          .locator(".daily-ranking-prize .event-ranking-reward")
          .allTextContents();
        assert.deepEqual(
          values.map((t) => t.trim().split(/\s+/).map(Number)),
          [
            [100, 10, 3],
            [70, 7, 2],
            [50, 5, 1],
          ],
        );
      }
      events.apply("test", "start", {
        eventId: "easter-hunt",
        revision: events.data.revision,
        requestId: randomUUID(),
      });
      await dialog.getByRole("button", { name: "Киллы за день", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelectorAll('.daily-ranking-prize img[alt="билетов"]').length === 3,
      );
      let layouts = 0;
      for (const [width, height] of [
        [1920, 1080],
        [1366, 900],
        [1024, 600],
        [768, 800],
        [390, 844],
        [320, 568],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        const sizes = [];
        for (const name of ["Величие", "Уровень", "Киллы за день"]) {
          await dialog.getByRole("button", { name, exact: true }).click();
          await page.waitForFunction(() => !document.querySelector(".tops-sort button").disabled);
          const bounds = await dialog.boundingBox();
          sizes.push([bounds.width, bounds.height]);
        }
        assert.deepEqual(sizes[1], sizes[0], "Shared window: level");
        assert.deepEqual(sizes[2], sizes[0], "Shared window: daily top");
        await page.waitForTimeout(100);
        const bad = await dialog.evaluate((root) => {
          const nodes = [
            ...root.querySelectorAll("button,.daily-ranking-prize,.clan-my-rank"),
          ].filter((n) => n.getClientRects().length);
          return nodes
            .filter((n) => {
              const r = n.getBoundingClientRect();
              return (
                r.x < 0 ||
                r.y < 0 ||
                r.right > innerWidth + 1 ||
                r.bottom > innerHeight + 1 ||
                n.scrollWidth > n.clientWidth + 2 ||
                (!n.classList.contains("booster-close") && n.scrollHeight > n.clientHeight + 3)
              );
            })
            .map((n) => ({
              text: n.textContent,
              rect: n.getBoundingClientRect().toJSON(),
              scroll: n.scrollHeight,
              client: n.clientHeight,
            }));
        });
        await page.screenshot({ path: path.join(out, `${engine}-${width}x${height}.png`) });
        assert.deepEqual(bad, [], `${engine} ${width}x${height}`);
        const rewardLayoutOk = await dialog.evaluate((root) => {
          const pager = root.querySelector(".clan-pager").getBoundingClientRect();
          return [...root.querySelectorAll(".daily-ranking-prize")].every((card) => {
            const box = card.getBoundingClientRect();
            const medal = card.querySelector(".daily-prize-heading img").getBoundingClientRect();
            const amounts = [...card.querySelector(".event-ranking-reward").children].map((item) =>
              item.getBoundingClientRect(),
            );
            return (
              (box.bottom <= pager.top || box.right <= pager.left || box.left >= pager.right) &&
              amounts.every((r, i) => r.left >= medal.right && (!i || r.top >= amounts[i - 1].bottom - 1))
            );
          });
        });
        assert.ok(rewardLayoutOk, `${engine} ${width}x${height}: призы перекрывают друг друга или пагинацию`);
        const rows = await dialog
          .locator(".clan-ranking-player")
          .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()));
        assert.equal(rows.length, 10);
        assert.ok(rows.every((r, i) => r.height >= 20 && (!i || r.top >= rows[i - 1].bottom - 1)));
        const scrolled = await dialog
          .locator(".ranking-players-table")
          .evaluate((n) => n.scrollHeight > n.clientHeight + 2);
        assert.equal(scrolled, false, "all ten rows visible");
        layouts++;
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      await dialog.getByRole("button", { name: "Следующая страница игроков", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelectorAll(".clan-ranking-player").length === 2,
      );
      assert.equal(await dialog.locator(".daily-ranking-prize").count(), 3);
      await dialog.getByRole("button", { name: "Уровень", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector(".daily-ranking-prize"));
      assert.deepEqual(errors, []);
      report.push({
        engine,
        layouts,
        tenRows: true,
        prizes: true,
        eventTickets: true,
        pagination: true,
        errors,
      });
      console.log(engine + ": passed");
    } finally {
      await browser?.close();
      await app.close();
    }
  }
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
