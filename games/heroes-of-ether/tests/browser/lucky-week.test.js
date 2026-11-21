"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  engines = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager"),
  { OwnerAccess } = require("../../src/server/admin/owner-access"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation");
const lucky = require("../../src/server/events/lucky-week"),
  output = path.resolve(__dirname, "../../../../artifacts/event-timing-frame-20261023/game-browser");
fs.mkdirSync(output, { recursive: true });
(async () => {
  const report = [];
  for (const engine of ["chromium", "firefox", "webkit"]) {
    let browser,
      now = Date.now();
    const profiles = new ProfileStore({ now: () => now }),
      auth = profiles.open(),
      events = new EventManager({ now: () => now }),
      access = new OwnerAccess({ ownerId: auth.profile.id });
    const app = createGameServer({
      profiles,
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
      const url = "http://127.0.0.1:" + app.httpServer.address().port;
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const context = await browser.newContext({
        viewport: { width: 1366, height: 900 },
        reducedMotion: "reduce",
      });
      await context.addCookies([{ name: "sferorumiya_session", value: auth.token, url }]);
      const admin = await context.newPage(),
        errors = [];
      admin.on("pageerror", (e) => errors.push(e.message));
      await admin.goto(url + "/admin.html");
      await admin.locator("#setupCode").fill(access.bootstrapCode);
      await admin.locator("#password").fill("Isolated browser password 2026");
      await admin.locator("#loginForm button").click();
      const card = admin.locator(".event-prepared article").filter({ hasText: "Удачная неделя" });
      await card.waitFor();
      assert.equal(events.active(), null);
      assert.match(await card.innerText(), /Достижений: 5/);
      const game = await context.newPage();
      game.on("pageerror", (e) => errors.push(e.message));
      await game.clock.install();
      await game.goto(url);
      await game.waitForFunction(() => !document.getElementById("playButton").disabled);
      for (const width of [1366, 390]) {
        await admin.setViewportSize({ width, height: 900 });
        assert.equal(
          await admin.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2),
          false,
        );
        await card.getByRole("button", { name: "Запустить", exact: true }).click();
        await admin.locator("#eventConfirm").waitFor();
        await admin.getByRole("button", { name: "Отмена", exact: true }).last().click();
      }
      await card.getByRole("button", { name: "Запустить", exact: true }).click();
      await admin.locator("#eventPassword").fill("Wrong password 2026");
      await admin.getByRole("button", { name: "Подтвердить запуск", exact: true }).click();
      await admin
        .locator("#eventConfirm .event-error")
        .filter({ hasText: "Неверный пароль" })
        .waitFor();
      assert.equal(events.active(), null);
      await admin.locator("#eventPassword").fill("Isolated browser password 2026");
      await admin.getByRole("button", { name: "Подтвердить запуск", exact: true }).click();
      await admin.locator(".event-tag").filter({ hasText: "Сейчас в игре" }).waitFor();
      await game.clock.runFor(21000);
      await game.locator("#eventAnnouncement[open]").waitFor();
      const extendedEnd = events.active().endsAt + 3600000;
      events.apply("owner", "reschedule", {
        requestId: randomUUID(),
        revision: events.data.revision,
        runId: events.active().id,
        endsAt: extendedEnd,
      });
      await game.clock.runFor(21000);
      assert.equal(
        await game.locator(".event-announcement-dates time").last().getAttribute("datetime"),
        new Date(extendedEnd).toISOString(),
      );
      for (const width of [1366, 390]) {
        await game.setViewportSize({ width, height: 900 });
        await game.waitForTimeout(100);
        const fits = await game.locator("#eventAnnouncement").evaluate((n) => {
          const r = n.getBoundingClientRect();
          return (
            r.left >= 0 &&
            r.right <= innerWidth + 1 &&
            r.top >= 0 &&
            r.bottom <= innerHeight + 1 &&
            n.scrollWidth <= n.clientWidth + 1
          );
        });
        assert.ok(fits);
        assert.match(await game.locator("#eventAnnouncement").innerText(), /Удачная неделя/);
        assert.match(await game.locator(".event-announcement-zone").innerText(), /Москве/);
        assert.equal(
          await game
            .locator(".event-announcement-banner")
            .evaluate((n) => n.complete && n.naturalWidth > 0),
          true,
        );
        await game.screenshot({ path: path.join(output, `${engine}-${width}-announcement.png`) });
      }
      await game
        .locator("#eventAnnouncement")
        .getByRole("button", { name: "Позже", exact: true })
        .click();
      await game.reload();
      await game.waitForFunction(() => !document.getElementById("playButton").disabled);
      assert.equal(await game.locator("#eventAnnouncement").evaluate((n) => n.open), false);
      for (const width of [1366, 390]) {
        await game.setViewportSize({ width, height: 900 });
        await game.locator("#achievementsButton").click();
        await game.clock.runFor(200);
        if (width <= 700)
          await game.locator('.achievement-panel-tabs [data-panel="showcase"]').click();
        const previous = game.getByRole("button", { name: "Предыдущая страница", exact: true });
        while (await previous.isEnabled()) await previous.click();
        await game.locator('[data-achievement="lucky_attempt"]').waitFor();
        await game.waitForFunction(() =>
          [...document.querySelectorAll(".achievement-card img")].every(
            (n) => n.complete && n.naturalWidth,
          ),
        );
        assert.equal(
          await game
            .locator("#achievementsDialog")
            .evaluate((n) => n.scrollWidth > n.clientWidth + 2),
          false,
        );
        await game.locator('[data-achievement="lucky_attempt"]').click();
        assert.match(await game.locator("#achievementDetail").innerText(), /Удачная неделя/);
        await game.screenshot({ path: path.join(output, `${engine}-${width}-achievements.png`) });
        await game.keyboard.press("Escape");
      }
      const loaded = await game.evaluate(
        async (ids) =>
          Promise.all(
            ids.map(async (id) => {
              const img = new Image();
              img.src = window.KillexProgressionArt.achievement(id);
              await img.decode();
              return img.naturalWidth;
            }),
          ),
        [
          ...lucky.achievements.map((d) => d.id),
          "career",
          "king",
          "eaten",
          "maximum",
          "boosters",
          "wealthy",
          "spendthrift",
          "miner",
          "spendthrift_i",
          "banker",
          "spendthrift_ii",
          "top",
          "generous",
          "needed",
          "sociable",
          "for_clan",
          "investment",
          "not_stingy",
          "resident",
        ],
      );
      assert.ok(loaded.every((n) => n === 256));
      now = events.active().endsAt;
      await game.clock.runFor(21000);
      await game.locator("#achievementsButton").click();
      await game.waitForFunction(
        () => !document.querySelector('[data-achievement="lucky_attempt"]'),
      );
      await game.keyboard.press("Escape");
      // A new run has a new announcement; an existing dialog defers it until closed.
      await game.locator("#achievementsButton").click();
      events.apply("owner", "start", {
        requestId: randomUUID(),
        revision: events.data.revision,
        eventId: "lucky-week",
      });
      await game.clock.runFor(21000);
      assert.equal(await game.locator("#eventAnnouncement").evaluate((n) => n.open), false);
      await game.keyboard.press("Escape");
      await game.locator("#eventAnnouncement[open]").waitFor();
      await game
        .locator("#eventAnnouncement")
        .getByRole("button", { name: "Позже", exact: true })
        .click();
      events.apply("owner", "stop", {
        requestId: randomUUID(),
        revision: events.data.revision,
        runId: events.active().id,
      });
      await game.clock.runFor(21000);
      for (const width of [1366, 390]) {
        await game.setViewportSize({ width, height: 900 });
        assert.equal(await game.locator("#rouletteButton").isDisabled(), true);
        assert.equal(await game.locator("#rouletteTicketBadge").isVisible(), false);
        await game.screenshot({ path: path.join(output, engine + "-" + width + "-locked.png") });
        await game.locator("#shopSection").click();
        await game.clock.runFor(200);
        const gap = await game.evaluate(() => {
          const cats = document
            .querySelector("#boosterDialog .shop-categories")
            .getBoundingClientRect();
          const tabs = document
            .querySelector("#boosterDialog .booster-tabs")
            .getBoundingClientRect();
          const filters = document
            .querySelector("#boosterDialog .booster-filters")
            .getBoundingClientRect();
          const dialog = document.querySelector("#boosterDialog");
          return {
            first: cats.top - tabs.bottom,
            second: filters.top - cats.bottom,
            overflow: dialog.scrollWidth > dialog.clientWidth + 2,
          };
        });
        assert.equal(gap.overflow, false);
        if (width > 700) {
          assert.ok(Math.abs(gap.first - gap.second) < 1, JSON.stringify(gap));
          assert.ok(gap.second <= 10);
        }
        await game.screenshot({ path: path.join(output, engine + "-" + width + "-shop.png") });
        await game.locator("#boosterDialog .booster-close").click();
        await game.locator("#boosterDialog").waitFor({ state: "hidden" });
      }
      assert.deepEqual(errors, []);
      report.push({
        engine,
        widths: [1366, 390],
        prepared: true,
        passwordRequired: true,
        announcementOncePerRun: true,
        dialogDeferral: true,
        expiryHidesAchievements: true,
        allCanonicalImagesLoaded: true,
        errors,
      });
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
