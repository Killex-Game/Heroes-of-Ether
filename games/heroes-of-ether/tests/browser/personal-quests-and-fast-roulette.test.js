"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  engines = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  lite = require("../../src/server/accounts/lite-account");
const output =
  process.env.SFER_ARTIFACT_DIR ||
  path.resolve(__dirname, "../../../../artifacts/personal-quests-20261024/browser");
fs.mkdirSync(output, { recursive: true });
const wallAt = Math.floor(Date.now() / 60000) * 60000;
const profiles = new ProfileStore({ now: () => wallAt }),
  events = new EventManager({ now: () => wallAt });
const event = (action, body) =>
  events.apply("test-owner", action, {
    revision: events.data.revision,
    requestId: randomUUID(),
    ...body,
  });
event("upload", {
  manifest: {
    schemaVersion: 1,
    id: "quest-test",
    title: "Тест заданий",
    description: "Изолированный тест",
    durationMinutes: 60,
    contentPack: "core-v1",
    features: { roulette: true, lite: true },
  },
});
event("start", { eventId: "quest-test" });
const app = createGameServer({
  profiles,
  events,
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  wallNow: () => wallAt,
  testBots: { enabled: false },
});
let browser;
const report = [];
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    for (const engine of process.argv[2] && process.argv[2] !== "--layout-only"
      ? [process.argv[2]]
      : ["chromium", "firefox", "webkit"]) {
      const auth = profiles.open(),
        p = () => profiles.find(auth.token);
      lite.activate(p(), profiles.rouletteConfig, Date.now(), events.active().id);
      profiles.save(profiles.data);
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1050 },
        reducedMotion: "no-preference",
      });
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
      await page.addInitScript(() => {
        window.rouletteAnimations = 0;
        const original = Element.prototype.animate;
        Element.prototype.animate = function (frames, options) {
          if (options?.duration === 4800 && this.classList.contains("roulette-wheel"))
            window.rouletteAnimations++;
          return original.call(this, frames, options);
        };
      });
      const ready = async () => {
        await page.goto(url);
        await page.waitForFunction(() => !document.getElementById("playButton").disabled);
        if (await page.locator("#eventAnnouncement[open]").count())
          await page.locator(".event-announcement-close").click();
      };
      await ready();
      assert.equal(
        await page.locator("#wardrobeSection + button").getAttribute("id"),
        "questsSection",
      );
      await page.locator("#questsSection").click();
      await page.locator(".quest-card").nth(3).waitFor();
      assert.equal(await page.locator('.quest-card[data-tier="large"]').count(), 2);
      const geometry = async (selector, width, height, name) => {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => document.fonts.ready);
        const box = await page.locator(selector).evaluate((n) => {
          const b = n.getBoundingClientRect();
          const bad = [...n.querySelectorAll("button,input,article")]
            .filter((node) => node.checkVisibility())
            .filter((node) => {
              const r = node.getBoundingClientRect();
              return r.left < b.left - 1 || r.right > b.right + 1;
            })
            .map((node) => node.className);
          return {
            left: b.left,
            right: b.right,
            client: n.clientWidth,
            scroll: n.scrollWidth,
            bad,
          };
        });
        assert.ok(
          box.left >= 0 && box.right <= width + 1 && box.scroll <= box.client + 1,
          `${name}: ${JSON.stringify(box)}`,
        );
        assert.deepEqual(box.bad, [], name);
        await page.screenshot({ path: path.join(output, `${engine}-${name}-${width}.png`) });
        report.push({ engine, name, width, ...box });
      };
      for (const [w, h] of [
        [1440, 1050],
        [900, 650],
        [390, 844],
      ])
        await geometry("#questsDialog", w, h, "quests");
      if (process.argv.includes("--layout-only")) {
        assert.deepEqual(errors, []);
        await browser.close();
        browser = null;
        continue;
      }
      await page.setViewportSize({ width: 1440, height: 1050 });
      const change = async (label) => {
        const previous = await page.locator(".quest-card").first().getAttribute("data-quest-id");
        const bounds = await page.locator("#questsDialog").boundingBox();
        await page.locator(".quest-reroll").first().click();
        assert.match(await page.locator(".quest-confirm-details").innerText(), label);
        const response = page.waitForResponse(
          (r) => r.url().endsWith("/api/quests/action") && r.request().method() === "POST",
        );
        await page
          .locator(".quest-confirm")
          .getByRole("button", { name: "Сменить", exact: true })
          .click();
        assert.equal((await response).status(), 200);
        await page.waitForFunction(
          (id) => !document.querySelector(`.quest-card[data-quest-id="${id}"]`),
          previous,
        );
        assert.deepEqual(await page.locator("#questsDialog").boundingBox(), bounds);
        assert.equal(await page.locator("#questsDialog .quests-status").count(), 0);
      };
      const initialCoins = p().wallet.coins;
      await change(/Бесплатно/);
      assert.equal(p().wallet.coins, initialCoins);
      await change(/100 монет/);
      assert.equal(p().wallet.coins, initialCoins - 100);
      // Завершённый сундук автоматически хранится в сокровищнице и открывается оттуда.
      const row = p().quests.items.find((r) => r.questId === "giant") || p().quests.items[0];
      row.questId = "giant";
      profiles.applyArenaProgress(
        randomUUID(),
        [
          { type: "lifeStarted", profileId: p().id, lifeId: "ui-life" },
          { type: "massPeak", profileId: p().id, mass: 50000 },
          { type: "lifeEnded", profileId: p().id, lifeId: "ui-life", durationSeconds: 0 },
        ],
        Date.now(),
      );
      await page.locator('#questsDialog button[aria-label="Закрыть задания"]').click();
      await page.locator("#questsSection").click();
      const card = page.locator(`.quest-card[data-quest-id="${row.id}"]`);
      await page.waitForFunction(
        (id) => document.querySelector(`[data-quest-id="${id}"]`)?.dataset.state === "complete",
        row.id,
      );
      const reward = p().quests.pending.find((r) => r.id === row.id),
        before = p().wallet.coins,
        tickets = p().roulette.tickets;
      await card.locator(".quest-claim").click();
      await page
        .locator(`.quest-treasury-chest[data-chest-id="${row.id}"]`)
        .getByRole("button", { name: "Открыть", exact: true })
        .click();
      await page.locator("#chestRewardDialog[open]").waitFor();
      await page.locator(".chest-claim").click();
      await page.waitForFunction(
        (id) => document.querySelector(`[data-quest-id="${id}"]`)?.dataset.state === "claimed",
        row.id,
      );
      assert.equal(p().wallet.coins, before + reward.coins);
      assert.equal(
        p().roulette.tickets,
        tickets + 4,
        "event chest plus the existing Lite chest bonus",
      );
      await page.keyboard.press("Escape");
      await page.locator("#rouletteButton").click();
      await page.locator("#rouletteFastSpin").waitFor();
      assert.equal(
        await page.locator(".roulette-spin:not(.roulette-spin-five)").innerText(),
        "Крутить рулетку",
      );
      assert.equal(await page.locator(".roulette-spin-five").innerText(), "Крутить рулетку x5");
      for (const [w, h] of [
        [1440, 1050],
        [900, 650],
        [390, 844],
      ])
        await geometry("#rouletteDialog", w, h, "roulette-fast");
      await page.setViewportSize({ width: 1440, height: 1050 });
      await page.locator("#rouletteFastSpin").check();
      const ticketCount = p().roulette.tickets;
      await page.locator(".roulette-spin-five").click();
      await page.waitForFunction(() =>
        document.querySelector(".roulette-status").textContent.startsWith("Все 5 призов зачислены"),
      );
      assert.equal(p().roulette.tickets, ticketCount - 5);
      assert.equal(await page.evaluate(() => rouletteAnimations), 0);
      await page.locator(".roulette-spin:not(.roulette-spin-five)").click();
      await page.waitForFunction(() =>
        document.querySelector(".roulette-status").textContent.startsWith("Поздравляем!"),
      );
      assert.equal(await page.evaluate(() => rouletteAnimations), 0);
      await ready();
      await page.locator("#rouletteButton").click();
      assert.equal(await page.locator("#rouletteFastSpin").isChecked(), true);
      await page.locator("#rouletteFastSpin").uncheck();
      await page.locator(".roulette-spin:not(.roulette-spin-five)").click();
      await page.waitForFunction(() =>
        document.querySelector(".roulette-status").textContent.startsWith("Поздравляем!"),
      );
      assert.equal(await page.evaluate(() => rouletteAnimations), 1);
      delete p().lite;
      p().revision++;
      await ready();
      await page.locator("#rouletteButton").click();
      assert.equal(await page.locator("#rouletteFastSpin").isDisabled(), true);
      assert.equal(await page.locator("#rouletteFastSpin").isChecked(), false);
      assert.equal(await page.locator(".roulette-spin-five").isVisible(), true);
      assert.equal(await page.locator(".roulette-spin-five").isDisabled(), false);
      for (const [w, h] of [
        [1440, 1050],
        [390, 844],
        [844, 390],
      ])
        await geometry("#rouletteDialog", w, h, "roulette-without-lite");
      const withoutLiteTickets = p().roulette.tickets;
      await page.locator(".roulette-spin-five").click();
      await page.waitForFunction(() =>
        document.querySelector(".roulette-status").textContent.startsWith("Все 5 призов зачислены"),
      );
      assert.equal(p().roulette.tickets, withoutLiteTickets - 5);
      assert.equal(await page.evaluate(() => rouletteAnimations), 1);
      assert.doesNotMatch(await page.locator(".lite-features").textContent(), /5 вращений/);
      assert.deepEqual(errors, []);
      assert.deepEqual(missing, []);
      report.push({
        engine,
        functional: "passed",
        fastSingleAndFive: true,
        normalAnimation: true,
        disabledWithoutLite: true,
      });
      await browser.close();
      browser = null;
    }
    fs.writeFileSync(
      path.join(
        output,
        process.argv.includes("--layout-only") ? "layout-report.json" : "report.json",
      ),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
