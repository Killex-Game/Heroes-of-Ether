/* Реальная доступность кнопок и окон при изменении размеров и масштаба браузера. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  engines = require("playwright");
const engineName =
  process.argv.find((arg) => arg.startsWith("--engine="))?.slice(9) ||
  process.env.SF_BROWSER_ENGINE ||
  "chromium";
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { xpForLevel } = require("../../src/server/progression/experience-progression");
const directory = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(directory, ".tmp-responsive-")),
  artifacts = path.join(directory, "artifacts", "responsive", engineName);
process.env.TEMP = process.env.TMP = scratch;
fs.mkdirSync(artifacts, { recursive: true });
let wall = Date.parse("2026-10-20T04:59:00Z");
const profiles = new ProfileStore({ now: () => wall }),
  clans = new ClanService(profiles);
const users = [];
for (let i = 0; i < 16; i++) {
  const user = profiles.open(),
    p = profiles.find(user.token);
  p.name = i === 0 ? "ШирокийНикИгрока" : "Тестировщик " + i;
  p.level = 25;
  p.progress.xp = xpForLevel(25);
  p.wallet.coins = 100000;
  p.wallet.crystals = 25000;
  p.wallet.bucks = 12000;
  clans.mutate(user.token, {
    action: "create",
    name: "Звёздные защитники " + i,
    prefix: "C" + i,
    privacy: "open",
    emblem: "astral",
    requestId: randomUUID(),
  });
  users.push(user);
}
wall = Date.parse("2026-10-20T05:01:00Z");
profiles.refreshCompetition(wall);
const member = profiles.open();
profiles.find(member.token).name = "Участник клана";
profiles.find(member.token).level = 25;
profiles.find(member.token).progress.xp = xpForLevel(25);
clans.mutate(member.token, {
  action: "apply",
  clanId: profiles.find(users[0].token).clanId,
  requestId: randomUUID(),
});
for (const kind of ["vip", "premium"])
  profiles.activateAccount(users[0].token, { kind, requestId: randomUUID() });
const app = createGameServer({
  profiles,
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  wallNow: () => wall,
  rateNow: () => performance.now(),
});
let browser;
const auditOnly = process.argv.includes("--audit");
const sizes =
  process.argv.includes("--arena-only") || process.argv.includes("--status-only")
    ? []
    : process.argv.includes("--members-only")
      ? [
          [1366, 768],
          [320, 568],
        ]
      : [
          [1920, 1080],
          [1366, 768],
          [1280, 720],
          [1093, 614],
          [1024, 600],
          [911, 512],
          [844, 390],
          [768, 1024],
          [683, 384],
          [568, 320],
          [390, 844],
          [320, 568],
        ];
const report = [],
  errors = [];
async function inspect(page, selector, label) {
  const state = await page.locator(selector).evaluate((root) => {
    const issues = [];
    const visible = (element) =>
      element.getClientRects().length && getComputedStyle(element).visibility !== "hidden";
    for (const element of root.querySelectorAll("button,input,select")) {
      if (!visible(element)) continue;
      const r = element.getBoundingClientRect(),
        css = getComputedStyle(element);
      const name =
        element.id || element.getAttribute("aria-label") || element.textContent.trim().slice(0, 45);
      if (
        !element.matches('input[type="checkbox"],input[type="radio"]') &&
        (r.width < 20 || r.height < 24)
      )
        issues.push({ name, type: "small", w: r.width, h: r.height });
      // Только полная подпись кнопки: сокращение имени игрока многоточием допустимо.
      if (
        element.matches(".sf-tab,.booster-action,.donation-action,.clan-battle-play,#playButton") &&
        (element.scrollWidth > element.clientWidth + 2 ||
          element.scrollHeight > element.clientHeight + 2)
      )
        issues.push({ name, type: "text-overflow", w: r.width, h: r.height });
      let scrollX = false,
        scrollY = false;
      for (
        let parent = element.parentElement;
        parent && parent !== document.body;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent),
          box = parent.getBoundingClientRect();
        if (
          !scrollX &&
          style.overflowX === "hidden" &&
          (r.left < box.left - 2 || r.right > box.right + 2)
        )
          issues.push({ name, type: "clipped-x", parent: parent.id || parent.className });
        if (
          !scrollY &&
          style.overflowY === "hidden" &&
          (r.top < box.top - 2 || r.bottom > box.bottom + 2)
        )
          issues.push({ name, type: "clipped-y", parent: parent.id || parent.className });
        scrollX ||= ["auto", "scroll"].includes(style.overflowX);
        scrollY ||= ["auto", "scroll"].includes(style.overflowY);
      }
    }
    const rect = root.getBoundingClientRect();
    return {
      issues,
      horizontalOverflow: root.scrollWidth > root.clientWidth + 2,
      box: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      bodyWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
    };
  });
  report.push({ label, ...state });
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    browser = await engines[engineName === "edge" ? "chromium" : engineName].launch({
      ...(engineName === "chromium" ? { channel: "chrome" } : {}),
      ...(engineName === "edge" ? { channel: "msedge" } : {}),
      headless: true,
    });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addCookies([{ name: "sferorumiya_session", value: users[0].token, url }]);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page.evaluate(() => document.fonts.ready);
    for (let i = 0; i < 20 && (await page.locator(".achievement-notice-close").isVisible()); i++)
      await page.locator(".achievement-notice-close").click();
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(100);
      await inspect(page, "#lobby", `${width}x${height}:lobby`);
      if ([1366, 911, 568, 390].includes(width))
        await page.screenshot({ path: path.join(artifacts, `lobby-${width}.png`), fullPage: true });
      // Trial clicks ensure hit targets remain reachable after reflow and browser scrolling.
      for (const [trigger, id] of [
        ["#shopSection", "boosterDialog"],
        ["#inventorySection", "boosterDialog"],
        ["#wardrobeSection", "skinsDialog"],
        ["#achievementsButton", "achievementsDialog"],
        ["#rankingsButton", "topsDialog"],
        ["#clanSection", "clanDialog"],
        ["#accountButton", "accountDialog"],
        ['#walletStatus .currency-add[data-currency="coins"]', "donationDialog"],
        ["#editProfile", "personalDialog"],
      ]) {
        await page.locator(trigger).click();
        const dialog = page.locator("#" + id);
        await dialog.waitFor({ state: "visible" });
        await page.waitForTimeout(60);
        await inspect(page, "#" + id, `${width}x${height}:${id}`);
        if (id === "clanDialog" && [1366, 911, 568, 390, 320].includes(width)) {
          await dialog.getByRole("button", { name: "О лигах", exact: true }).click();
          await inspect(page, "#leagueInfoDialog", `${width}x${height}:leagueInfoDialog`);
          await page.locator("#leagueInfoDialog .booster-close").click();
          await dialog.getByRole("button", { name: "Настройки клана", exact: true }).click();
          await inspect(page, "#clanDialog", `${width}x${height}:clanEditor`);
          await dialog.getByRole("button", { name: "Цвет", exact: true }).click();
          await inspect(page, "#clanDialog", `${width}x${height}:clanColors`);
          if (width === 1366)
            await dialog.locator(".clan-crest-controls").screenshot({
              path: path.join(artifacts, "clan-enamel-palette.png"),
            });
          await dialog.getByRole("button", { name: "Мой клан", exact: true }).click();
          await dialog.locator(".clan-battle-play").waitFor();
          assert.match(
            await dialog
              .locator(".clan-battle-play")
              .evaluate((e) => getComputedStyle(e, "::before").borderImageSource),
            /button_play_default/,
          );
          const row = dialog.locator(`[data-member-id="${member.profile.id}"]`);
          await row.locator(".clan-member-profile").click();
          await page.locator("#playerProfileDialog .public-player-hero").waitFor();
          assert.match(await page.locator("#publicPlayerTitle").textContent(), /Участник клана/);
          assert.equal(
            await page.evaluate(() => KillexWindows.top().id),
            "playerProfileDialog",
          );
          await inspect(page, "#playerProfileDialog", `${width}x${height}:clanMemberProfile`);
          await page.locator("#playerProfileDialog .personal-close").click();
          await row.locator(".clan-member-profile").focus();
          await page.keyboard.press("Enter");
          await page.locator("#playerProfileDialog .public-player-hero").waitFor();
          await page.locator("#playerProfileDialog .personal-close").click();
          await row.locator(".clan-member-gear").click();
          await page.locator(".clan-member-dialog").waitFor({ state: "visible" });
          assert.equal(await page.locator("#playerProfileDialog").isVisible(), false);
          await inspect(page, ".clan-member-dialog", `${width}x${height}:memberManagement`);
          await page.locator(".clan-member-dialog .booster-close").click();
        }
        if (
          [1366, 568, 390].includes(width) &&
          ["clanDialog", "boosterDialog", "topsDialog"].includes(id)
        )
          await page.screenshot({ path: path.join(artifacts, `${id}-${width}.png`) });
        await dialog.locator(".booster-close,.personal-close").first().click();
        await dialog.waitFor({ state: "hidden" });
      }
      await page.locator("#playButton").click({ trial: true });
      assert.match(
        await page
          .locator("#playButton")
          .evaluate((e) => getComputedStyle(e, "::before").borderImageSource),
        /button_play_/,
      );
      await page.locator("#settingsButton").click();
      await inspect(page, "#settingsMenu", `${width}x${height}:settings`);
      await page.locator("#closeSettings").click();
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.locator("#playButton").click();
    await page.waitForFunction(() => document.body.dataset.screen === "arena");
    await page.locator("#leaveButton").click();
    await page.locator("#leaveConfirmDialog").waitFor({ state: "visible" });
    for (const [width, height] of [
      [1366, 768],
      [568, 320],
      [320, 568],
    ]) {
      await page.setViewportSize({ width, height });
      await inspect(page, "#leaveConfirmDialog", `${width}x${height}:leaveConfirmDialog`);
    }
    if (!process.argv.includes("--arena-only")) {
      const statusContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const statusPage = await statusContext.newPage();
      statusPage.on("pageerror", (e) => errors.push(e.message));
      await statusPage.goto(url);
      await statusPage.waitForFunction(() => !document.getElementById("playButton").disabled);
      const statusProfile = (await (await statusContext.request.get(url + "/api/profile")).json())
        .profile;
      const initialCard = await statusPage.locator(".profile-card").boundingBox();
      const initialWallet = await statusPage.locator("#walletStatus").boundingBox();
      for (const [vip, premium] of [
        [false, false],
        [true, false],
        [true, true],
        [false, true],
        [false, false],
      ]) {
        const accountProfile = profiles.byId(statusProfile.id);
        accountProfile.account ||= { vipUntil: 0, premiumUntil: 0, dailyDay: null, dailyAmount: 0 };
        accountProfile.account.vipUntil = vip ? wall + 86400000 : wall - 1;
        accountProfile.account.premiumUntil = premium ? wall + 86400000 : wall - 1;
        accountProfile.revision++;
        await statusPage.setViewportSize({ width: 1366, height: 768 });
        await statusPage.reload();
        await statusPage.waitForFunction(() => !document.getElementById("playButton").disabled);
        assert.equal(await statusPage.locator("#accountMarks .profile-account").count(), 2);
        assert.equal(
          await statusPage.locator("#accountMarks time").count(),
          Number(vip) + Number(premium),
        );
        for (const [kind, active] of [
          ["vip", vip],
          ["premium", premium],
        ]) {
          const mark = statusPage.locator("#accountMarks ." + kind);
          assert.equal(await mark.getAttribute("data-active"), String(active));
          assert.match(
            await mark.locator(".profile-account-period").textContent(),
            active ? /до / : /^Не активен$/,
          );
          assert.equal(
            await mark.locator("img").evaluate((e) => Number(getComputedStyle(e).opacity)),
            active ? 1 : 0.72,
          );
        }
        assert.equal(
          (await statusPage.locator(".profile-card").boundingBox()).width,
          initialCard.width,
        );
        assert.equal((await statusPage.locator("#walletStatus").boundingBox()).x, initialWallet.x);
        await inspect(statusPage, "#lobby", `1366:status-${vip}-${premium}`);
        if (!vip && premium)
          await statusPage
            .locator(".profile-card")
            .screenshot({ path: path.join(artifacts, "account-status-mixed.png") });
        await statusPage.setViewportSize({ width: 320, height: 568 });
        await inspect(statusPage, "#lobby", `320:status-${vip}-${premium}`);
      }
      await statusContext.close();
    }
    fs.writeFileSync(
      path.join(
        artifacts,
        auditOnly
          ? "before.json"
          : process.argv.includes("--arena-only")
            ? "arena.json"
            : "report.json",
      ),
      JSON.stringify({ report, errors }, null, 2),
    );
    const failures = report.filter(
      (r) => r.issues.length || r.horizontalOverflow || r.bodyWidth > r.viewport + 1,
    );
    console.log(
      JSON.stringify(
        failures.map((r) => ({ label: r.label, overflow: r.horizontalOverflow, issues: r.issues })),
        null,
        2,
      ),
    );
    assert.deepEqual(errors, []);
    if (!auditOnly) assert.deepEqual(failures, []);
    console.log(`Checked ${report.length} screens; ${failures.length} with issues.`);
  } finally {
    fs.writeFileSync(
      path.join(
        artifacts,
        auditOnly
          ? "before.json"
          : process.argv.includes("--arena-only")
            ? "arena.json"
            : "report.json",
      ),
      JSON.stringify({ report, errors }, null, 2),
    );
    if (browser) await browser.close();
    await app.close();
    assert.ok(path.resolve(scratch).startsWith(directory + path.sep + ".tmp-responsive-"));
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
