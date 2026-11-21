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
  E = require("../../src/server/events/easter-hunt");
const out =
  process.env.EASTER_OUTPUT ||
  path.resolve(__dirname, "../../../../artifacts/event-presentation-20261027/browser");
fs.mkdirSync(out, { recursive: true });
(async () => {
  const report = [];
  for (const engine of ["chromium", "firefox", "webkit"].filter(
    (n) => !process.env.EASTER_BROWSER || n === process.env.EASTER_BROWSER,
  )) {
    const now = Math.floor(Date.now() / 60000) * 60000,
      profiles = new ProfileStore({ now: () => now }),
      events = new EventManager({ now: () => now });
    let arenaNow = 0;
    events.apply("test", "start", {
      eventId: E.manifest.id,
      revision: 0,
      requestId: randomUUID(),
    });
    profiles.events = events;
    const auth = profiles.open();
    const testProfile = profiles.find(auth.token);
    testProfile.level = 12;
    testProfile.progress.xp =
      require("../../src/server/progression/experience-progression").xpForLevel(12);
    profiles.applyArenaProgress(
      randomUUID(),
      Array.from({ length: 676 }, (_, i) => ({
        type: "easterPickup",
        eggType: i % 4,
        runId: events.active().id,
        profileId: auth.profile.id,
      })),
      now,
    );
    const app = createGameServer({
      profiles,
      events,
      autoTick: false,
      now: () => arenaNow,
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
          viewport: { width: 1366, height: 900 },
        });
      await context.addCookies([
        { name: "sferorumiya_session", value: auth.token, url, httpOnly: true },
      ]);
      const page = await context.newPage(),
        errors = [],
        missing = [];
      // Fresh profiles must finish the mandatory first nickname and claim the
      // daily reward before event announcements. Do not bypass production UI.
      await page.addLocatorHandler(page.locator("#personalDialog[open]"), async () => {
        await page.locator("#profileNickname").fill("Исследователь");
        await page.locator("#personalDialog").getByRole("button", { name: "Сохранить", exact: true }).click();
      });
      await page.addLocatorHandler(page.locator(".daily-login-dialog[open]"), async () => {
        await page.locator(".daily-login-dialog").getByRole("button", { name: "Забрать награду", exact: true }).click();
      });
      await page.addLocatorHandler(page.locator("#titleEarnedDialog[open]"), async () => {
        await page.locator("#titleEarnedDialog").getByRole("button", { name: "Отлично", exact: true }).click();
      });
      await page.addLocatorHandler(page.locator("#collectionEarnedDialog[open]"), async () => {
        await page.locator("#collectionEarnedDialog").getByRole("button", { name: "Отлично", exact: true }).click();
      });
      page.on("pageerror", (e) => errors.push(e.stack || e.message));
      page.on("response", (r) => {
        if (r.status() === 404) missing.push(new URL(r.url()).pathname);
      });
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.getByRole("button", { name: "Закрыть объявление об ивенте" }).click();
      for (const width of [1366, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator("#petsSection").click();
        const box = await page.locator(".pets-close").boundingBox();
        assert.equal(Math.round(box.width), 92);
        assert.equal(Math.round(box.height), 34);
        await page.locator(".pets-heading").screenshot({
          path: path.join(out, engine + "-pets-heading-" + width + ".png"),
        });
        await page.locator(".pets-close").click();
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.locator("#wardrobeSection").click();
      const wardrobe = page.locator("#skinsDialog");
      await wardrobe.getByRole("button", { name: "Шапки", exact: true }).click();
      const lockedEars = wardrobe.locator('[data-accessory-id="rabbit_ears"]');
      assert.equal(await lockedEars.getAttribute("data-locked"), "true");
      assert.equal(await lockedEars.locator(".accessory-lock").isVisible(), true);
      assert.equal(await lockedEars.getByRole("button").isEnabled(), false);
      assert.equal(
        await wardrobe.locator('[data-accessory-id="novice_hat"] .accessory-lock').isVisible(),
        false,
      );
      for (const width of [1366, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await lockedEars.scrollIntoViewIfNeeded();
        const geometry = await lockedEars.evaluate((card) => {
          const r = card.getBoundingClientRect(),
            lock = card.querySelector(".accessory-lock").getBoundingClientRect();
          return {
            outside: r.left < 0 || r.right > innerWidth + 1,
            clipped: card.scrollWidth > card.clientWidth + 1,
            lockInside:
              lock.right <= r.right &&
              lock.left >= r.left &&
              lock.top >= r.top &&
              lock.bottom <= r.bottom,
            dimmed: +getComputedStyle(card.querySelector(".accessory-art")).opacity < 1,
          };
        });
        assert.deepEqual(geometry, {
          outside: false,
          clipped: false,
          lockInside: true,
          dimmed: true,
        });
        await lockedEars.screenshot({ path: path.join(out, `${engine}-locked-hat-${width}.png`) });
      }
      await wardrobe.getByRole("button", { name: "Бабочки", exact: true }).click();
      assert.equal(
        await wardrobe.locator('[data-accessory-id="novice_bow"]').getAttribute("data-locked"),
        "false",
      );
      await page.evaluate(() => document.getElementById("skinsDialog").close());
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.locator("#eventsSection").click();
      assert.equal(await page.locator('[data-event-index="0"]').isEnabled(), true);
      await page.locator(".events-activity-flow").waitFor();
      for (const [width, height] of [
        [1920, 1080],
        [1366, 900],
        [1024, 600],
        [844, 390],
        [390, 844],
        [320, 568],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForFunction(() => {
          const map = document.querySelector(".events-map").getBoundingClientRect(),
            stage = document.querySelector(".events-stage").getBoundingClientRect();
          return (
            map.left >= stage.left &&
            map.right <= stage.right + 1 &&
            map.top >= stage.top &&
            map.bottom <= stage.bottom + 1
          );
        });
        await page.waitForTimeout(100);
        const seen = new Set();
        for (let turn = 0; turn < 4; turn++) {
          const geometry = await page.evaluate(() => {
            const map = document.querySelector(".events-map").getBoundingClientRect(),
              cards = [...document.querySelectorAll(".event-card")].filter((n) => !n.hidden),
              rects = cards.map((n) => n.getBoundingClientRect()),
              center = rects[0];
            const overlap = rects.some((a, i) =>
              rects
                .slice(i + 1)
                .some(
                  (b) =>
                    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1,
                ),
            );
            const outside = rects.some(
              (r) =>
                r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1,
            );
            const clipped = cards
              .filter(
                (n) => n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1,
              )
              .map((n) => n.dataset.eventIndex);
            const line = document.querySelector(".events-activity-flow");
            let lineOK = true;
            if (line) {
              const svg = line.ownerSVGElement.getBoundingClientRect(),
                source = document.querySelector('[data-event-index="2"]').getBoundingClientRect();
              const edge = (p, r) =>
                Math.min(
                  Math.abs(p.x + svg.left - r.left),
                  Math.abs(p.x + svg.left - r.right),
                  Math.abs(p.y + svg.top - r.top),
                  Math.abs(p.y + svg.top - r.bottom),
                ) < 1;
              lineOK =
                edge(line.getPointAtLength(0), source) &&
                edge(line.getPointAtLength(line.getTotalLength()), center);
            }
            return {
              indices: cards.map((n) => n.dataset.eventIndex),
              rects: rects.map((r) => ({
                left: r.left,
                top: r.top,
                right: r.right,
                bottom: r.bottom,
              })),
              overlap,
              outside,
              clipped,
              lineOK,
              centered:
                Math.abs(center.left + center.width / 2 - map.left - map.width / 2) < 1 &&
                Math.abs(center.top + center.height / 2 - map.top - map.height / 2) < 1,
            };
          });
          assert.equal(geometry.overlap, false, JSON.stringify({ width, height, geometry }));
          assert.equal(geometry.outside, false, JSON.stringify({ width, height, geometry }));
          assert.deepEqual(geometry.clipped, [], JSON.stringify({ width, height, geometry }));
          assert.equal(geometry.centered, true);
          assert.equal(geometry.lineOK, true);
          geometry.indices.forEach((i) => seen.add(i));
          await page.screenshot({
            path: path.join(out, engine + "-events-" + width + "x" + height + "-" + turn + ".png"),
          });
          const next = page.getByRole("button", {
            name: "Следующие события",
            exact: true,
          });
          if (!(await next.isVisible()) || !(await next.isEnabled())) break;
          await next.click();
        }
        assert.equal(seen.size, 8);
        const previous = page.getByRole("button", {
          name: "Предыдущие события",
          exact: true,
        });
        while ((await previous.isVisible()) && (await previous.isEnabled())) await previous.click();
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.waitForTimeout(150);
      await page.locator('[data-event-index="2"]').click();
      const dialog = page.locator("#easterDialog");
      await dialog.waitFor({ state: "visible" });
      assert.equal(await dialog.locator(".easter-counter strong").first().textContent(), "169");
      const measure = () =>
        page.evaluate(() => {
          const d = document.getElementById("easterDialog");
          return [...d.querySelectorAll("button,.easter-panel")]
            .filter((n) => n.getClientRects().length)
            .map((n) => {
              const r = n.getBoundingClientRect();
              return {
                text: n.textContent.slice(0, 45),
                x: r.x,
                y: r.y,
                right: r.right,
                bottom: r.bottom,
              };
            })
            .filter(
              (r) =>
                r.x < -0.5 ||
                r.y < -0.5 ||
                r.right > innerWidth + 0.5 ||
                r.bottom > innerHeight + 0.5,
            );
        });
      for (const [width, height] of [
        [1920, 1080],
        [1366, 900],
        [1024, 600],
        [844, 390],
        [390, 844],
        [320, 568],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(120);
        if (await dialog.locator(".easter-tabs").isVisible()) {
          for (const n of [0, 1]) {
            await dialog.locator(".easter-tabs button").nth(n).click();
            assert.deepEqual(await measure(), [], `${engine} ${width}x${height} page ${n}`);
          }
        } else assert.deepEqual(await measure(), [], `${engine} ${width}x${height}`);
        await page.screenshot({
          path: path.join(out, `${engine}-${width}x${height}.png`),
        });
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      for (let i = 0; i < 12; i++) {
        assert.equal(
          await dialog.locator(".easter-exchange").textContent(),
          "Обменять набор на сундук",
        );
        await dialog.locator(".easter-exchange").click();
        await page.waitForFunction(
          (n) =>
            document.querySelector(".easter-footer button").textContent.includes("(" + n + ")"),
          i + 1,
        );
      }
      assert.equal(await dialog.locator("[data-found=true]").count(), 0);
      assert.deepEqual(await dialog.locator(".easter-counter strong").allTextContents(), [
        "49",
        "49",
        "49",
        "49",
      ]);
      assert.deepEqual(
        profiles.find(auth.token).easter.runs[events.active().id].eggs,
        [49, 49, 49, 49],
      );
      assert.ok(!profiles.view(profiles.find(auth.token)).wardrobe.owned.includes("rabbit_ears"));
      // Fixed sealed outcomes exercise all twelve collection pieces without a probabilistic test.
      profiles.find(auth.token).easter.chests.forEach((c, i) => (c.reward.fragmentId = i));
      await dialog.getByRole("button", { name: /В сокровищницу/ }).click();
      await page
        .locator(".easter-treasury-chest")
        .first()
        .getByRole("button", { name: "Открыть", exact: true })
        .click();
      await page
        .locator("#chestConfirmDialog")
        .getByRole("button", { name: "Да", exact: true })
        .click();
      await page.locator("#chestRewardDialog").waitFor({ state: "visible" });
      assert.ok(
        (await page.locator("#chestRewardDialog").textContent()).includes("Пасхальное яйцо"),
      );
      assert.ok(
        (await page.locator("#chestRewardDialog").textContent()).includes("Новый фрагмент"),
      );
      assert.equal(await page.locator(".chest-fragment-art").count(), 1);
      assert.equal(
        await page
          .locator(".chest-fragment-art")
          .evaluate((n) => getComputedStyle(n).backgroundPosition),
        "0% 0%",
      );
      assert.ok(!/Фрагмент \d+ из/.test(await page.locator("#chestRewardDialog").textContent()));
      await page.screenshot({
        path: path.join(out, engine + "-chest-fragment.png"),
      });
      const crops = await page.evaluate(() => {
        const reward = {
            id: "easter-preview",
            items: {},
            fragment: { index: 0, duplicate: false },
          },
          owner = {
            profile: { easter: { chests: [{ id: reward.id, reward }] } },
          },
          ui = new window.KillexChestUI(owner),
          open = window.KillexWindows.open,
          results = [];
        ui.confirm.id = "fragmentPreviewConfirm";
        ui.reward.id = "fragmentPreviewReward";
        ui.selected = reward.id;
        window.KillexWindows.open = () => {};
        try {
          for (let index = 0; index < 48; index++) {
            reward.fragment = { index, duplicate: index % 2 === 1 };
            ui.showReward();
            const piece = ui.reward.querySelector(".chest-fragment-art"),
              style = getComputedStyle(piece);
            results.push({
              position: style.backgroundPosition,
              size: style.backgroundSize,
              filter: style.filter,
              name: piece.getAttribute("aria-label"),
            });
          }
        } finally {
          window.KillexWindows.open = open;
          ui.confirm.remove();
          ui.reward.remove();
        }
        return results;
      });
      for (let i = 0; i < 48; i++) {
        const [x, y] = crops[i].position.split(" ").map(parseFloat);
        assert.ok(
          Math.abs(x - (i % 3) * 50) < 0.001 &&
            Math.abs(y - (Math.floor((i % 12) / 3) * 100) / 3) < 0.001,
        );
        assert.equal(crops[i].size, "300% 400%");
        assert.equal(crops[i].filter, "none");
        assert.equal(crops[i].name, i % 2 ? "Повторный фрагмент" : "Новый фрагмент");
      }
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const overflow = await page.locator("#chestRewardDialog").evaluate((d) =>
          [...d.querySelectorAll(".chest-reward-item,button")]
            .filter((n) => n.getClientRects().length)
            .some((n) => {
              const b = n.getBoundingClientRect();
              return b.left < 0 || b.right > innerWidth || b.top < 0 || b.bottom > innerHeight;
            }),
        );
        assert.equal(overflow, false, `chest ${width}`);
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.locator("#chestRewardDialog").getByRole("button", { name: "Отлично" }).click();
      await page.waitForFunction(() => !document.getElementById("chestRewardDialog").open);
      assert.equal(profiles.find(auth.token).inventory.easter_egg, 10);
      assert.equal(profiles.find(auth.token).easter.chests.filter((c) => c.stored).length, 7);
      await page.evaluate(() =>
        document.querySelectorAll("dialog[open]").forEach((d) => d.close()),
      );
      for (const c of [...profiles.find(auth.token).easter.chests])
        E.mutate(profiles, auth.token, {
          action: "open",
          chestId: c.id,
          requestId: randomUUID(),
        });
      assert.equal(profiles.find(auth.token).easter.runs[events.active().id].fragments, 12);
      assert.equal(profiles.find(auth.token).easter.trophies.length, 0);
      assert.equal(E.album(profiles.find(auth.token)).length, 1);
      profiles.applyArenaProgress(
        randomUUID(),
        Array.from({ length: 1440 }, (_, i) => ({
          type: "easterPickup",
          eggType: i % 4,
          runId: events.active().id,
          profileId: auth.profile.id,
        })),
        now,
      );
      for (let i = 12; i < 48; i++) {
        E.mutate(profiles, auth.token, {
          action: "exchange",
          runId: events.active().id,
          requestId: randomUUID(),
        });
        const chest = profiles.find(auth.token).easter.chests.at(-1);
        chest.reward.fragmentId = i;
        E.mutate(profiles, auth.token, {
          action: "open",
          chestId: chest.id,
          requestId: randomUUID(),
        });
      }
      assert.equal(profiles.find(auth.token).easter.trophies.length, 1);
      assert.equal(E.album(profiles.find(auth.token)).length, 4);

      await page.reload();
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.locator("#eventsSection").click();
      await page.locator("#eventAlbumButton").click();
      const album = page.locator("#eventAlbumDialog");
      await album.waitFor({ state: "visible" });
      for (const [width, height] of [[1366, 900], [390, 844], [320, 568], [844, 390]]) {
        await page.setViewportSize({ width, height });
        const pictures = album.locator(".event-album-event")
          .filter({ has: page.getByRole("heading", { name: "Пасхальная охота", exact: true }) })
          .locator(".event-album-tile");
        assert.equal(await pictures.count(), 4);
        assert.ok(await album.locator(".event-album-gallery").evaluate((grid) => grid.scrollWidth <= grid.clientWidth + 1));
        for (const tile of await pictures.all()) {
          await tile.click();
          const viewer = page.locator(".event-album-viewer[open]");
          await viewer.locator("img").evaluate((img) => img.decode());
          assert.ok(await viewer.isVisible());
          await viewer.getByRole("button", { name: "К альбому" }).click();
        }
        await page.screenshot({ path: path.join(out, engine + "-album-" + width + ".png") });
      }
      const balance = profiles.find(auth.token).wallet.bucks;
      await album.getByRole("button", { name: "Забрать 400 эфира" }).click();
      await album.getByRole("button", { name: "Награды получены" }).waitFor();
      assert.equal(profiles.find(auth.token).wallet.bucks, balance + 400);
      await album.getByRole("button", { name: "К событиям", exact: true }).click();
      await page
        .locator("#eventsDialog")
        .getByRole("button", { name: "В лобби", exact: true })
        .click();
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.locator("#inventorySection").click();
      const inventory = page.locator(".booster-card[data-booster-id=easter_egg]");
      await inventory.waitFor();
      assert.ok((await inventory.locator(".booster-expiry").textContent()).includes("00:00"));
      await inventory.getByRole("button", { name: "В быстрые слоты" }).click();
      await page.evaluate(() =>
        document.querySelectorAll("dialog[open]").forEach((d) => d.close()),
      );
      await page.locator("#wardrobeSection").click();
      await page
        .locator("#skinsDialog")
        .getByRole("button", { name: "Шапки", exact: true })
        .click();
      const ears = page.locator("[data-accessory-id=rabbit_ears]");
      assert.equal(await ears.getAttribute("data-locked"), "false");
      assert.equal(await ears.locator(".accessory-lock").isVisible(), false);
      assert.ok(!(await ears.textContent()).includes("+25%"));
      await ears.getByRole("button", { name: /Надеть/ }).click();
      await page.waitForFunction(
        () => document.querySelector("[data-accessory-id=rabbit_ears]").dataset.equipped === "true",
      );
      await page.screenshot({ path: path.join(out, engine + "-wardrobe.png") });
      await page.evaluate(() =>
        document.querySelectorAll("dialog[open]").forEach((d) => d.close()),
      );
      await page.locator("#playButton").click();
      await page.waitForFunction(() => document.body.dataset.screen === "arena");
      assert.equal(await page.locator("#game").getAttribute("data-background"), "easter-meadow");
      assert.equal(await page.locator("#easterCounters").isVisible(), true);
      assert.deepEqual(await page.locator("#easterCounters b").allTextContents(), [
        "0",
        "0",
        "0",
        "0",
      ]);
      arenaNow += 1000;
      app.tick();
      const player = [...app.arena.players.values()].find((p) => p.profileId === auth.profile.id);
      app.arena.hazards.items = Array.from({ length: 4 }, (_, i) => ({
        ...app.arena.hazards.create(player.x - 180 + i * 120, player.y + 120, 0),
        eggType: i,
      }));
      app.broadcast();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, engine + "-arena.png") });
      player.protectedUntil = 0;
      app.arena.gainMass(player, 300 - player.mass);
      app.arena.hazards.items = [
        { ...app.arena.hazards.create(player.x, player.y, 0), eggType: 1 },
      ];
      // Production ticks publish the coalesced profile projection once a
      // second. With autoTick disabled, advance that clock explicitly.
      arenaNow += 1000;
      app.tick();
      assert.deepEqual(profiles.view(profiles.byId(auth.profile.id)).easter.lifeEggs, [0, 1, 0, 0]);
      await page.waitForFunction(
        () => document.querySelectorAll("#easterCounters b")[1].textContent === "1",
      );
      assert.deepEqual(await page.locator("#easterCounters b").allTextContents(), [
        "0",
        "1",
        "0",
        "0",
      ]);
      assert.deepEqual(errors, []);
      assert.deepEqual([...new Set(missing)], []);
      report.push({
        engine,
        layouts: 6,
        exchange: true,
        collection: true,
        chest: true,
        inventory: true,
        hat: true,
        arena: true,
        errors,
        missing,
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
