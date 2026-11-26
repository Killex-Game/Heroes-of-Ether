/* Браузерный сценарий: full game flow. */
"use strict";
const { setNickname, revealCollectionItem } = require("./helpers/profile-controls");
// Дополнительная проверка. Использует уже установленный Playwright (через NODE_PATH)
// и Chrome; ничего не скачивает. Тестовые позиции задаются только объекту сервера здесь.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events");
const { chromium } = require("playwright");
const { createGameServer } = require("../../src/server/game-server");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
const { grantCoins } = require("../../scripts/development/grant-coins");
const testsDirectory = path.resolve(__dirname, "..");
const scratch = fs.mkdtempSync(path.join(testsDirectory, ".tmp-browser-"));
const artifacts = path.join(testsDirectory, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
process.env.TEMP = scratch;
process.env.TMP = scratch;
let time = 5000;
const app = createGameServer({
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  now: () => time,
  rateNow: () => performance.now(),
});
// Мир двигается вручную, но подключённые страницы получают снимки и во время UI-проверок.
const snapshots = setInterval(() => app.broadcast(), 3000);
const errors = [];
let browser;
async function until(predicate, label) {
  for (let i = 0; i < 150; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw Error("Ожидание не выполнено: " + label);
}
async function ready(page, url) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (/\/assets\/(ui|boosters|menu-icons|progression)\//.test(response.url()) && !response.ok())
      errors.push("UI asset: " + response.status() + " " + response.url());
  });
  await page.goto(url);
  await page.waitForFunction(() => !document.getElementById("playButton").disabled);
}
async function buy(page, id) {
  const action = page.locator(`[data-booster-id="${id}"] .booster-action`);
  await revealCollectionItem(page, action);
  await action.click();
  await until(
    () =>
      page
        .locator(".booster-message")
        .textContent()
        .then((s) => s.startsWith("Куплено:")),
    "покупка " + id,
  );
}
async function tick(milliseconds = 1000) {
  time += milliseconds;
  app.broadcast();
}
async function noOverlaps(page) {
  const selectors = [
    ".booster-quick",
    "#boosterBudget",
    "#joystick",
    "#settingsButton",
    "#massPanel",
  ];
  const boxes = await Promise.all(
    selectors.map((selector) => page.locator(selector).boundingBox()),
  );
  const intersects = (a, b) =>
    a &&
    b &&
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      assert.equal(
        !!intersects(boxes[i], boxes[j]),
        false,
        "Перекрытие: " + selectors[i] + " / " + selectors[j],
      );
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    browser = await chromium.launch({
      channel: process.env.SFERORUMIYA_BROWSER_CHANNEL || "chrome",
      headless: true,
    });
    const contextA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await contextA.newPage();
    await ready(page, url);
    assert.deepEqual(
      (await page.locator(".menu-tile").allTextContents()).map((text) => text.trim()),
      ["Зал славы", "События", "Инвентарь", "Гардероб", "Задания", "Магазин", "Топы", "Достижения", "Клан", "Питомцы"],
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".menu-icon,#walletStatus .currency-icon")].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    );
    assert.equal(await page.locator(".menu-icon").count(), 10);
    assert.equal(await page.locator("#walletStatus .currency-icon").count(), 3);
    assert.equal(
      await page.locator(".lobby-logo, #selectedSkinName, .arena-identity, .arena-hint").count(),
      0,
    );
    const walletBoxes = await page.locator("#walletStatus .sf-currency").evaluateAll((items) =>
      items.map((el) => ({
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      })),
    );
    assert.ok(
      walletBoxes.every(
        (b) => Math.abs(b.width - walletBoxes[0].width) < 1 && b.height === walletBoxes[0].height,
      ),
    );
    assert.equal(app.arena.players.size, 0);
    const previewProfile = JSON.stringify(app.profiles.data);
    await page.locator("#walletStatus .coins-add").click();
    assert.equal(
      await page.getByRole("tab", { name: "Монетки", exact: true }).getAttribute("aria-selected"),
      "true",
    );
    for (const [name, amount] of [
      ["Кристаллы", "415"],
      ["Эфир", "550"],
      ["Монетки", "8250"],
    ]) {
      await page.getByRole("tab", { name, exact: true }).click();
      assert.equal(await page.locator("#donationDialog").isVisible(), true);
      assert.equal(
        await page
          .locator(".donation-amount strong")
          .nth(3)
          .textContent()
          .then((s) => s.replace(/\s/g, "")),
        amount,
      );
      assert.equal(await page.locator(".donation-action:enabled").count(), 6);
    }
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#donationDialog").getAttribute("data-currency"), "crystals");
    await page.screenshot({ path: path.join(artifacts, "donation-tabs-desktop.png") });
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#walletStatus .coins-add").evaluate((e) => e === document.activeElement),
      true,
    );
    assert.equal(JSON.stringify(app.profiles.data), previewProfile);
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#skinList img")].every(
        (img) => img.complete && img.naturalWidth,
      ),
    );
    assert.equal(await page.locator("#artStatus").count(), 0);
    assert.equal(await page.locator(".promo-slot").count(), 3);
    const columns = await page.evaluate(() => ({
      banners: document.querySelector(".promo-column").getBoundingClientRect().right,
      skin: document.querySelector(".showcase").getBoundingClientRect().left,
      menu: document.querySelector(".side-nav").getBoundingClientRect().left,
      skinRight: document.querySelector(".showcase").getBoundingClientRect().right,
      buttons: [...document.querySelectorAll(".menu-tile")].map((el) => ({
        x: el.getBoundingClientRect().left,
        y: el.getBoundingClientRect().top,
      })),
    }));
    assert.ok(columns.banners < columns.skin && columns.menu > columns.skinRight);
    assert.ok(
      columns.buttons.every(
        (b, i) => b.x === columns.buttons[0].x && (!i || b.y > columns.buttons[i - 1].y),
      ),
    );
    await page.screenshot({ path: path.join(artifacts, "lobby-desktop.png"), fullPage: true });
    await page.locator("#shopSection").click();
    assert.equal(await page.locator(".booster-card").count(), 22);
    assert.equal(await page.locator(".booster-action:enabled").count(), 22);
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".booster-card img")].every(
        (img) => img.complete && img.naturalWidth,
      ),
    );
    assert.equal(
      await page
        .locator(".booster-card")
        .evaluateAll(
          (cards, icons) =>
            cards.every(
              (card) =>
                icons[card.dataset.boosterId] === card.querySelector("img").getAttribute("src"),
            ),
          Object.fromEntries([...BOOSTERS.values()].map((b) => [b.id, b.icon])),
        ),
      true,
    );
    await page.screenshot({ path: path.join(artifacts, "shop-desktop.png") });
    for (const id of ["ice_cream", "web", "colorful_shield", "speed", "meat"]) await buy(page, id);
    assert.equal(app.arena.players.size, 0);
    assert.match(await page.locator("#walletStatus").textContent(), /980 монет · 88 кристаллов/);
    await page
      .locator("#boosterDialog")
      .getByRole("button", { name: "Инвентарь", exact: true })
      .click();
    assert.equal(await page.locator('.booster-action[aria-pressed="true"]').count(), 4);
    await page.getByRole("button", { name: "Закрыть бустеры" }).click();
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    assert.match(await page.locator("#walletStatus").textContent(), /980 монет · 88 кристаллов/);
    await setNickname(page, "Лесник");
    await page.locator("#wardrobeSection").click();
    await page
      .locator("#skinList")
      .getByRole("button", { name: "Лесная хранительница", exact: true })
      .click();
    await page.getByRole("button", { name: "Закрыть гардероб" }).click();
    const profileA = (await (await contextA.request.get(url + "/api/profile")).json()).profile;
    app.profiles.byId(profileA.id).level = 12;
    app.profiles.byId(profileA.id).progress.xp =
      require("../../src/server/progression/experience-progression").xpForLevel(12);
    grantCoins(app.profiles, profileA.id, 1500); // Только изолированное хранилище теста.
    await page.locator("#clanSection").click();
    await page.getByRole("button", { name: "Создать клан", exact: true }).click();
    await page.locator("#clan-name").fill("Лесной союз");
    await page.locator("#clan-prefix").fill("ЛЕС");
    await page.locator("#clan-description").fill("Вместе исследуем Сферорумию");
    await page.getByRole("button", { name: "Символ", exact: true }).click();
    await page.locator('[data-choice="s18_oak"]').click();
    await page.screenshot({ path: path.join(artifacts, "clan-create.png") });
    await page.getByRole("button", { name: "Создать за 1500 монет", exact: true }).click();
    await until(() => app.profiles.byId(profileA.id).clanId, "создание клана");
    const clanId = app.profiles.byId(profileA.id).clanId;
    assert.equal(app.profiles.byId(profileA.id).wallet.coins, 980);
    await page.getByRole("button", { name: "Закрыть кланы" }).click();
    // Создание клана открывается поверх топов; закрываем оставшийся родительский слой.
    await page.getByRole("button", { name: "Закрыть топы" }).click();
    const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const other = await contextB.newPage();
    await ready(other, url);
    await setNickname(other, "Феникс");
    await other.locator("#wardrobeSection").click();
    await other
      .locator("#skinList")
      .getByRole("button", { name: "Вестница рассвета", exact: true })
      .click();
    await other.getByRole("button", { name: "Закрыть гардероб" }).click();
    await other.locator("#shopSection").click();
    await buy(other, "web");
    await other.getByRole("button", { name: "Закрыть бустеры" }).click();
    const clanApplicant = (await (await contextB.request.get(url + "/api/profile")).json()).profile;
    app.profiles.byId(clanApplicant.id).level = 12;
    app.profiles.byId(clanApplicant.id).progress.xp =
      require("../../src/server/progression/experience-progression").xpForLevel(12);
    await other.locator("#clanSection").click();
    await other.getByRole("button", { name: "Топ кланов", exact: true }).click();
    await other.getByRole("button", { name: "Подать заявку · 50 монет", exact: true }).click();
    await until(() => app.profiles.data.clans[clanId].applications.length === 1, "заявка в клан");
    await other.screenshot({ path: path.join(artifacts, "clan-top.png") });
    await other.getByRole("button", { name: "Закрыть топы" }).click();
    await page.locator("#clanSection").click();
    await page.locator(".clan-applications-button").click();
    await page.getByRole("button", { name: "Принять", exact: true }).click();
    await until(() => app.profiles.data.clans[clanId].members.length === 2, "принятие участника");
    await page.getByRole("button", { name: "Настройки клана", exact: true }).click();
    await page.locator("#clan-prefix").fill("ЛЕС1");
    await page.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
    await page.locator(".clan-banner h3").filter({ hasText: "ЛЕС1" }).waitFor();
    await page.screenshot({ path: path.join(artifacts, "clan-home.png") });
    await page.getByRole("button", { name: "Закрыть кланы" }).click();
    // Следующий независимый сценарий проверяет арену с первым уровнем и уже существующим членством.
    for (const id of [profileA.id, clanApplicant.id]) {
      const p = app.profiles.byId(id);
      p.level = 1;
      p.progress.xp = 0;
    }
    let delayedLoadout;
    await page.route(
      "**/api/profile/loadout",
      (route) => {
        delayedLoadout = route;
      },
      { times: 1 },
    );
    await page.locator("#playButton").click();
    await until(() => !!delayedLoadout, "ожидание сохранения перед входом");
    await page.locator("#cancelJoin").click();
    await delayedLoadout.continue();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    assert.equal(app.arena.players.size, 0, "Отмена во время сохранения не открывает арену");
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    await until(() => app.arena.players.size === 1, "первый игрок");
    const a = [...app.arena.players.values()][0];
    await until(
      () =>
        page
          .locator("#lifeTime")
          .textContent()
          .then((s) => s === "00:00:01"),
      "секунды идут сразу после входа, между снимками сервера",
    );
    assert.equal(a.skinId, "forest-spirit");
    assert.equal(a.clanPrefix, "ЛЕС1");
    assert.equal(a.level, 1);
    assert.equal(await page.getByRole("button", { name: "Открыть инвентарь на арене" }).count(), 0);
    assert.equal(await page.locator("#boosterDialog").isVisible(), false);
    const secondTab = await contextA.newPage();
    await ready(secondTab, url);
    await secondTab.locator("#shopSection").click();
    assert.equal(await secondTab.locator('.booster-action[data-action="shop"]:enabled').count(), 0);
    assert.equal(await secondTab.locator(".booster-shop-lock").isVisible(), true);
    const blocked = await secondTab.evaluate(async () => {
      const response = await fetch("/api/shop/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boosterId: "candy", requestId: crypto.randomUUID() }),
      });
      return { status: response.status, body: await response.json() };
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, "ARENA_ACTIVE");
    await secondTab.screenshot({ path: path.join(artifacts, "shop-locked.png") });
    await other.locator("#playButton").click();
    await other.locator("#arena").waitFor({ state: "visible" });
    let b = [...app.arena.players.values()].find((p) => p.id !== a.id);
    assert.equal(b.skinId, "sun-phoenix");
    assert.equal(b.clanPrefix, "ЛЕС1");
    await other.keyboard.press("KeyF");
    assert.equal(await other.locator("#boosterDialog").isVisible(), false);
    assert.equal(await other.locator('[data-slot="4"]').isDisabled(), true);
    for (const [p, x] of [
      [a, 500],
      [b, 650],
    ])
      Object.assign(p, { x, y: 500, targetX: x, targetY: 500, protectedUntil: 0 });
    await tick(5000);
    await page.waitForTimeout(350);
    await other.waitForTimeout(350);
    assert.match(await other.locator("#leaderList").textContent(), /\[ЛЕС1\] Феникс \[1\]/);
    assert.equal(await other.locator("#leadersTitle").textContent(), "Топ игроков");
    assert.equal(await other.locator("#onlineCount").textContent(), "2 игрока");
    await page.locator('[data-slot="1"]').click();
    await until(() => a.mass === 210, "масса после мороженого");
    await until(
      () =>
        page
          .locator("#mass")
          .textContent()
          .then((s) => s === "210"),
      "масса в интерфейсе",
    );
    await tick();
    await until(
      () => page.locator('[data-slot="4"]').isEnabled(),
      "клиент получил окончание перезарядки",
    );
    await page.keyboard.press("KeyF");
    await until(() => a.effects.speed > time, "ускорение с клавиатуры");
    await tick();
    await page.locator('[data-slot="3"]').click();
    await until(() => a.effects.colorful_shield > time, "щит");
    await other.mouse.move(900, 500);
    await other.keyboard.press("KeyA");
    await until(() => app.arena.combat.shots.length === 1, "паутина запущена курсором");
    const firstTrap = app.arena.combat.shots[0];
    app.arena.combat.update(time + 3000);
    Object.assign(a, { x: firstTrap.x, y: firstTrap.y });
    app.arena.combat.update(time + 3001);
    assert.equal(app.arena.combat.shots.length, 0);
    assert.equal(a.effects.web, undefined);
    await tick(20001);
    await until(() => other.locator('[data-slot="1"]').isEnabled(), "готовность следующей ловушки");
    await other.keyboard.press("KeyA");
    await until(() => app.arena.combat.shots.length === 1, "повторный запуск ловушки");
    const secondTrap = app.arena.combat.shots[0];
    time += 3000;
    app.arena.combat.update(time);
    Object.assign(a, { x: secondTrap.x, y: secondTrap.y });
    app.arena.combat.update(time);
    app.broadcast();
    await until(() => a.effects.web > time, "ловушка попала в реального браузерного игрока");
    await page.screenshot({ path: path.join(artifacts, "arena-desktop.png") });
    await other.screenshot({ path: path.join(artifacts, "arena-other-player.png") });
    assert.equal(a.effects.web, time + 7000);
    await tick(7000);
    // Начальное состояние только в памяти теста: килл завершит две степени, уровень — при выходе.
    Object.assign(app.profiles.byId(profileA.id).progress, {
      xp: 485,
      kills: 9,
      absorbedMass: 955,
    });
    await other.locator("#leaveButton").click(); // Поглощение во время вопроса отменяет подтверждение.
    Object.assign(a, {
      x: 500,
      y: 500,
      targetX: 500,
      targetY: 500,
      mass: 400,
      radius: radiusForMass(400),
      protectedUntil: 0,
    });
    Object.assign(b, {
      x: 500,
      y: 500,
      targetX: 500,
      targetY: 500,
      mass: 57,
      radius: radiusForMass(57),
      protectedUntil: 0,
    });
    app.tick();
    assert.equal(a.mass, 445);
    assert.equal(b.dead, true);
    await other.locator("#lifeResultDialog").waitFor({ state: "visible" });
    assert.equal(await other.locator("#leaveConfirmDialog").isVisible(), false);
    assert.match(await other.locator("#lifeKiller").textContent(), /\[ЛЕС1\] Лесник \[1\]/);
    assert.equal(await other.locator("#lifeDuration").textContent(), "00:00:37");
    assert.equal(await other.locator("#lifeEarned").textContent(), "+0");
    await other.keyboard.press("Escape");
    assert.equal(await other.locator("#lifeResultDialog").isVisible(), true);
    assert.equal(
      app.arena.snapshot(time).players.some((p) => p.id === b.id),
      false,
    );
    assert.equal(a.level, 1);
    assert.equal(app.profiles.byId(profileA.id).greatness, 2);
    assert.equal(app.profiles.byId(profileA.id).progress.xp, 485);
    await until(
      () =>
        page
          .locator("#arenaXp")
          .textContent()
          .then((s) => s === "макс"),
      "предел опыта до выхода",
    );
    await until(
      () =>
        page
          .locator("#arenaKills")
          .textContent()
          .then((s) => s === "1"),
      "серверный килл рядом с массой",
    );
    await other.screenshot({ path: path.join(artifacts, "life-result-desktop.png") });
    assert.equal(await other.locator("#continueLife").count(), 0);
    await other.locator("#lifeLobby").click();
    await other.waitForFunction(() => !document.getElementById("playButton").disabled);
    await other.locator("#playButton").click();
    await other.locator("#arena").waitFor({ state: "visible" });
    b = [...app.arena.players.values()].find((p) => p.id !== a.id);
    await until(
      () =>
        other
          .locator("#mass")
          .textContent()
          .then((s) => s === "10"),
      "новая жизнь после входа из лобби",
    );
    assert.equal(b.dead, false);
    assert.equal(b.lifeStartedAt, time);
    assert.equal(await other.locator("#lifeTime").textContent(), "00:00:00");
    assert.equal(await other.locator("#arenaKills").textContent(), "0");
    Object.assign(a, {
      mass: 1500,
      radius: radiusForMass(1500),
      x: 500,
      y: 500,
      targetX: 500,
      targetY: 500,
    });
    Object.assign(b, { x: 1800, y: 1200, targetX: 1800, targetY: 1200 });
    time = a.lifeStartedAt + 60000;
    await page.waitForTimeout(200);
    app.tick();
    await until(
      () =>
        page
          .locator("#lifeTime")
          .textContent()
          .then((s) => s === "00:01:00"),
      "таймер полной минуты",
    );
    assert.equal(app.profiles.byId(profileA.id).progress.xp, 485);
    assert.equal(app.profiles.byId(profileA.id).progress.session.xp, 15);
    const beforeExitMass = a.mass;
    await page.screenshot({ path: path.join(artifacts, "progress-arena.png") });
    time = a.lifeStartedAt + 120001; // Полная минута на выходе, без промежуточного тика.
    const beforeExitSerial = a.spawnSerial;
    await page.locator("#leaveButton").click();
    await page.locator("#leaveConfirmDialog").waitFor({ state: "visible" });
    await page.screenshot({ path: path.join(artifacts, "leave-confirm-desktop.png") });
    const itemsBeforeCancel = JSON.stringify(app.profiles.byId(profileA.id).inventory);
    await page.keyboard.press("KeyA");
    assert.equal(JSON.stringify(app.profiles.byId(profileA.id).inventory), itemsBeforeCancel);
    await page.locator("#leaveNo").click();
    assert.equal(a.dead, false);
    assert.equal(a.mass, beforeExitMass);
    assert.equal(a.spawnSerial, beforeExitSerial);
    assert.equal(app.profiles.byId(profileA.id).progress.xp, 485);
    await page.mouse.move(950, 450);
    await until(() => a.targetX > a.x, "движение мышью после отказа от выхода");
    await page.locator("#leaveButton").click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#leaveConfirmDialog").isVisible(), false);
    assert.equal(a.dead, false);
    await page.locator("#levelToast").evaluate((el) => {
      window.__toastVisibility = [];
      new MutationObserver(() =>
        window.__toastVisibility.push({ visible: !el.hidden, at: performance.now() }),
      ).observe(el, { attributes: true, attributeFilter: ["hidden"] });
    });
    assert.equal(
      await page.locator("#arena").isVisible(),
      true,
      (await page.locator("#lobbyStatus").textContent()) + " " + JSON.stringify(errors),
    );
    await page.locator("#leaveButton").click();
    await page.locator("#leaveYes").click();
    await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
    assert.equal(await page.locator("#lifeKiller").isVisible(), false);
    assert.equal(await page.locator("#lifeResultTitle").textContent(), "Выход с арены");
    assert.equal(await page.locator("#continueLife").count(), 0);
    await page.locator("#levelToast").waitFor({ state: "visible" });
    assert.equal(await page.locator("#levelToast").textContent(), "Уровень повышен!+10+1");
    assert.equal(
      await page.locator("#levelToast").evaluate((el) => getComputedStyle(el).pointerEvents),
      "none",
    );
    assert.equal(await page.locator("#lifeEarned").textContent(), "+15");
    assert.equal(await page.locator("#lifeDuration").textContent(), "00:02:00");
    assert.equal(await page.locator("#lifeXp").textContent(), "Лимит опыта достигнут");
    assert.equal(await page.locator("#lifeXpFill").evaluate((el) => el.style.width), "100%");
    assert.equal(a.dead, true);
    assert.equal(
      app.arena.snapshot(time).players.some((p) => p.id === a.id),
      false,
    );
    await page.screenshot({ path: path.join(artifacts, "leave-result-desktop.png") });
    // Повторные серверные снимки не продлевают уведомление одного повышения.
    await page.locator("#levelToast").waitFor({ state: "hidden", timeout: 11000 });
    const toastDuration = await page.evaluate(() => {
      const shown = window.__toastVisibility.find((e) => e.visible),
        hidden = window.__toastVisibility.find((e) => !e.visible && e.at > shown.at);
      return hidden.at - shown.at;
    });
    assert.ok(
      toastDuration >= 9900 && toastDuration < 11500,
      `Уведомление длится 10 секунд: ${toastDuration}`,
    );
    await page.locator("#lifeLobby").click();
    await until(() => app.arena.players.size === 1, "выход из арены");
    await until(
      () =>
        page
          .locator("#progressXp")
          .textContent()
          .then((s) => s === "0 / 500 опыта"),
      "ограниченный опыт после выхода",
    );
    await secondTab.bringToFront();
    await secondTab.getByRole("button", { name: "Обновить", exact: true }).click();
    await until(
      () =>
        secondTab
          .locator('.booster-action[data-action="shop"]:enabled')
          .count()
          .then((n) => n > 0),
      "магазин после выхода из другой вкладки",
    );
    await secondTab.close();
    await page.locator("#inventorySection").click();
    assert.equal(
      await page.locator('[data-booster-id="ice_cream"] .booster-art-count').textContent(),
      "9",
    );
    await page.screenshot({ path: path.join(artifacts, "inventory-desktop.png") });
    await revealCollectionItem(page, page.locator('[data-booster-id="ice_cream"] .booster-action'));
    await page.locator('[data-booster-id="ice_cream"] .booster-action').click();
    await until(
      () => !app.profiles.byId(profileA.id).quickSlots.includes("ice_cream"),
      "смена слотов в лобби сохраняется",
    );
    await page.getByRole("button", { name: "Закрыть бустеры" }).click();
    await page.locator("#achievementsButton").click();
    await until(
      () =>
        page
          .locator(".achievement-summary")
          .textContent()
          .then((s) => s.includes("500")),
      "сохранённый опыт в достижениях",
    );
    await until(
      () =>
        page
          .locator("#achievementsDialog .clan-status")
          .textContent()
          .then((s) => s === "Прогресс сохраняется на сервере."),
      "достижения обновлены",
    );
    assert.equal(await page.locator(".achievement-card").count(), 12);
    assert.equal(await page.locator(".showcase-count").textContent(), "30 / 30");
    assert.equal(await page.locator(".achievement-grid .achievement-earned").count(), 2);
    await page.screenshot({ path: path.join(artifacts, "achievements-desktop.png") });
    await page.getByRole("button", { name: "Закрыть достижения" }).click();
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    assert.equal(await page.locator("#progressXp").textContent(), "0 / 500 опыта");
    assert.equal(await page.locator("#progressGreatness").textContent(), "Величие: 2");
    await page.screenshot({ path: path.join(artifacts, "progress-lobby.png") });
    await page.locator("#rankingsButton").click();
    await page
      .locator("#topsDialog .tops-sort")
      .getByRole("button", { name: "Уровень", exact: true })
      .click();
    await until(
      () =>
        page
          .locator(".clan-ranking-player")
          .first()
          .textContent()
          .then((s) => s.includes("500 XP")),
      "рейтинг по уровню",
    );
    assert.equal(
      await page.locator(".clan-ranking-player").first().getAttribute("data-player-id"),
      profileA.id,
    );
    await page
      .locator("#topsDialog .tops-sort")
      .getByRole("button", { name: "Величие", exact: true })
      .click();
    await until(
      () =>
        page
          .locator(".clan-ranking-player")
          .first()
          .textContent()
          .then((s) => !s.includes("XP")),
      "рейтинг по величию",
    );
    await page.getByRole("button", { name: "Топ кланов", exact: true }).click();
    assert.equal(await page.locator(`[data-clan-id="${clanId}"] strong`).last().textContent(), "2");
    await page.screenshot({ path: path.join(artifacts, "rankings-progress.png") });
    await page.getByRole("button", { name: "Закрыть топы" }).click();
    // Только изолированный профиль: достижение при 99 величия запускает Новичка.
    app.profiles.byId(profileA.id).greatness = 99;
    app.profiles.applyArenaProgress(
      "browser-title",
      [{ type: "massPeak", profileId: profileA.id, mass: 25000 }],
      Date.now(),
    );
    await page.locator("#achievementsButton").click();
    await until(
      () =>
        page
          .locator("#profileTitle")
          .textContent()
          .then((s) => s.includes("Новичок")),
      "звание Новичка в лобби",
    );
    assert.equal(await page.locator('[data-achievement="career"] .achievement-earned').count(), 1);
    await page.screenshot({ path: path.join(artifacts, "career-desktop.png") });
    await page.getByRole("button", { name: "Закрыть достижения" }).click();
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    if (!(await other.locator("#arena").isVisible())) {
      await other.locator("#playButton").click();
      await other.locator("#arena").waitFor({ state: "visible" });
    }
    app.broadcast();
    await until(
      () =>
        page
          .locator("#leaderList .leader-name")
          .count()
          .then((n) => n === 2),
      "имена игроков в топе",
    );
    assert.equal(await page.locator("#leaderList .title-medal").count(), 0);
    assert.equal(await other.locator("#leaderList .title-medal").count(), 0);
    const chestTab = await contextA.newPage();
    await ready(chestTab, url);
    await chestTab.locator("#inventorySection").click();
    await chestTab.getByRole("button", { name: "Сундуки", exact: true }).click();
    await until(
      () => chestTab.locator('[data-chest-id="novice"] button').isDisabled(),
      "сундук закрыт во второй вкладке арены",
    );
    await chestTab.screenshot({ path: path.join(artifacts, "chests-arena-locked.png") });
    await page.locator("#leaveButton").click();
    await page.locator("#leaveYes").click();
    await page.locator("#lifeLobby").click();
    await until(() => app.arena.players.size === 1, "выход перед сундуком");
    await chestTab.getByRole("button", { name: "Обновить", exact: true }).click();
    await until(
      () => chestTab.locator('[data-chest-id="novice"] button').isEnabled(),
      "сундук доступен в лобби",
    );
    assert.equal(await chestTab.locator(".chest-card").count(), 10);
    await chestTab.screenshot({ path: path.join(artifacts, "chests-desktop.png") });
    await chestTab.locator('[data-chest-id="novice"] button').click();
    const chestInventory = structuredClone(app.profiles.byId(profileA.id).inventory);
    await chestTab
      .locator("#chestConfirmDialog")
      .getByRole("button", { name: "Да", exact: true })
      .click();
    await chestTab.locator("#chestRewardDialog").waitFor({ state: "visible" });
    const chestItems = structuredClone(app.profiles.byId(profileA.id).honors.pending.items);
    await chestTab
      .locator("#chestRewardDialog")
      .getByRole("button", { name: "Отлично", exact: true })
      .click();
    await until(() => app.profiles.byId(profileA.id).wallet.bucks === 5, "награды сундука");
    assert.equal(app.profiles.byId(profileA.id).wallet.coins, 1480);
    assert.equal(app.profiles.byId(profileA.id).wallet.crystals, 138);
    for (const [id, n] of Object.entries(chestItems))
      chestInventory[id] = (chestInventory[id] || 0) + n;
    assert.deepEqual(app.profiles.byId(profileA.id).inventory, chestInventory);
    assert.equal(await chestTab.locator('[data-chest-id="novice"] button').isDisabled(), true);
    await chestTab.screenshot({ path: path.join(artifacts, "chests-opened.png") });
    app.profiles.byId(profileA.id).greatness = 5000;
    app.profiles.applyArenaProgress(
      "browser-next-title",
      [{ type: "massPeak", profileId: profileA.id, mass: 10 }],
      Date.now(),
    );
    await chestTab.reload();
    await chestTab.waitForFunction(() => !document.getElementById("playButton").disabled);
    assert.match(await chestTab.locator("#walletStatus").textContent(), /5 эфира/);
    await chestTab.locator("#inventorySection").click();
    await chestTab.getByRole("button", { name: "Сундуки", exact: true }).click();
    assert.equal(
      await chestTab.locator('[data-chest-id="experienced"]').getAttribute("data-state"),
      "closed",
    );
    assert.equal(
      await chestTab.locator('[data-chest-id="experienced"] button').isDisabled(),
      false,
    );
    assert.equal(
      await chestTab.locator('[data-chest-id="novice"]').getAttribute("data-state"),
      "opened",
    );
    await contextA.close();
    await contextB.close();
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });
    const mobile = await mobileContext.newPage();
    await ready(mobile, url);
    await mobile.setViewportSize({ width: 320, height: 700 });
    const mobileWallet = await mobile.locator("#walletStatus .sf-currency").evaluateAll((items) =>
      items.map((el) => ({
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      })),
    );
    assert.ok(
      mobileWallet.every(
        (b) =>
          Math.abs(b.width - mobileWallet[0].width) < 1 &&
          Math.abs(b.height - mobileWallet[0].height) < 1,
      ),
    );
    assert.equal(
      await mobile.locator(".lobby").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    await mobile.locator("#walletStatus .crystals-add").tap();
    for (const name of ["Монетки", "Эфир", "Кристаллы"]) {
      await mobile.getByRole("tab", { name, exact: true }).tap();
      assert.equal(
        await mobile.locator("#donationDialog").evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        true,
      );
    }
    await mobile.screenshot({ path: path.join(artifacts, "donation-tabs-mobile.png") });
    await mobile.getByRole("button", { name: "Закрыть пакеты кристаллов" }).tap();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.screenshot({ path: path.join(artifacts, "lobby-mobile.png") });
    await mobile.locator("#achievementsButton").tap();
    await mobile.locator(".achievement-card").first().waitFor();
    assert.equal(
      await mobile
        .locator("#achievementsDialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    await mobile.screenshot({ path: path.join(artifacts, "achievements-mobile.png") });
    await mobile.setViewportSize({ width: 320, height: 700 });
    assert.equal(
      await mobile
        .locator("#achievementsDialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.getByRole("button", { name: "Закрыть достижения" }).tap();
    await mobile.locator("#clanSection").tap();
    await mobile.getByRole("button", { name: "Создать клан", exact: true }).tap();
    assert.equal(
      await mobile.getByRole("button", { name: "Создать за 1500 монет", exact: true }).isDisabled(),
      true,
    );
    await mobile.getByRole("button", { name: "Закрыть кланы" }).tap();
    await mobile.getByRole("button", { name: "Закрыть топы" }).tap();
    await mobile.locator("#clanSection").tap();
    assert.equal(
      await mobile.locator("#topsDialog").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    await mobile.screenshot({ path: path.join(artifacts, "clan-mobile.png") });
    await mobile.setViewportSize({ width: 320, height: 700 });
    assert.equal(
      await mobile.locator("#topsDialog").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.getByRole("button", { name: "Закрыть топы" }).tap();
    await mobile.locator("#shopSection").tap();
    assert.equal(
      await mobile.locator("#boosterDialog").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    await mobile.waitForFunction(() =>
      [...document.querySelectorAll(".booster-card img")].every(
        (img) => img.complete && img.naturalWidth,
      ),
    );
    await mobile.screenshot({ path: path.join(artifacts, "shop-mobile.png") });
    await buy(mobile, "ice_cream");
    await mobile.getByRole("button", { name: "Закрыть бустеры" }).tap();
    await mobile.locator("#playButton").tap();
    await mobile.locator("#arena").waitFor({ state: "visible" });
    await mobile.locator('[data-slot="1"]').tap();
    await until(
      () =>
        mobile
          .locator("#mass")
          .textContent()
          .then((s) => s === "210"),
      "применение касанием",
    );
    assert.equal(await mobile.locator("#joystick").isVisible(), true);
    await noOverlaps(mobile);
    await mobile.locator("#settingsButton").tap();
    await mobile.locator("#massToggle").tap();
    assert.equal(await mobile.locator("#massPanel").isVisible(), true);
    await mobile.locator("#massToggle").tap();
    await mobile.screenshot({ path: path.join(artifacts, "settings-mobile.png") });
    await mobile.locator("#closeSettings").tap();
    await mobile.screenshot({ path: path.join(artifacts, "arena-mobile.png") });
    await mobile.setViewportSize({ width: 320, height: 700 });
    await noOverlaps(mobile);
    await mobile.setViewportSize({ width: 844, height: 390 });
    await noOverlaps(mobile);
    await mobile.screenshot({ path: path.join(artifacts, "arena-landscape.png") });
    const m = [...app.arena.players.values()][0];
    app.profiles.byId(m.profileId).progress.xp = 495;
    const attacker = app.arena.addPlayer(time);
    attacker.name = "Соперник";
    const meet = () => {
      for (const [p, mass] of [
        [m, 150],
        [attacker, 5000],
      ])
        Object.assign(p, {
          mass,
          radius: radiusForMass(mass),
          x: 800,
          y: 800,
          targetX: 800,
          targetY: 800,
          protectedUntil: 0,
        });
      app.tick();
    };
    time = m.lifeStartedAt + 3601000;
    meet();
    await mobile.locator("#lifeResultDialog").waitFor({ state: "visible" });
    assert.equal(await mobile.locator("#lifeDuration").textContent(), "01:00:01");
    assert.equal(await mobile.locator("#lifeEarned").textContent(), "+5");
    assert.equal(await mobile.locator("#lifeLevel").textContent(), "Уровень 2");
    assert.equal(await mobile.locator("#lifeXp").textContent(), "Лимит опыта достигнут");
    assert.equal(await mobile.locator("#lifeXpBar").getAttribute("aria-valuenow"), "100");
    assert.equal(await mobile.locator("#lifeXpFill").evaluate((el) => el.style.width), "100%");
    assert.equal(
      await mobile
        .locator("#lifeResultDialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    assert.equal(
      await mobile
        .locator("#lifeResultDialog")
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollTop === 0),
      true,
      "В альбомном режиме весь итог виден без прокрутки",
    );
    await mobile.screenshot({ path: path.join(artifacts, "life-result-landscape.png") });
    await mobile.setViewportSize({ width: 320, height: 700 });
    assert.equal(
      await mobile
        .locator("#lifeResultDialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    await mobile.screenshot({ path: path.join(artifacts, "life-result-mobile.png") });
    assert.equal(await mobile.locator("#continueLife").count(), 0);
    assert.equal(m.dead, true);
    await mobile.locator("#lifeLobby").tap();
    await mobile.locator("#lobby").waitFor({ state: "visible" });
    await until(
      () =>
        mobile
          .locator("#progressXp")
          .textContent()
          .then((s) => s === "0 / 500 опыта"),
      "опыт после выхода из окна результата",
    );
    assert.equal(app.profiles.byId(m.profileId).progress.xp, 500);
    app.arena.removePlayer(attacker.id);
    await mobile.locator("#playButton").tap();
    await mobile.locator("#arena").waitFor({ state: "visible" });
    const voluntary = [...app.arena.players.values()][0];
    await until(
      () =>
        mobile
          .locator("#arenaXp")
          .textContent()
          .then((s) => s === "0"),
      "новый вход из лобби снимает предел XP",
    );
    Object.assign(voluntary, { mass: 1500, radius: radiusForMass(1500) });
    time += 61000;
    app.tick();
    await mobile.locator("#leaveButton").tap();
    await mobile.screenshot({ path: path.join(artifacts, "leave-confirm-mobile.png") });
    await mobile.locator("#leaveNo").tap();
    assert.equal(voluntary.dead, false);
    await mobile.setViewportSize({ width: 844, height: 390 });
    await mobile.locator("#leaveButton").tap();
    assert.equal(
      await mobile
        .locator("#leaveConfirmDialog")
        .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      true,
    );
    await mobile.screenshot({ path: path.join(artifacts, "leave-confirm-landscape.png") });
    await mobile.locator("#leaveYes").tap();
    await mobile.locator("#lifeResultDialog").waitFor({ state: "visible" });
    assert.equal(await mobile.locator("#lifeKiller").isVisible(), false);
    assert.equal(await mobile.locator("#lifeEarned").textContent(), "+9");
    assert.equal(await mobile.locator("#lifeXp").textContent(), "9 / 500 опыта");
    await mobile.screenshot({ path: path.join(artifacts, "leave-result-landscape.png") });
    await mobile.setViewportSize({ width: 320, height: 700 });
    await mobile.screenshot({ path: path.join(artifacts, "leave-result-mobile.png") });
    assert.equal(await mobile.locator("#continueLife").count(), 0);
    await mobile.locator("#lifeLobby").tap();
    await mobile.locator("#lobby").waitFor({ state: "visible" });
    assert.equal(app.profiles.byId(m.profileId).progress.xp, 509);
    // Все будущие сундуки проверяем только на тестовом профиле, без публичной выдачи величия.
    app.profiles.byId(m.profileId).greatness = 2000000;
    app.profiles.applyArenaProgress(
      "browser-all-titles",
      [{ type: "massPeak", profileId: m.profileId, mass: 10 }],
      Date.now(),
    );
    await mobile.locator("#inventorySection").tap();
    await mobile.getByRole("button", { name: "Сундуки", exact: true }).tap();
    await until(
      () =>
        mobile
          .locator('.chest-card[data-state="closed"]')
          .count()
          .then((n) => n === 10),
      "все сундуки сохранены",
    );
    assert.equal(
      await mobile.locator("#boosterDialog").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    assert.equal(await mobile.locator(".chest-card button:enabled").count(), 10);
    await mobile.screenshot({ path: path.join(artifacts, "chests-mobile.png") });
    await mobile.locator('[data-chest-id="novice"] button').tap();
    await mobile
      .locator("#chestConfirmDialog")
      .getByRole("button", { name: "Да", exact: true })
      .tap();
    await mobile
      .locator("#chestRewardDialog")
      .getByRole("button", { name: "Отлично", exact: true })
      .tap();
    await until(
      () => app.profiles.byId(m.profileId).wallet.bucks === 10,
      "открытие сундука касанием",
    );
    await mobile.getByRole("button", { name: "Закрыть бустеры" }).tap();
    await mobile.locator("#achievementsButton").tap();
    await until(
      () =>
        mobile
          .locator('[data-achievement="career"] .achievement-earned')
          .count()
          .then((n) => n === 10),
      "десять степеней Карьеры",
    );
    assert.equal(
      await mobile
        .locator("#achievementsDialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    await mobile.locator('[data-achievement="career"]').scrollIntoViewIfNeeded();
    await mobile.screenshot({ path: path.join(artifacts, "career-mobile.png") });
    await mobile.getByRole("button", { name: "Закрыть достижения" }).tap();
    // Новый изолированный игрок: реальные нажатия, исчерпание лимита и наведение на HUD.
    const patchContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const patchPage = await patchContext.newPage();
    await ready(patchPage, url);
    const patchProfile = (await (await patchContext.request.get(url + "/api/profile")).json())
      .profile;
    const stored = app.profiles.byId(patchProfile.id);
    stored.inventory.candy = 20;
    stored.quickSlots = ["candy"];
    stored.revision++;
    await patchPage.reload();
    await patchPage.waitForFunction(() => !document.getElementById("playButton").disabled);
    await patchPage.locator("#playButton").click();
    await patchPage.locator("#arena").waitFor({ state: "visible" });
    let patchPlayer = [...app.arena.players.values()].find((p) => p.profileId === patchProfile.id);
    Object.assign(patchPlayer, { x: 1200, y: 800, targetX: 1200, targetY: 800 });
    await tick();
    await patchPage.waitForTimeout(350);
    await patchPage.locator("#settingsButton").click();
    await patchPage.locator("#fullscreenToggle").click();
    await patchPage.waitForFunction(() => !!document.fullscreenElement);
    await patchPage.keyboard.press("Escape");
    await patchPage.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await patchPage.locator("#leaveConfirmDialog").isVisible(), false);
    await patchPage.waitForTimeout(200);
    await patchPage.keyboard.press("Escape");
    await patchPage.locator("#leaveConfirmDialog").waitFor({ state: "visible" });
    await patchPage.keyboard.press("Escape");
    await patchPage.locator("#leaveConfirmDialog").waitFor({ state: "hidden" });
    await patchPage.keyboard.press("Escape");
    await patchPage.locator("#leaveConfirmDialog").waitFor({ state: "visible" });
    await patchPage.locator("#leaveNo").click();
    // Сбрасываем курсор после клика по модальному окну для проверки клавиш движения.
    await patchPage.locator("#settingsButton").click();
    await patchPage.locator("#closeSettings").click();
    for (const key of [
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowLeft",
      "ArrowDown",
      "ArrowRight",
    ]) {
      await patchPage.keyboard.down(key);
      await patchPage.waitForTimeout(110);
      await patchPage.keyboard.up(key);
      assert.equal(patchPlayer.targetX, patchPlayer.x);
      assert.equal(patchPlayer.targetY, patchPlayer.y);
    }
    const hoverWhileMoving = async (selector) => {
      time += 200;
      await patchPage.locator(selector).hover();
      await until(() => patchPlayer.lastMoveAt === time, "мышь над " + selector);
      assert.ok(
        Math.hypot(patchPlayer.targetX - patchPlayer.x, patchPlayer.targetY - patchPlayer.y) > 10,
      );
      time += 1800;
      await until(() => patchPlayer.lastMoveAt === time, "движение сохраняется над " + selector);
      const before = { x: patchPlayer.x, y: patchPlayer.y };
      app.tick();
      assert.ok(Math.hypot(patchPlayer.x - before.x, patchPlayer.y - before.y) > 0);
    };
    await patchPage.mouse.move(950, 450);
    for (const selector of [
      "#massPanel",
      "#settingsButton",
      ".leaderboard",
      '[data-slot="1"]',
      "#leaveButton",
    ])
      await hoverWhileMoving(selector);
    // A уже применяет конфету при проверке отсутствия клавиатурного движения.
    for (let used = patchPlayer.boostersUsed + 1; used <= 10; used++) {
      await tick(1001);
      await until(() => patchPage.locator('[data-slot="1"]').isEnabled(), "готовность бустера");
      await patchPage.locator('[data-slot="1"]').click();
      await until(() => patchPlayer.boostersUsed === used, "расход лимита");
    }
    await until(
      () =>
        patchPage
          .locator('[data-slot="1"] .booster-slot-count')
          .textContent()
          .then((s) => s === "0"),
      "исчерпанный лимит слота",
    );
    await tick(1001);
    assert.equal(await patchPage.locator('[data-slot="1"]').isDisabled(), true);
    const inventoryAtLimit = app.profiles.byId(patchProfile.id).inventory.candy;
    await patchPage.keyboard.press("KeyA");
    await patchPage.waitForTimeout(150);
    assert.equal(app.profiles.byId(patchProfile.id).inventory.candy, inventoryAtLimit);
    await hoverWhileMoving('[data-slot="1"]');
    await patchPage.mouse.move(950, 450);
    await patchPage.keyboard.press("Space");
    await until(() => patchPlayer.parts?.length === 2, "деление пробелом");
    const splitMass = patchPlayer.mass;
    await patchPage.keyboard.press("Space");
    await until(() => patchPlayer.parts?.length === 4, "повторное деление всех частей");
    assert.equal(patchPlayer.mass, splitMass);
    assert.equal(patchPlayer.boosterUses.candy, 10);
    await patchPage.waitForTimeout(350);
    await patchPage.screenshot({ path: path.join(artifacts, "split-desktop.png") });
    app.arena.etherCount = 200;
    app.arena.fillEther();
    await tick();
    await patchPage.screenshot({ path: path.join(artifacts, "arena-update-desktop.png") });
    await patchPage.locator("#leaveButton").click();
    await patchPage.locator("#leaveYes").click();
    assert.equal(await patchPage.locator("#continueLife").count(), 0);
    await patchPage.locator("#lifeLobby").click();
    await patchPage.locator("#lobby").waitFor({ state: "visible" });
    await patchPage.waitForFunction(() => !document.getElementById("playButton").disabled);
    await patchPage.locator("#playButton").click();
    await patchPage.locator("#arena").waitFor({ state: "visible" });
    patchPlayer = [...app.arena.players.values()].find((p) => p.profileId === patchProfile.id);
    await until(
      () =>
        patchPage
          .locator('[data-slot="1"] .booster-slot-count')
          .textContent()
          .then((s) => s === "10"),
      "новая жизнь обновила лимит слота",
    );
    assert.equal(patchPlayer.boostersUsed, 0);
    await mobile.locator("#playButton").tap();
    await mobile.locator("#arena").waitFor({ state: "visible" });
    const touchPlayer = [...app.arena.players.values()].find((p) => p.profileId === m.profileId);
    Object.assign(touchPlayer, { x: 1200, y: 800, targetX: 1200, targetY: 800 });
    await tick();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.waitForTimeout(350);
    const touch = await mobile.context().newCDPSession(mobile);
    const stick = await mobile.locator("#joystick").boundingBox();
    const finger = { x: stick.x + stick.width / 2 + 25, y: stick.y + stick.height / 2 };
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger] });
    await until(() => touchPlayer.targetX > touchPlayer.x, "джойстик задаёт движение вправо");
    let touchX = touchPlayer.x;
    time += 50;
    app.tick();
    assert.ok(touchPlayer.x > touchX);
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await until(
      () => touchPlayer.targetX === touchPlayer.x && touchPlayer.targetY === touchPlayer.y,
      "отпускание джойстика",
    );
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 290, y: 450 }],
    });
    await until(() => touchPlayer.targetX > touchPlayer.x, "касание арены задаёт направление");
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 80, y: 460 }],
    });
    await until(() => touchPlayer.targetX < touchPlayer.x, "перемещение пальца меняет направление");
    touchX = touchPlayer.x;
    time += 50;
    app.tick();
    assert.ok(touchPlayer.x < touchX);
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await until(
      () => touchPlayer.targetX === touchPlayer.x && touchPlayer.targetY === touchPlayer.y,
      "отпускание касания арены",
    );
    await touch.detach();
    Object.assign(touchPlayer, { mass: 501, radius: radiusForMass(501) });
    await tick();
    // Wait for the client snapshot that also updates canSplit before pressing Space.
    await until(
      () =>
        mobile
          .locator("#mass")
          .textContent()
          .then((value) => value === "501"),
      "снимок новой массы перед делением",
    );
    assert.equal(await mobile.locator("#splitButton").count(), 0);
    assert.equal(await patchPage.locator("#splitButton").count(), 0);
    // Внешняя клавиатура; отдельной экранной кнопки больше нет.
    await mobile.keyboard.press("Space");
    await until(() => touchPlayer.parts?.length === 2, "части сферы в мобильной раскладке");
    assert.equal(touchPlayer.mass, 501);
    assert.deepEqual(
      touchPlayer.parts.map((part) => part.mass).sort((a, b) => a - b),
      [250, 251],
    );
    await until(
      () =>
        mobile
          .locator("#mass")
          .textContent()
          .then((value) => value === "501"),
      "HUD общей массы после деления",
    );
    assert.equal(touchPlayer.parts.length, 2);
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 700 },
      { width: 844, height: 390 },
    ]) {
      await mobile.setViewportSize(viewport);
      await noOverlaps(mobile);
      assert.equal(
        await mobile.locator("#massPanel").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        true,
      );
      if (viewport.width <= 760 && (await mobile.locator("#levelToast").isVisible())) {
        const notification = await mobile.locator("#levelToast").boundingBox(),
          leaders = await mobile.locator(".leaderboard").boundingBox();
        assert.ok(
          notification.y >= leaders.y + leaders.height,
          "Уведомление не закрывает верхний HUD",
        );
      }
      await mobile.screenshot({ path: path.join(artifacts, `arena-update-${viewport.width}.png`) });
    }
    // Точный пример пользователя: четыре независимых остатка при лимите 24.
    const quotaContext = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
      quotaPage = await quotaContext.newPage();
    await ready(quotaPage, url);
    const quotaId = (await (await quotaContext.request.get(url + "/api/profile")).json()).profile
      .id;
    const quotaProfile = app.profiles.byId(quotaId);
    quotaProfile.level = 501;
    quotaProfile.progress.xp =
      require("../../src/server/progression/experience-progression").xpForLevel(501);
    Object.assign(quotaProfile.inventory, { donut: 100, colorful_shield: 40, candy: 5, speed: 67 });
    quotaProfile.quickSlots = ["donut", "colorful_shield", "candy", "speed"];
    quotaProfile.revision++;
    await quotaPage.reload();
    await quotaPage.waitForFunction(() => !document.getElementById("playButton").disabled);
    await quotaPage.locator("#playButton").click();
    await quotaPage.locator("#arena").waitFor({ state: "visible" });
    const quotaPlayer = [...app.arena.players.values()].find((p) => p.profileId === quotaId);
    assert.deepEqual(
      await quotaPage.locator(".booster-quick .booster-slot-count").allTextContents(),
      ["24", "24", "5", "24"],
    );
    Object.assign(quotaPlayer, { mass: 1000, radius: radiusForMass(1000) });
    await tick();
    await until(
      () =>
        quotaPage
          .locator("#mass")
          .textContent()
          .then((s) => s.replace(/\s/g, "") === "1000"),
      "масса перед делением",
    );
    await quotaPage.keyboard.press("Space");
    await until(() => quotaPlayer.parts?.length === 2, "две части перед бустером");
    await quotaPage.keyboard.press("Space");
    await until(() => quotaPlayer.parts?.length === 4, "четыре части перед бустером");
    const mainPart = app.arena.mainBody(quotaPlayer),
      mainId = quotaPlayer.mainPartId;
    const siblings = quotaPlayer.parts.filter((part) => part.id !== mainId),
      siblingMasses = siblings.map((part) => part.mass);
    const fixedTime = time;
    for (let i = 1; i <= 5; i++) {
      await quotaPage.locator('[data-slot="3"]').click();
      await until(() => quotaPlayer.boosterUses.candy === i, "масса без секундной паузы");
      assert.equal(mainPart.mass, 250 + 150 * i);
      assert.deepEqual(
        siblings.map((part) => part.mass),
        siblingMasses,
      );
    }
    assert.equal(time, fixedTime);
    await until(
      () =>
        quotaPage
          .locator('[data-slot="3"]')
          .getAttribute("aria-label")
          .then((s) => s === "Пустой слот D"),
      "последняя конфета очистила свой слот",
    );
    assert.deepEqual(
      await quotaPage.locator(".booster-quick .booster-slot-count").allTextContents(),
      ["24", "24", "24"],
    );
    assert.deepEqual(quotaPlayer.quickSlots, ["donut", "colorful_shield", null, "speed"]);
    await quotaPage.locator('[data-slot="1"]').click();
    await until(() => quotaPlayer.boosterUses.donut === 1, "независимый слот пончиков");
    assert.equal(mainPart.mass, 1500);
    assert.deepEqual(
      siblings.map((part) => part.mass),
      siblingMasses,
    );
    // Проверяем промежуточные размеры реального canvas при соединении.
    await quotaPage.bringToFront();
    time += 30000;
    for (const part of quotaPlayer.parts) Object.assign(part, { x: 1200, y: 800, vx: 0, vy: 0 });
    Object.assign(quotaPlayer, { targetX: 1200, targetY: 800, stopped: true });
    app.arena.syncParts(quotaPlayer);
    app.broadcast();
    await quotaPage.waitForTimeout(400);
    await quotaPage.evaluate(() => {
      window.mergeRadii = [];
      window.originalArc = CanvasRenderingContext2D.prototype.arc;
      CanvasRenderingContext2D.prototype.arc = function (x, y, r, ...rest) {
        if (Math.abs(x - 1200) < 1 && Math.abs(y - 800) < 1) window.mergeRadii.push(r);
        return window.originalArc.call(this, x, y, r, ...rest);
      };
    });
    const beforeMergeRadius = mainPart.radius;
    await quotaPage.waitForFunction(
      (radius) => window.mergeRadii.some((r) => Math.abs(r - radius) < 0.5),
      beforeMergeRadius,
    );
    await quotaPage.evaluate(() => (window.mergeRadii = []));
    app.arena.moveParts(quotaPlayer, time, 0);
    app.broadcast();
    assert.equal(quotaPlayer.parts, null);
    assert.equal(quotaPlayer.mainPartId, mainId);
    await quotaPage.waitForFunction(
      ({ low, high }) => window.mergeRadii.some((r) => r > low + 1 && r < high - 1),
      { low: beforeMergeRadius, high: quotaPlayer.radius },
    );
    const renderedRadii = await quotaPage.evaluate(() => {
      CanvasRenderingContext2D.prototype.arc = window.originalArc;
      return window.mergeRadii;
    });
    assert.ok(
      renderedRadii.some((r) => r > beforeMergeRadius + 1 && r < quotaPlayer.radius - 1),
      "размер проходит промежуточные значения при слиянии",
    );
    await quotaPage.screenshot({ path: path.join(artifacts, "merged-desktop.png") });
    Object.assign(quotaPlayer, { mass: 29999, radius: radiusForMass(29999) });
    await tick();
    await quotaPage.locator('[data-slot="1"]').click();
    await until(() => quotaPlayer.mass === 30000, "предел отдельного шара в браузере");
    await until(
      () => quotaPage.locator('[data-slot="1"]').isDisabled(),
      "нет расхода бустера при пределе",
    );
    assert.equal(app.profiles.byId(quotaId).inventory.donut, 98);
    const flightContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    for (const context of browser.contexts()) if (context !== flightContext) await context.close();
    await until(() => app.arena.players.size === 0, "изолированная проверка мобильного полёта");
    const flightPage = await flightContext.newPage();
    await ready(flightPage, url);
    for (const width of [390, 320]) {
      await flightPage.setViewportSize({ width, height: 844 });
      await flightPage.waitForFunction(() =>
        [...document.querySelectorAll(".menu-icon,#walletStatus .currency-icon")].every(
          (img) => img.complete && img.naturalWidth,
        ),
      );
      assert.equal(
        await flightPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      const clipped = await flightPage
        .locator(".menu-tile")
        .evaluateAll((buttons) => buttons.some((b) => b.scrollWidth > b.clientWidth + 1));
      assert.equal(clipped, false, "иконки и названия помещаются в мобильном меню");
      assert.equal(
        await flightPage.locator(".menu-icon").evaluateAll((imgs) =>
          imgs.every((img) => {
            const highDensitySource = img.srcset.split(",").find((entry) => /\s2x\s*$/.test(entry));
            return (
              highDensitySource &&
              img.currentSrc ===
                new URL(highDensitySource.trim().split(/\s+/)[0], document.baseURI).href
            );
          }),
        ),
        true,
      );
      await flightPage.screenshot({
        path: path.join(artifacts, `lobby-icons-${width}.png`),
        fullPage: true,
      });
      await flightPage.locator(".side-nav").scrollIntoViewIfNeeded();
      await flightPage.screenshot({ path: path.join(artifacts, `menu-icons-${width}.png`) });
      await flightPage.locator(".lobby-header").scrollIntoViewIfNeeded();
    }
    await flightPage.setViewportSize({ width: 390, height: 844 });
    const flightId = (await (await flightContext.request.get(url + "/api/profile")).json()).profile
      .id;
    const flightProfile = app.profiles.byId(flightId);
    flightProfile.inventory.freeze = 1;
    flightProfile.inventory.web = 2;
    flightProfile.quickSlots = ["freeze", "web"];
    flightProfile.revision++;
    await flightPage.reload();
    await flightPage.waitForFunction(() => !document.getElementById("playButton").disabled);
    await flightPage.locator("#playButton").tap();
    await flightPage.locator("#arena").waitFor({ state: "visible" });
    const flightPlayer = [...app.arena.players.values()].find((p) => p.profileId === flightId);
    Object.assign(flightPlayer, {
      x: 1000,
      y: 800,
      targetX: 1000,
      targetY: 800,
      protectedUntil: 0,
    });
    await tick(2100);
    await flightPage.waitForTimeout(300);
    await flightPage.evaluate(() => {
      const renderer = window.KillexProjectiles.Renderer.prototype,
        draw = renderer.draw;
      renderer.draw = function (ctx, options) {
        const original = ctx.drawImage;
        ctx.drawImage = (img, ...args) => {
          if ([...this.images].some(([url, asset]) => asset === img && url.endsWith("/freeze.png")))
            window.projectilePainted = true;
          return original.call(ctx, img, ...args);
        };
        try {
          draw.call(this, ctx, options);
        } finally {
          ctx.drawImage = original;
        }
      };
    });
    await flightPage.locator('[data-slot="1"]').tap();
    assert.equal(
      app.profiles.byId(flightId).inventory.freeze,
      1,
      "касание слота ждёт выбора направления",
    );
    await flightPage.locator("#game").tap({ position: { x: 300, y: 420 } });
    await until(() => flightPlayer.boosterUses.freeze === 1, "запуск снаряда касанием");
    await until(
      () =>
        flightPage
          .locator('[data-slot="1"]')
          .getAttribute("aria-label")
          .then((s) => s === "Пустой слот A"),
      "пустой слот на телефоне",
    );
    assert.deepEqual(flightPlayer.quickSlots, [null, "web"]);
    assert.ok(
      app.arena.combat.shots.some((s) => s.ownerId === flightPlayer.id && s.boosterId === "freeze"),
    );
    app.arena.combat.update(time + 200);
    app.broadcast();
    await flightPage.waitForFunction(() => window.projectilePainted);
    await flightPage.waitForTimeout(150);
    await flightPage.screenshot({ path: path.join(artifacts, "projectile-mobile.png") });
    await flightContext.close();
    assert.deepEqual(errors, []);
    console.log(
      "Browser OK: Escape/fullscreen, simplified lobby/HUD, level notification, voluntary exit without Continue, decay/XP; main sphere, merge, boosters, mobile, donation, titles, chests and clans.",
    );
  } finally {
    clearInterval(snapshots);
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== testsDirectory ||
      !path.basename(scratch).startsWith(".tmp-browser-")
    )
      throw Error("Небезопасный временный путь.");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
