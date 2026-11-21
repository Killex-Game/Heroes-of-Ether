"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  engines = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager"),
  { createGameServer } = require("../../src/server/game-server"),
  E = require("../../src/server/events/easter-hunt"),
  Q = require("../../src/server/progression/personal-quests"),
  T = require("../../src/server/progression/title-chest-rewards"),
  C = require("../../src/server/clans/clan-chest-rewards"),
  lite = require("../../src/server/accounts/lite-account");
const out = path.resolve("../artifacts/event-seekers-daily-20261028/chests-browser");
fs.mkdirSync(out, { recursive: true });
(async () => {
  const report = [];
  for (const engine of ["chromium", "firefox", "webkit"]) {
    const now = Math.floor(Date.now() / 60000) * 60000,
      profiles = new ProfileStore({ now: () => now }),
      events = new EventManager({ now: () => now });
    profiles.events = events;
    events.apply("test", "start", { eventId: E.manifest.id, revision: 0, requestId: randomUUID() });
    const auth = profiles.open(),
      p = () => profiles.find(auth.token),
      runId = events.active().id;
    p().greatness = 2000000;
    T.awardTitles(p(), now);
    p().honors.notified = p().honors.claimed;
    p().account = {
      ...require("../../src/server/accounts/account-benefits").fresh(),
      vipUntil: now + 86400000,
      premiumUntil: now + 86400000,
    };
    lite.activate(p(), profiles.rouletteConfig, now, runId);
    E.progress(p(), events, { type: "easterPickup", eggType: 0, runId }, now);
    p().easter.runs[runId].eggs = [10, 10, 10, 10];
    p().easter.runs[runId].found = [10, 10, 10, 10];
    E.act(p(), events, { action: "exchange", runId }, now, () => 0);
    const easterId = p().easter.chests[0].id,
      questId = randomUUID(),
      def = Q.CATALOG.find((q) => q.tier === "large");
    p().quests.pending.push({
      ...Q.makeReward("large", now, true, () => 0),
      id: questId,
      questId: def.id,
      title: def.name,
      stored: true,
      notifiedAt: now,
    });
    for (const tier of ["medium", "small"]) {
      const def = Q.CATALOG.find((q) => q.tier === tier);
      p().quests.pending.push({
        ...Q.makeReward(tier, now, true, () => 0),
        id: randomUUID(),
        questId: def.id,
        title: def.name,
        stored: true,
        notifiedAt: now,
      });
    }
    for (const tier of ["high", "medium", "low"]) C.grant(p(), tier, now);
    for (const notice of p().clanChests.notices) notice.notifiedAt = now;
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
        context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await context.addCookies([
        { name: "sferorumiya_session", value: auth.token, url, httpOnly: true },
      ]);
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      const notice = page.getByRole("button", { name: "Закрыть объявление об ивенте" });
      if (await notice.isVisible()) await notice.click();
      const openShop = async (category) => {
        await page.evaluate((category) => {
          document.querySelectorAll("dialog[open]").forEach((d) => d.close());
          document.dispatchEvent(
            new CustomEvent("killex:open-chests", { detail: { category } }),
          );
        }, category);
        await page.locator("#boosterDialog").waitFor();
      };
      await openShop("titles");
      const hero = page.locator('.chest-card[data-chest-id="boss"]');
      assert.match(await hero.textContent(), /Сундук героя/);
      assert.match(await hero.textContent(), /VIP — 90 дн., Premium — 90 дн./);
      assert.doesNotMatch(await hero.textContent(), /билет рулетки с Lite/);
      const novice = page.locator('.chest-card[data-chest-id="novice"]');
      assert.match(
        (await novice.textContent()).replace(/\s/g, ""),
        /50бустеров—500монет—50кристаллов—5эфира/,
      );
      await page.screenshot({ path: path.join(out, engine + "-titles.png") });
      const confirm = page.locator("#chestConfirmDialog");
      const beforeCancel = JSON.stringify({
        wallet: p().wallet,
        inventory: p().inventory,
        honors: p().honors,
        quests: p().quests,
        clan: p().clanChests,
        easter: p().easter,
      });
      await novice.getByRole("button").click();
      await confirm.waitFor();
      assert.match(await confirm.textContent(), /Сундук Новичка/);
      await page.keyboard.press("Escape");
      await confirm.waitFor({ state: "hidden" });
      await openShop("treasury");
      const ids = [
        easterId,
        ...p().quests.pending.map((q) => q.id),
        ...p().clanChests.items.map((c) => c.id),
      ];
      for (const [index, id] of ids.entries()) {
        await page.locator(`.clan-owned-chest[data-chest-id="${id}"] button`).click();
        await confirm.waitFor();
        await page.waitForFunction(
          () => document.querySelector("#chestConfirmDialog img").naturalWidth > 0,
        );
        assert.match(await confirm.locator("h2").textContent(), /Вы уверены что хотите открыть/);
        if (index % 2) await confirm.getByRole("button", { name: "Закрыть", exact: true }).click();
        else await confirm.getByRole("button", { name: "Нет", exact: true }).click();
      }
      assert.equal(
        JSON.stringify({
          wallet: p().wallet,
          inventory: p().inventory,
          honors: p().honors,
          quests: p().quests,
          clan: p().clanChests,
          easter: p().easter,
        }),
        beforeCancel,
        "cancel must not prepare or award any source",
      );
      await page.locator(`.clan-owned-chest[data-chest-id="${questId}"] button`).click();
      for (const [width, height] of [
        [1920, 1080],
        [390, 844],
        [320, 568],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        const fits = await confirm.evaluate((d) =>
          [...d.querySelectorAll("img,h2,button")].every((n) => {
            const r = n.getBoundingClientRect();
            return (
              r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1
            );
          }),
        );
        assert.ok(fits, `${engine} confirmation fits ${width}`);
        await page.screenshot({ path: path.join(out, `${engine}-confirmation-${width}.png`) });
      }
      await confirm.getByRole("button", { name: "Нет", exact: true }).click();
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.evaluate(() => {
        document.querySelectorAll("dialog[open]").forEach((d) => d.close());
      });
      await page.locator("#achievementsButton").click();
      await page.locator(".honor-chest-preview summary").click();
      assert.match(
        await page.locator(".honor-chest-preview").textContent(),
        /VIP — 90 дн., Premium — 90 дн./,
      );
      await page.screenshot({ path: path.join(out, engine + "-honor-description.png") });
      await page.evaluate(() => {
        document.querySelectorAll("dialog[open]").forEach((d) => d.close());
      });
      await page.locator("#eventsSection").click();
      await page.locator('[data-event-index="2"]').click();
      const summary = page.locator(".easter-chest-summary");
      assert.match(
        await summary.textContent(),
        /300–450 монет, 30–60 кристаллов, 15 величия, 30 бустеров/,
      );
      assert.match(await summary.textContent(), /\+1 билет/);
      for (const [width, height] of [
        [1920, 1080],
        [844, 600],
        [390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        const tabs = page.locator(".easter-tabs");
        if (await tabs.isVisible()) await tabs.getByRole("button").nth(1).click();
        const box = await summary.boundingBox();
        assert.ok(box.y + box.height <= height, `${engine}: summary fits`);
        await page.screenshot({ path: path.join(out, `${engine}-easter-${width}.png`) });
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      await openShop("treasury");
      await page.locator(`.clan-owned-chest[data-chest-id="${easterId}"] button`).click();
      await page
        .locator("#chestConfirmDialog")
        .getByRole("button", { name: "Да", exact: true })
        .click();
      const reward = page.locator("#chestRewardDialog");
      await reward.waitFor();
      assert.equal(await reward.locator(".chest-reward-item").count(), 6);
      assert.match(await reward.textContent(), /Билеты рулетки/);
      assert.equal(
        await reward
          .locator(".chest-reward-item")
          .filter({ has: page.locator('img[alt="Пасхальное яйцо"]') })
          .locator("strong")
          .textContent(),
        "30",
      );
      for (const [width, height] of [
        [1366, 900],
        [844, 600],
        [390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(80);
        const geometry = await reward.evaluate((d) => ({
          outside: [...d.querySelectorAll(".chest-reward-item,button")]
            .filter((n) => n.getClientRects().length)
            .map((n) => n.getBoundingClientRect())
            .filter(
              (r) =>
                r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1,
            ).length,
          scroll:
            d.querySelector(".chest-reward-grid").scrollHeight -
            d.querySelector(".chest-reward-grid").clientHeight,
        }));
        assert.equal(geometry.outside, 0, `${engine}: reward fits ${width}`);
        assert.ok(geometry.scroll <= 1, `${engine}: reward needs no scroll ${width}`);
        await page.screenshot({ path: path.join(out, `${engine}-reward-${width}.png`) });
      }
      const before = p().roulette.tickets;
      await reward.getByRole("button", { name: "Отлично" }).click();
      await reward.waitFor({ state: "hidden" });
      assert.equal(p().roulette.tickets, before + 1);
      assert.equal(p().inventory.easter_egg, 30);
      await page.setViewportSize({ width: 1366, height: 900 });
      await openShop("treasury");
      await page.locator(`.clan-owned-chest[data-chest-id="${questId}"] button`).click();
      await confirm.getByRole("button", { name: "Да", exact: true }).click();
      await reward.waitFor();
      assert.equal(p().quests.pending.find((r) => r.id === questId).multiplier, 3);
      assert.match(await reward.textContent(), /Билеты рулетки/);
      const prepared = structuredClone(p().quests.pending.find((q) => q.id === questId));
      await reward.getByRole("button", { name: "Закрыть", exact: true }).click();
      await openShop("treasury");
      await page.locator(`.clan-owned-chest[data-chest-id="${questId}"] button`).click();
      await confirm.waitFor();
      assert.equal(await reward.isVisible(), false);
      await confirm.getByRole("button", { name: "Да", exact: true }).click();
      await reward.waitFor();
      assert.deepEqual(
        p().quests.pending.find((q) => q.id === questId),
        prepared,
        "prepared reward reused unchanged",
      );
      const questTickets = p().roulette.tickets;
      await reward.getByRole("button", { name: "Отлично" }).click();
      await reward.waitFor({ state: "hidden" });
      assert.equal(p().roulette.tickets, questTickets + 4);
      await page.evaluate(() =>
        document.querySelectorAll("dialog[open]").forEach((d) => d.close()),
      );
      await page.locator("#accountButton").click();
      for (const [width, height] of [
        [1366, 900],
        [390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        for (const kind of ["vip", "premium"]) {
          const tab = page
            .locator("#accountDialog .account-plan-tabs button")
            .filter({ hasText: kind === "vip" ? "VIP" : "Premium" });
          if (await tab.isVisible()) await tab.click();
          const card = page.locator("#accountDialog .account-plan." + kind);
          assert.match(await card.textContent(), kind === "vip" ? /Клан: \+5/ : /Клан: \+10/);
          assert.match(await card.textContent(), /без умножения базового/);
          const bounds = await card.evaluate((n) => {
            const r = n.getBoundingClientRect();
            return {
              right: r.right,
              bottom: r.bottom,
              top: r.top,
              viewport: [innerWidth, innerHeight],
            };
          });
          assert.ok(
            bounds.right <= width + 1 && bounds.bottom <= height + 1 && bounds.top >= 0,
            engine + " account layout " + JSON.stringify(bounds),
          );
          await page.screenshot({
            path: path.join(out, engine + "-accounts-" + width + "-" + kind + ".png"),
          });
        }
      }
      assert.deepEqual(errors, []);
      report.push({
        engine,
        titleDescription: true,
        easterAndQuestOpen: true,
        confirmation: true,
        cancel: true,
        preparedReplay: true,
        layouts: 4,
        errors,
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
