"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  engines = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { createGameServer } = require("../../src/server/game-server"),
  { OwnerAccess } = require("../../src/server/admin/owner-access"),
  { EventManager } = require("../../src/server/events/event-manager"),
  { Arena } = require("../../src/server/arena/arena-simulation");
const output = path.resolve(
  __dirname,
  "../../../../artifacts/event-minute-schedule-20261025/admin-browser",
);
fs.mkdirSync(output, { recursive: true });
const password = "Browser fixture password 2026";
const manifest = {
  schemaVersion: 1,
  id: "browser-fixture",
  title: "Проверка праздничного запуска",
  description: "Изолированная проверка интерфейса. В действующей игре этот ивент не создаётся.",
  durationMinutes: 60,
  contentPack: "core-v1",
  features: { roulette: true, lite: true },
};
async function layout(page) {
  return page.evaluate(() => {
    const rect = (n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    return {
      width: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      modal: document.querySelector("#eventConfirm[open]")
        ? rect(document.querySelector("#eventConfirm"))
        : null,
    };
  });
}
(async () => {
  const report = [];
  for (const engine of ["chromium", "firefox", "webkit"]) {
    let browser;
    let now = Date.now();
    const store = new ProfileStore({ now: () => now }),
      opened = store.open(),
      access = new OwnerAccess({ ownerId: opened.profile.id }),
      events = new EventManager({ now: () => now });
    const app = createGameServer({
      profiles: store,
      events,
      ownerAccess: access,
      wallNow: () => now,
      autoTick: false,
      arena: new Arena({ etherCount: 0 }),
      testBots: { enabled: false },
    });
    try {
      app.httpServer.listen(0, "127.0.0.1");
      await once(app.httpServer, "listening");
      const url = `http://127.0.0.1:${app.httpServer.address().port}`;
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const context = await browser.newContext({
        viewport: { width: 1366, height: 900 },
        timezoneId: "Asia/Yekaterinburg",
      });
      await context.addCookies([
        { name: "sferorumiya_session", value: opened.token, url, httpOnly: true },
      ]);
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(url + "/admin.html");
      await page.locator("#setupCode").fill(access.bootstrapCode);
      await page.locator("#password").fill(password);
      await page.locator("#loginForm button").click();
      await page.locator(".event-prepared article").filter({ hasText: "Удачная неделя" }).waitFor();
      const prepared = page.locator(".event-prepared article").filter({ hasText: manifest.title });
      const game = await context.newPage();
      game.on("pageerror", (e) => errors.push(e.message));
      await game.clock.install();
      await game.goto(url);
      await game.waitForFunction(() => !document.getElementById("playButton").disabled);
      assert.equal(await game.locator("#rouletteButton").isDisabled(), true);
      assert.equal(await game.locator("#rouletteTicketBadge").isVisible(), false);
      await page.locator("#eventFile").setInputFiles({
        name: "invalid.json",
        mimeType: "application/json",
        buffer: Buffer.from('{"schemaVersion":99}'),
      });
      await page.getByRole("button", { name: "Загрузить и проверить", exact: true }).click();
      await page.locator(".event-message.event-error").waitFor();
      assert.equal(events.data.prepared.length, 0);
      await page.locator("#eventFile").setInputFiles({
        name: "fixture.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(manifest)),
      });
      await page.getByRole("button", { name: "Загрузить и проверить", exact: true }).click();
      await prepared.locator(".event-start").waitFor();
      assert.equal(events.active(), null);
      await prepared.getByRole("button", { name: "3 ч.", exact: true }).click();
      assert.equal(await prepared.locator('input[name="hours"]').inputValue(), "3");
      await prepared.locator('input[name="hours"]').fill("2");
      assert.equal(await prepared.locator(".event-start").isDisabled(), true);
      await prepared.getByRole("button", { name: "Сохранить срок", exact: true }).click();
      await prepared.locator(".event-start:enabled").waitFor();
      assert.equal(
        events.prepared().find((e) => e.manifest.id === manifest.id).manifest.durationMinutes,
        120,
      );
      for (const width of [1366, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const result = await layout(page);
        assert.equal(result.overflow, false);
        await page.screenshot({
          path: path.join(output, `${engine}-${width}-prepared.png`),
          fullPage: true,
        });
        await prepared.locator(".event-start").click();
        const modal = await layout(page);
        assert.ok(modal.modal.left >= 0 && modal.modal.right <= width);
        await page.screenshot({ path: path.join(output, `${engine}-${width}-confirmation.png`) });
        await page.getByRole("button", { name: "Отмена", exact: true }).last().click();
        assert.equal(events.active(), null);
        report.push({ engine, width, ...result, modalFits: true });
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      await prepared.locator(".event-start").click();
      await page.locator("#eventPassword").fill("Definitely wrong password");
      await page.getByRole("button", { name: "Подтвердить запуск", exact: true }).click();
      await page
        .locator("#eventConfirm .event-error")
        .filter({ hasText: "Неверный пароль" })
        .waitFor();
      assert.equal(events.active(), null);
      assert.equal(await page.locator("#eventPassword").inputValue(), "");
      await page.locator("#eventPassword").fill(password);
      await page.getByRole("button", { name: "Подтвердить запуск", exact: true }).click();
      await page.locator(".event-tag").filter({ hasText: "Запланирован" }).waitFor();
      assert.equal(events.data.runs.length, 1);
      const scheduled = events.scheduled();
      assert.equal(scheduled.startsAt % 60000, 0);
      assert.equal(scheduled.endsAt % 60000, 0);
      assert.equal(scheduled.endsAt - scheduled.startsAt, 120 * 60000);
      assert.equal(events.active(), null);
      await game.clock.runFor(21000);
      assert.equal(await game.locator("#rouletteButton").isDisabled(), true);
      now = scheduled.startsAt;
      await page.getByRole("button", { name: "Обновить", exact: true }).click();
      await page.locator(".event-tag").filter({ hasText: "Сейчас в игре" }).waitFor();
      await game.clock.runFor(21000);
      await game
        .locator("#eventAnnouncement[open]")
        .getByRole("button", { name: "Позже", exact: true })
        .click();
      assert.equal(await game.locator("#rouletteButton").isEnabled(), true);
      assert.equal(await game.locator("#rouletteTicketBadge").isVisible(), true);
      await game.locator("#rouletteButton").click();
      await game.locator(".roulette-event").filter({ hasText: manifest.title }).waitFor();
      assert.equal((await context.request.get(url + "/api/profile")).ok(), true);
      const initialEnd = events.active().endsAt;
      for (const width of [1366, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const endsAt = Math.floor((initialEnd + width * 60000) / 60000) * 60000;
        await page
          .locator('input[name="event-end"]')
          .fill(new Date(endsAt + 3 * 3600000).toISOString().slice(0, 16));
        await page.getByRole("button", { name: "Изменить окончание", exact: true }).click();
        await page.locator("#eventPassword").fill(password);
        await page.getByRole("button", { name: "Подтвердить новый срок", exact: true }).click();
        await page.locator("#eventConfirm").waitFor({ state: "hidden" });
        assert.equal(events.active().endsAt, endsAt);
        const fits = await layout(page);
        assert.equal(fits.overflow, false);
        await page.screenshot({
          path: path.join(output, engine + "-" + width + "-timing.png"),
          fullPage: true,
        });
        await game.clock.runFor(21000);
        assert.equal((await context.request.get(url + "/api/profile")).status(), 200);
      }
      now = events.active().endsAt;
      await game.clock.runFor(21000);
      await game.locator(".roulette-event").filter({ hasText: "откроется" }).waitFor();
      assert.equal(events.active(), null);
      await page.getByRole("button", { name: "Обновить", exact: true }).click();
      await prepared.locator(".event-start:enabled").waitFor();
      const startsAt = now + 30 * 60000;
      const plannedValue = new Date(startsAt + 3 * 3600000).toISOString().slice(0, 16);
      await prepared.locator('input[name="event-start"]').fill(plannedValue);
      await prepared.locator(".event-start").click();
      assert.match(
        await page.locator(".event-confirm-summary").innerText(),
        /Начало:.*:00.*Окончание:.*:00/,
      );
      await page.getByRole("button", { name: "Отмена", exact: true }).last().click();
      assert.equal(await prepared.locator('input[name="event-start"]').inputValue(), plannedValue);
      await prepared.locator(".event-start").click();
      await page.locator("#eventPassword").fill(password);
      await page.getByRole("button", { name: "Подтвердить запуск", exact: true }).click();
      await page.locator(".event-tag").filter({ hasText: "Запланирован" }).waitFor();
      assert.equal(events.scheduled().startsAt, startsAt);
      assert.equal(events.scheduled().endsAt, startsAt + 120 * 60000);
      await page.getByRole("button", { name: "Отменить запуск", exact: true }).click();
      await page.locator("#eventPassword").fill(password);
      await page
        .locator("#eventConfirm")
        .getByRole("button", { name: "Отменить запуск", exact: true })
        .click();
      await prepared.locator(".event-start:enabled").waitFor();
      assert.equal(events.scheduled(), null);
      assert.equal(events.publicView(startsAt + 1), null);
      assert.deepEqual(errors, []);
      report.push({
        engine,
        correctPasswordRequired: true,
        autoClientStartAndExpiry: true,
        noPageErrors: true,
      });
      await context.close();
    } finally {
      if (browser) await browser.close();
      await app.close();
    }
  }
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
