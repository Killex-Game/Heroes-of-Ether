"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  engines = require("playwright"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager"),
  { createGameServer } = require("../../src/server/game-server"),
  T = require("../../src/server/progression/title-chest-rewards"),
  E = require("../../src/server/events/easter-hunt"),
  lite = require("../../src/server/accounts/lite-account");
const out = path.resolve("../artifacts/title-descriptions-notice-20261028/browser");
fs.mkdirSync(out, { recursive: true });
async function until(check) {
  for (let i = 0; i < 80; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail("timeout");
}
(async () => {
  const report = [];
  for (const engine of ["chromium", "firefox", "webkit"]) {
    const now = Math.floor(Date.now() / 60000) * 60000,
      profiles = new ProfileStore({ now: () => now }),
      events = new EventManager({ now: () => now });
    profiles.events = events;
    events.apply("test", "start", { eventId: E.manifest.id, revision: 0, requestId: randomUUID() });
    const auth = profiles.open(),
      p = () => profiles.find(auth.token);
    p().account = {
      ...require("../../src/server/accounts/account-benefits").fresh(),
      vipUntil: now + 86400000,
      premiumUntil: now + 86400000,
    };
    lite.activate(p(), profiles.rouletteConfig, now, events.active().id);
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
      const url = "http://127.0.0.1:" + app.httpServer.address().port;
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await context.addCookies([
        { name: "sferorumiya_session", value: auth.token, url, httpOnly: true },
      ]);
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.getByRole("button", { name: "Закрыть объявление об ивенте" }).click();
      await page.evaluate(() =>
        document.querySelectorAll("dialog[open]").forEach((d) => d.close()),
      );
      // Не мешаем арене и другим открытым окнам.
      await page.evaluate(() => {
        document.body.dataset.screen = "arena";
      });
      p().greatness = 25000;
      T.awardTitles(p(), now);
      p().revision++;
      const view = profiles.view(p());
      const update = (v) =>
        page.evaluate(
          (v) => document.dispatchEvent(new CustomEvent("killex:profile", { detail: v })),
          v,
        );
      await update(view);
      assert.equal(await page.locator("#titleEarnedDialog").isVisible(), false);
      await page.evaluate(() => {
        const d = document.createElement("dialog");
        d.id = "testBlocker";
        document.body.append(d);
        d.showModal();
        document.body.dataset.screen = "lobby";
      });
      await update(view);
      assert.equal(await page.locator("#titleEarnedDialog").isVisible(), false);
      await page.locator("#testBlocker").evaluate((d) => d.close());
      const popup = page.locator("#titleEarnedDialog");
      try {
        await popup.waitFor({ timeout: 6000 });
      } catch (e) {
        console.log(
          JSON.stringify({
            errors,
            honors: profiles.view(p()).honors.notifications,
            revision: profiles.view(p()).revision,
            state: await page.evaluate(() => ({
              screen: document.body.dataset.screen,
              dialogs: [...document.querySelectorAll("dialog[open]")].map((d) => d.id),
              storage: localStorage.getItem(
                "sferorumiya.title-notice.v1." + document.body.dataset.profileId,
              ),
            })),
          }),
        );
        await page.screenshot({ path: path.join(out, engine + "-failure.png") });
        throw e;
      }
      assert.equal(await popup.locator("h3").textContent(), "Новичок");
      await until(() => p().honors.notified === 1);
      await popup.getByRole("button", { name: "Поделиться", exact: true }).click();
      assert.match(await popup.textContent(), /Публикация в VK будет доступна позже/);
      for (const [width, height] of [
        [1920, 1080],
        [390, 844],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        const box = await popup.boundingBox();
        assert.ok(
          box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= width + 1 &&
            box.y + box.height <= height + 1,
          `${engine}: popup within ${width}x${height}`,
        );
        assert.ok(await popup.locator("img").evaluate((i) => i.complete && i.naturalWidth > 0));
        assert.ok(
          await popup.evaluate(
            (d) => d.scrollHeight <= d.clientHeight + 1 && d.scrollWidth <= d.clientWidth + 1,
          ),
        );
        for (const button of await popup.locator("button").all()) {
          const b = await button.boundingBox();
          assert.ok(b.y + b.height <= box.y + box.height && b.x + b.width <= box.x + box.width);
        }
        await page.screenshot({ path: path.join(out, `${engine}-notice-${width}.png`) });
      }
      await popup.getByRole("button", { name: "Отлично", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector("#titleEarnedDialog").dataset.titleId === "experienced",
      );
      await until(() => p().honors.notified === 2);
      await popup.getByRole("button", { name: "Закрыть уведомление о звании" }).click();
      await page.waitForFunction(
        () => document.querySelector("#titleEarnedDialog").dataset.titleId === "expert",
      );
      await until(() => p().honors.notified === 3);
      await page.keyboard.press("Escape");
      await popup.waitFor({ state: "hidden" });
      await update(view); // устаревшее сообщение профиля
      assert.equal(await popup.isVisible(), false);
      await page.evaluate(
        (id) => localStorage.removeItem("sferorumiya.title-notice.v1." + id),
        p().id,
      ); // серверная отметка также защищает
      await page.reload();
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      assert.equal(await popup.isVisible(), false);
      await page.evaluate(() =>
        document.querySelectorAll("dialog[open]").forEach((d) => d.close()),
      );
      // Потеря подтверждения: локальная отметка защищает от повтора, online повторяет запись.
      await page.route("**/api/profile/title-notice", (route) => route.abort());
      p().greatness = 100000;
      T.awardTitles(p(), now);
      p().revision++;
      await update(profiles.view(p()));
      await popup.waitFor();
      assert.equal(await popup.locator("h3").textContent(), "Мудрец");
      await popup.getByRole("button", { name: "Отлично", exact: true }).click();
      await page.reload();
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      assert.equal(await popup.isVisible(), false);
      await page.unroute("**/api/profile/title-notice");
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await until(() => p().honors.notified === 4);
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.evaluate(() => {
        document.querySelectorAll("dialog[open]").forEach((d) => d.close());
        document.dispatchEvent(
          new CustomEvent("killex:open-chests", { detail: { category: "titles" } }),
        );
      });
      const sage = page.locator('.chest-card[data-chest-id="sage"]');
      await sage.waitFor();
      assert.match(
        (await sage.textContent()).replace(/\s/g, ""),
        /1250бустеров—7500монет—500кристаллов—375эфира/,
      );
      assert.doesNotMatch(await sage.textContent(), /Lite|билет/);
      await page.screenshot({ path: path.join(out, engine + "-sage-base.png") });
      await page.evaluate(() =>
        document.querySelectorAll("dialog[open]").forEach((d) => d.close()),
      );
      await page.locator("#eventsSection").click();
      await page.locator('[data-event-index="2"]').click();
      const heading = page.locator(".easter-heading");
      assert.doesNotMatch(await heading.textContent(), /по Москве/);
      assert.match(await heading.textContent(), /До \d/);
      for (const [width, height] of [
        [1920, 1080],
        [390, 844],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        const icon = heading.locator(".easter-heading-icon"),
          text = heading.locator("h1 span");
        assert.ok(await icon.evaluate((i) => i.complete && i.naturalWidth > 0));
        const a = await icon.boundingBox(),
          b = await text.boundingBox(),
          c = await heading.locator("button").boundingBox();
        assert.ok(
          a.x + a.width <= b.x + 1 && b.x + b.width <= c.x + 1,
          `${engine}: egg, heading and back do not overlap`,
        );
        await page.screenshot({ path: path.join(out, `${engine}-easter-heading-${width}.png`) });
      }
      assert.deepEqual(errors, []);
      report.push({
        engine,
        notice: "once, queue, reload, offline retry",
        viewports: 3,
        baseSageRewards: true,
        easterHeading: true,
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
