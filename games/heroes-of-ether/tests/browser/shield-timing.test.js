/* Браузерный сценарий: shield timing. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { chromium } = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const directory = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(directory, ".tmp-shield-timing-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
const artifacts = path.join(directory, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const start = Date.now(),
  now = () => 5000 + Date.now() - start;
const app = createGameServer({
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  now,
  rateNow: () => performance.now(),
});
const errors = [];
let browser, snapshots;
async function until(fn, label) {
  for (let i = 0; i < 700; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Timeout: " + label);
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(r.status() + " " + r.url());
    });
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const profile = (await (await context.request.get(url + "/api/profile")).json()).profile,
      stored = app.profiles.byId(profile.id);
    Object.assign(stored.inventory, {
      colorful_shield: 100,
      golden_shield: 100,
      speed: 100,
      candy: 100,
      cake: 10,
      warheads: 10,
    });
    stored.quickSlots = ["colorful_shield", "golden_shield", "speed", "candy"];
    stored.revision++;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page.locator("#inventorySection").click();
    const cake = page.locator('[data-booster-id="cake"] img');
    assert.equal(await cake.getAttribute("src"), "assets/boosters/png/cake.png");
    await cake.evaluate((img) => img.decode());
    assert.equal(await cake.evaluate((img) => img.naturalWidth), 1254);
    assert.match(
      await page.locator('[data-booster-id="warheads"] img').getAttribute("src"),
      /warheads\.png$/,
    );
    await page.screenshot({ path: path.join(artifacts, "cake-inventory.png") });
    await page.getByRole("button", { name: "Закрыть бустеры" }).click();
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    const entered = Date.now(),
      player = [...app.arena.players.values()].find((p) => p.profileId === profile.id);
    player.protectedUntil = 0;
    snapshots = setInterval(() => app.broadcast(), 250);
    const first = page.locator('[data-slot="1"]'),
      second = page.locator('[data-slot="2"]'),
      speed = page.locator('[data-slot="3"]');
    const message = page.locator(".booster-arena-message"),
      budget = page.locator("#boosterBudget");
    assert.equal(await budget.textContent(), "До 10 применений каждого слота");
    await first.click();
    await until(() => player.boosterUses.colorful_shield === 1, "первый щит");
    await until(() => second.isEnabled(), "подтверждение первого щита");
    assert.equal(await first.isDisabled(), true);
    await second.click();
    await until(() => player.boosterUses.golden_shield === 1, "смена щита");
    await until(() => first.isEnabled(), "возврат прежнего типа сразу");
    await first.click();
    await until(() => player.boosterUses.colorful_shield === 2, "A→B→A");
    assert.equal(player.effects.golden_shield, undefined);
    const degrees = () =>
      first
        .locator(".booster-slot-cooldown")
        .evaluate((el) => parseFloat(el.style.getPropertyValue("--cooldown-sweep")));
    const before = await degrees();
    await page.waitForTimeout(120);
    assert.ok((await degrees()) < before, "анимация между снимками");
    assert.ok(Number(await first.locator(".booster-cooldown-seconds").textContent()) <= 15);
    await speed.click();
    await until(() => player.boosterUses.speed === 1, "ускорение");
    app.arena.combat.impact(
      { boosterId: "awl", ownerId: "isolated-enemy", landed: false },
      player,
      now(),
    );
    app.broadcast();
    await until(() => first.isEnabled(), "Шило очистило индикатор щита");
    assert.equal(await speed.isDisabled(), true, "действующее ускорение сохраняется");
    await first.click();
    await until(() => player.boosterUses.colorful_shield === 3, "щит сразу после Шила");
    const refreshed = now();
    await until(
      () => message.textContent().then((t) => t === "Бустер применён."),
      "уведомление применения",
    );
    await page.screenshot({ path: path.join(artifacts, "shield-cooldown-desktop.png") });
    await until(
      () => message.textContent().then((text) => text === ""),
      "подсказка применения исчезает",
    );
    for (let i = 0; i < 10; i++) {
      await until(() => page.locator('[data-slot="4"]').isEnabled(), "подтверждение применения");
      await page.keyboard.press("KeyF");
      await until(() => player.boosterUses.candy === i + 1, "расход конфеты");
    }
    assert.equal(app.profiles.byId(profile.id).inventory.candy, 90);
    await until(
      () =>
        page
          .locator('[data-slot="4"] .booster-slot-count')
          .textContent()
          .then((s) => s === "0"),
      "пустой слот подтверждён",
    );
    await page.keyboard.press("KeyF");
    assert.match(await message.textContent(), /В этом слоте больше нет/);
    await page.waitForTimeout(4700);
    assert.match(await message.textContent(), /В этом слоте больше нет/);
    await page.waitForTimeout(450);
    assert.equal(await message.textContent(), "");
    await until(() => first.isEnabled(), "15 секунд истекли раньше окончания защиты");
    assert.ok(now() - refreshed >= 14500 && now() - refreshed < 16500);
    assert.ok(player.effects.colorful_shield > now());
    await first.click();
    await until(() => player.boosterUses.colorful_shield === 4, "повтор текущего щита через 15 с");
    await page.waitForTimeout(Math.max(0, 20500 - (Date.now() - entered)));
    assert.equal(await budget.textContent(), "");
    const enemy = app.arena.addPlayer(now(), "isolated-enemy");
    Object.assign(enemy, {
      x: player.x,
      y: player.y,
      targetX: player.x,
      targetY: player.y,
      stopped: true,
      protectedUntil: 0,
      level: 121,
      mass: 10000,
      radius: radiusForMass(10000),
    });
    player.protectedUntil = 0;
    app.tick();
    await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
    app.arena.removePlayer(enemy.id);
    assert.equal(await page.locator("#continueLife").count(), 0);
    await page.locator("#lifeLobby").click();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    assert.equal(
      await budget.textContent(),
      "До 10 применений каждого слота",
      "новый вход снова показывает подсказку",
    );
    await first.click();
    await until(() => first.isDisabled(), "новая перезарядка");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(artifacts, "shield-cooldown-mobile.png") });
    assert.equal(await first.locator(".booster-slot-cooldown").isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(
      "Shield timing browser OK: cake PNG, A→B→A, Awl reset, smooth cooldown, 15s repeat, 5s messages, 20s entry hint, respawn/re-entry, desktop/mobile.",
    );
  } finally {
    clearInterval(snapshots);
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== directory ||
      !path.basename(scratch).startsWith(".tmp-shield-timing-")
    )
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
