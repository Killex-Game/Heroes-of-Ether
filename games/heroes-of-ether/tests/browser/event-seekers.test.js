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
const out = path.resolve(__dirname, "../../../../artifacts/event-seekers-daily-20261028/browser");
fs.mkdirSync(out, { recursive: true });
(async () => {
  const report = [];
  for (const engine of ["chromium", "firefox", "webkit"]) {
    let now = Math.floor(Date.now() / 60000) * 60000;
    const profiles = new ProfileStore({ now: () => now }),
      events = new EventManager({ now: () => now });
    events.apply("test", "start", { eventId: E.manifest.id, revision: 0, requestId: randomUUID() });
    profiles.events = events;
    const run = events.active(),
      auth = profiles.open(),
      p = () => profiles.find(auth.token);
    p().wallet.bucks = 1000;
    // Inventory grants must not show up as collected objects or leaderboard score.
    E.progress(p(), events, { type: "easterPickup", runId: run.id, eggType: 0 }, now);
    p().easter.runs[run.id].exchangedEggs = [1000, 1000, 1000, 1000];
    p().easter.runs[run.id].eggs = [1001, 1000, 1000, 1000];
    for (let i = 0; i < 8; i++) {
      const other = profiles.find(profiles.open().token);
      other.name = "Искатель " + (i + 1);
      E.progress(other, events, { type: "easterPickup", runId: run.id, eggType: i % 4 }, now);
      other.easter.runs[run.id].found[i % 4] = 20 - i;
      other.easter.runs[run.id].dailyFound[Math.floor((now + 10800000) / 86400000)] = 20 - i;
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
    let browser, page;
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
      page = await context.newPage();
      await page.addLocatorHandler(page.locator("#dailyRankingNotice[open]"), async () => {
        await page
          .locator("#dailyRankingNotice")
          .getByRole("button", { name: "Отлично!", exact: true })
          .click();
      });
      const errors = [],
        missing = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.status() === 404) missing.push(new URL(r.url()).pathname);
      });
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.getByRole("button", { name: "Закрыть объявление об ивенте" }).click();
      await page.locator("#eventsSection").click();
      await page.locator('[data-event-index="2"]').click();
      await page.locator("#easterMultiplier").waitFor();
      assert.match(await page.locator(".easter-multiplier-info").textContent(), /250/);
      async function layout(name, selector, sizes) {
        for (const [width, height] of sizes) {
          await page.setViewportSize({ width, height });
          await page.waitForTimeout(120);
          const geometry = await page.locator(selector).evaluate((root) => {
            const visible = [
              ...root.querySelectorAll(
                "button, .easter-counter, .event-ranking-prize, #lifeEventCounts",
              ),
            ].filter(
              (n) => n.getClientRects().length && getComputedStyle(n).visibility !== "hidden",
            );
            return visible
              .filter((n) => {
                const r = n.getBoundingClientRect();
                return (
                  r.left < -1 ||
                  r.top < -1 ||
                  r.right > innerWidth + 1 ||
                  r.bottom > innerHeight + 1 ||
                  n.scrollWidth > n.clientWidth + 2
                );
              })
              .map((n) => ({
                tag: n.id || n.className,
                text: n.textContent.slice(0, 60),
                rect: n.getBoundingClientRect().toJSON(),
              }));
          });
          await page.screenshot({
            path: path.join(out, `${engine}-${name}-${width}x${height}.png`),
          });
          assert.deepEqual(geometry, [], `${engine} ${name} ${width}x${height}`);
        }
      }
      const sizes = [
        [1920, 1080],
        [1366, 900],
        [390, 844],
        [320, 568],
        [844, 390],
      ];
      await layout("easter", "#easterDialog", sizes);
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.locator("#easterMultiplier").click();
      await page.waitForFunction(
        () => document.querySelector("#easterMultiplier").getAttribute("aria-pressed") === "true",
      );
      assert.equal(p().wallet.bucks, 750);
      assert.equal(await page.locator("#easterMultiplier").isDisabled(), true);
      assert.match(
        await page.locator(".easter-multiplier-info").textContent(),
        /Осталось 0[23]:[0-5][0-9]:[0-5][0-9]/,
      );
      await page.locator("#easterTopButton").click();
      await page.locator("#topsDialog .clan-ranking-player").first().waitFor();
      assert.equal(await page.locator(".event-ranking-prize").count(), 3);
      assert.deepEqual(await page.locator("#topsDialog .ranking-score").allTextContents(), [
        "20",
        "19",
        "18",
        "17",
        "16",
      ]);
      assert.match(await page.locator("#topsDialog .clan-my-rank").textContent(), /9.*1/);
      await layout("top", "#topsDialog", sizes);
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.getByRole("button", { name: "Следующая страница искателей" }).click();
      await page.waitForFunction(
        () => document.querySelector("#topsDialog .ranking-score").textContent === "15",
      );
      assert.deepEqual(await page.locator("#topsDialog .ranking-score").allTextContents(), [
        "15",
        "14",
        "13",
        "1",
      ]);
      await page.getByRole("button", { name: "Закрыть топы" }).click();
      await page.locator("#playButton").click();
      await page.waitForFunction(() => document.body.dataset.screen === "arena");
      app.tick();
      const player = [...app.arena.players.values()].find((v) => v.profileId === p().id);
      player.protectedUntil = 0;
      app.arena.gainMass(player, 300 - player.mass);
      for (const eggType of [0, 1, 2, 2, 3]) {
        const cell = app.arena.bodies(player).reduce((a, b) => (a.mass > b.mass ? a : b));
        app.arena.hazards.items = [{ ...app.arena.hazards.create(cell.x, cell.y, 0), eggType }];
        app.tick();
      }
      await page.waitForFunction(
        () => document.querySelectorAll("#easterCounters b")[2].textContent === "2",
      );
      await page.locator("#leaveButton").click();
      await page.locator("#leaveYes").click();
      await page.locator("#lifeResultDialog[open]").waitFor();
      assert.deepEqual(await page.locator("#lifeEventCounts b").allTextContents(), [
        "3",
        "3",
        "6",
        "3",
      ]);
      assert.equal(
        p().easter.runs[run.id].found.reduce((a, b) => a + b, 0),
        6,
      );
      await layout("life", "#lifeResultDialog", sizes);
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.locator("#lifeLobby").click();
      run.stoppedAt = now + 1;
      now = (Math.floor((now + 10800000) / 86400000) + 1) * 86400000 - 10800000;
      profiles.refreshCompetition();
      await page.locator("#rankingsButton").click();
      await page.getByRole("button", { name: "Топ искателей", exact: true }).click();
      await page.locator(".event-ranking-received").waitFor();
      assert.match(await page.locator(".event-ranking-received").textContent(), /25.*5.*250.*15/);
      await layout("settled", "#topsDialog", [
        [390, 844],
        [844, 390],
      ]);
      assert.deepEqual(errors, []);
      assert.deepEqual([...new Set(missing)], []);
      report.push({
        engine,
        layouts: 17,
        multiplier: true,
        rawRanking: true,
        paging: true,
        lifeSummary: true,
        settlement: true,
        errors,
        missing,
      });
      console.log(engine + ": passed");
    } catch (error) {
      await page?.screenshot({ path: path.join(out, engine + "-failure.png") }).catch(() => {});
      throw error;
    } finally {
      await browser?.close();
      await app.close();
    }
  }
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
