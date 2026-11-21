"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  { chromium } = require("playwright"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation");
const output = path.resolve(__dirname, "../../../../artifacts/lite-event-cycle-20261023/browser");
fs.mkdirSync(output, { recursive: true });
let now = Date.now(),
  browser;
const profiles = new ProfileStore({ now: () => now }),
  events = new EventManager({ now: () => now });
const app = createGameServer({
  profiles,
  events,
  wallNow: () => now,
  autoTick: false,
  arena: new Arena({ etherCount: 0 }),
  testBots: { enabled: false },
});
const event = (action, body) =>
  events.apply("owner", action, {
    revision: events.data.revision,
    requestId: randomUUID(),
    ...body,
  });
(async () => {
  try {
    event("upload", {
      manifest: {
        schemaVersion: 1,
        id: "browser-fixture",
        title: "Проверка Lite",
        description: "Только изолированный тест",
        durationMinutes: 60,
        contentPack: "core-v1",
        features: { roulette: true, lite: true },
      },
    });
    event("start", { eventId: "browser-fixture" });
    const firstRun = events.active().id,
      auth = profiles.open(),
      p = () => profiles.find(auth.token);
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
      reducedMotion: "reduce",
    });
    await context.addCookies([
      { name: "sferorumiya_session", value: auth.token, url, httpOnly: true },
    ]);
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install();
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page
      .locator("#eventAnnouncement[open]")
      .getByRole("button", { name: "Позже", exact: true })
      .click();
    await page.locator("#rouletteButton").click();
    await page.locator(".roulette-lite-button").click();
    const buyButton = page.locator(".account-plan.lite button"),
      payment = page.locator("#mockPaymentDialog");
    const buy = async () => {
      await buyButton.click();
      await payment.getByRole("button", { name: "Подтвердить", exact: true }).click();
      await page.waitForFunction(
        () => document.getElementById("mockPaymentDialog").dataset.state === "success",
      );
      await payment.getByRole("button", { name: "Готово", exact: true }).click();
      assert.equal(await buyButton.isDisabled(), true);
    };
    await buy();
    assert.equal(p().roulette.tickets, 50);
    // Keep the existing account and roulette dialogs open across both event transitions.
    now = events.active().endsAt;
    await page.clock.runFor(21000);
    await page.waitForFunction(() => document.querySelector(".account-plan.lite").hidden);
    assert.equal(profiles.view(p()).roulette.lite.active, false);
    assert.equal(await page.locator(".roulette-spin-five").isVisible(), false);
    assert.equal(p().roulette.tickets, 50);
    event("start", { eventId: "browser-fixture" });
    assert.notEqual(events.active().id, firstRun);
    await page.clock.runFor(21000);
    await page.waitForFunction(
      () =>
        !document.querySelector(".account-plan.lite").hidden &&
        !document.querySelector(".account-plan.lite button").disabled,
    );
    assert.match(await buyButton.innerText(), /Купить Lite/);
    assert.equal(profiles.view(p()).roulette.lite.active, false);
    await page.screenshot({ path: path.join(output, "lite-new-event-purchase.png") });
    await buy();
    assert.equal(p().roulette.tickets, 100);
    assert.equal(Object.keys(p().lite.events).length, 2);
    assert.equal(await page.locator("#rouletteDialog").getAttribute("data-account"), "lite");
    assert.deepEqual(errors, []);
    const report = {
      engine: "chrome",
      expiryDisablesLite: true,
      sameEventRepeatAllowsPurchase: true,
      newPurchaseGrants50Once: true,
      oldTicketsPreserved: true,
      withoutPageReload: true,
      pageErrors: errors,
    };
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
