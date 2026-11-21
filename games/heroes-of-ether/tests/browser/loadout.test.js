/* Браузерный сценарий: loadout. */
"use strict";
const { setNickname } = require("./helpers/profile-controls");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events");
const { chromium } = require("playwright"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { ProfileStore } = require("../../src/server/profiles/profile-store");
const tests = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(tests, ".tmp-loadout-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
const artifacts = path.join(tests, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let time = 5000,
  accountTime = Date.now(),
  browser,
  timer;
const app = createGameServer({
  arena: new Arena({ etherCount: 0 }),
  profiles: new ProfileStore({ now: () => accountTime }),
  autoTick: false,
  now: () => time,
  rateNow: () => performance.now(),
});
const ids = ["candy", "ice_cream", "donut", "meat", "speed", "colorful_shield", "golden_shield"];
async function until(check, label) {
  for (let i = 0; i < 180; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Timeout: " + label);
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage({
        viewport: { width: 1366, height: 768 },
        timezoneId: "America/Los_Angeles",
      }),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const profileId = (await (await page.request.get(url + "/api/profile")).json()).profile.id;
    const p = () => app.profiles.byId(profileId);
    for (const id of [...ids, "web"]) p().inventory[id] = 5;
    p().revision++;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const slot = (i) => page.locator(`#lobbyLoadout [data-loadout-slot="${i}"]`);
    const inventorySlot = (i) => page.locator(`#inventoryLoadout [data-loadout-slot="${i}"]`);
    const choose = async (i, id) => {
      await page.waitForTimeout(260);
      await slot(i).click();
      await page.locator("#boosterDialog").waitFor({ state: "visible" });
      assert.equal(await page.locator("#inventoryLoadout .loadout-slot").count(), 7);
      await page
        .locator(`#boosterDialog .booster-card[data-booster-id="${id}"]`)
        .dragTo(inventorySlot(i));
      await until(() => p().quickSlots[i] === id, "назначение из инвентаря");
      await until(() => inventorySlot(i).isEnabled(), "сохранение");
      await page.getByRole("button", { name: "Закрыть бустеры", exact: true }).click();
    };
    const inventoryAction = (id) =>
      page.locator(`#boosterDialog [data-booster-id="${id}"] [data-action="inventory"]`);
    const checkInventory = async (id, full) => {
      await page.locator("#inventorySection").click();
      assert.equal(await inventoryAction(id).isDisabled(), full);
      assert.equal(
        await inventoryAction(id).textContent(),
        full ? "Слоты заняты" : "В быстрые слоты",
      );
      assert.equal(await inventoryAction(p().quickSlots.find(Boolean)).isEnabled(), true);
      if (full) await page.screenshot({ path: path.join(artifacts, "loadout-inventory-full.png") });
      await page.getByRole("button", { name: "Закрыть бустеры", exact: true }).click();
    };
    const drag = async (from, to) => {
      const expected = [...p().quickSlots];
      while (expected.length <= to) expected.push(null);
      [expected[from], expected[to]] = [expected[to], expected[from]];
      await slot(from).dragTo(slot(to));
      await until(
        () => JSON.stringify(p().quickSlots) === JSON.stringify(expected),
        "перетаскивание",
      );
      await until(() => slot(to).isEnabled(), "сохранение переноса");
      assert.equal(await page.locator("#loadoutDialog").count(), 0);
    };
    assert.equal(await page.locator("#lobbyLoadout .booster-slot").count(), 7);
    assert.equal(await page.locator('#lobbyLoadout [data-locked="true"]').count(), 3);
    for (let i = 0; i < 4; i++) await choose(i, ids[i]);
    await choose(0, "speed");
    assert.equal(p().inventory.candy, 5);
    await choose(0, "candy");
    await checkInventory("speed", true);
    await drag(0, 1);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    assert.deepEqual(p().quickSlots, ["ice_cream", "candy", "donut", "meat"]);
    await drag(1, 0);
    const beforeDrag = structuredClone(p().quickSlots);
    await slot(0).dragTo(slot(4));
    assert.deepEqual(p().quickSlots, beforeDrag);
    await slot(0).dragTo(page.locator("#lobbyLoadout .loadout-heading"));
    assert.deepEqual(p().quickSlots, beforeDrag);
    await page.route("**/api/profile/loadout", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Проверка ошибки сохранения" }),
      }),
    );
    await slot(0).dragTo(slot(1));
    await until(
      () =>
        page
          .locator("#lobbyLoadout .loadout-feedback")
          .textContent()
          .then((text) => text === "Проверка ошибки сохранения"),
      "ошибка переноса",
    );
    assert.deepEqual(p().quickSlots, beforeDrag);
    await page.unroute("**/api/profile/loadout");
    assert.ok(ids.every((id) => p().inventory[id] === 5));
    await page.screenshot({ path: path.join(artifacts, "loadout-standard.png") });
    await page.waitForTimeout(260);
    await slot(0).click();
    await inventoryAction("candy").click();
    await until(() => p().quickSlots[0] === null, "удаление кнопкой");
    assert.equal(p().inventory.candy, 5);
    await page.getByRole("button", { name: "Закрыть бустеры", exact: true }).click();
    await checkInventory("speed", false);
    await drag(1, 0);
    await drag(0, 1);
    await page.waitForTimeout(260);
    await choose(0, "candy");
    await page.locator("#accountButton").click();
    await page.locator("#accountDialog").waitFor({ state: "visible" });
    await page
      .locator(".account-plan.premium")
      .getByRole("button", { name: "Купить за 30 голосов на 7 дней", exact: true })
      .click();
    await page
      .locator("#mockPaymentDialog")
      .getByRole("button", { name: "Подтвердить", exact: true })
      .click();
    await page
      .locator("#mockPaymentDialog")
      .getByRole("button", { name: "Готово", exact: true })
      .click();
    await until(() => p().account.premiumUntil > accountTime, "VIP");
    const displayed = await page.locator("#accountMarks time").textContent();
    const expectedDate = new Date(p().account.premiumUntil).toLocaleString("ru-RU", {
      timeZone: "America/Los_Angeles",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    assert.equal(displayed, "до " + expectedDate);
    assert.ok(!(await page.locator("#accountDialog").textContent()).includes("Екатеринбург"));
    await page.getByRole("button", { name: "Закрыть улучшение аккаунта", exact: true }).click();
    for (let i = 4; i < 7; i++) await choose(i, ids[i]);
    await checkInventory("web", true);
    await drag(6, 4);
    await drag(4, 6);
    await page.waitForTimeout(260);
    await slot(6).click();
    await inventorySlot(6).dragTo(inventorySlot(4));
    await until(() => p().quickSlots[4] === "golden_shield", "перенос внутри инвентаря");
    await until(() => inventorySlot(4).isEnabled(), "сохранение");
    await inventorySlot(4).dragTo(inventorySlot(6));
    await until(() => p().quickSlots[6] === "golden_shield", "обратный перенос");
    await until(() => inventorySlot(6).isEnabled(), "сохранение");
    await page.screenshot({ path: path.join(artifacts, "loadout-inventory-rack.png") });
    await page.keyboard.press("Escape");
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    assert.deepEqual(p().quickSlots, ids);
    assert.equal(await page.locator("#lobbyLoadout img").count(), 7);
    await page.screenshot({ path: path.join(artifacts, "loadout-premium.png") });
    for (const [width, height] of [
      [1024, 600],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(80);
      await page.locator("#lobbyLoadout").scrollIntoViewIfNeeded();
      const geometry = await page.locator("#lobbyLoadout .booster-slot").evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect();
          return { left: r.left, right: r.right, bottom: r.bottom, top: r.top };
        }),
      );
      assert.ok(
        geometry.every((r) => r.left >= 0 && r.right <= width && r.top >= 0 && r.bottom <= height),
      );
      assert.ok(geometry.every((r) => Math.abs(r.top - geometry[0].top) < 1));
    }
    await page.screenshot({ path: path.join(artifacts, "loadout-landscape.png") });
    await page.setViewportSize({ width: 1366, height: 768 });
    assert.equal(await page.locator("#nickname").count(), 0);
    await setNickname(page, "Первый");
    assert.equal(p().wallet.crystals, 100);
    await page.locator("#editProfile").click();
    await page.locator("#profileNickname").fill("Второй");
    await page
      .locator("#personalDialog")
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await page.locator("#renameConfirmDialog").waitFor({ state: "visible" });
    assert.equal(await page.locator("#renameConfirmDialog .inline-currency").count(), 1);
    await page.screenshot({ path: path.join(artifacts, "profile-rename-confirm.png") });
    await page
      .locator("#renameConfirmDialog")
      .getByRole("button", { name: "Нет", exact: true })
      .click();
    assert.equal(p().name, "Первый");
    assert.equal(p().wallet.crystals, 100);
    await page.locator("#profileNickname").fill("Первый");
    await page.locator('#profileGender [data-gender="female"]').click();
    await page
      .locator("#personalDialog")
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await until(() => p().personal.gender === "female", "пол");
    assert.equal(p().wallet.crystals, 100);
    await page.screenshot({ path: path.join(artifacts, "profile-personal.png") });
    await page.keyboard.press("Escape");
    await setNickname(page, "ASDFGHJ");
    assert.equal(p().wallet.crystals, 90);
    assert.ok(ids.every((id) => p().inventory[id] === 5));
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    assert.equal(await page.locator("#previewName").textContent(), "ASDFGHJ");
    await page.locator("#settingsButton").click();
    await page.screenshot({ path: path.join(artifacts, "lobby-settings-new.png") });
    await page.keyboard.press("Escape");
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page.locator("#rankingsButton").click();
    await page.getByRole("button", { name: "Киллы за день", exact: true }).click();
    await page.getByRole("button", { name: "Топ кланов", exact: true }).click();
    await page.getByRole("button", { name: "Казна", exact: true }).click();
    await until(
      () =>
        page
          .getByRole("button", { name: "Казна", exact: true })
          .getAttribute("aria-pressed")
          .then((v) => v === "true"),
      "рейтинг казны",
    );
    await page.screenshot({ path: path.join(artifacts, "lobby-rankings-new.png") });
    await page.keyboard.press("Escape");
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    const player = [...app.arena.players.values()][0];
    timer = setInterval(() => {
      time += 50;
      app.broadcast();
    }, 50);
    await page.keyboard.press("Digit1");
    await page.waitForTimeout(150);
    assert.equal(p().inventory.candy, 5);
    for (let i = 0; i < 6; i++) {
      await until(
        () => page.locator(`.booster-quick [data-slot="${i + 1}"]`).isEnabled(),
        "ответ предыдущего применения",
      );
      await page.keyboard.press(["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH"][i]);
      await until(() => p().inventory[ids[i]] === 4, "клавиша слота " + i);
    }
    await until(() => page.locator('.booster-quick [data-slot="7"]').isEnabled(), "ответ перед J");
    await page.evaluate(() =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyJ", key: "о", bubbles: true }),
      ),
    );
    await until(() => p().inventory.golden_shield === 4, "русская раскладка");
    assert.equal(await page.locator(".booster-quick .booster-slot").count(), 8);
    await page.keyboard.press("KeyT");
    await until(() => player.turbo.active, "Турбо");
    await page.keyboard.press("KeyT");
    await until(() => !player.turbo.active, "пауза");
    await page.screenshot({ path: path.join(artifacts, "loadout-arena.png") });
    accountTime += 7 * 86400000;
    app.tick();
    await until(
      () =>
        page
          .locator('.booster-quick [data-locked="true"]')
          .count()
          .then((n) => n === 3),
      "истечение на арене",
    );
    const stock = p().inventory.speed;
    await page.keyboard.press("KeyG");
    await page.waitForTimeout(150);
    assert.equal(p().inventory.speed, stock);
    await page.locator("#leaveButton").click();
    await page.locator("#leaveYes").click();
    await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
    await page.locator("#lifeLobby").click();
    await page.locator("#lobby").waitFor({ state: "visible" });
    await until(() => slot(0).isEnabled(), "витрина после выхода");
    await choose(0, "web");
    await choose(0, "candy");
    assert.deepEqual(p().quickSlots, ids);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: native mouse drag swap/move, reload persistence, locked/outside drops, save failure rollback, full 4/7 inventory buttons, picking/removing, Premium unlock/expiry, horizontal layout, A/S/D/F/G/H/J including Russian layout, digits disabled, Turbo T.",
    );
  } finally {
    clearInterval(timer);
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== tests ||
      !path.basename(scratch).startsWith(".tmp-loadout-")
    )
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
