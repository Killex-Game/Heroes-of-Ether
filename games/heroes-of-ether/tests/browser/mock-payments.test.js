/* Покупки через LAN HTTP: отмена, начисление, потеря ответа, продление и узкий экран. */
"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { once } = require("node:events"),
  { chromium } = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { WEEK } = require("../../src/server/accounts/account-benefits");
const scratch = fs.mkdtempSync(path.join(__dirname, "../.tmp-mock-payments-"));
process.env.TEMP = process.env.TMP = scratch;
const profiles = new ProfileStore({ filePath: path.join(scratch, "profiles.json") });
const app = createGameServer({ profiles, arena: new Arena({ etherCount: 0 }), autoTick: false });
const artifacts = path.resolve(__dirname, "../artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let browser;
(async () => {
  try {
    app.httpServer.listen(0, "0.0.0.0");
    await once(app.httpServer, "listening");
    const host = process.env.SF_BROWSER_HOST || "game-lan.test";
    const url = `http://${host}:${app.httpServer.address().port}`;
    browser = await chromium.launch({
      headless: true,
      channel: "chrome",
      args: ["--host-resolver-rules=MAP game-lan.test 127.0.0.1", "--no-proxy-server"],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const ready = async () => {
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    };
    await ready();
    assert.equal(await page.evaluate(() => isSecureContext), false);
    assert.equal(await page.evaluate(() => typeof crypto.randomUUID), "undefined");
    const initial = (await (await context.request.get(url + "/api/profile")).json()).profile;
    const p = () => profiles.byId(initial.id);
    const balance = initial.wallet.coins;
    let purchaseRequests = 0;
    page.on("request", (req) => {
      if (req.url().endsWith("/api/mock-payments/confirm")) purchaseRequests++;
    });
    const modal = page.locator("#mockPaymentDialog");
    const openCoins = async (packageId = "handful") => {
      await page.locator('#walletStatus .currency-add[data-currency="coins"]').click();
      await page.locator(`[data-package-id="${packageId}"] .donation-action`).click();
      await modal.waitFor({ state: "visible" });
    };
    const done = async () => {
      const receipt = page.locator("#chestRewardDialog");
      if (await receipt.isVisible()) {
        await receipt.getByRole("button", { name: "Отлично", exact: true }).click();
        return;
      }
      await modal
        .locator(".mock-payment-actions button")
        .getByText("Готово", { exact: true })
        .click();
    };
    await openCoins();
    await page.screenshot({ path: path.join(artifacts, "mock-payment-confirm-desktop.png") });
    await modal.getByRole("button", { name: "Отмена", exact: true }).click();
    assert.equal(p().wallet.coins, balance);
    assert.equal(purchaseRequests, 0);
    assert.equal(await page.locator("#donationDialog").isVisible(), true);
    await page.locator('[data-package-id="handful"] .donation-action').click();
    await page.keyboard.press("Escape");
    assert.equal(purchaseRequests, 0);
    await page.locator('[data-package-id="handful"] .donation-action').click();
    // Два синхронных клика: только один запрос и одно начисление.
    await modal
      .locator(".mock-payment-actions button")
      .last()
      .evaluate((button) => {
        button.click();
        button.click();
      });
    await page.waitForFunction(
      () => document.querySelector("#mockPaymentDialog").dataset.state === "success",
    );
    assert.equal(p().wallet.coins, balance + 300);
    assert.equal(purchaseRequests, 1);
    await done();
    await page.keyboard.press("Escape");
    await ready();
    assert.equal(
      (await (await context.request.get(url + "/api/profile")).json()).profile.wallet.coins,
      balance + 300,
    );
    // Ответ теряется после записи сервером. Повтор после перезагрузки не удваивает выдачу.
    await page.route(
      "**/api/mock-payments/confirm",
      async (route) => {
        await route.fetch();
        await route.abort();
      },
      { times: 1 },
    );
    await openCoins();
    await modal.getByRole("button", { name: "Подтвердить", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector("#mockPaymentDialog").dataset.state === "error",
    );
    assert.equal(p().wallet.coins, balance + 600);
    await ready();
    await openCoins();
    await modal.getByRole("button", { name: "Проверить операцию", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector("#mockPaymentDialog").dataset.state === "success",
    );
    assert.equal(p().wallet.coins, balance + 600);
    await done();
    await page.keyboard.press("Escape");
    // Все 18 ценовых кнопок доступны, цена и количество приходят из общего каталога.
    for (const currency of ["coins", "crystals", "bucks"]) {
      await page.locator(`#walletStatus .currency-add[data-currency="${currency}"]`).click();
      assert.equal(await page.locator("#donationDialog .donation-action:enabled").count(), 6);
      await page.keyboard.press("Escape");
    }
    // Повторная покупка того же пакета — новая операция и новый прогресс достижения.
    for (let count = 1; count <= 2; count++) {
      await openCoins("treasury");
      await modal.getByRole("button", { name: "Подтвердить", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector("#mockPaymentDialog").dataset.state === "success",
      );
      assert.equal(p().activity.values.wealthy, 600 + count * 37500);
      assert.equal(p().activity.claimed.wealthy, count);
      await done();
      await page.keyboard.press("Escape");
      for (let i = 0; i < 20 && (await page.locator(".achievement-notice-close").isVisible()); i++)
        await page.locator(".achievement-notice-close").click();
    }
    const achievements = (await (await context.request.get(url + "/api/profile")).json()).profile
      .progress.achievements;
    assert.equal(achievements.find((a) => a.id === "wealthy").claimed, 2);
    await page.locator("#accountButton").click();
    await page.locator(".account-plan.vip button").click();
    await modal.getByRole("button", { name: "Отмена", exact: true }).click();
    assert.equal(p().account?.vipUntil || 0, 0);
    for (const kind of ["vip", "premium", "vip"]) {
      const previous = p().account?.[kind + "Until"] || 0;
      await page.locator(`.account-plan.${kind} button`).click();
      if (kind === "premium") {
        await page.setViewportSize({ width: 320, height: 640 });
        const bounds = await modal.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 321);
        assert.equal(await modal.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), true);
        await page.screenshot({ path: path.join(artifacts, "mock-payment-mobile.png") });
      }
      await modal.getByRole("button", { name: "Подтвердить", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector("#mockPaymentDialog").dataset.state === "success",
      );
      if (previous > Date.now()) assert.equal(p().account[kind + "Until"], previous + WEEK);
      else assert.ok(p().account[kind + "Until"] > Date.now());
      await done();
    }
    await page.keyboard.press("Escape");
    await ready();
    assert.equal(await page.locator("#accountMarks .profile-account").count(), 2);
    const restored = new ProfileStore({ filePath: path.join(scratch, "profiles.json") });
    assert.deepEqual(restored.byId(initial.id).wallet, p().wallet);
    assert.deepEqual(restored.byId(initial.id).account, p().account);
    // Второй компьютер получает собственный профиль и не видит чужое начисление.
    const other = await browser.newContext(),
      otherPage = await other.newPage();
    await otherPage.goto(url);
    await otherPage.waitForFunction(() => !document.getElementById("playButton").disabled);
    const another = (await (await other.request.get(url + "/api/profile")).json()).profile;
    assert.notEqual(another.id, initial.id);
    assert.equal(another.wallet.coins, initial.wallet.coins);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: LAN HTTP; 20 products; cancel/Escape; double click; lost response + reload; exact balances; VIP/Premium renewal; persistence; isolated clients; 320px layout.",
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
    const parent = path.resolve(__dirname, "..");
    assert.ok(path.resolve(scratch).startsWith(parent + path.sep + ".tmp-mock-payments-"));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
