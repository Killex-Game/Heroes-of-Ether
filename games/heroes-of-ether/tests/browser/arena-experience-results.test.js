/* Итоги арены: заполненная шкала при лимите опыта и обычный прогресс после нового входа. */
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { once } = require("node:events");
const { chromium } = require("playwright");
const { createGameServer } = require("../../src/server/game-server");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { xpForLevel } = require("../../src/server/progression/experience-progression");

let browser;
let clock = 5000;
const app = createGameServer({
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  now: () => clock,
  rateNow: () => performance.now(),
});
const artifacts = path.resolve(__dirname, "../artifacts");
fs.mkdirSync(artifacts, { recursive: true });

(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(response.status() + " " + response.url());
    });
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const { profile } = await (await context.request.get(url + "/api/profile")).json();
    const saved = () => app.profiles.byId(profile.id);
    const enter = async () => {
      await page.locator("#playButton").click();
      await page.locator("#arena").waitFor({ state: "visible" });
      return [...app.arena.players.values()].find((player) => player.profileId === profile.id);
    };
    const award = (xp) => {
      // При массе 1500 одна минута даёт 3 опыта; прогресс проходит штатный серверный лимит.
      app.profiles.applyArenaProgress(
        "xp-ui-" + clock++,
        [{ type: "survivalMinute", profileId: profile.id, mass: 1500, minutes: xp / 3 }],
        Date.now(),
      );
    };
    const leave = async () => {
      await page.locator("#leaveButton").click();
      await page.locator("#leaveYes").click();
      await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
    };
    const returnToLobby = async () => {
      await page.locator("#lifeLobby").click();
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    };
    const fullBar = async () => {
      assert.equal(await page.locator("#lifeXpFill").evaluate((el) => el.style.width), "100%");
      assert.equal(await page.locator("#lifeXpBar").getAttribute("aria-valuenow"), "100");
      assert.equal(await page.locator("#lifeXpBar").getAttribute("aria-valuemax"), "100");
      assert.equal(await page.locator("#lifeXp").textContent(), "Лимит опыта достигнут");
    };

    await enter();
    award(15);
    await leave();
    assert.equal(await page.locator("#lifeXpFill").evaluate((el) => el.style.width), "3%");
    assert.equal(await page.locator("#lifeXp").textContent(), "15 / 500 опыта");
    await returnToLobby();

    // Переход 25 → 26 меняет стоимость следующего уровня с 500 на 1000.
    saved().progress.xp = xpForLevel(25) + 490;
    saved().level = 25;
    await enter();
    award(15);
    await leave();
    await fullBar();
    assert.equal(await page.locator("#lifeLevel").textContent(), "Уровень 26");
    assert.equal(saved().progress.lastLife.earnedXp, 10);
    await page.locator("#lifeResultDialog").screenshot({
      path: path.join(artifacts, "arena-experience-limit.png"),
    });
    await returnToLobby();
    assert.equal(await page.locator("#xpFill").evaluate((el) => el.style.width), "0%");
    assert.equal(await page.locator("#progressXp").textContent(), "0 / 1 000 опыта");
    await enter();
    award(15);
    await leave();
    assert.equal(await page.locator("#lifeXpFill").evaluate((el) => el.style.width), "1.5%");
    assert.equal(await page.locator("#lifeXp").textContent(), "15 / 1000 опыта");
    await returnToLobby();

    // При поглощении показываем новый заголовок и отключённое продолжение.
    saved().progress.xp = xpForLevel(26) - 1;
    saved().level = 25;
    const player = await enter();
    award(3);
    const opponentContext = await browser.newContext();
    const opponentPage = await opponentContext.newPage();
    await opponentPage.goto(url);
    await opponentPage.waitForFunction(() => !document.getElementById("playButton").disabled);
    await opponentPage.locator("#playButton").click();
    await opponentPage.locator("#arena").waitFor({ state: "visible" });
    const opponent = [...app.arena.players.values()].find((p) => p.profileId !== profile.id);
    for (const [p, mass] of [
      [player, 10],
      [opponent, 400],
    ]) {
      Object.assign(p, {
        mass,
        radius: radiusForMass(mass),
        x: 800,
        y: 800,
        targetX: 800,
        targetY: 800,
        protectedUntil: 0,
      });
    }
    clock += 3000;
    app.tick();
    await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
    await fullBar();
    assert.equal(await page.locator("#lifeResultTitle").textContent(), "Вас съели");
    assert.equal(await page.locator(".life-result-stats dt").first().textContent(), "Время игры");
    assert.equal(await page.locator("#continueLife").count(), 0);
    assert.equal(await page.locator("#lifeResultStatus").textContent(), "");
    assert.equal(await page.locator("#lifeResultStatus").isVisible(), false);
    assert.equal(await page.locator("#lifeResultDialog").isVisible(), true);
    assert.equal(player.dead, true);
    await page
      .locator("#lifeResultDialog")
      .screenshot({ path: path.join(artifacts, "arena-eaten-result.png") });
    await returnToLobby();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: partial XP, cap/level-up, cost-band transition, lobby reset, death and lobby-only exit.",
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
