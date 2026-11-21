"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  browsers = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation");
const { xpForLevel } = require("../../src/server/progression/experience-progression"),
  appearance = require("../../src/server/profiles/league-appearance");
const catalog = require("../../public/shared/league-appearance");
const engine = process.argv.find((a) => a.startsWith("--engine="))?.split("=")[1] || "chromium";
const profiles = new ProfileStore({ unlockLeagueBackgrounds: true, unlockLeagueFrames: true }),
  clans = new ClanService(profiles);
function user() {
  const u = profiles.open(),
    p = profiles.find(u.token);
  p.level = 12;
  p.progress.xp = xpForLevel(12);
  p.wallet.coins = 10000;
  return u;
}
const head = user(),
  member = user();
clans.mutate(head.token, {
  action: "create",
  name: "Рубиновая корона",
  prefix: "RUBY",
  emblem: "astral",
  privacy: "open",
  requestId: randomUUID(),
});
const clanId = profiles.find(head.token).clanId;
clans.mutate(member.token, { action: "apply", clanId, requestId: randomUUID() });
const until = Date.now() + 180000;
appearance.grant(profiles.find(head.token), 1, until - appearance.MONTH);
appearance.grant(profiles.find(head.token), 5, Date.now());
profiles.data.clans[clanId].appearance.grants.silver = until;
profiles.save(profiles.data);
const app = createGameServer({
  profiles,
  clans,
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
});
const artifacts = path.resolve(__dirname, "../artifacts/clan-appearance");
fs.mkdirSync(artifacts, { recursive: true });
let browser, page, phase;
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await browsers[engine].launch({
      headless: true,
      ...(engine === "chromium" ? { channel: "chrome" } : {}),
    });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await context.addCookies([{ name: "sferorumiya_session", value: head.token, url }]);
    page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(r.status() + " " + r.url());
    });
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page.locator("#clanSection").click();
    await page.getByRole("button", { name: "Фон клана", exact: true }).click();
    assert.equal(await page.locator(".clan-backgrounds .appearance-card").count(), 7);
    const timer = page.locator(
      '.clan-backgrounds [data-theme-id="silver"] .appearance-access-time',
    );
    const firstTime = await timer.textContent();
    assert.match(firstTime, /^00:\d\d:\d\d$/);
    await page.waitForFunction(
      (text) =>
        document.querySelector('.clan-backgrounds [data-theme-id="silver"] .appearance-access-time')
          .textContent !== text,
      firstTime,
    );
    async function chooseClan(theme) {
      phase = "clan:" + theme.id;
      const [response] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().endsWith("/api/clans/action") && r.request().method() === "POST",
        ),
        page.getByRole("button", { name: "Фон клана: " + theme.name, exact: true }).click(),
      ]);
      assert.equal(response.status(), 200);
      assert.equal(profiles.data.clans[clanId].appearance.background, theme.id);
      await page.waitForFunction(
        (id) =>
          (document.getElementById("clanDialog").dataset.leagueBackground || "default") === id,
        theme.id,
      );
    }
    const panelColors = new Set();
    for (const theme of catalog.themes) {
      await chooseClan(theme);
      assert.ok(
        (
          await page.locator("#clanDialog").evaluate((el) => getComputedStyle(el).backgroundImage)
        ).includes(theme.id + "-clan.svg"),
      );
      await page.screenshot({ path: path.join(artifacts, `${engine}-${theme.id}.png`) });
      await page.getByRole("button", { name: "Мой клан", exact: true }).click();
      await page.locator("#clanDialog .clan-banner").waitFor({ state: "visible" });
      const paints = await page
        .locator("#clanDialog .clan-banner, #clanDialog .clan-home-grid > .clan-panel")
        .evaluateAll((nodes) => nodes.map((el) => getComputedStyle(el).backgroundImage));
      assert.equal(paints.length, 4);
      assert.equal(new Set(paints).size, 1);
      panelColors.add(paints[0]);
      await page.screenshot({ path: path.join(artifacts, `${engine}-panels-${theme.id}.png`) });
      await page.getByRole("button", { name: "Фон клана", exact: true }).click();
    }
    assert.equal(panelColors.size, 6);
    await chooseClan({ id: "default", name: "По умолчанию" });
    await chooseClan(catalog.theme("champions"));
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(
        await page.locator("#clanDialog").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      await page.screenshot({ path: path.join(artifacts, `${engine}-clan-${width}.png`) });
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.getByRole("button", { name: "Мой клан", exact: true }).click();
    await page.screenshot({ path: path.join(artifacts, `${engine}-clan-home.png`) });
    await page.keyboard.press("Escape");
    await page.locator("#wardrobeSection").click();
    await page.getByRole("button", { name: "Наборы лиг", exact: true }).click();
    const sets = page.locator('[data-appearance-slot="set"]');
    assert.equal(await sets.locator(".appearance-card").count(), 7);
    for (const theme of catalog.themes) {
      await page.getByRole("button", { name: "Наборы лиг: " + theme.name, exact: true }).click();
      await page.waitForFunction(
        (id) => document.querySelector('[data-appearance-slot="set"]').dataset.selection === id,
        theme.id,
      );
      for (const slot of catalog.slots)
        assert.equal(profiles.find(head.token).appearance[slot], theme.id);
    }
    for (const width of [1366, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1366 ? 900 : 844 });
      assert.ok(
        await page.locator("#skinsDialog").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      await page
        .getByRole("button", { name: "Наборы лиг: Бронзовая", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(artifacts, `${engine}-sets-${width}.png`) });
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.getByRole("button", { name: "Наборы лиг: Бронзовая", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('[data-appearance-slot="set"]').dataset.selection === "bronze",
    );
    await page.getByRole("button", { name: "Рамки арены", exact: true }).click();
    await page.getByRole("button", { name: "Рамки арены: Золотая", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('[data-appearance-slot="set"]').dataset.selection === "custom",
    );
    for (const slot of catalog.slots)
      assert.equal(
        profiles.find(head.token).appearance[slot],
        slot === "arenaFrame" ? "gold" : "bronze",
      );
    await page.reload();
    await page.waitForFunction(
      () => document.getElementById("lobby").dataset.leagueBackground === "bronze",
    );
    await page.locator("#wardrobeSection").click();
    await page.getByRole("button", { name: "Наборы лиг", exact: true }).click();
    assert.equal(await sets.getAttribute("data-selection"), "custom");
    await page.getByRole("button", { name: "Рамки", exact: true }).click();
    const profileTimer = page.locator(
      '[data-appearance-slot="avatarFrame"] [data-theme-id="silver"] .appearance-access-time',
    );
    assert.match(await profileTimer.textContent(), /^00:\d\d:\d\d$/);
    for (const [tab, slot, name] of [
      ["Рамки", "avatarFrame", "profile"],
      ["Рамки арены", "arenaFrame", "arena"],
    ]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      const card = page.locator(`[data-appearance-slot="${slot}"] [data-theme-id="champions"]`);
      await card.scrollIntoViewIfNeeded();
      assert.equal(await card.locator(".appearance-access-time").textContent(), "Бессрочно");
      await card.locator("button").click();
      await page.waitForFunction(
        ([slot]) =>
          document.querySelector(`[data-appearance-slot="${slot}"] [data-theme-id="champions"]`)
            .dataset.selected === "true",
        [slot],
      );
      await card.screenshot({ path: path.join(artifacts, `${engine}-champion-${name}.png`) });
    }
    await page.keyboard.press("Escape");
    await page.locator("#openSelfProfile").click();
    await page
      .locator("#playerProfileDialog")
      .screenshot({ path: path.join(artifacts, `${engine}-champion-profile-full.png`) });
    const memberContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await memberContext.addCookies([{ name: "sferorumiya_session", value: member.token, url }]);
    const memberPage = await memberContext.newPage();
    await memberPage.goto(url);
    await memberPage.waitForFunction(() => !document.getElementById("playButton").disabled);
    await memberPage.locator("#clanSection").click();
    await memberPage.waitForFunction(
      () => document.getElementById("clanDialog").dataset.leagueBackground === "champions",
    );
    assert.equal(
      await memberPage.getByRole("button", { name: "Фон клана", exact: true }).count(),
      0,
    );
    assert.equal(
      await memberPage.locator("#clanDialog").getAttribute("data-league-background"),
      "champions",
    );
    const denied = await memberContext.request.post(url + "/api/clans/action", {
      data: { action: "background", clanId, themeId: "bronze", requestId: randomUUID() },
    });
    assert.equal(denied.status(), 409);
    assert.equal(profiles.data.clans[clanId].appearance.background, "champions");
    assert.deepEqual(errors, []);
    console.log(
      engine +
        ": six clan panel palettes, atomic sets and individual choice, reload, live timers, permissions, 3 viewports OK",
    );
  } catch (error) {
    if (page && !page.isClosed()) {
      const ui = await page
        .evaluate(() => ({
          background: document.getElementById("clanDialog")?.dataset.leagueBackground,
          status: document.querySelector("#clanDialog .clan-status")?.textContent,
        }))
        .catch(() => null);
      console.error(
        JSON.stringify({
          phase,
          ui,
          serverBackground: profiles.data.clans[clanId].appearance.background,
        }),
      );
      await page
        .screenshot({ path: path.join(artifacts, engine + "-failure.png") })
        .catch(() => {});
    }
    throw error;
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
