"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { once } = require("node:events"), { randomUUID } = require("node:crypto");
const { chromium } = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { ClanService } = require("../../src/server/clans/clan-service");
const history = require("../../src/server/clans/member-history");
const { createGameServer } = require("../../src/server/game-server");
const { Arena } = require("../../src/server/arena/arena-simulation");
const { xpForLevel } = require("../../src/server/progression/experience-progression");
const out = path.resolve(__dirname, "../../../../artifacts/clan-history-hook-20261108");
fs.mkdirSync(out, { recursive: true });
const profiles = new ProfileStore(), clans = new ClanService(profiles);
function user(name) {
  const u = profiles.open(), p = profiles.find(u.token);
  p.name = name; p.level = 12; p.progress.xp = xpForLevel(12); p.wallet.coins = 10000;
  return u;
}
const a = user("Лунный рыцарь"), b = user("Звёздный страж");
const act = (u, action, extra = {}) => clans.mutate(u.token, { action, requestId: randomUUID(), ...extra });
act(a, "create", { name: "Хранители", prefix: "LOG", emblem: "astral", privacy: "open" });
const clanId = profiles.find(a.token).clanId;
act(b, "apply", { clanId });
for (let i = 0; i < 45; i++) act(a, "role", { clanId, memberId: b.profile.id, role: i % 2 ? "member" : "officer" });
const pa = profiles.find(a.token);
pa.inventory.freeze = 10; pa.inventory.candy = 10; pa.quickSlots = ["freeze", "candy"];
const app = createGameServer({ profiles, arena: new Arena({ etherCount: 0 }), autoTick: false, testBots: { enabled: false } });
let browser, timer;
async function until(fn) {
  for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 30)); }
  assert.fail("Expected server action was not received");
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1"); await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    timer = setInterval(() => app.broadcast(), 50);
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: "sferorumiya_session", value: a.token, url }]);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(() => {
      window.sentActions = [];
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        if (typeof data === "string") { try {
          const m = JSON.parse(data);
          if (["move", "split", "feed", "useBooster"].includes(m.type)) window.sentActions.push(m);
        } catch {} }
        return send.call(this, data);
      };
    });
    await page.goto(url); await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page.locator(".daily-login-done").click();
    await page.locator("#clanSection").click();
    await page.locator("#clanDialog .clan-nav").getByRole("button", { name: "Чат", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".clan-history-entry").length === 40);
    const left = await page.locator(".clan-chat").boundingBox(), right = await page.locator(".clan-member-history").boundingBox();
    assert.ok(right.x >= left.x + left.width && Math.abs(right.y - left.y) < 2);
    await page.locator(".clan-chat .chat-input").fill("История участников теперь рядом с чатом.");
    await page.locator(".clan-chat .chat-input").press("Enter");
    await page.getByRole("button", { name: "Ранее", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".clan-history-entry").length === 47);
    assert.equal(await page.getByRole("button", { name: "Ранее", exact: true }).isVisible(), false);
    await page.evaluate(() => { window.historyFirst = document.querySelector(".clan-history-entry"); });
    await page.waitForTimeout(3200);
    assert.ok(await page.evaluate(() => window.historyFirst === document.querySelector(".clan-history-entry")), "unchanged polling must not rebuild history");
    act(a, "role", { clanId, memberId: b.profile.id, role: "manager" });
    await page.waitForFunction(() => document.querySelectorAll(".clan-history-entry").length === 48);
    assert.match(await page.locator(".clan-history-entry").first().innerText(), /Управляющий/);
    for (const theme of ["", "visual", "prism", "glass"]) {
      await page.evaluate(t => { document.documentElement.dataset.uiTheme = t;
        document.getElementById("clanDialog").dataset.uiTheme = t;
      }, theme);
      await page.screenshot({ path: path.join(out, `history-${theme || "classic"}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const smallLeft = await page.locator(".clan-chat").boundingBox(), smallRight = await page.locator(".clan-member-history").boundingBox();
    assert.ok(smallRight.y >= smallLeft.y + smallLeft.height && smallRight.width <= 390);
    await page.screenshot({ path: path.join(out, "history-mobile.png") });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("#clanDialog .booster-close").click();
    await page.locator("#playButton").click(); await page.locator("#arena").waitFor({ state: "visible" });
    const player = [...app.arena.players.values()].find(p => p.profileId === a.profile.id);
    assert.ok(player); player.protectedUntil = 0;
    app.arena.gainMass(player, 1000); app.broadcast();
    await page.waitForFunction(() => !document.querySelector('.booster-quick [data-slot="1"]').disabled);
    await page.waitForTimeout(1500);
    const center = { x: player.x, y: player.y };
    await page.mouse.move(100, 100);
    await page.locator('.booster-quick [data-slot="1"]').hover();
    await page.keyboard.press("KeyA");
    await until(() => profiles.byId(a.profile.id).inventory.freeze === 9);
    const shot = await page.evaluate(() => window.sentActions.filter(m => m.type === "useBooster").at(-1));
    assert.ok(shot.aimY > center.y + 100, "HUD hover must aim downward, not to last canvas point");
    await page.locator('.booster-quick [data-slot="6"]').hover();
    await page.keyboard.press("Space");
    const split = await page.evaluate(() => {
      const i = window.sentActions.findLastIndex(m => m.type === "split");
      return { split: window.sentActions[i], move: window.sentActions.slice(0, i).findLast(m => m.type === "move") };
    });
    assert.ok(split.split && split.move.y > center.y + 100, "disabled HUD slot must update split direction");
    await page.keyboard.press("KeyW");
    const feed = await page.evaluate(() => window.sentActions.findLast(m => m.type === "feed"));
    assert.ok(feed?.y > center.y + 100);
    const candy = profiles.byId(a.profile.id).inventory.candy;
    await page.locator('.booster-quick [data-slot="2"]').click();
    await page.waitForTimeout(150);
    assert.equal(profiles.byId(a.profile.id).inventory.candy, candy, "desktop mouse cannot activate booster");
    await page.waitForTimeout(1500);
    const aimBeforeChat = await page.evaluate(() => window.sentActions.filter(m => m.type === "move").at(-1));
    await page.locator(".arena-chat .chat-input").hover();
    await page.locator(".arena-chat .chat-input").fill("Проверка");
    await page.keyboard.press("KeyA");
    await page.waitForTimeout(150);
    assert.equal(profiles.byId(a.profile.id).inventory.freeze, 9, "typing must not activate boosters");
    const aimAfterChat = await page.evaluate(() => window.sentActions.filter(m => m.type === "move").at(-1));
    // Camera easing can still change world coordinates for the same screen point.
    // Hovering the right-hand chat must not redirect the player to that panel.
    assert.ok(Math.hypot(aimAfterChat.x - aimBeforeChat.x, aimAfterChat.y - aimBeforeChat.y) < 120);
    assert.deepEqual(errors, []);
    await context.close();
    const touchUser = user("Сенсорный игрок"), touchProfile = profiles.find(touchUser.token);
    touchProfile.inventory.candy = 10; touchProfile.inventory.freeze = 10;
    touchProfile.quickSlots = ["candy", "freeze"];
    const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await touchContext.addCookies([{ name: "sferorumiya_session", value: touchUser.token, url }]);
    const touchPage = await touchContext.newPage();
    touchPage.on("pageerror", e => errors.push(e.message));
    await touchPage.goto(url);
    await touchPage.waitForFunction(() => !document.getElementById("playButton").disabled);
    await touchPage.locator(".daily-login-done").tap();
    await touchPage.locator("#playButton").tap();
    await touchPage.waitForFunction(() => !document.querySelector('.booster-quick [data-slot="1"]').disabled);
    [...app.arena.players.values()].find(p => p.profileId === touchUser.profile.id).protectedUntil = 0;
    await touchPage.locator('.booster-quick [data-slot="1"]').tap();
    await until(() => profiles.byId(touchUser.profile.id).inventory.candy === 9);
    await touchPage.setViewportSize({ width: 1366, height: 900 });
    await touchPage.locator('.booster-quick [data-slot="2"]').tap();
    await touchPage.locator(".booster-cancel").waitFor({ state: "visible" });
    await touchPage.locator("#game").tap({ position: { x: 900, y: 400 } });
    await until(() => profiles.byId(touchUser.profile.id).inventory.freeze === 9);
    assert.deepEqual(errors, []);
    await touchContext.close();
    fs.writeFileSync(path.join(out, "browser-result.json"), JSON.stringify({ clanHistory: "desktop/mobile/paging/live-poll passed", aim: "HUD projectile/split/feed/disabled slots passed", mouseActivation: false, touchActivation: "mass/projectile passed", pageErrors: errors }, null, 2));
    console.log("PASS: clan history desktop/mobile, paging, polling; HUD aim for booster/Space/W; mouse/chat exclusion; touch activation");
  } finally { clearInterval(timer); await browser?.close(); await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
