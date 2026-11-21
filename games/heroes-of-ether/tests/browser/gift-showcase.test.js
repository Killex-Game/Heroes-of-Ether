"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  { once } = require("node:events"),
  engines = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { gifts } = require("../../src/server/profiles/player-social"),
  { medals } = require("../../public/shared/daily-ranking-rules");
const output = path.resolve(__dirname, "../../../../artifacts/showcase-spacing-20261023/browser");
fs.mkdirSync(output, { recursive: true });
let now = Date.now(),
  browser;
const store = new ProfileStore({ now: () => now });
const app = createGameServer({
  profiles: store,
  arena: new Arena({ foodCount: 0 }),
  autoTick: false,
});
// Дополнительная регалия чемпиона нужна только для проверки размеров всех типов ячеек.
const publicPlayer = store.publicPlayer.bind(store);
store.publicPlayer = (id) => ({ ...publicPlayer(id), clanFrame: "champion" });
(async () => {
  const report = [];
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    for (const engine of ["chromium", "firefox", "webkit"]) {
      now = Date.now();
      const current = now,
        sender = store.open(),
        recipient = store.open();
      store.find(sender.token).wallet = { coins: 10000, crystals: 100, bucks: 100 };
      for (const [index, age] of [
        [0, 72],
        [1, 47],
        [1, 0],
        [2, 0],
      ]) {
        now = current - age * 3600000;
        store.socialAction(sender.token, {
          action: "gift",
          targetId: recipient.profile.id,
          giftId: gifts[index].id,
          confirmed: true,
          requestId: randomUUID(),
        });
      }
      now = current;
      const target = store.find(recipient.token);
      target.greatness = 5927;
      require("../../src/server/progression/title-chest-rewards").awardTitles(target, now);
      const day = Math.floor(now / 86400000) - 1;
      target.regalia = Object.fromEntries(
        medals.slice(0, 2).map((m) => [m.id, { count: 2, firstDay: day, lastDay: day }]),
      );
      target.seasonTrophies = [0, 2].map((league) => ({
        seasonId: "visual-" + league,
        number: league + 1,
        league,
        awardedAt: now - 1000,
        year: new Date(now).getFullYear(),
      }));
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const context = await browser.newContext({
        viewport: { width: 1366, height: 900 },
        reducedMotion: "reduce",
      });
      await context.addCookies([
        { name: "sferorumiya_session", value: sender.token, url, httpOnly: true },
      ]);
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.install({ time: new Date(now) });
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.evaluate((id) => window.KillexPlayerProfile.open(id), recipient.profile.id);
      await page.locator(".public-player-shelf").waitFor();
      assert.equal(await page.locator(".public-gift").count(), 3);
      assert.equal(await page.locator(".public-trophy .title-medal").count(), 1);
      assert.equal(await page.locator(".personal-season-trophy").count(), 2);
      assert.equal(await page.locator(".daily-regalia").count(), 2);
      for (const width of [1366, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => document.fonts.ready);
        const boxes = await page
          .locator(".public-shelf-track > .public-trophy")
          .evaluateAll((nodes) =>
            nodes.map((n) => {
              const b = n.getBoundingClientRect(),
                icon = n.querySelector("img,.title-medal").getBoundingClientRect(),
                count = n.querySelector(".regalia-count")?.getBoundingClientRect();
              return {
                width: b.width,
                height: b.height,
                top: b.top,
                padding: getComputedStyle(n).padding,
                overflow: n.scrollHeight > n.clientHeight + 1,
                iconCenterX: icon.x + icon.width / 2 - (b.x + b.width / 2),
                iconCenterY: icon.y + icon.height / 2 - (b.y + b.height / 2),
                countBottom: count ? b.bottom - count.bottom : null,
              };
            }),
          );
        assert.ok(
          boxes.every(
            (b) =>
              b.width === 76 &&
              b.height === 104 &&
              b.padding === "6px" &&
              !b.overflow &&
              Math.abs(b.iconCenterX) < 1 &&
              Math.abs(b.iconCenterY) < 1 &&
              (b.countBottom === null || b.countBottom >= 14),
          ),
          JSON.stringify(boxes),
        );
        assert.ok(boxes.every((b) => Math.abs(b.top - boxes[0].top) < 1));
        assert.equal(
          await page.locator(".public-shelf-track").evaluate((n) => getComputedStyle(n).gap),
          "4px",
        );
        assert.equal(
          await page
            .locator("#playerProfileDialog")
            .evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
          true,
        );
        await page.screenshot({ path: path.join(output, `${engine}-${width}.png`) });
        report.push({ engine, width, boxes });
      }
      await page.locator('.public-shelf-arrow[aria-label="Следующие награды"]').click();
      assert.ok(await page.locator(".public-shelf-track").evaluate((n) => n.scrollLeft > 0));
      // Истечение в уже открытом чужом профиле: таймера в интерфейсе нет, перезагрузка не нужна.
      now += 3600000 + 1;
      await page.clock.fastForward(3600000 + 1);
      await page.waitForFunction(() => document.querySelectorAll(".public-gift").length === 2);
      assert.equal(
        store.publicPlayer(recipient.profile.id).social.gifts.reduce((n, g) => n + g.count, 0),
        2,
      );
      assert.equal(await page.locator(".public-trophy:not(.public-gift)").count(), 6);
      assert.doesNotMatch(
        await page.locator(".public-player-shelf").innerText(),
        /48|остал|час|минут/i,
      );
      await page.locator(".public-gift-button").click();
      await page.locator(".social-gift-grid").waitFor();
      assert.match(
        await page.locator(".social-content").innerText(),
        /Подарок останется в витрине игрока на 48 часов, затем исчезнет/,
      );
      await page.locator(".social-dialog .personal-close").click();
      now += 47 * 3600000;
      await page.clock.fastForward(47 * 3600000);
      await page.waitForFunction(() => document.querySelectorAll(".public-gift").length === 0);
      assert.equal(await page.locator(".public-trophy").count(), 6);
      assert.deepEqual(errors, []);
      console.log(
        engine +
          ": uniform award cards, scroll, individual expiry in an open profile and gift description passed",
      );
      await browser.close();
      browser = null;
    }
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
