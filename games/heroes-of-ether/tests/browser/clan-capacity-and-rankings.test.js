/* Визуальная проверка клана, рейтинга, значков сети и уведомления о награде. */
"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { chromium } = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { ClanService } = require("../../src/server/clans/clan-service");
const { createGameServer } = require("../../src/server/game-server");
const { Arena } = require("../../src/server/arena/arena-simulation");
const { xpForLevel } = require("../../src/server/progression/experience-progression");
const profiles = new ProfileStore(),
  clans = new ClanService(profiles);
const users = Array.from({ length: 22 }, (_, i) => {
  const u = profiles.open(),
    p = profiles.find(u.token);
  p.name = i === 0 ? "Клановый лидер" : "Игрок " + String(i).padStart(2, "0");
  p.level = 12;
  p.progress.xp = xpForLevel(12);
  p.wallet.coins = 5000;
  p.greatness = 2000 - i * 20;
  return u;
});
const act = (u, action, fields = {}) =>
  clans.mutate(u.token, { action, requestId: randomUUID(), ...fields });
act(users[0], "create", {
  name: "Проверка клана",
  prefix: "UI",
  emblem: "astral",
  privacy: "open",
});
const clanId = profiles.find(users[0].token).clanId;
for (const u of users.slice(1, 10)) act(u, "apply", { clanId });
act(users[0], "edit", { clanId, privacy: "closed" });
profiles.data.clans[clanId].xp = 12390;
const app = createGameServer({ profiles, autoTick: false, arena: new Arena({ etherCount: 0 }) });
const artifacts = path.resolve(__dirname, "../artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let browser;
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addCookies([{ name: "sferorumiya_session", value: users[0].token, url }]);
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(r.status() + " " + r.url());
    });
    await page.goto(url);
    await page.locator("#progressLevel").filter({ hasText: "12" }).waitFor();
    await page.locator("#clanSection").click();
    await page.locator("#clanDialog .clan-xp-track").waitFor();
    assert.equal(await page.locator("#clanDialog .clan-wallet").count(), 0);
    assert.equal(await page.locator("#clanDialog .clan-application-badge").count(), 0);
    assert.equal(await page.locator("#clanDialog .clan-applications-button").innerText(), "Заявки");
    assert.match(
      await page.locator("#clanDialog .clan-xp-track").getAttribute("title"),
      /12.?390 \/ 30.?000/,
    );
    assert.doesNotMatch(await page.locator("#clanDialog .clan-level").innerText(), /12.?390/);
    assert.doesNotMatch(await page.locator("#clanDialog").innerText(), /величи[еяюи]/iu);
    assert.equal(
      await page.locator("#clanDialog .clan-member .player-online-indicator").count(),
      10,
    );
    assert.equal(
      await page
        .locator('#clanDialog .clan-member .player-online-indicator[data-online="true"]')
        .count(),
      1,
    );
    await page.screenshot({ path: path.join(artifacts, "clan-ui-members.png") });
    act(users[10], "apply", { clanId });
    await page.getByRole("button", { name: "Обновить", exact: true }).click();
    await page.locator(".clan-application-badge").waitFor();
    assert.equal(await page.locator(".clan-application-badge").innerText(), "1");
    await page.getByRole("button", { name: "Настройки клана", exact: true }).click();
    assert.equal(await page.locator(".clan-crest-choice.clan-crest-locked:disabled").count(), 3);
    await page.screenshot({ path: path.join(artifacts, "clan-frames-level-lock.png") });
    await page.getByRole("button", { name: "Назад", exact: true }).click();
    await page.getByRole("button", { name: "О лигах", exact: true }).click();
    const header = await page
      .locator("#leagueInfoDialog")
      .evaluate((d) => ({
        border: getComputedStyle(d).borderImageSource,
        background: getComputedStyle(d.querySelector("header")).backgroundImage,
      }));
    assert.equal(header.border, "none");
    assert.match(header.background, /gradient/);
    await page.screenshot({ path: path.join(artifacts, "clan-league-header.png") });
    await page.locator("#leagueInfoDialog .booster-close").click();
    await page.locator("#clanDialog > .interface-header .booster-close").click();
    await page.locator("#rankingsButton").click();
    await page.locator("#topsDialog .clan-ranking-player").first().waitFor();
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(150);
      const layout = await page.locator("#topsDialog").evaluate((d) => {
        const table = d.querySelector(".ranking-table"),
          rows = [...table.children],
          bounds = table.getBoundingClientRect();
        const tabs = [...d.querySelectorAll(".tops-sort button")].map((b) => {
          const r = b.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        });
        return {
          rowCount: rows.length,
          scroll: table.scrollHeight - table.clientHeight,
          last: rows.at(-1).getBoundingClientRect().bottom,
          tableBottom: bounds.bottom,
          dialogBottom: d.getBoundingClientRect().bottom,
          height: innerHeight,
          tabs,
        };
      });
      assert.equal(layout.rowCount, 10, JSON.stringify(size));
      assert.ok(layout.scroll <= 1, JSON.stringify({ size, layout }));
      assert.ok(
        layout.last <= layout.tableBottom + 1 && layout.last <= size.height,
        JSON.stringify({ size, layout }),
      );
      assert.ok(
        layout.tabs.every(
          (t) =>
            Math.abs(t.y - layout.tabs[0].y) < 1 &&
            Math.abs(t.w - layout.tabs[0].w) < 1 &&
            Math.abs(t.h - layout.tabs[0].h) < 1,
        ),
      );
      await page.screenshot({ path: path.join(artifacts, `tops-ten-rows-${size.width}.png`) });
    }
    assert.doesNotMatch(await page.locator("#topsDialog").innerText(), /величи[еяюи]/iu);
    assert.equal(
      await page.locator('#topsDialog .player-online-indicator[data-online="true"]').count(),
      1,
    );
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.locator("#topsDialog .booster-close").click();
    const player = profiles.find(users[0].token);
    player.progress.xp = xpForLevel(13) - 1;
    profiles.applyArenaProgress(
      randomUUID(),
      [
        { profileId: player.id, type: "lifeStarted", lifeId: "reward-life" },
        { profileId: player.id, type: "survivalMinute", mass: 1000, minutes: 1 },
        {
          profileId: player.id,
          type: "lifeEnded",
          lifeId: "reward-life",
          durationSeconds: 60,
          reason: "left",
        },
      ],
      Date.now(),
    );
    await page.evaluate(async () => {
      const response = await fetch("/api/profile"),
        data = await response.json();
      document.dispatchEvent(new CustomEvent("killex:profile", { detail: data.profile }));
    });
    await page.locator("#levelToast").waitFor();
    assert.match(
      await page.locator("#levelToast").innerText(),
      /Уровень повышен![\s\S]*\+10[\s\S]*\+1/,
    );
    await page.screenshot({ path: path.join(artifacts, "level-coins-crystals-toast.png") });
    await page.locator("#achievementsButton").click();
    await page.locator("#achievementsDialog[open]").waitFor();
    assert.doesNotMatch(await page.locator("#achievementsDialog").innerText(), /величи[еяюи]/iu);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: clan limits, frame locks, XP tooltip, applications, presence, 10 visible ranks at four sizes, level reward toast.",
    );
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
