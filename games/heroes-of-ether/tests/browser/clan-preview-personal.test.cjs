"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { once } = require("node:events");
const engines = require("playwright"), engine = process.env.SF_BROWSER_ENGINE || "chromium";
const fixture = require("../clan-preview-fixture.cjs");
const { createGameServer } = require("../../src/server/game-server");
const { Arena } = require("../../src/server/arena/arena-simulation");
const f = fixture({ previewRoles: true });
const app = createGameServer({ profiles: f.profiles, arena: new Arena({ etherCount: 0 }), autoTick: false, testBots: { enabled: false } });
const out = path.resolve(__dirname, "../../../../artifacts/interface-copy-20261108", engine);
fs.mkdirSync(out, { recursive: true });
let browser, timer;
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1"); await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    timer = setInterval(() => app.broadcast(), 50);
    browser = await engines[engine].launch({ ...(engine === "chromium" ? { channel: "chrome" } : {}), headless: true });
    const errors = [];
    const pageFor = async (token) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      if (token) await context.addCookies([{ name: "sferorumiya_session", value: token, url }]);
      const page = await context.newPage();
      page.on("pageerror", e => errors.push(e.stack));
      await page.addInitScript(at => { const now = Date.now, origin = now(); Date.now = () => at + now() - origin; }, f.at);
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      return page;
    };
    const fresh = await pageFor();
    await fresh.locator("#personalDialog[open]").waitFor();
    assert.equal(await fresh.locator(".daily-login-dialog[open], .daily-login-done").count(), 0);
    assert.ok(!(await fresh.locator("#personalDialog").innerText()).includes("Пол — бесплатно"));
    await fresh.locator("#profileNickname").fill("Новая героиня");
    await fresh.locator('[data-gender="female"]').click();
    await fresh.locator("#personalDialog").getByRole("button", { name: "Сохранить", exact: true }).click();
    await fresh.locator(".daily-login-done").waitFor();
    assert.equal(await fresh.locator("#personalDialog[open]").count(), 0);
    const token = (await fresh.context().cookies()).find(c => c.name === "sferorumiya_session").value;
    assert.equal(f.profiles.find(token).personal.gender, "female");
    assert.equal(f.profiles.find(token).personal.introPending, false);
    const beforeReward = structuredClone(f.profiles.find(token));
    assert.equal(beforeReward.loginReward, undefined, "showing the window does not claim");
    assert.equal(await fresh.locator('.daily-login-dialog button').count(), 1, "no close button");
    await fresh.keyboard.press("Escape");
    await fresh.mouse.click(1, 1);
    assert.equal(await fresh.locator('.daily-login-dialog[open]').count(), 1);
    await fresh.reload(); await fresh.locator('.daily-login-done').waitFor();
    assert.deepEqual(f.profiles.find(token).wallet, beforeReward.wallet);
    await fresh.route('**/api/profile/login-reward', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Пробуем ещё раз' }) }), { times: 1 });
    await fresh.locator('.daily-login-done').click();
    await fresh.getByText('Пробуем ещё раз', { exact: true }).waitFor();
    assert.deepEqual(f.profiles.find(token).wallet, beforeReward.wallet);
    await fresh.locator('.daily-login-done').evaluate(e => { e.click(); e.click(); });
    await fresh.locator('.daily-login-dialog').waitFor({ state: 'detached' });
    assert.equal(f.profiles.find(token).wallet.coins, beforeReward.wallet.coins + 100);
    await fresh.reload();
    await fresh.waitForFunction(() => !document.getElementById("playButton").disabled);
    assert.equal(await fresh.locator("#personalDialog[open], .daily-login-done").count(), 0);
    const skip = await pageFor();
    await skip.locator("#personalDialog[open]").waitFor();
    await skip.locator("#profileNickname").fill("Несохранённое");
    await skip.locator("#personalDialog .personal-close").click();
    await skip.locator(".daily-login-done").waitFor();
    const skipToken = (await skip.context().cookies()).find(c => c.name === "sferorumiya_session").value;
    assert.notEqual(f.profiles.find(skipToken).name, "Несохранённое");
    assert.equal(f.profiles.find(skipToken).personal.nameSet, false);
    assert.equal(f.profiles.find(skipToken).personal.gender, "unspecified");
    await skip.context().close(); await fresh.context().close();
    const page = await pageFor(f.heads[0].token);
    await page.locator(".daily-login-done").click();
    await page.locator('.daily-login-dialog').waitFor({ state: 'detached' });
    await page.locator("#clanSection").click();
    await page.locator("#clanDialog[open]").waitFor();
    const opponent = f.profiles.data.clans[f.opponent];
    const label = `Посмотреть клан [${opponent.prefix}] ${opponent.name}`;
    await page.locator("#clanDialog .clan-versus").getByRole("button", { name: label, exact: true }).click();
    await page.locator("#clanPreviewDialog .clan-member").first().waitFor();
    assert.equal(await page.locator("#clanPreviewDialog .clan-member-gear, #clanPreviewDialog .clan-battle-play, #clanPreviewDialog .clan-personal-reward").count(), 0);
    assert.ok((await page.locator("#clanPreviewTitle").innerText()).includes(opponent.name));
    await page.screenshot({ path: path.join(out, "clan-preview-desktop.png") });
    const previewMetrics = await page.locator("#clanPreviewDialog").evaluate(dialog => ({
      borderImage: getComputedStyle(dialog).borderImageSource,
      panels: Array.from(dialog.querySelectorAll(".clan-panel"), p => getComputedStyle(p).borderImageSource),
      roles: Array.from(dialog.querySelectorAll(".clan-role-icon"), img => ({
        name: img.alt, width: img.getBoundingClientRect().width,
        height: img.getBoundingClientRect().height, position: getComputedStyle(img).position,
      })),
    }));
    assert.equal(previewMetrics.borderImage, "none");
    assert.ok(previewMetrics.panels.every(value => value === "none"));
    assert.deepEqual(previewMetrics.roles.map(r => r.name).sort(), ["Глава", "Офицер", "Управляющий"]);
    assert.ok(previewMetrics.roles.every(r => r.width === 25 && r.height === 25 && r.position === "absolute"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, "clan-preview-mobile.png") });
    assert.equal(await page.locator("#clanPreviewDialog").evaluate(e => e.scrollWidth <= e.clientWidth + 1), true);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const theme of ["visual", "prism", "glass"]) {
      await page.locator("#clanPreviewDialog").evaluate((dialog, value) => { dialog.dataset.uiTheme = value; }, theme);
      await page.screenshot({ path: path.join(out, "clan-preview-" + theme + ".png") });
    }
    // Own-clan links return to the full clan page and never request a public preview.
    const original = f.profiles.data.clans[f.own];
    const ownPreviewRequests = [];
    page.on("request", request => {
      if (request.url().includes("/api/clans/view?clanId=" + f.own)) ownPreviewRequests.push(request.url());
    });
    await page.locator("#clanPreviewDialog .clan-versus").getByRole("button", { name: `Посмотреть клан [${original.prefix}] ${original.name}`, exact: true }).click();
    await page.locator("#clanPreviewDialog").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#clanDialog[open] .clan-member").count(), 3);
    assert.ok(await page.locator("#clanDialog .clan-member-gear").count() > 0);
    await page.locator("#clanDialog .clan-versus").getByRole("button", { name: `Посмотреть клан [${original.prefix}] ${original.name}`, exact: true }).click();
    assert.equal(await page.locator("#clanPreviewDialog[open]").count(), 0);
    await page.locator("#clanDialog .clan-league-row").getByRole("button", { name: label, exact: true }).click();
    await page.locator("#clanPreviewDialog .clan-member").first().waitFor();
    await page.locator("#clanPreviewDialog .booster-close").click();
    await page.locator("#clanDialog .clan-nav").getByRole("button", { name: "Чат", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".clan-history-entry").length >= 3);
    const history = await page.locator(".clan-history-text").allTextContents();
    assert.ok(history.some(t => t.includes("Глава 0 назначила")), history.join("\n"));
    assert.ok(history.some(t => t.includes("Участница вступила")));
    assert.ok(history.some(t => t.includes("Странник вступил(а)")));
    const forms = await page.evaluate(() => {
      const text = window.KillexChat.ClanChat.prototype.historyText;
      return ["male", "female", "unspecified"].map(gender => text({ action: "transfer", actor: { name: "A", gender }, target: { name: "Б" } }));
    });
    assert.deepEqual(forms, ["A передал руководство Б и стал участником.", "A передала руководство Б и стала участницей.", "A передал(а) руководство Б и стал(а) участником."]);
    await page.screenshot({ path: path.join(out, "history-gender.png") });
    await page.locator("#clanDialog .clan-nav").getByRole("button", { name: "Мой клан", exact: true }).click();
    await page.locator(`[data-member-id="${f.member.profile.id}"] .clan-member-gear`).click();
    const actions = await page.locator(".clan-role-actions button").allTextContents();
    assert.deepEqual(actions.slice(0, 2), ["Назначить управляющим", "Назначить офицером"]);
    await page.screenshot({ path: path.join(out, "member-actions.png") });
    await page.locator(".clan-member-dialog .booster-close").click();
    await page.locator("#clanDialog").getByRole("button", { name: "Закрыть кланы", exact: true }).click();
    await page.locator("#rankingsButton").click();
    await page.getByRole("button", { name: "Топ кланов", exact: true }).click();
    const rankRow = page.locator('.clan-ranking-row[data-clan-id="' + f.opponent + '"]');
    await rankRow.waitFor();
    assert.equal(await rankRow.locator(".clan-rank-name").getAttribute("title"), null);
    await rankRow.locator(".clan-view-link").focus(); await page.keyboard.press("Enter");
    await page.locator("#clanPreviewDialog .clan-member").first().waitFor();
    await page.locator("#clanPreviewDialog .booster-close").click();
    const ownRank = page.locator('.clan-ranking-row[data-clan-id="' + f.own + '"]');
    await ownRank.locator(".clan-view-link").click();
    await page.waitForFunction(() => window.KillexWindows.top()?.id === "clanDialog");
    assert.equal(await page.locator("#clanPreviewDialog[open]").count(), 0);
    assert.deepEqual(ownPreviewRequests, []);
    assert.deepEqual(errors, []);
    console.log("PASS: first-entry/save/skip/reload, foreign clan battle/league/ranking links, public read-only UI, gender, role order, desktop/mobile.");
  } finally { clearInterval(timer); await browser?.close(); await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
