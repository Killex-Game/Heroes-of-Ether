"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  browsers = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { xpForLevel } = require("../../src/server/progression/experience-progression"),
  appearance = require("../../src/server/profiles/league-appearance"),
  clanAppearance = require("../../src/server/clans/clan-appearance");
const engine = process.argv.find((arg) => arg.startsWith("--engine="))?.split("=")[1] || "chromium",
  artifacts = path.resolve(__dirname, "../../../../artifacts/league-medal-access-20261026");
let offset = 0;
const now = () => Date.now() + offset,
  profiles = new ProfileStore({ now, unlockClanCrests: true }),
  clans = new ClanService(profiles),
  head = profiles.open(),
  player = profiles.find(head.token);
player.level = 12;
player.progress.xp = xpForLevel(12);
player.wallet.coins = 10000;
clans.mutate(head.token, {
  action: "create",
  name: "Месяц серебра",
  prefix: "TIME",
  emblem: "astral",
  privacy: "open",
  requestId: randomUUID(),
});
const clanId = profiles.find(head.token).clanId;
for (const rank of [0, 1, 5]) {
  appearance.grant(profiles.find(head.token), rank, now());
  clanAppearance.grant(profiles.data.clans[clanId], rank, now());
}
profiles.save(profiles.data);
profiles.setAppearance(head.token, { slot: "set", themeId: "silver", requestId: randomUUID() });
clans.mutate(head.token, {
  action: "background",
  clanId,
  themeId: "silver",
  requestId: randomUUID(),
});
const app = createGameServer({
  profiles,
  clans,
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
});
let browser,
  page,
  phase = "start";
fs.mkdirSync(artifacts, { recursive: true });
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await browsers[engine].launch({
      headless: true,
      ...(engine === "chromium" ? { channel: "chrome" } : {}),
    });
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      screen: { width: 1920, height: 1080 },
    });
    await context.addCookies([{ name: "sferorumiya_session", value: head.token, url }]);
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(response.status() + " " + response.url());
    });
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    phase = "clan access";
    await page.locator("#clanSection").click();
    await page.getByRole("button", { name: "Оформление", exact: true }).click();
    const cards = page.locator(".clan-backgrounds");
    assert.equal(await cards.locator(".appearance-card").count(), 7);
    for (const id of ["bronze", "silver"]) {
      const card = cards.locator(`[data-theme-id="${id}"]`);
      assert.equal(await card.getAttribute("data-locked"), "false");
      assert.match(
        await card.locator(".appearance-access-time").textContent(),
        /^\d+ д \d\d:\d\d:\d\d$/,
      );
    }
    for (const id of ["gold", "platinum", "diamond"]) {
      const card = cards.locator(`[data-theme-id="${id}"]`);
      assert.equal(await card.getAttribute("data-locked"), "true");
      assert.equal(await card.locator("button").isDisabled(), true);
    }
    assert.equal(
      await cards.locator('[data-theme-id="champions"] .appearance-access-time').textContent(),
      "Бессрочно",
    );
    assert.ok(!(await cards.textContent()).includes("Тестовый доступ"));
    assert.equal(
      await page.locator("#clanDialog").getAttribute("data-league-background"),
      "silver",
    );
    await page.screenshot({ path: path.join(artifacts, `${engine}-clan-access.png`) });
    phase = "expiry preserves draft";
    await page.locator("#clan-name").fill("Сохранить черновик");
    await page
      .locator("#clan-description")
      .fill("Описание не должно исчезнуть при завершении срока темы.");
    await page.locator("#clan-privacy").selectOption("closed");
    const draft = await page.locator("#clanForm").evaluate((form) => form.readDraft());
    offset = appearance.MONTH + 1000;
    await page.evaluate(
      (at) => document.dispatchEvent(new CustomEvent("killex:server-time", { detail: at })),
      now(),
    );
    await page.waitForFunction(
      () => !document.getElementById("clanDialog").dataset.leagueBackground,
    );
    assert.deepEqual(await page.locator("#clanForm").evaluate((form) => form.readDraft()), draft);
    assert.equal(await cards.locator('[data-theme-id="silver"] button').isDisabled(), true);
    assert.equal(await cards.locator('[data-theme-id="champions"] button').isDisabled(), false);
    await page.screenshot({ path: path.join(artifacts, `${engine}-clan-expired.png`) });
    await cards.locator('[data-theme-id="champions"] button').click();
    await page.waitForFunction(
      () => document.getElementById("clanDialog").dataset.leagueBackground === "champions",
    );
    assert.equal(profiles.data.clans[clanId].appearance.background, "champions");
    assert.deepEqual(await page.locator("#clanForm").evaluate((form) => form.readDraft()), draft);
    assert.equal(profiles.data.clans[clanId].name, "Месяц серебра");
    phase = "personal access";
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.KillexAppearance.open("theme"));
    const personal = page.locator('[data-appearance-slot="theme"]');
    await personal.waitFor({ state: "visible" });
    assert.equal(await personal.locator('[data-theme-id="silver"] button').isDisabled(), true);
    assert.equal(await personal.locator('[data-theme-id="gold"] button').isDisabled(), true);
    assert.equal(
      await personal.locator('[data-theme-id="champions"] .appearance-access-time').textContent(),
      "Бессрочно",
    );
    await personal.locator('[data-theme-id="champions"] button').click();
    await page.waitForFunction(
      () => document.getElementById("lobby").dataset.leagueBackground === "champions",
    );
    assert.equal(profiles.find(head.token).appearance.lobbyBackground, "champions");
    await page.screenshot({ path: path.join(artifacts, `${engine}-personal-access.png`) });
    phase = "reload";
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    assert.equal(await page.locator("#lobby").getAttribute("data-league-background"), "champions");
    await page.locator("#clanSection").click();
    await page.getByRole("button", { name: "Оформление", exact: true }).click();
    assert.equal(
      await page.locator("#clanDialog").getAttribute("data-league-background"),
      "champions",
    );
    assert.equal(await cards.locator('[data-theme-id="bronze"] button').isDisabled(), true);
    assert.equal(
      await cards.locator('[data-theme-id="champions"] .appearance-access-time').textContent(),
      "Бессрочно",
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        engine,
        passed: true,
        checks: [
          "earned access only",
          "30-day expiry",
          "draft preserved",
          "champions permanent",
          "reload",
        ],
      }),
    );
  } catch (error) {
    console.error("Phase:", phase);
    await page?.screenshot({ path: path.join(artifacts, `${engine}-failure.png`) }).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
