"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  engines = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager"),
  { createGameServer } = require("../../src/server/game-server"),
  E = require("../../src/server/events/easter-hunt"),
  rules = require("../../public/shared/easter-rules");
const out =
  process.env.EASTER_OUTPUT || path.resolve("../artifacts/easter-four-cards-20261027/browser");
fs.mkdirSync(out, { recursive: true });
(async () => {
  const report = [];
  for (const engine of ["chromium", "firefox", "webkit"].filter(
    (n) => !process.env.EASTER_BROWSER || n === process.env.EASTER_BROWSER,
  )) {
    const now = Math.floor(Date.now() / 60000) * 60000,
      profiles = new ProfileStore({ now: () => now }),
      events = new EventManager({ now: () => now });
    profiles.events = events;
    events.apply("test", "start", { eventId: E.manifest.id, revision: 0, requestId: randomUUID() });
    const auth = profiles.open();
    profiles.applyArenaProgress(
      randomUUID(),
      [{ type: "easterPickup", eggType: 0, runId: events.active().id, profileId: auth.profile.id }],
      now,
    );
    const s = profiles.find(auth.token).easter.runs[events.active().id];
    s.fragmentCounts = Array.from({ length: 48 }, (_, i) =>
      i < 3
        ? i + 1
        : i >= 12 && i < 18
          ? 1
          : i >= 24 && i < 36
            ? i === 24
              ? 31
              : 1
            : i === 47
              ? 1
              : 0,
    );
    s.fragments = s.fragmentCounts.filter((n) => n > 0).length;
    profiles.refreshCompetition(now);
    profiles.find(auth.token).honors.notified = profiles.find(auth.token).honors.claimed;
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
        context = await browser.newContext({
          viewport: { width: 1920, height: 1080 },
          timezoneId: "Asia/Yekaterinburg",
        });
      await context.addCookies([
        { name: "sferorumiya_session", value: auth.token, url, httpOnly: true },
      ]);
      const page = await context.newPage(),
        errors = [];
      await page.addLocatorHandler(page.locator("#titleEarnedDialog[open]"), async () => {
        await page
          .locator("#titleEarnedDialog")
          .getByRole("button", { name: "Отлично", exact: true })
          .click();
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      const notice = page.getByRole("button", { name: "Закрыть объявление об ивенте" });
      if (await notice.isVisible()) await notice.click();
      await page.locator("#eventsSection").click();
      await page.locator('[data-event-index="2"]').click();
      const dialog = page.locator("#easterDialog"),
        cards = dialog.locator(".easter-collection-card");
      await dialog.waitFor();
      assert.equal(
        await dialog.locator(".easter-exchange").textContent(),
        "Обменять набор на сундук",
      );
      await dialog.locator(".easter-exchange-help").focus();
      await page.locator("#boosterTooltip:popover-open").waitFor();
      assert.equal(await page.locator("#boosterTooltip .tooltip-item-recipe img").count(), 4);
      await page.keyboard.press("Tab");
      const view = profiles.view(profiles.find(auth.token));
      assert.equal(view.easter.endsAt, view.event.endsAt);
      assert.equal(
        await dialog.locator(".easter-heading > div > small").textContent(),
        await page.evaluate(
          (at) =>
            "До " +
            new Date(at).toLocaleString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            }),
          view.easter.endsAt,
        ),
      );
      assert.equal(await cards.count(), 4);
      assert.equal(await dialog.locator(".easter-prizes > div").count(), 3);
      assert.equal(await dialog.locator(".easter-fragment").count(), 48);
      assert.deepEqual(await cards.locator(".easter-card-progress").allTextContents(), [
        "3 / 12 фрагментов",
        "6 / 12 фрагментов",
        "12 / 12 фрагментов",
        "1 / 12 фрагментов",
      ]);
      for (let i = 0; i < 4; i++) {
        assert.ok(
          (
            await cards
              .nth(i)
              .locator(".easter-fragment")
              .first()
              .evaluate((n) => getComputedStyle(n).backgroundImage)
          ).includes(rules.collections[i].image),
        );
        assert.equal(await cards.nth(i).getByRole("button").isEnabled(), i === 2);
      }
      for (const [width, height] of [
        [1920, 1080],
        [1366, 900],
        [1024, 600],
        [844, 390],
        [768, 800],
        [650, 900],
        [390, 844],
        [320, 568],
      ]) {
        await page.setViewportSize({ width, height });
        const tabs = dialog.locator(".easter-tabs");
        if (await tabs.isVisible()) await tabs.getByRole("button").first().click();
        await page.waitForTimeout(80);
        const geometry = await dialog.evaluate((d) => {
          const cards = [...d.querySelectorAll(".easter-collection-card")].map((n) =>
            n.getBoundingClientRect(),
          );
          const outside = [
            ...d.querySelectorAll("button,.easter-panel,.easter-album,h2,.easter-card-progress"),
          ]
            .filter((n) => n.getClientRects().length)
            .map((n) => ({
              text: n.textContent.slice(0, 40),
              r: n.getBoundingClientRect().toJSON(),
            }))
            .filter(
              ({ r }) =>
                r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1,
            );
          return {
            outside,
            rows: new Set(cards.map((r) => Math.round(r.top))).size,
            overlap: cards.some((a, i) =>
              cards
                .slice(i + 1)
                .some(
                  (b) =>
                    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1,
                ),
            ),
            visible: cards.filter((r) => r.width > 0 && r.height > 0).length,
          };
        });
        await page.screenshot({ path: path.join(out, `${engine}-${width}x${height}.png`) });
        assert.deepEqual(geometry.outside, [], `${engine} ${width}x${height}`);
        assert.equal(geometry.overlap, false);
        assert.equal(geometry.visible, 4);
        assert.equal(geometry.rows, width <= 740 && height > 460 ? 2 : 1);
        if (await tabs.isVisible()) {
          await tabs.getByRole("button").nth(1).click();
          assert.equal(await dialog.locator(".easter-rewards").isVisible(), true);
          const bottom = await dialog.locator(".easter-footer").boundingBox();
          await page.screenshot({ path: path.join(out, engine + "-rewards-" + width + ".png") });
          assert.ok(bottom.y + bottom.height <= height + 1, `${engine} rewards ${width}`);
        }
      }
      await page.setViewportSize({ width: 1920, height: 1080 });
      const eggsBefore = profiles
        .find(auth.token)
        .easter.runs[events.active().id].eggs.reduce((a, b) => a + b, 0);
      await cards.nth(2).getByRole("button").click();
      await page.waitForFunction(
        () =>
          document.querySelector(".easter-message").textContent ===
          "Все лишние фрагменты этой картины обменены на яйца.",
      );
      assert.equal(
        profiles.find(auth.token).easter.runs[events.active().id].eggs.reduce((a, b) => a + b, 0),
        eggsBefore + 300,
      );
      assert.equal(await cards.nth(2).locator(".easter-fragment").first().textContent(), "");
      assert.equal(await cards.nth(2).getByRole("button").isDisabled(), true);
      assert.equal(await cards.nth(2).getAttribute("data-complete"), "true");
      const player = profiles.find(auth.token),
        state = player.easter.runs[events.active().id];
      state.fragmentCounts = Array(48).fill(1);
      state.fragments = 48;
      player.easter.trophies = [{ runId: events.active().id, at: now, collectionVersion: 2 }];
      player.outfit.hat = "rabbit_ears";
      player.outfit.bow = "carrot_bow";
      state.exchangedEggs = state.exchangedEggs.map((n) => n + 100);
      state.eggs = state.eggs.map((n) => n + 100);
      player.easter.etherExchangeDays = { [Math.floor((now + 10800000) / 86400000)]: 9 };
      profiles.refreshCompetition(now);
      profiles.find(auth.token).honors.notified = profiles.find(auth.token).honors.claimed;
      await page.reload();
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      const eventNotice = page.getByRole("button", { name: "Закрыть объявление об ивенте" });
      if (await eventNotice.isVisible()) await eventNotice.click();
      const collectionNotice = page.locator("#collectionEarnedDialog");
      await collectionNotice.waitFor();
      assert.equal(await collectionNotice.locator(".collection-earned-prize").count(), 3);
      for (const [width, height] of [
        [1366, 900],
        [390, 844],
        [320, 568],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        const fits = await collectionNotice.evaluate((d) => {
          const r = d.getBoundingClientRect();
          return (
            r.top >= 0 &&
            r.bottom <= innerHeight &&
            r.left >= 0 &&
            r.right <= innerWidth &&
            d.scrollHeight <= d.clientHeight + 2
          );
        });
        assert.ok(fits, `collection notice fits ${width}x${height}`);
        await page.screenshot({ path: path.join(out, `${engine}-collection-notice-${width}.png`) });
      }
      await collectionNotice.getByRole("button", { name: "Отлично", exact: true }).click();
      await page.waitForTimeout(250);
      assert.ok(profiles.find(auth.token).easter.trophies[0].notifiedAt);
      await page.reload();
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      assert.equal(
        await collectionNotice.isVisible(),
        false,
        "notice is not repeated after reload",
      );
      await page.waitForTimeout(250);
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#skinPreview .outfit-accessory")].every(
          (img) => img.complete && img.naturalWidth > 0 && !img.hidden,
        ),
      );
      await page.screenshot({ path: path.join(out, engine + "-front-hat-lobby.png") });
      await page.locator("#wardrobeSection").click();
      const wardrobe = page.locator("#skinsDialog");
      await wardrobe.getByRole("button", { name: "Бабочки", exact: true }).click();
      const bowCard = wardrobe.locator('[data-accessory-id="carrot_bow"]');
      assert.equal(await bowCard.getAttribute("data-locked"), "false");
      assert.match(
        await bowCard.locator(".accessory-bonus").textContent(),
        /Бонусный бустер «Пасхальное яйцо»/,
      );
      for (const [width, height] of [
        [1366, 900],
        [390, 844],
        [320, 568],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(150);
        const outside = await wardrobe.evaluate((d) =>
          [...d.querySelectorAll("button,.accessory-art,.accessory-copy")]
            .filter((n) => n.getClientRects().length)
            .map((n) => ({
              text: n.textContent.slice(0, 40),
              r: n.getBoundingClientRect().toJSON(),
            }))
            .filter(
              ({ r }) =>
                r.top < -1 || r.left < -1 || r.bottom > innerHeight + 1 || r.right > innerWidth + 1,
            ),
        );
        assert.deepEqual(outside, [], engine + " wardrobe " + width);
        const clipped = await wardrobe.evaluate((d) =>
          [...d.querySelectorAll(".accessory-list button,.collection-pages button")]
            .filter((n) => n.getClientRects().length)
            .filter((n) => {
              const r = n.getBoundingClientRect(),
                hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              return !n.contains(hit);
            })
            .map((n) => n.textContent),
        );
        await page.screenshot({ path: path.join(out, engine + "-wardrobe-" + width + ".png") });
        assert.deepEqual(clipped, [], engine + " wardrobe actions unobstructed " + width);
        const next = wardrobe
          .locator(".collection-pages")
          .getByRole("button", { name: "Следующая страница" });
        if (await next.isVisible()) {
          await next.click();
          await page.waitForTimeout(80);
          const novice = wardrobe.locator('[data-accessory-id="novice_bow"] button');
          assert.ok(await novice.isVisible());
          const visible = await novice.evaluate((n) => {
            const r = n.getBoundingClientRect();
            return n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          });
          assert.ok(visible, engine + " second bow action " + width);
          await wardrobe
            .locator(".collection-pages")
            .getByRole("button", { name: "Предыдущая страница" })
            .click();
        }
      }
      await wardrobe.getByRole("button", { name: "Закрыть гардероб", exact: true }).click();
      await page.locator("#eventsSection").click();
      await page.locator('[data-event-index="2"]').click();
      for (const [width, height] of [
        [1920, 1080],
        [390, 844],
        [320, 568],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        const tabs = dialog.locator(".easter-tabs");
        if (await tabs.isVisible()) await tabs.getByRole("button").nth(1).click();
        const note = dialog.locator(".easter-rewards .easter-note");
        assert.match(await note.textContent(), /Осталось обменов сегодня: 1 \/ 10/);
        const r = await note.boundingBox();
        assert.ok(
          r && r.y + r.height <= height + 1 && r.x + r.width <= width + 1,
          `${engine} limit note fits ${width}`,
        );
        await page.screenshot({ path: path.join(out, `${engine}-limit-${width}.png`) });
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      const etherBefore = profiles.find(auth.token).wallet.bucks;
      await dialog.locator(".easter-ether-exchange").click();
      await page.waitForFunction(() =>
        document.querySelector(".easter-rewards .easter-note").textContent.includes("0 / 10"),
      );
      assert.equal(await dialog.locator(".easter-ether-exchange").isDisabled(), true);
      assert.equal(profiles.find(auth.token).wallet.bucks, etherBefore + 5);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.locator("#playButton").click();
      const ability = page.locator(".accessory-ability");
      await ability.waitFor({ state: "visible" });
      assert.match(await ability.getAttribute("aria-label"), /E.*Пасхальное яйцо, 1/);
      for (const [width, height] of [
        [1366, 900],
        [390, 844],
        [320, 568],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        const r = await ability.boundingBox();
        assert.ok(r && r.x >= 0 && r.y >= 0 && r.x + r.width <= width && r.y + r.height <= height);
      }
      await page.keyboard.press("e");
      await page.waitForFunction(
        () => document.querySelector(".accessory-ability .booster-slot-count").textContent === "0",
      );
      assert.equal(await ability.isDisabled(), true);
      const arenaPlayer = [...app.arena.players.values()].find(
        (p) => p.profileId === auth.profile.id,
      );
      assert.ok(arenaPlayer.effects.easter_egg > 0);
      assert.equal(arenaPlayer.boosterUses.easter_egg, undefined);
      await page.screenshot({ path: path.join(out, engine + "-accessory-E-arena.png") });
      assert.deepEqual(errors, []);
      report.push({
        engine,
        layouts: 12,
        cards: 4,
        fragments: 48,
        exchange: true,
        etherLimit: true,
        hat: true,
        bow: true,
        accessoryE: true,
        errors,
      });
      console.log(engine + ": passed");
    } finally {
      await browser?.close();
      await app.close();
    }
  }
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
