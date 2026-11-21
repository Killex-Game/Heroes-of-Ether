"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  engines = require("playwright");
const { randomUUID } = require("node:crypto");
const { createGameServer } = require("../../src/server/game-server");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { Arena } = require("../../src/server/arena/arena-simulation");
const { WEEK, fresh } = require("../../src/server/accounts/account-benefits");
const output =
  process.env.SFER_ARTIFACT_DIR ||
  path.resolve(__dirname, "../../../../artifacts/currency-packs-20261025/browser");
fs.mkdirSync(output, { recursive: true });
const profiles = new ProfileStore({ promotionConfig: require("../../config/promotions.json") });
const app = createGameServer({
  profiles,
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  testBots: { enabled: false },
});
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`,
      report = [];
    for (const engine of process.argv[2] ? [process.argv[2]] : ["chromium", "firefox", "webkit"]) {
      const browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      try {
        const auth = profiles.open();
        profiles.setPersonal(auth.token, {
          name: "Новый " + engine,
          expectedName: auth.profile.name,
          gender: "unspecified",
          requestId: randomUUID(),
        });
        const profile = profiles.find(auth.token);
        profile.account = fresh();
        profile.account.vipUntil = profile.account.premiumUntil = Date.now() + WEEK;
        const context = await browser.newContext();
        await context.addCookies([
          { name: "sferorumiya_session", value: auth.token, url, httpOnly: true },
        ]);
        const page = await context.newPage(),
          errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(url);
        await page.waitForFunction(() => !document.getElementById("playButton").disabled);
        const settle = async () => {
          await page.waitForFunction(() =>
            [...document.querySelectorAll("#donationDialog .donation-card")].every(
              (c) =>
                c.dataset.pageReady &&
                c.querySelector("img").complete &&
                c.querySelector("img").naturalWidth,
            ),
          );
          await page.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
        };
        for (const [width, height] of [
          [1920, 1080],
          [1366, 900],
          [1145, 807],
          [900, 650],
          [390, 844],
          [320, 568],
          [844, 390],
        ]) {
          await page.setViewportSize({ width, height });
          await page.locator('#walletStatus .currency-add[data-currency="coins"]').click();
          const dialog = page.locator("#donationDialog");
          for (const currency of ["coins", "crystals", "bucks"]) {
            await page.locator(`#donationTab-${currency}`).click();
            await settle();
            const found = new Set();
            for (let index = 0; index < 8; index++) {
              await settle();
              const layout = await dialog.evaluate((d) => {
                const rect = (e) => {
                  const r = e.getBoundingClientRect();
                  return {
                    x: r.x,
                    y: r.y,
                    width: r.width,
                    height: r.height,
                    right: r.right,
                    bottom: r.bottom,
                  };
                };
                const cards = [
                  ...d.querySelectorAll(".donation-card:not(.collection-page-hidden)"),
                ];
                const nav = d.querySelector(".collection-pages");
                const content = d.querySelector(".interface-content");
                return {
                  dialog: rect(d),
                  overflowX: d.scrollWidth - d.clientWidth,
                  overflowY: d.scrollHeight - d.clientHeight,
                  contentOverflow: content.scrollHeight - content.clientHeight,
                  bottomGap:
                    rect(d).bottom -
                    Math.max(
                      ...cards.map((c) => rect(c).bottom),
                      nav && !nav.hidden ? rect(nav).bottom : 0,
                    ),
                  close: rect(d.querySelector(".booster-close")),
                  cards: cards.map((c) => ({
                    id: c.dataset.packageId || c.dataset.accountKind,
                    rect: rect(c),
                    image: rect(c.querySelector("img")),
                    title: rect(c.querySelector("h3")),
                    src: c.querySelector("img").getAttribute("src"),
                    overflow: c.scrollHeight - c.clientHeight,
                    action: rect(c.querySelector("button")),
                  })),
                };
              });
              if (index === 0 || (currency === "bucks" && width === 390))
                await page.screenshot({
                  path: path.join(output, `${engine}-${width}-${currency}-${index}.png`),
                });
              const d = layout.dialog;
              assert.ok(
                d.x >= 0 && d.y >= 0 && d.right <= width + 1 && d.bottom <= height + 1,
                JSON.stringify({ engine, width, height, currency, index, layout }),
              );
              assert.ok(
                layout.overflowX <= 2 &&
                  layout.overflowY <= 2 &&
                  layout.contentOverflow <= 2 &&
                  layout.bottomGap <= 28,
                JSON.stringify({ engine, width, currency, index, layout }),
              );
              assert.equal(layout.close.width, height <= 560 ? 30 : 34);
              for (const c of layout.cards) {
                found.add(c.id);
                assert.ok(
                  Math.abs(c.image.x + c.image.width / 2 - c.rect.x - c.rect.width / 2) < 2 &&
                    c.title.y >= c.image.bottom - 1,
                  JSON.stringify(c),
                );
                assert.ok(
                  c.overflow <= 2 && c.action.bottom <= c.rect.bottom - 2,
                  JSON.stringify(c),
                );
                if (c.id === "vip" || c.id === "premium")
                  assert.equal(c.src, `assets/accounts/${c.id}.png`);
                else
                  assert.equal(
                    c.src,
                    currency === "bucks"
                      ? `assets/currency-packs/ether-v1/${c.id}.webp`
                      : `assets/currency-packs/v1/${currency}-${c.id}.webp`,
                  );
              }
              assert.equal(await dialog.locator("#donationNotice,.donation-notice").count(), 0);
              report.push({ engine, width, height, currency, index, layout });
              const next = dialog.getByRole("button", { name: "Следующая страница", exact: true });
              if (!(await next.isVisible()) || (await next.isDisabled())) break;
              await next.click();
            }
            assert.equal(found.size, 8, `${engine} ${width} ${currency}: all offers accessible`);
          }
          await dialog.locator(".booster-close").click();
          const timerLayout = await page.locator("#promotionsButton").evaluate((b) => {
            const t = b.querySelector(".promotions-countdown").getBoundingClientRect(),
              name = b.querySelector("strong").getBoundingClientRect(),
              r = b.getBoundingClientRect();
            return { right: t.right, buttonRight: r.right, left: t.left, nameRight: name.right };
          });
          assert.ok(
            timerLayout.right <= timerLayout.buttonRight &&
              timerLayout.left >= timerLayout.nameRight,
            JSON.stringify(timerLayout),
          );
          await page.locator("#promotionsButton").click();
          assert.equal(
            await page
              .locator("#promotionsDialog .booster-close")
              .evaluate((e) => e.getBoundingClientRect().width),
            height <= 560 ? 30 : 34,
          );
          if (width === 1366)
            await page.screenshot({ path: path.join(output, `${engine}-promotions-close.png`) });
          await page.getByRole("button", { name: "Закрыть акции", exact: true }).click();
        }
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.locator('#walletStatus .currency-add[data-currency="coins"]').click();
        await settle();
        const before = structuredClone(profiles.find(auth.token).wallet);
        await page.getByRole("button", { name: "Купить: Горсть золота", exact: true }).click();
        assert.ok(
          (await page.locator("#mockPaymentDialog img").first().getAttribute("src")).includes(
            "coins-handful.webp",
          ),
        );
        await page.getByRole("button", { name: "Отмена", exact: true }).click();
        assert.deepEqual(profiles.find(auth.token).wallet, before);
        await page.getByRole("button", { name: "Купить: Горсть золота", exact: true }).click();
        await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
        await page.locator('#mockPaymentDialog[data-state="success"]').waitFor();
        assert.equal(profiles.find(auth.token).wallet.coins, before.coins + 300);
        await page.getByRole("button", { name: "Готово", exact: true }).click();
        await page
          .getByRole("button", { name: "Получить бонус VIP: монеток", exact: true })
          .click();
        await page.waitForFunction(() =>
          document.querySelector(".donation-bonus-status").textContent.includes("зачислено"),
        );
        assert.equal(profiles.find(auth.token).wallet.coins, before.coins + 350);
        // Сокращаем только демонстрационный цикл фикстуры, реальные сроки покупок прежние.
        const originalView = profiles.view;
        profiles.view = function (p) {
          const result = originalView.call(this, p);
          if (result.promotionPreview) result.promotionPreview.cycleMs = 3000;
          return result;
        };
        try {
          profiles.find(auth.token).personal.firstNameSetAt = Date.now() - 8 * 86400000;
          const expiredWallet = structuredClone(profiles.find(auth.token).wallet);
          await page.reload();
          const timer = page.locator(".promotions-countdown");
          await page.locator("#promotionsButton").waitFor({ state: "visible" });
          await page.waitForFunction(
            () => document.querySelector(".promotions-countdown").textContent === "00:00:01",
          );
          await page.waitForFunction(
            () => document.querySelector(".promotions-countdown").textContent === "00:00:03",
          );
          assert.equal(await page.locator("#promotionsButton").isVisible(), true);
          assert.match(await timer.getAttribute("title"), /Тестовый таймер/);
          await page.locator("#promotionsButton").click();
          for (const button of await page.locator("#promotionsDialog .promotion-card button").all())
            assert.equal(await button.isDisabled(), true);
          const denied = await context.request.post(url + "/api/mock-payments/confirm", {
            headers: { Origin: url },
            data: { productId: "promotion:starter", requestId: randomUUID(), confirmed: true },
          });
          assert.equal(denied.status(), 409);
          assert.deepEqual(profiles.find(auth.token).wallet, expiredWallet);
        } finally {
          profiles.view = originalView;
        }
        assert.deepEqual(errors, []);
        console.log(
          engine +
            ": all currency tabs, pages, artwork, close buttons, purchase, VIP bonus and looping preview passed",
        );
      } finally {
        await browser.close();
      }
    }
    fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify(report, null, 2));
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
