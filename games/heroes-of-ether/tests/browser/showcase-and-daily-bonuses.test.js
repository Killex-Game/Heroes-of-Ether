"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { once } = require("node:events"),
  engines = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { accountLoginRewards: rewards } = require("../../public/shared/virtual-product-catalog"),
  { WEEK, fresh } = require("../../src/server/accounts/account-benefits");
const engine = process.argv.find((arg) => arg.startsWith("--engine="))?.slice(9) || "chromium";
const bonusesOnly = process.argv.includes("--bonuses-only");
const scratch = fs.mkdtempSync(path.join(__dirname, "../.tmp-showcase-"));
process.env.TEMP = process.env.TMP = scratch;
const artifacts = path.resolve(__dirname, "../artifacts/showcase-bonuses", engine);
fs.mkdirSync(artifacts, { recursive: true });
let now = Date.parse("2026-10-20T20:59:57Z");
const profiles = new ProfileStore({
  filePath: path.join(scratch, "profiles.json"),
  now: () => now,
});
const app = createGameServer({ profiles, arena: new Arena({ etherCount: 0 }), autoTick: false });
let browser;
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    browser = await engines[engine === "edge" ? "chromium" : engine].launch({
      headless: true,
      ...(engine === "chromium"
        ? { channel: "chrome" }
        : engine === "edge"
          ? { channel: "msedge" }
          : {}),
    });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await context.addInitScript((at) => {
      window.bonusNow = at;
      Date.now = () => window.bonusNow;
    }, now);
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const initial = (await (await context.request.get(url + "/api/profile")).json()).profile;
    const current = () => profiles.byId(initial.id);
    current().account = fresh();
    current().greatness = 5927;
    require("../../src/server/progression/title-chest-rewards").awardTitles(current(), now);
    current().revision++;
    await page.evaluate((id) => window.KillexPlayerProfile.open(id), initial.id);
    await page.locator("#playerProfileDialog .public-player-hero").waitFor();
    assert.equal(await page.locator(".public-player-avatar .player-online-indicator").count(), 0);
    assert.deepEqual(await page.locator(".public-player-stats dt").allTextContents(), [
      "Величие:",
      "Место в топе:",
      "Рекорд массы:",
      "Съедено игроков:",
    ]);
    assert.equal(await page.locator(".public-player-stats dt img").count(), 0);
    await page.locator("#playerProfileDialog .personal-close").click();
    const ready = async () => {
      await page.reload();
      await page.evaluate((at) => {
        window.bonusNow = at;
      }, now);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    };
    const close = async (id) => page.locator(`#${id} .booster-close`).click();
    const packs = page.locator("#donationDialog");
    const bonus = (kind) => packs.locator(`[data-account-kind="${kind}"]`);
    // Доступность независима, включая оба неактивных и оба активных.
    for (const [vip, premium] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ]) {
      current().account.vipUntil = vip ? now + WEEK : now - 1;
      current().account.premiumUntil = premium ? now + WEEK : now - 1;
      current().revision++;
      await ready();
      await page.locator("#accountButton").click();
      assert.equal(await page.locator(".account-plan.vip h3").textContent(), "VIP");
      for (const [kind, active] of [
        ["vip", vip],
        ["premium", premium],
      ])
        assert.equal(
          await page.locator(`.account-plan.${kind} .account-active-badge`).isVisible(),
          active,
        );
      if (vip && premium)
        await page
          .locator("#accountDialog")
          .screenshot({ path: path.join(artifacts, "active-accounts.png") });
      await close("accountDialog");
      await page
        .locator(
          '#walletStatus [data-currency="coins"] .currency-add, #walletStatus .currency-add[data-currency="coins"]',
        )
        .click();
      assert.equal(await packs.locator(".donation-card").count(), 8);
      assert.equal(await packs.locator(".donation-bonus-countdown:visible").count(), 0);
      assert.equal(await packs.getByText("Обновление в 00:00 МСК").count(), 0);
      for (const [kind, active] of [
        ["vip", vip],
        ["premium", premium],
      ])
        assert.equal(await bonus(kind).locator("button").isEnabled(), active);
      await close("donationDialog");
    }
    // Размер карточек не зависит от страницы, фильтров и свободного места.
    for (const [width, height] of bonusesOnly
      ? []
      : [
          [1920, 1080],
          [1366, 768],
          [1280, 720],
          [1024, 600],
          [768, 1024],
          [390, 844],
          [320, 568],
        ]) {
      await page.setViewportSize({ width, height });
      await page.locator("#accountButton").click();
      const account = page.locator("#accountDialog");
      const checkFits = async (id) => {
        await page.waitForTimeout(100);
        const box = await page.locator(`#${id} .interface-content`).evaluate((e) => ({
          width: e.clientWidth,
          height: e.clientHeight,
          scrollWidth: e.scrollWidth,
          scrollHeight: e.scrollHeight,
        }));
        if (box.scrollHeight > box.height + 1) {
          await page
            .locator(`#${id}`)
            .screenshot({ path: path.join(artifacts, `overflow-${id}-${width}.png`) });
          console.log(
            "OVERFLOW",
            await page.locator(`#${id} .interface-content`).evaluate((e) =>
              [
                ...e.querySelectorAll(
                  ".honor-sidebar,.achievement-showcase,.achievement-grid,.achievement-detail,.achievement-pages,.interface-page,.achievements-layout",
                ),
              ].map((n) => ({
                class: n.className,
                height: n.getBoundingClientRect().height,
                top: n.getBoundingClientRect().top - e.getBoundingClientRect().top + e.scrollTop,
                style: n.getAttribute("style"),
                id: n.dataset.achievementDetail,
              })),
            ),
          );
        }
        assert.ok(
          box.scrollWidth <= box.width + 1,
          `${width} ${id} horizontal: ${JSON.stringify(box)}`,
        );
        assert.ok(
          box.scrollHeight <= box.height + 1,
          `${width} ${id} vertical: ${JSON.stringify(box)}`,
        );
      };
      if (width <= 650) {
        for (const name of ["VIP", "Premium"]) {
          await account
            .locator(".account-plan-tabs")
            .getByRole("button", { name, exact: true })
            .click();
          await checkFits("accountDialog");
        }
      } else {
        await checkFits("accountDialog");
        const box = await account.boundingBox();
        assert.ok(box.width <= 941 && box.height <= 620, `${width}: compact account bounds`);
      }
      await close("accountDialog");
      await page.mouse.move(0, 0);
      await page.locator("#achievementsButton").click();
      if (width <= 700)
        await page.locator('.achievement-panel-tabs [data-panel="showcase"]').click();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(150);
      await checkFits("achievementsDialog");
      assert.equal(
        await page
          .locator(
            "#achievementsDialog .achievement-summary, #achievementsDialog .showcase-count, #achievementsDialog .honor-trophy-degree",
          )
          .count(),
        0,
      );
      const checkHonor = async () => {
        const geometry = await page.locator(".honor-sidebar").evaluate((sidebar) => {
          const rect = (selector) => sidebar.querySelector(selector).getBoundingClientRect();
          const copy = rect(".honor-copy"),
            medal = rect(".honor-trophy"),
            progress = rect(".honor-advancement"),
            rewards = rect(".honor-rewards"),
            card = sidebar.getBoundingClientRect();
          return {
            vertical:
              copy.bottom <= medal.top + 1 &&
              medal.bottom <= progress.top + 1 &&
              progress.bottom <= rewards.top + 1,
            centered: Math.abs((medal.left + medal.right) / 2 - (card.left + card.right) / 2) < 2,
          };
        });
        assert.deepEqual(geometry, { vertical: true, centered: true }, `${width}: vertical honor`);
        await page.locator(".honor-sidebar").screenshot({
          path: path.join(artifacts, `honor-panel-${width}.png`),
        });
      };
      if (width > 700) await checkHonor();
      for (const index of [0, 1]) {
        const nav = page.locator(
          ".achievement-showcase > .achievement-pages button:not(:disabled)",
        );
        if (index > 0 && (await nav.count()) > index && (await nav.nth(index).isVisible()))
          await nav.nth(index).click();
        const rows = await page.locator(".achievement-grid").evaluate((grid) => {
          const rows = new Map();
          for (const card of grid.querySelectorAll(".achievement-card")) {
            const r = card.getBoundingClientRect(),
              key = Math.round(r.top);
            const list = rows.get(key) || [];
            list.push({ left: r.left, right: r.right, width: r.width, height: r.height });
            rows.set(key, list);
          }
          return [...rows.values()].map((r) => ({
            left: r[0].left,
            right: r.at(-1).right,
            count: r.length,
            cards: r,
          }));
        });
        for (const row of rows) {
          assert.ok(Math.abs(row.left - rows[0].left) < 2);
          for (const card of row.cards) {
            assert.equal(card.width, 132, `${width}: fixed card width`);
            assert.equal(card.height, 132, `${width}: fixed card height`);
          }
        }
        await checkFits("achievementsDialog");
      }
      // Фильтрация и неполная последняя страница не растягивают оставшиеся карточки.
      const planned = page.locator('.achievement-filters input[value="planned"]');
      await planned.uncheck();
      const last = page.locator(".achievement-showcase > .achievement-pages button").last();
      if ((await last.isVisible()) && (await last.isEnabled())) await last.click();
      const cardSizes = await page.locator(".achievement-card").evaluateAll((cards) =>
        cards.map((c) => {
          const r = c.getBoundingClientRect();
          return [r.width, r.height];
        }),
      );
      assert.ok(cardSizes.every(([w, h]) => w === 132 && h === 132));
      await planned.check();
      if (width <= 700) {
        await page.locator('.achievement-panel-tabs [data-panel="honor"]').click();
        await checkFits("achievementsDialog");
        await checkHonor();
        await page.locator(".honor-career-link").click();
        for (let i = 0; i < 3; i++) {
          await page.locator(".milestone-pages button").nth(i).click();
          await checkFits("achievementsDialog");
        }
        await checkFits("achievementsDialog");
      } else {
        await page.locator(".honor-career-link").click();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(100);
        await checkFits("achievementsDialog");
      }
      if (width === 1920 || width === 390)
        await page
          .locator("#achievementsDialog")
          .screenshot({ path: path.join(artifacts, `achievements-${width}.png`) });
      await close("achievementsDialog");
      await page.locator("#shopSection").click();
      await page
        .locator("#boosterDialog")
        .getByRole("button", { name: "Сундуки", exact: true })
        .click();
      const chestLayout = await page.locator(".chest-grid").evaluate((grid) => ({
        fits: grid.scrollWidth <= grid.clientWidth + 1,
        cards: [...grid.querySelectorAll(".chest-card")].map((card) => {
          const icon = card.querySelector(".chest-heading img").getBoundingClientRect(),
            name = card.querySelector(".chest-heading h3"),
            box = name.getBoundingClientRect();
          return {
            below: box.top >= icon.bottom - 1,
            fits: name.scrollWidth <= name.clientWidth + 1,
            readableLines: box.height <= parseFloat(getComputedStyle(name).lineHeight) * 3 + 1,
          };
        }),
      }));
      assert.equal(chestLayout.fits, true, `${width}: chests fit horizontally`);
      assert.equal(chestLayout.cards.length, 10);
      assert.ok(
        chestLayout.cards.every((card) => card.below && card.fits && card.readableLines),
        `${width}: chest names below illustrations without broken words`,
      );
      assert.equal(
        await page.getByText("Виды и количество каждого вида случайны.", { exact: false }).count(),
        0,
      );
      if ([1920, 1366, 390, 320].includes(width))
        await page
          .locator("#boosterDialog")
          .screenshot({ path: path.join(artifacts, `title-chests-${width}.png`) });
      await close("boosterDialog");
      await page.locator('#walletStatus .currency-add[data-currency="coins"]').click();
      const layout = await packs.locator(".donation-grid").evaluate((grid) => ({
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        overflow: grid.scrollWidth > grid.clientWidth + 1,
      }));
      assert.equal(layout.columns, width > 1100 ? 4 : width > 540 ? 2 : 1);
      assert.equal(layout.overflow, false);
      if (width === 1920 || width === 1366 || width === 390)
        await packs.screenshot({ path: path.join(artifacts, `currency-${width}.png`) });
      await close("donationDialog");
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.locator("#rankingsButton").click();
    await page.locator('#topsDialog .tops-sort button[aria-label="Величие"]').waitFor();
    assert.equal(await page.locator("#topsDialog .tops-sort img").count(), 0);
    assert.equal(
      await page.locator('#topsDialog .tops-sort button[aria-label="Величие"]').textContent(),
      "Величие",
    );
    assert.equal(
      await page
        .locator('#topsDialog .tops-sort button[aria-label="Величие за день"]')
        .textContent(),
      "Величие за день",
    );
    assert.equal(await page.locator("#topsDialog .ranking-board > .clan-muted").count(), 0);
    await close("topsDialog");
    await page.locator('#walletStatus .currency-add[data-currency="coins"]').click();
    for (const [width, height] of [
      [1366, 768],
      [390, 844],
      [320, 568],
    ]) {
      await page.setViewportSize({ width, height });
      for (const currency of ["coins", "crystals", "bucks"]) {
        await page.locator(`#donationTab-${currency}`).click();
        assert(
          await packs
            .locator(".donation-grid")
            .evaluate((grid) => grid.scrollWidth <= grid.clientWidth + 1),
        );
        if (currency === "coins")
          await packs.screenshot({ path: path.join(artifacts, `purchase-${width}.png`) });
      }
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    const wallet = structuredClone(current().wallet);
    for (const currency of ["coins", "crystals", "bucks"]) {
      await page.locator(`#donationTab-${currency}`).click();
      const label = { coins: "монеток", crystals: "кристаллов", bucks: "эфира" }[currency];
      assert.equal(await packs.locator("h2").textContent(), `Покупка ${label}`);
      assert(
        await packs.locator(".donation-card").evaluateAll((cards) =>
          cards.every((card) => {
            const style = getComputedStyle(card);
            return (
              style.backgroundImage === "none" &&
              style.backgroundColor === "rgba(0, 0, 0, 0)" &&
              style.borderImageSlice.includes("fill")
            );
          }),
        ),
        `${currency}: only the decorative frame supplies the card background`,
      );
      for (const kind of ["vip", "premium"]) {
        assert.equal(await bonus(kind).locator(".donation-bonus-countdown").isVisible(), false);
        await bonus(kind).locator("button").click();
        await page.waitForFunction(
          ([kind]) =>
            document.querySelector(`.donation-bonus-card[data-account-kind="${kind}"] button`)
              .textContent === "Получено",
          [kind],
        );
        wallet[currency] += rewards[kind][currency];
        assert.deepEqual(current().wallet, wallet);
        assert.equal(await bonus(kind).locator("button").isDisabled(), true);
        assert.equal(await bonus(kind).locator(".donation-bonus-countdown").isVisible(), true);
        assert.equal(
          await bonus(kind).locator(".donation-bonus-countdown").textContent(),
          "Новый бонус через 00:00:03",
        );
      }
    }
    now += 2000;
    await page.evaluate((at) => {
      window.bonusNow = at;
    }, now);
    await page.waitForFunction(
      () =>
        document.querySelector(".donation-bonus-countdown").textContent ===
        "Новый бонус через 00:00:01",
    );
    await packs.screenshot({ path: path.join(artifacts, "bonus-countdown.png") });
    await ready();
    await page.locator('#walletStatus .currency-add[data-currency="coins"]').click();
    assert.equal(await bonus("vip").locator("button").isDisabled(), true);
    assert.equal(
      await bonus("vip").locator(".donation-bonus-countdown").textContent(),
      "Новый бонус через 00:00:01",
    );
    // Уже открытое окно обновляет доступность без перезагрузки в полночь МСК.
    now += 1000;
    await page.evaluate((at) => {
      window.bonusNow = at;
    }, now);
    await page.waitForFunction(
      () =>
        !document.querySelector('.donation-bonus-card[data-account-kind="vip"] button').disabled,
      { timeout: 10000 },
    );
    assert.equal(await bonus("vip").locator(".donation-bonus-countdown").isVisible(), false);
    await bonus("vip").locator("button").click();
    await page.waitForFunction(
      () =>
        document.querySelector('.donation-bonus-card[data-account-kind="vip"] button')
          .textContent === "Получено",
    );
    assert.equal(current().wallet.coins, wallet.coins + 50);
    assert.equal(
      await bonus("vip").locator(".donation-bonus-countdown").textContent(),
      "Новый бонус через 24:00:00",
    );
    current().account.vipUntil = now;
    current().revision++;
    await page.waitForFunction(
      () =>
        document.querySelector('.donation-bonus-card[data-account-kind="vip"] button')
          .textContent === "Нужен VIP",
    );
    assert.equal(await bonus("vip").locator(".donation-bonus-countdown").isVisible(), false);
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${engine}: ${bonusesOnly ? "currency windows" : "showcase layout"}; transparent card backgrounds; all 6 claims; countdown, reload, Moscow midnight and expired VIP.`,
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
    assert.ok(
      path.resolve(scratch).startsWith(path.resolve(__dirname, "..") + path.sep + ".tmp-showcase-"),
    );
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
