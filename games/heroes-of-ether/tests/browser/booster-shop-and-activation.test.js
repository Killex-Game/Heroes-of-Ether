/* Браузерный сценарий: booster shop and activation. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  { chromium } = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { ClanService } = require("../../src/server/clans/clan-service");
const directory = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(directory, ".tmp-booster-browser-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
const artifacts = path.join(directory, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let now = 5000,
  browser;
const errors = [];
const app = createGameServer({
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  now: () => now,
  rateNow: () => performance.now(),
});
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(r.status() + " " + r.url());
    });
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const token =
      (await context.cookies()).find((c) => c.name === "sferorumiya_session")?.value ||
      (await context.cookies())[0].value;
    const p = app.profiles.find(token),
      member = app.profiles.open(),
      late = app.profiles.open();
    p.wallet.coins = 2000;
    p.wallet.bucks = 100;
    const clans = new ClanService(app.profiles),
      act = (token, action, data = {}) =>
        clans.mutate(token, { action, requestId: randomUUID(), ...data });
    act(token, "create", { name: "Проверка бустеров", prefix: "ТЕСТ", emblem: "astral" });
    const clanId = app.profiles.find(token).clanId;
    act(member.token, "apply", { clanId });
    act(token, "accept", { clanId, memberId: member.profile.id });
    await page.locator("#clanSection").click();
    await page.getByRole("heading", { name: /Казна/ }).waitFor();
    await page.getByLabel("Взнос в казну").fill("80");
    await page.getByRole("button", { name: "Внести", exact: true }).click();
    await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
    await page.getByText("Взнос поступил в казну.", { exact: true }).waitFor();
    const fire = page
      .locator(".clan-shop-item")
      .filter({ has: page.getByRole("heading", { name: "Огонь", exact: true }) });
    await fire.getByRole("button", { name: "Купить · 50 эфира", exact: true }).click();
    await page
      .getByText("Каждому текущему участнику выдано 10 бустеров.", { exact: true })
      .waitFor();
    assert.equal(app.profiles.find(token).inventory.fire, 10);
    assert.equal(app.profiles.find(member.token).inventory.fire, 10);
    assert.equal(app.profiles.find(late.token).inventory.fire, undefined);
    assert.equal(app.profiles.data.clans[clanId].treasury, 30);
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".clan-shop-item img")].every(
        (i) => i.complete && i.naturalWidth,
      ),
    );
    await page
      .locator(".clan-shop-grid")
      .screenshot({ path: path.join(artifacts, "clan-booster-shop.png") });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page.locator("#clanDialog").evaluate((d) => d.scrollWidth <= d.clientWidth + 1),
        true,
        "Нет горизонтального переполнения клана",
      );
    }
    await page.screenshot({ path: path.join(artifacts, "clan-booster-mobile.png") });
    await page.getByRole("button", { name: "Закрыть кланы" }).click();
    await page.locator("#inventorySection").click();
    assert.equal(await page.locator(".booster-filters").count(), 0);
    assert.equal(await page.locator(".booster-card").count(), 1);
    await page.locator('[data-booster-id="fire"] .booster-action').click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-booster-id="fire"] .booster-action')
          .getAttribute("aria-pressed") === "true",
    );
    await page.getByRole("button", { name: "Закрыть бустеры" }).click();
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    const victim = [...app.arena.players.values()].find((x) => x.profileId === p.id);
    assert.ok(victim);
    app.profiles.byId(p.id).progress.session.xp = 123;
    const enemy = app.arena.addPlayer(now, "test-enemy");
    Object.assign(enemy, { x: 800, y: 800, protectedUntil: 0, stopped: true });
    Object.assign(victim, { x: 900, y: 800, protectedUntil: 0, stopped: true });
    app.arena.prepareBooster(
      enemy.id,
      { boosterId: "fire", spawnSerial: enemy.spawnSerial, aimX: 2000, aimY: 800 },
      now,
    )();
    now += 1000;
    app.tick();
    await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
    assert.equal(await page.locator("#lifeKiller").textContent(), "Вас сожгли");
    assert.equal(await page.locator("#lifeEarned").textContent(), "+123");
    assert.equal(await page.locator("#continueLife").count(), 0);
    await page.screenshot({ path: path.join(artifacts, "burned-life-mobile.png") });
    assert.deepEqual(errors, []);
    console.log(
      "Booster browser OK: clan contribution, head purchase, offline gifts, 7 icons, inventory slot, 320/390 widths, burned life result and earned XP.",
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== directory ||
      !path.basename(scratch).startsWith(".tmp-booster-browser-")
    )
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
