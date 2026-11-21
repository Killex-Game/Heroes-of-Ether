"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  engines = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { EventManager } = require("../../src/server/events/event-manager"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { xpForLevel } = require("../../src/server/progression/experience-progression"),
  rules = require("../../public/shared/pet-rules"),
  pets = require("../../src/server/pets/pet-service");
const output = path.resolve(__dirname, "../../../../artifacts/pet-vitality-ui-20261024/browser");
fs.mkdirSync(output, { recursive: true });
const profiles = new ProfileStore({ unlockLeagueBackgrounds: true, unlockLeagueFrames: true }),
  clans = new ClanService(profiles),
  events = new EventManager();
events.apply("test-owner", "upload", {
  revision: events.data.revision,
  requestId: randomUUID(),
  manifest: {
    schemaVersion: 1,
    id: "vitality-ui",
    title: "Удачная неделя",
    description: "Изолированный тест",
    durationMinutes: 60,
    contentPack: "core-v1",
    features: { roulette: true, lite: true },
  },
});
events.apply("test-owner", "start", {
  revision: events.data.revision,
  requestId: randomUUID(),
  eventId: "vitality-ui",
});
const auth = profiles.open(),
  p = profiles.find(auth.token);
p.level = 100;
p.progress.xp = xpForLevel(100);
p.wallet = { coins: 200000, crystals: 10000, bucks: 10000 };
clans.mutate(auth.token, {
  action: "create",
  name: "Проверка оформления",
  prefix: "TEST",
  emblem: "astral",
  privacy: "open",
  requestId: randomUUID(),
});
for (const id of Object.keys({ zaya: 1, leva: 1, drakosha: 1, manya: 1 })) {
  pets.mutate(profiles, auth.token, { action: "buy", petId: id, requestId: randomUUID() });
  const pet = profiles.find(auth.token).pets.owned[id];
  pet.games = 5000;
  pet.vitalityMs = rules.capacityMs(id, 5000);
}
const app = createGameServer({
  profiles,
  clans,
  events,
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  testBots: { enabled: false },
});
let browser,
  phase = "start";
const report = [];
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    for (const engine of process.argv[2] ? [process.argv[2]] : ["chromium", "firefox", "webkit"]) {
      profiles.data.clans[profiles.find(auth.token).clanId].appearance.background = "default";
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await context.addCookies([
        { name: "sferorumiya_session", value: auth.token, url, httpOnly: true },
      ]);
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.status() === 404) errors.push(r.url());
      });
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      if (await page.locator("#eventAnnouncement[open]").count())
        await page.locator(".event-announcement-close").click();
      async function shot(name) {
        await page.screenshot({ path: path.join(output, `${engine}-${name}.png`) });
      }
      async function geometry(selector, name, noScroll = true) {
        await page.evaluate(() => document.fonts.ready);
        const result = await page.locator(selector).evaluate((n) => {
          const b = n.getBoundingClientRect(),
            c = n.querySelector(".interface-content");
          return {
            width: b.width,
            height: b.height,
            bottom: b.bottom,
            right: b.right,
            client: c?.clientHeight,
            scroll: c?.scrollHeight,
            hOverflow: n.scrollWidth - n.clientWidth,
            clippedControls: [...n.querySelectorAll("button,input,select")]
              .filter((x) => x.checkVisibility())
              .filter((x) => {
                const r = x.getBoundingClientRect();
                return r.bottom > b.bottom + 2 || r.top < b.top - 2;
              })
              .map((x) => x.className),
          };
        });
        await shot(name);
        assert.ok(result.hOverflow <= 2, `${name} horizontal overflow ${JSON.stringify(result)}`);
        assert.ok(
          result.bottom <= page.viewportSize().height + 2,
          `${name} bottom ${JSON.stringify(result)}`,
        );
        if (noScroll) assert.deepEqual(result.clippedControls, [], `${name}: clipped controls`);
        if (noScroll && result.client)
          assert.ok(result.scroll <= result.client + 2, `${name} scroll ${JSON.stringify(result)}`);
        report.push({ engine, name, ...result });
      }
      phase = "quests";
      await page.locator("#questsSection").click();
      await page.locator(".quest-card").nth(3).waitFor();
      assert.equal(
        await page.locator(".quests-summary").textContent(),
        "Ежедневные 4 задания, обновляются каждый день.",
      );
      await page.locator(".quest-chest-trigger").first().hover();
      await page.locator(".quest-rewards").first().waitFor({ state: "visible" });
      await shot("quest-tooltip");
      await page.mouse.move(1, 1);
      for (const [width, height] of [
        [1366, 900],
        [900, 650],
        [390, 844],
        [320, 700],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(100);
        await geometry("#questsDialog", `quests-${width}`);
        if (width >= 800) {
          assert.equal(await page.locator(".quest-card:visible").count(), 4);
          assert.equal(await page.locator(".quests-pages").isVisible(), false);
        }
        while (
          (await page
            .getByRole("button", { name: "Предыдущие задания", exact: true })
            .isVisible()) &&
          !(await page
            .getByRole("button", { name: "Предыдущие задания", exact: true })
            .isDisabled())
        )
          await page.getByRole("button", { name: "Предыдущие задания", exact: true }).click();
        const seen = new Set();
        do {
          for (const id of await page
            .locator(".quest-card:visible")
            .evaluateAll((ns) => ns.map((n) => n.dataset.questId)))
            seen.add(id);
          if (
            (await page
              .getByRole("button", { name: "Следующие задания", exact: true })
              .isVisible()) &&
            !(await page
              .getByRole("button", { name: "Следующие задания", exact: true })
              .isDisabled())
          )
            await page.getByRole("button", { name: "Следующие задания", exact: true }).click();
          else break;
        } while (true);
        assert.equal(seen.size, 4);
      }
      await page.getByRole("button", { name: "Закрыть задания", exact: true }).click();
      await page.setViewportSize({ width: 1366, height: 900 });
      phase = "clan";
      await page.locator("#clanSection").click();
      await page.getByRole("button", { name: "Чат", exact: true }).click();
      for (const [width, height] of [
        [1366, 900],
        [390, 844],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        await geometry("#clanDialog", `chat-${width}`);
        const b = await page.locator(".clan-chat").boundingBox();
        assert.ok(b.y + b.height > height - 70);
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.getByRole("button", { name: "Оформление", exact: true }).click();
      await page.locator("#clanForm").waitFor();
      assert.equal(await page.locator(".clan-settings-tabs").count(), 0);
      assert.equal(await page.locator(".clan-backgrounds .appearance-card").count(), 7);
      await page.locator("#clan-description").fill("Черновик остаётся при выборе фона");
      await page.getByRole("button", { name: "Фон клана: Бронзовая", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector("#clan-description")?.value ===
          "Черновик остаётся при выборе фона",
      );
      if (await page.locator(".clan-crest-tabs").count())
        await page.getByRole("button", { name: "Символ", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Без символа", exact: true }).count(), 0);
      await page.getByRole("button", { name: "Геральдическая лилия", exact: true }).click();
      for (const [width, height] of [
        [1366, 900],
        [1128, 785],
        [900, 650],
        [390, 844],
        [320, 700],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        await geometry("#clanDialog", `appearance-${width}`);
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.locator('#clanForm button[type="submit"]').click();
      await page.locator("#clanForm").waitFor({ state: "hidden" });
      assert.equal(
        profiles.data.clans[profiles.find(auth.token).clanId].description,
        "Черновик остаётся при выборе фона",
      );
      await page.locator("#clanDialog .booster-close, #clanDialog .clan-close").first().click();
      phase = "roulette";
      await page.locator("#rouletteButton").click();
      await page.locator(".roulette-wheel svg").waitFor();
      for (const [width, height] of [
        [1366, 900],
        [390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await geometry("#rouletteDialog", `roulette-${width}`, false);
      }
      await page.getByRole("button", { name: "Закрыть рулетку", exact: true }).click();
      await page.setViewportSize({ width: 1366, height: 900 });
      phase = "pets";
      await page.locator("#petsSection").click();
      await page.locator(".pet-care-line").waitFor();
      assert.match(await page.locator(".pet-care-line").textContent(), /120 мин полного запаса/);
      await page.getByRole("button", { name: "Развитие", exact: true }).click();
      for (const [width, height] of [
        [1366, 900],
        [390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await geometry("#petsDialog", `pets-${width}`, false);
      }
      await page.locator(".pets-close").click();
      await page.setViewportSize({ width: 1366, height: 900 });
      phase = "chests";
      await page.locator("#shopSection").click();
      await page.getByRole("button", { name: "Сундуки", exact: true }).click();
      await page.locator(".chest-card").first().waitFor();
      await shot("chests");
      const alignment = await page.locator(".chest-grid").evaluate((n) => {
        const b = n.getBoundingClientRect(),
          cards = [...n.children].map((x) => x.getBoundingClientRect()),
          row = cards.filter((r) => Math.abs(r.top - cards[0].top) < 2);
        return { left: row[0].left - b.left, right: b.right - row.at(-1).right };
      });
      assert.ok(Math.abs(alignment.left - alignment.right) < 3, JSON.stringify(alignment));
      assert.deepEqual(errors, []);
      await browser.close();
      browser = null;
    }
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, checks: report.length }));
  } catch (e) {
    console.error("PHASE", phase, e);
    fs.writeFileSync(path.join(output, "partial-report.json"), JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})();
