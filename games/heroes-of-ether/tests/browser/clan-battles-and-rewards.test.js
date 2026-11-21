/* Браузерный сценарий: clan battles and rewards. */
"use strict";
// Isolated world, fake Moscow clock. Never reads or writes the live profiles.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { chromium } = require("playwright"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { xpForLevel } = require("../../src/server/progression/experience-progression"),
  kit = require("../../public/shared/clan-crest-rules"),
  chests = require("../../src/server/clans/clan-chest-rewards");
const artifacts = path.resolve(__dirname, "../artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let at = Date.parse("2026-10-19T04:59:00Z");
const store = new ProfileStore({ now: () => at }),
  clans = new ClanService(store),
  heads = [];
const act = (u, action, extra = {}) =>
  clans.mutate(u.token, {
    action,
    clanId: store.find(u.token).clanId,
    requestId: randomUUID(),
    ...extra,
  });
function user(name) {
  const u = store.open(),
    p = store.find(u.token);
  p.level = 12;
  p.progress.xp = xpForLevel(12);
  p.wallet.coins = 10000;
  p.name = name;
  return u;
}
for (let i = 0; i < 16; i++) {
  const u = user("Глава " + i);
  act(u, "create", {
    name:
      ["Аметистовые драконы", "Золотые львы", "Стражи рассвета", "Звёздный союз"][i % 4] + " " + i,
    prefix: "C" + i,
    emblem: "astral",
    crest: {
      ...kit.DEFAULT,
      frame: kit.frames[i % 10].id,
      color: kit.colors[i].id,
      symbol: kit.symbols[i].id,
    },
    privacy: "open",
  });
  heads.push(u);
}
const clanId = store.find(heads[0].token).clanId;
const members = [heads[0]];
for (let i = 0; i < 9; i++) {
  const u = user("Воин " + i);
  act(u, "apply", { clanId });
  members.push(u);
}
act(heads[0], "role", { memberId: store.find(members[1].token).id, role: "manager" });
act(heads[0], "role", { memberId: store.find(members[2].token).id, role: "officer" });
at = Date.parse("2026-10-19T05:01:00Z");
store.refreshCompetition(at);
for (let i = 0; i < members.length; i++) {
  const p = store.find(members[i].token),
    lifeId = randomUUID();
  store.startLife(p.id, lifeId);
  for (let n = 0; n < 10 - i; n++)
    store.applyArenaProgress(
      randomUUID(),
      [{ type: "absorbed", profileId: p.id, victimProfileId: randomUUID(), gain: 1 }],
      at,
    );
  store.applyArenaProgress(
    randomUUID(),
    [{ type: "lifeEnded", profileId: p.id, lifeId, durationSeconds: 60, reason: "quit" }],
    at,
  );
}
const recruit = user("Новобранец");
act(recruit, "apply", { clanId });
const pair = store.data.competition.day.pairs.find((p) => p.a === clanId || p.b === clanId),
  opponentId = pair.a === clanId ? pair.b : pair.a,
  opponent = heads.find((u) => store.find(u.token).clanId === opponentId);
const enemyProfile = store.find(opponent.token),
  enemyLife = randomUUID();
store.startLife(enemyProfile.id, enemyLife);
store.applyArenaProgress(
  randomUUID(),
  [{ type: "absorbed", profileId: enemyProfile.id, victimProfileId: randomUUID(), gain: 1 }],
  at,
);
store.applyArenaProgress(
  randomUUID(),
  [
    {
      type: "lifeEnded",
      profileId: enemyProfile.id,
      lifeId: enemyLife,
      durationSeconds: 60,
      reason: "quit",
    },
  ],
  at,
);
const app = createGameServer({
  profiles: store,
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  wallNow: () => at,
  rateNow: () => performance.now(),
});
let browser;
const errors = [];
async function loaded(page) {
  await page.waitForFunction(() => !document.getElementById("playButton").disabled);
}
async function clanOpen(page) {
  await page.locator("#clanSection").click();
  await page.waitForSelector("#clanDialog[open] .clan-banner");
}
async function images(page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll("dialog[open] img")].every(
      (x) => x.complete && x.naturalWidth > 0,
    ),
  );
}
async function fit(page, selector) {
  const box = await page.locator(selector).boundingBox(),
    v = page.viewportSize();
  assert.ok(
    box.x >= -1 &&
      box.y >= -1 &&
      box.x + box.width <= v.width + 1 &&
      box.y + box.height <= v.height + 1,
    selector + " outside viewport: " + JSON.stringify(box),
  );
  assert.equal(
    await page.locator(selector).evaluate((x) => x.scrollWidth > x.clientWidth + 2),
    false,
    "horizontal overflow " + selector,
  );
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addCookies([{ name: "sferorumiya_session", value: heads[0].token, url }]);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.stack));
    page.on("response", (r) => {
      if (r.url().includes("/assets/") && !r.ok()) errors.push(r.status() + " " + r.url());
    });
    await page.addInitScript((epoch) => {
      window.battleTestNow = epoch;
      Date.now = () => window.battleTestNow;
    }, at);
    await page.goto(url);
    await loaded(page);
    await clanOpen(page);
    await images(page);
    await fit(page, "#clanDialog");
    assert.equal(await page.locator('.clan-league-row[data-promotion="true"]').count(), 3);
    assert.match(
      await page.locator(".clan-battle-countdown").innerText(),
      /До конца битвы: 15:59:00/,
    );
    await page.evaluate(() => {
      window.battleTestNow += 1000;
    });
    await page.waitForFunction(() =>
      document.querySelector(".clan-battle-countdown").textContent.endsWith("15:58:59"),
    );
    // Preview the same UI at the next opening and with senior league zones.
    const previews = await page.evaluate(async () => {
      const data = await (await fetch("/api/clans")).json(),
        ui = new window.KillexClanBattleUI({ dialog: { open: false } }),
        s = structuredClone(data.competition);
      s.battle = null;
      s.nextBattleAt = Date.now() + 1000;
      ui.battle(s, data.mine);
      const before = ui.countdown.textContent;
      window.battleTestNow += 1000;
      ui.updateCountdown();
      const opening = ui.countdown.textContent;
      const sizes = [];
      for (const [index, promote] of [
        [0, 3],
        [3, 2],
        [4, 2],
        [5, 1],
      ]) {
        s.league.index = index;
        s.group.zones.promote = promote;
        sizes.push(ui.leagues(s, data.mine).querySelectorAll('[data-promotion="true"]').length);
      }
      s.battle = { ...data.competition.battle, start: Date.now() - 1000, end: Date.now() + 1000 };
      ui.battle(s, data.mine);
      const running = ui.countdown.textContent;
      window.battleTestNow += 1000;
      ui.updateCountdown();
      const ended = ui.countdown.textContent;
      const bar = document.querySelector(".clan-battle-bar"),
        directions = [...bar.children].map(
          (el) => getComputedStyle(el, "::after").animationDirection,
        );
      ui.dialog.remove();
      return { before, opening, sizes, running, ended, directions };
    });
    assert.match(previews.before, /00:00:01/);
    assert.equal(previews.opening, "Битва начинается");
    assert.deepEqual(previews.sizes, [3, 2, 2, 1]);
    assert.equal(previews.running, "До конца битвы: 00:00:01");
    assert.equal(previews.ended, "Битва завершена");
    assert.deepEqual(previews.directions, ["normal", "reverse"]);
    assert.equal(await page.locator(".clan-league-row").count(), 16);
    assert.equal(await page.locator(".clan-member[data-reward=high]").count(), 3);
    assert.equal(await page.locator(".clan-member[data-reward=medium]").count(), 3);
    assert.match(await page.locator("#clanDialog").innerText(), /Новобранец/);
    const memberLayout = await page.locator(".clan-member").evaluateAll((rows) =>
      rows.map((row) => {
        const score = row.querySelector(".clan-member-kills"),
          gear = row.querySelector(".clan-member-gear"),
          info = row.querySelector(".clan-member-info");
        const s = score.getBoundingClientRect(),
          i = info.getBoundingClientRect(),
          r = row.getBoundingClientRect();
        return {
          value: score.textContent,
          large: parseFloat(getComputedStyle(score).fontSize) >= 26,
          right: s.left >= i.right && s.right <= r.right,
          gearFits: !gear || gear.getBoundingClientRect().left >= s.right,
          oldLabel: /киллов за битву|за неделю|Вступит в битву/.test(row.textContent),
          center: s.x + s.width / 2,
        };
      }),
    );
    assert.deepEqual(
      memberLayout.map((r) => r.value),
      ["10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "0"],
    );
    assert.ok(memberLayout.every((r) => r.large && r.right && r.gearFits && !r.oldLabel));
    assert.ok(
      Math.max(...memberLayout.map((r) => r.center)) -
        Math.min(...memberLayout.map((r) => r.center)) <
        1,
      "Battle counts align with and without a settings button",
    );
    await page.screenshot({ path: path.join(artifacts, "clan-battle-desktop.png") });
    assert.equal(await page.locator(".clan-personal-reward").getAttribute("data-state"), "preview");
    assert.match(await page.locator(".clan-personal-reward").innerText(), /Высший сундук/);
    assert.equal(await page.locator(".clan-personal-reward-claim").count(), 0);
    const timerStyle = await page.locator(".clan-battle-countdown").evaluate((t) => ({
      width: t.getBoundingClientRect().width,
      panel: t.closest(".clan-battle-panel").getBoundingClientRect().width,
      font: parseFloat(getComputedStyle(t.querySelector(".clan-countdown-value")).fontSize),
    }));
    assert.ok(
      timerStyle.width < timerStyle.panel * 0.9 && timerStyle.font >= 20,
      "Compact timer with larger digits",
    );
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1024, height: 768 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(100);
      await fit(page, "#clanDialog");
      const layout = await page.locator(".clan-battle-panel").evaluate((panel) => {
        const r = panel.getBoundingClientRect(),
          children = [...panel.children].map((c) => ({
            cls: c.className,
            ...c.getBoundingClientRect().toJSON(),
          }));
        return {
          panel: r.toJSON(),
          children,
          fits: children.every(
            (c) => c.top >= r.top && c.bottom <= r.bottom && c.left >= r.left && c.right <= r.right,
          ),
          separate: children.every((c, i) => !i || c.top >= children[i - 1].bottom),
        };
      });
      assert.ok(layout.fits && layout.separate, JSON.stringify({ size, layout }));
      await page.screenshot({
        path: path.join(artifacts, "battle-reward-preview-" + size.width + ".png"),
      });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.getByRole("button", { name: "О лигах", exact: true }).click();
    await fit(page, "#leagueInfoDialog");
    assert.equal(await page.locator(".clan-league-guide-row").count(), 6);
    await page
      .locator("#leagueInfoDialog")
      .getByRole("button", { name: "Закрыть описание лиг", exact: true })
      .click();
    // New windows cover their parents; reopening an existing lower window raises it
    // without firing its close handlers or discarding the windows underneath.
    await page.locator(".clan-member-gear").first().click();
    await page.waitForSelector(".clan-member-dialog[open]");
    const memberHeading = await page.locator(".clan-member-dialog .clan-heading").evaluate((n) => ({
      background: getComputedStyle(n).backgroundImage,
      shadow: getComputedStyle(n).boxShadow,
    }));
    assert.match(memberHeading.background, /169, 75, 197/);
    assert.match(memberHeading.shadow, /inset/);
    await page.screenshot({ path: path.join(artifacts, "member-window-stacked.png") });
    await page.evaluate(() => {
      const member = document.querySelector(".clan-member-dialog"),
        guide = document.getElementById("leagueInfoDialog");
      window.memberClosed = 0;
      member.addEventListener("close", () => window.memberClosed++);
      window.KillexWindows.open(guide);
    });
    assert.equal(
      await page.locator("#leagueInfoDialog").evaluate((d) => {
        const r = d.getBoundingClientRect();
        return d.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }),
      true,
    );
    await page.evaluate(() =>
      window.KillexWindows.open(document.querySelector(".clan-member-dialog")),
    );
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => window.memberClosed), 0);
    assert.equal(
      await page.locator(".clan-member-dialog").evaluate((d) => {
        const r = d.getBoundingClientRect();
        return d.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }),
      true,
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".clan-member-dialog").open);
    assert.equal(await page.locator("#leagueInfoDialog").evaluate((d) => d.open), true);
    assert.equal(await page.evaluate(() => window.memberClosed), 1);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("leagueInfoDialog").open);
    assert.equal(await page.locator("#clanDialog").evaluate((d) => d.open), true);
    await page.getByRole("button", { name: "Настройки клана", exact: true }).click();
    await images(page);
    await fit(page, "#clanDialog");
    const before = store.find(heads[0].token).wallet.crystals;
    await page.locator('[data-choice="f09_royal"]').click();
    await page.getByRole("button", { name: "Цвет", exact: true }).click();
    await page.locator('[data-choice="' + kit.colors[5].id + '"]').click();
    await page.getByRole("button", { name: "Символ", exact: true }).click();
    await page.locator('[data-choice="s04_dragon"]').click();
    await images(page);
    assert.equal(store.find(heads[0].token).wallet.crystals, before);
    assert.match(await page.locator("#clanForm button[type=submit]").innerText(), /50/);
    await page.screenshot({ path: path.join(artifacts, "clan-crest-editor.png") });
    await page.setViewportSize({ width: 1024, height: 768 });
    await fit(page, "#clanDialog");
    await page.screenshot({ path: path.join(artifacts, "clan-crest-1024.png") });
    await page.setViewportSize({ width: 844, height: 390 });
    await fit(page, "#clanDialog");
    await page.locator("#clanForm button[type=submit]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, "clan-crest-landscape.png") });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.locator("#clanForm button[type=submit]").click();
    await page.waitForSelector("#clanDialog .clan-banner");
    assert.equal(store.find(heads[0].token).wallet.crystals, before - 50);
    assert.equal(store.data.clans[clanId].crest.symbol, "s04_dragon");
    await page.getByRole("button", { name: "Настройки клана", exact: true }).click();
    await page.getByRole("button", { name: "Символ", exact: true }).click();
    await page.locator('[data-choice="null"]').click();
    await page.getByRole("button", { name: "Вернуть исходный", exact: true }).click();
    assert.match(
      await page.locator("#clanForm button[type=submit]").innerText(),
      /Сохранить изменения/,
    );
    await page.getByRole("button", { name: "Назад", exact: true }).click();
    assert.equal(store.find(heads[0].token).wallet.crystals, before - 50);
    await page.getByRole("button", { name: "Закрыть кланы", exact: true }).click();
    // Settle one battle and open its chest through the actual confirmation flow.
    at = Date.parse("2026-10-19T21:00:00Z");
    store.refreshCompetition(at);
    const p = store.find(heads[0].token),
      chest = p.clanChests.items[0];
    assert.ok(chest);
    assert.equal(store.data.clans[clanId].competition.wins, 1);
    await page.reload();
    await loaded(page);
    await page.evaluate((epoch) => {
      window.battleTestNow = epoch;
    }, at);
    await clanOpen(page);
    assert.equal(
      await page.locator(".clan-personal-reward").getAttribute("data-state"),
      "available",
    );
    assert.equal(store.find(heads[0].token).clanChests.items[0].stored, false);
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1024, height: 768 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(100);
      const rewardBox = await page.locator(".clan-personal-reward").boundingBox(),
        claimBox = await page.locator(".clan-personal-reward-claim").boundingBox(),
        panelBox = await page.locator(".clan-battle-panel").boundingBox();
      assert.ok(
        claimBox.x >= rewardBox.x &&
          claimBox.x + claimBox.width <= rewardBox.x + rewardBox.width &&
          claimBox.y + claimBox.height <= rewardBox.y + rewardBox.height,
        "Claim button stays inside the reward card",
      );
      assert.ok(
        rewardBox.y + rewardBox.height <= panelBox.y + panelBox.height,
        "Earned reward fits in the panel",
      );
      await page.screenshot({ path: path.join(artifacts, "battle-claim-" + size.width + ".png") });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.screenshot({ path: path.join(artifacts, "battle-reward-earned.png") });
    await page.locator(".clan-personal-reward-claim").click();
    await page.waitForFunction(
      () => document.querySelector(".clan-personal-reward")?.dataset.state === "stored",
    );
    assert.equal(await page.locator("#clanDialog").isVisible(), true);
    assert.equal(await page.locator("#boosterDialog").isVisible(), false);
    assert.equal(store.find(heads[0].token).clanChests.items.filter((c) => c.stored).length, 1);
    assert.equal(store.find(heads[0].token).clanChests.items[0].reward, undefined);
    assert.match(await page.locator(".clan-personal-reward").innerText(), /Сундук в Сокровищнице/);
    await page.reload();
    await loaded(page);
    await clanOpen(page);
    assert.equal(await page.locator(".clan-personal-reward").getAttribute("data-state"), "stored");
    assert.equal(await page.locator(".clan-personal-reward-claim").count(), 0);
    await page.getByRole("button", { name: "Закрыть кланы", exact: true }).click();
    await page.locator("#inventorySection").click();
    await page.getByRole("button", { name: "Сундуки", exact: true }).click();
    await page.getByRole("button", { name: "Сокровищница", exact: true }).click();
    const enemyContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await enemyContext.addCookies([{ name: "sferorumiya_session", value: opponent.token, url }]);
    await enemyContext.addInitScript((epoch) => {
      Date.now = () => epoch;
    }, at);
    const enemyPage = await enemyContext.newPage();
    await enemyPage.goto(url);
    await loaded(enemyPage);
    await clanOpen(enemyPage);
    assert.equal(
      await enemyPage.locator(".clan-personal-reward").getAttribute("data-state"),
      "credited",
    );
    assert.match(
      await enemyPage.locator(".clan-personal-reward").innerText(),
      /Уже начислено на баланс/,
    );
    assert.equal(await enemyPage.locator(".clan-personal-reward-claim").count(), 0);
    assert.deepEqual(
      await enemyPage.locator(".clan-personal-reward-currencies b").allTextContents(),
      ["100", "10", "1"],
    );
    await enemyPage.screenshot({ path: path.join(artifacts, "battle-reward-fixed.png") });
    await enemyContext.close();
    const card = page.locator('.clan-owned-chest[data-chest-id="' + chest.id + '"]');
    await card.getByRole("button", { name: "Открыть", exact: true }).click();
    await page
      .locator("#chestConfirmDialog")
      .getByRole("button", { name: "Нет", exact: true })
      .click();
    assert.equal(store.find(heads[0].token).clanChests.items[0].reward, undefined);
    const coins = store.find(heads[0].token).wallet.coins;
    await card.getByRole("button", { name: "Открыть", exact: true }).click();
    await page
      .locator("#chestConfirmDialog")
      .getByRole("button", { name: "Да", exact: true })
      .click();
    await page.waitForSelector("#chestRewardDialog[open]");
    await images(page);
    await fit(page, "#chestRewardDialog");
    assert.equal(store.find(heads[0].token).wallet.coins, coins);
    const reward = store.find(heads[0].token).clanChests.items[0].reward;
    await page.screenshot({ path: path.join(artifacts, "clan-chest-reward.png") });
    await page.getByRole("button", { name: "Отлично", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#chestRewardDialog").open);
    assert.equal(store.find(heads[0].token).wallet.coins, coins + reward.coins);
    assert.equal(store.find(heads[0].token).clanChests.items.length, 0);
    // A newly created clan uses the same builder, without a separate crest fee.
    const newcomer = user("Основатель"),
      newContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await newContext.addCookies([{ name: "sferorumiya_session", value: newcomer.token, url }]);
    const second = await newContext.newPage();
    second.on("pageerror", (e) => errors.push(e.stack));
    await second.goto(url);
    await loaded(second);
    await second.locator("#clanSection").click();
    await second.getByRole("button", { name: /Создать клан/ }).click();
    await second.locator("#clan-name").fill("Новый союз");
    await second.locator("#clan-prefix").fill("NEW");
    await images(second);
    await fit(second, "#clanDialog");
    await second.screenshot({ path: path.join(artifacts, "clan-crest-create.png") });
    const newCoins = store.find(newcomer.token).wallet.coins;
    await second.getByRole("button", { name: "Создать за 1500 монет", exact: true }).click();
    await second.waitForSelector("#clanDialog .clan-banner");
    assert.equal(store.find(newcomer.token).wallet.coins, newCoins - 1500);
    assert.equal(store.find(newcomer.token).wallet.crystals, 100);
    assert.deepEqual(store.data.clans[store.find(newcomer.token).clanId].crest, kit.DEFAULT);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: battle table, tiers, recruit, league guide, crest preview/save/reset/create, responsive dialogs, chest confirmation and reward claim; no browser or asset errors.",
    );
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
