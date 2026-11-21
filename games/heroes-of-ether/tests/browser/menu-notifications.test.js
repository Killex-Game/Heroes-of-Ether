"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const engines = require("playwright");
const { createGameServer } = require("../../src/server/game-server");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { ClanService } = require("../../src/server/clans/clan-service");
const quests = require("../../src/server/progression/personal-quests");
const output = path.resolve(
  __dirname,
  "../../../../artifacts/arena-feedback-20261025/notifications",
);
fs.mkdirSync(output, { recursive: true });
const report = [];
(async () => {
  for (const engine of process.argv[2] ? [process.argv[2]] : ["chromium", "firefox", "webkit"]) {
    const profiles = new ProfileStore(),
      app = createGameServer({
        profiles,
        arenaPolicy: require("../../config/arena-rooms.json"),
        testBots: { enabled: false },
      });
    let browser;
    try {
      app.httpServer.listen(0, "127.0.0.1");
      await once(app.httpServer, "listening");
      const url = `http://127.0.0.1:${app.httpServer.address().port}`;
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      const cookie = (await page.context().cookies()).find((c) => c.name === "sferorumiya_session");
      const player = profiles.find(cookie.value);
      const refresh = async () => {
        await page.evaluate(() =>
          document.dispatchEvent(new CustomEvent("killex:events-changed")),
        );
      };
      assert.equal(await page.locator(".menu-notification-dot:not([hidden])").count(), 0);
      const q = quests.ensure(player, profiles.now());
      const row = q.items.find((r) => r.questId === "giant") || q.items[0];
      row.questId = "giant";
      quests.progress(player, { type: "lifeStarted", lifeId: "fixture" }, profiles.now());
      quests.progress(player, { type: "massPeak", mass: 50000 }, profiles.now());
      quests.progress(player, { type: "lifeEnded", lifeId: "fixture" }, profiles.now());
      quests.validate(player);
      player.inventory.fire = (player.inventory.fire || 0) + 2;
      player.revision++;
      await refresh();
      await page.waitForFunction(
        () =>
          !document.getElementById("menuNotice-quests").hidden &&
          !document.getElementById("menuNotice-inventory").hidden,
      );
      await page.reload();
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      assert.equal(await page.locator("#menuNotice-inventory").evaluate((n) => n.hidden), false);
      await page.locator("#inventorySection").click();
      await page.locator("#boosterDialog[open]").waitFor();
      assert.equal(await page.locator("#sectionNotice-chests").evaluate((n) => n.hidden), false);
      await page.getByRole("button", { name: "Сундуки", exact: true }).click();
      assert.equal(await page.locator("#sectionNotice-treasury").evaluate((n) => n.hidden), false);
      assert.equal(
        await page.locator("#sectionNotice-titleChests").evaluate((n) => n.hidden),
        true,
      );
      assert.equal(
        await page.locator("#sectionNotice-inventoryItems").evaluate((n) => n.hidden),
        true,
      );
      await page.getByRole("button", { name: "Закрыть бустеры" }).click();
      const clans = new ClanService(profiles);
      const eligible = (p) => {
        p.level = 12;
        p.progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(
          12,
        );
        p.wallet.coins = 2000;
      };
      eligible(profiles.find(cookie.value));
      clans.mutate(cookie.value, {
        action: "create",
        requestId: randomUUID(),
        name: "Проверка",
        prefix: "TEST",
        description: "",
        emblem: "grove",
        privacy: "closed",
      });
      const clanId = profiles.find(cookie.value).clanId;
      const other = profiles.open();
      eligible(profiles.find(other.token));
      clans.mutate(other.token, { action: "apply", clanId, requestId: randomUUID() });
      // Штатный heartbeat должен заметить заявку при закрытом окне клана.
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await page.waitForFunction(() => !document.getElementById("menuNotice-clan").hidden);
      for (const [width, height] of [
        [1366, 900],
        [390, 844],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        const layout = await page
          .locator(".side-nav .menu-notification-dot:not([hidden])")
          .evaluateAll((nodes) =>
            nodes.map((n) => {
              const b = n.getBoundingClientRect(),
                p = n.parentElement.getBoundingClientRect();
              return {
                id: n.id,
                width: b.width,
                height: b.height,
                top: b.top - p.top,
                right: p.right - b.right,
                inside:
                  b.left >= p.left && b.top >= p.top && b.right <= p.right && b.bottom <= p.bottom,
              };
            }),
          );
        assert.ok(layout.length >= 3);
        assert.ok(
          layout.every(
            (b) =>
              b.inside &&
              b.width >= 10 &&
              b.width <= 16 &&
              Math.abs(b.width - b.height) < 1 &&
              b.top <= 8 &&
              b.right <= 10,
          ),
          JSON.stringify(layout),
        );
        await page.screenshot({ path: path.join(output, `${engine}-${width}.png`) });
        report.push({ engine, width, layout });
        const sizes = await page
          .locator(".side-nav .menu-tile")
          .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
        assert.ok(Math.max(...sizes) - Math.min(...sizes) < 2, JSON.stringify(sizes));
      }
      assert.notEqual(
        await page.locator("#menuNotice-quests").evaluate((n) => getComputedStyle(n).animationName),
        "none",
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await page.locator("#menuNotice-quests").evaluate((n) => getComputedStyle(n).animationName),
        "none",
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.locator("#questsSection").click();
      await page.locator("#questsDialog[open]").waitFor();
      await page.waitForFunction(() => document.getElementById("menuNotice-quests").hidden);
      await page.getByRole("button", { name: "В сокровищницу", exact: true }).first().click();
      await page.locator("#boosterDialog[open]").waitFor();
      assert.equal(await page.locator("#menuNotice-inventory").evaluate((n) => n.hidden), false);
      for (const [width, height] of [
        [1366, 900],
        [390, 844],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForFunction(() => {
          const grid = document.querySelector("#boosterDialog .clan-owned-chests");
          const cards = [...grid.children];
          return cards.every((c) => c.checkVisibility());
        });
        const geometry = await page.locator("#boosterDialog").evaluate((d) => {
          const b = d.getBoundingClientRect(),
            content = d.querySelector(".interface-content");
          return {
            bottom: b.bottom,
            right: b.right,
            height: b.height,
            scrollable: getComputedStyle(content).overflowY === "auto",
            cards: [...d.querySelectorAll(".quest-treasury-chest")]
              .filter((c) => c.checkVisibility())
              .map((c) => c.getBoundingClientRect().width),
          };
        });
        await page.screenshot({ path: path.join(output, `${engine}-treasury-${width}.png`) });
        assert.ok(
          geometry.bottom <= height + 1 && geometry.right <= width + 1 && geometry.scrollable,
          JSON.stringify(geometry),
        );
        assert.ok(
          geometry.cards.every((w) => w <= 241),
          JSON.stringify(geometry),
        );
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      while (profiles.find(cookie.value).quests.pending.length) {
        const remaining = profiles.find(cookie.value).quests.pending.length;
        await page
          .locator(".quest-treasury-chest:visible")
          .first()
          .getByRole("button", { name: "Открыть", exact: true })
          .click();
        await page.locator("#chestRewardDialog[open]").waitFor();
        await page.locator(".chest-claim").click();
        await page.waitForFunction(
          (n) =>
            !document.getElementById("chestRewardDialog").open &&
            document.querySelectorAll(".quest-treasury-chest").length === n,
          remaining - 1,
        );
      }
      await page.waitForFunction(() => document.getElementById("sectionNotice-treasury").hidden);
      assert.equal(
        await page.locator("#sectionNotice-inventoryItems").evaluate((n) => n.hidden),
        false,
      );
      await page.getByRole("button", { name: "Инвентарь", exact: true }).click();
      await page.waitForFunction(() => document.getElementById("menuNotice-inventory").hidden);
      await page.locator("#boosterDialog").getByRole("button", { name: "Закрыть бустеры" }).click();
      await page.locator("#boosterDialog").waitFor({ state: "hidden" });
      const noticeClose = page.getByRole("button", { name: "Закрыть уведомления о наградах" });
      if (await noticeClose.isVisible()) await noticeClose.click();
      await page.locator("#clanSection").click();
      await page.locator("#clanDialog[open]").waitFor();
      assert.equal(await page.locator("#menuNotice-clan").evaluate((n) => n.hidden), false);
      await page.keyboard.press("Escape");
      clans.mutate(cookie.value, {
        action: "accept",
        clanId,
        memberId: other.profile.id,
        requestId: randomUUID(),
      });
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await page.waitForFunction(() => document.getElementById("menuNotice-clan").hidden);
      await page.locator("#arenaPickerButton").click();
      await page.locator('.arena-choice[data-arena-id="arena-2"]').waitFor();
      assert.equal(
        await page.locator('.arena-choice[data-arena-id="arena-1"] strong').textContent(),
        "Альфа",
      );
      await page.locator('.arena-choice[data-arena-id="arena-2"]').click();
      await page.locator("#playButton").click();
      await page.waitForFunction(() => document.body.dataset.screen === "arena");
      await page.locator("#leaveButton").click();
      await page.locator("#leaveYes").click();
      await page.locator("#lifeLobby").click();
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.locator("#playButton").click();
      await page.waitForFunction(() => document.body.dataset.screen === "arena");
      const models = [...app.rooms.get("arena-2").arena.players.values()].filter((p) => !p.dead);
      assert.equal(models.length, 2);
      assert.equal(models.filter((p) => p.isRemnant).length, 1);
      assert.deepEqual(errors, []);
    } finally {
      if (browser) await browser.close();
      await app.close();
    }
  }
  fs.writeFileSync(
    path.join(output, `${process.argv[2] || "all"}-report.json`),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ passed: true, layouts: report.length }));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
