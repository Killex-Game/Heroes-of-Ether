"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  engines = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  roulette = require("../../src/server/roulette/roulette-service"),
  { xpForLevel } = require("../../src/server/progression/experience-progression");
const output = path.resolve(
  __dirname,
  "../../../../artifacts/roulette-account-modes-20261023/roulette-browser",
);
fs.mkdirSync(output, { recursive: true });
const store = new ProfileStore({ rouletteConfig: { testEnabled: true } });
const app = createGameServer({
  profiles: store,
  arena: new Arena({ foodCount: 0 }),
  autoTick: false,
});
let browser;
const report = [];
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    for (const engine of ["chromium", "firefox", "webkit"]) {
      const auth = store.open(),
        p = store.find(auth.token);
      p.level = 4;
      p.progress.xp = xpForLevel(4);
      roulette.grantLevels(p, 1);
      p.clanChests = {
        items: [],
        notices: [
          {
            id: randomUUID(),
            at: Date.now(),
            kind: "reward",
            text: "Клановая битва завершена: получено 100 монет, 10 кристаллов и 1 эфир.",
          },
          {
            id: randomUUID(),
            at: Date.now(),
            kind: "expired",
            text: "Клановый сундук не дождался открытия и сгорел.",
          },
          {
            id: randomUUID(),
            at: Date.now(),
            kind: "reward",
            text: "Клановый сундук высшей степени заработан. Нажми «Получить», чтобы зачислить его в Сокровищницу. Открой в течение 48 часов.",
          },
        ],
      };
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
      await context.addCookies([
        { name: "sferorumiya_session", value: auth.token, url, httpOnly: true },
      ]);
      const page = await context.newPage(),
        errors = [],
        missing = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.status() === 404) missing.push(r.url());
      });
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.locator(".clan-reward-toast:popover-open").waitFor();
      assert.equal(await page.locator(".clan-reward-toast .clan-notice-card").count(), 3);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 960 });
        const dimensions = await page.locator(".clan-reward-toast").evaluate((n) => {
          const b = n.getBoundingClientRect();
          return {
            left: b.left,
            right: b.right,
            bottom: b.bottom,
            width: innerWidth,
            height: innerHeight,
            scroll: n.scrollHeight,
            client: n.clientHeight,
          };
        });
        assert.ok(
          dimensions.left >= 0 && dimensions.right <= width + 1 && dimensions.bottom <= 961,
          JSON.stringify(dimensions),
        );
        await page.screenshot({ path: path.join(output, `${engine}-${width}-notices.png`) });
        report.push({ engine, width, notices: dimensions });
      }
      await page.getByRole("button", { name: "В Сокровищницу", exact: true }).first().click();
      await page.waitForFunction(() =>
        document.querySelector(".clan-chest-inventory")?.checkVisibility(),
      );
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.locator("#rouletteButton").click();
      await page.waitForFunction(
        () => document.querySelectorAll(".roulette-wheel svg image").length === 14,
      );
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator(".roulette-lamp").count(), 42);
      assert.deepEqual(await page.locator(".roulette-odds-row").allTextContents(), [
        "1 час VIP2%",
        "Кристаллы8,17%",
        "Клановые бустеры5–10 шт.16,33%",
        "Монеты20,42%",
        "Редкие бустеры7–15 шт.24,5%",
        "Улучшенные бустеры10–20 шт.28,58%",
      ]);
      const clanIcons = store
        .view(store.find(auth.token))
        .roulette.offer.slots.filter((s) => s.category === "clan")
        .map((s) => s.icon);
      const shownIcons = await page
        .locator(".roulette-wheel image")
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
      assert.equal(clanIcons.length, 3);
      assert.ok(clanIcons.every((icon) => shownIcons.includes(icon)));
      assert.equal(await page.locator(".roulette-heading h2").innerText(), "Колесо удачи");
      const idle = await page
        .locator(".roulette-lamp")
        .first()
        .evaluate((n) => ({
          duration: getComputedStyle(n, "::after").animationDuration,
          name: getComputedStyle(n, "::after").animationName,
        }));
      assert.equal(idle.name, "roulette-lamp-idle");
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 960 });
        const geometry = await page.locator("#rouletteDialog").evaluate((n) => {
          const b = n.getBoundingClientRect(),
            wheel = n.querySelector(".roulette-wheel").getBoundingClientRect();
          return {
            left: b.left,
            right: b.right,
            scroll: n.scrollWidth,
            client: n.clientWidth,
            wheelWidth: wheel.width,
            wheelHeight: wheel.height,
          };
        });
        assert.ok(
          geometry.left >= 0 &&
            geometry.right <= width + 1 &&
            geometry.scroll <= geometry.client + 1,
          JSON.stringify(geometry),
        );
        assert.ok(
          Math.abs(geometry.wheelWidth - geometry.wheelHeight) <= 1 && geometry.wheelWidth > 200,
          JSON.stringify(geometry),
        );
        await page.screenshot({ path: path.join(output, `${engine}-${width}-roulette.png`) });
        report.push({ engine, width, roulette: geometry });
      }
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.locator(".roulette-spin").first().click();
      await page.locator(".roulette-wheel-frame.is-spinning").waitFor();
      const spinning = await page
        .locator(".roulette-lamp")
        .first()
        .evaluate((n) => ({
          duration: getComputedStyle(n, "::after").animationDuration,
          name: getComputedStyle(n, "::after").animationName,
        }));
      assert.equal(spinning.name, "roulette-lamp-chase");
      assert.ok(parseFloat(spinning.duration) < parseFloat(idle.duration));
      await page.screenshot({ path: path.join(output, `${engine}-spinning.png`) });
      await page.waitForFunction(
        () =>
          !document.querySelector(".roulette-result").hidden &&
          !document.querySelector(".roulette-spin").disabled,
        { timeout: 15000 },
      );
      assert.equal(store.find(auth.token).roulette.tickets, 2);
      assert.equal(await page.locator(".roulette-wheel-frame.is-spinning").count(), 0);
      const actual = store.find(auth.token).roulette.results[
        store.find(auth.token).roulette.lastRequestId
      ];
      const angle = await page
        .locator(".roulette-wheel")
        .evaluate((n) => Number(n.style.transform.match(/rotate\(([^d]+)/)[1]));
      assert.ok(Math.abs(angle - ((360 - (actual.index * 360) / 14) % 360)) < 0.001);
      await page.screenshot({ path: path.join(output, `${engine}-result.png`) });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".roulette-lamp"), "::after").animationName ===
          "none",
      );
      let intercepted = false;
      await page.route("**/api/roulette/action", async (route) => {
        const body = route.request().postDataJSON();
        if (!intercepted && body.action === "spin") {
          intercepted = true;
          await route.fetch(); // Сервер сохранил, ответ потерян.
          await route.abort("failed");
        } else await route.continue();
      });
      await page.locator(".roulette-spin").first().click();
      await page.getByRole("button", { name: "Восстановить результат" }).waitFor();
      assert.equal(store.find(auth.token).roulette.tickets, 1);
      await page.reload();
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.getByRole("button", { name: "Закрыть уведомления о наградах" }).click();
      await page.locator("#rouletteButton").click();
      await page.waitForFunction(
        () =>
          !document.querySelector(".roulette-result").hidden &&
          !document.querySelector(".roulette-spin").disabled,
      );
      assert.equal(store.find(auth.token).roulette.tickets, 1);
      assert.equal(store.find(auth.token).roulette.spent, 2);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      assert.equal(
        await page
          .locator(".roulette-lamp")
          .first()
          .evaluate((n) => getComputedStyle(n, "::after").animationPlayState),
        "paused",
      );
      await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.getByRole("button", { name: "Закрыть рулетку", exact: true }).click();
      assert.equal(
        await page
          .locator(".roulette-lamp")
          .first()
          .evaluate((n) => getComputedStyle(n, "::after").animationPlayState),
        "paused",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(missing, []);
      console.log(
        engine +
          ": 42 lights, faster spin chase, wide/narrow, result recovery, reduced motion and closed/hidden pause passed",
      );
      await browser.close();
      browser = null;
    }
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
