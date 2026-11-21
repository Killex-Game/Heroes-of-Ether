"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  engines = require("playwright"),
  { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  roulette = require("../../src/server/roulette/roulette-service");
const output = path.resolve(
  __dirname,
  "../../../../artifacts/lite-button-visibility-20261023/browser",
);
fs.mkdirSync(output, { recursive: true });
const store = new ProfileStore({ rouletteConfig: { testEnabled: true } });
const app = createGameServer({
  profiles: store,
  arena: new Arena({ foodCount: 0 }),
  autoTick: false,
});
let browser;
const report = [];
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    for (const engine of process.env.SF_TEST_ENGINE
      ? [process.env.SF_TEST_ENGINE]
      : ["chromium", "firefox", "webkit"]) {
      store.rouletteConfig = roulette.configuration({ testEnabled: false });
      const auth = store.open(),
        p = () => store.find(auth.token);
      p().wallet = { coins: 100000, crystals: 100000, bucks: 100000 };
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1050 },
        reducedMotion: "reduce",
      });
      await context.addCookies([
        { name: "sferorumiya_session", value: auth.token, url, httpOnly: true },
      ]);
      const page = await context.newPage(),
        errors = [],
        missing = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.status() === 404) missing.push(r.url());
      });
      const ready = async () => {
        await page.goto(url);
        await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      };
      const wheel = async (available = true) => {
        await page.locator("#rouletteButton").click();
        if (available)
          await page.waitForFunction(
            () => document.querySelectorAll(".roulette-wheel image").length === 14,
          );
        else await page.locator("#rouletteDialog[open]").waitFor();
      };
      const geometry = async (selector, width, name) => {
        const height = width === 1040 ? 855 : width === 390 ? 844 : width === 900 ? 650 : 960;
        await page.setViewportSize({ width, height });
        await page.evaluate(() => document.fonts.ready);
        const boxes = await page.locator(selector).evaluate((node) => {
          const box = node.getBoundingClientRect();
          const overflow = [
            ...node.querySelectorAll("button,input,.account-plan,.roulette-ticket-offer"),
          ]
            .filter((n) => n.checkVisibility())
            .filter((n) => {
              const b = n.getBoundingClientRect();
              return b.left < box.left - 1 || b.right > box.right + 1;
            })
            .map((n) => n.className);
          const wide = [...node.querySelectorAll("*")]
            .filter(
              (n) =>
                n instanceof HTMLElement &&
                n.checkVisibility() &&
                n.getBoundingClientRect().right > box.right + 1,
            )
            .map((n) => ({
              tag: n.tagName,
              cls: n.className,
              text: n.innerText?.slice(0, 120),
              width: n.getBoundingClientRect().width,
            }));
          return {
            left: box.left,
            right: box.right,
            scroll: node.scrollWidth,
            client: node.clientWidth,
            scrollHeight: node.scrollHeight,
            clientHeight: node.clientHeight,
            overflow,
            wide,
          };
        });
        assert.ok(
          boxes.left >= 0 && boxes.right <= width + 1 && boxes.scroll <= boxes.client + 1,
          JSON.stringify(boxes),
        );
        assert.deepEqual(boxes.overflow, []);
        if (selector === "#rouletteDialog")
          assert.ok(
            boxes.scrollHeight <= boxes.clientHeight + 1,
            "Vertical scroll (" + name + "): " + JSON.stringify(boxes),
          );
        await page.screenshot({ path: path.join(output, `${engine}-${width}-${name}.png`) });
        report.push({ engine, width, name, ...boxes });
      };
      const panel = async (id) => {
        const tab = page.locator(`.roulette-view-tabs [data-panel="${id}"]`);
        if (await tab.isVisible()) await tab.click();
      };
      await ready();
      await wheel(false);
      assert.equal(await page.locator("#rouletteDialog").getAttribute("data-account"), "base");
      assert.equal(await page.locator(".roulette-spin-five").isVisible(), false);
      assert.equal(await page.locator(".roulette-lite-button").isVisible(), true);
      for (const width of [1440, 1040, 900, 390])
        await geometry("#rouletteDialog", width, "base-no-event");
      await page.locator(".roulette-lite-button").click();
      assert.equal(await page.locator(".account-plan.vip").isVisible(), true);
      assert.equal(await page.locator(".account-plan.lite").isVisible(), false);
      for (const width of [1440, 390]) {
        await geometry("#accountDialog", width, "accounts-no-event");
        if (width === 1440) {
          assert.equal(await page.locator("#accountDialog .account-plan:visible").count(), 2);
          assert.equal((await page.locator("#accountDialog").boundingBox()).width, 940);
        }
      }
      // Тестовый режим разрешает Lite бессрочно, без изменения расписания и сохранений игроков.
      store.rouletteConfig = roulette.configuration({ testEnabled: true });
      await ready();
      await wheel();
      assert.equal(await page.locator(".roulette-lite-button").innerText(), "Купить Lite");
      await page.locator(".roulette-lite-button").click();
      await page.locator("#accountDialog[open] .account-plan.lite").waitFor();
      assert.match(
        await page.locator(".account-plan.lite .account-expiry").innerText(),
        /бессрочно/,
      );
      assert.equal(await page.locator(".account-plan.lite button").isEnabled(), true);
      for (const width of [1440, 390]) await geometry("#accountDialog", width, "accounts-testing");
      // Настоящий активный ивент добавляет предложение Lite, но базовый вид рулетки сохраняется до покупки.
      const startsAt = Date.now() - 60000;
      store.rouletteConfig = roulette.configuration({
        events: [{ id: "ui-event", startsAt, endsAt: Date.now() + 3600000 }],
      });
      await ready();
      await wheel();
      assert.equal(await page.locator("#rouletteDialog").getAttribute("data-account"), "base");
      assert.equal(await page.locator(".roulette-lite-button").innerText(), "Купить Lite");
      for (const width of [1440, 1040, 900, 390])
        await geometry("#rouletteDialog", width, "base-event");
      await page.locator(".roulette-lite-button").click();
      await page.locator("#accountDialog[open] .account-plan.lite").waitFor();
      assert.match(await page.locator(".account-plan.lite .account-expiry").innerText(), /До /);
      for (const width of [1440, 390]) {
        await geometry("#accountDialog", width, "accounts");
        if (width === 1440) {
          const cards = await page.locator("#accountDialog .account-plan").evaluateAll((nodes) =>
            nodes.map((n) => {
              const b = n.getBoundingClientRect(),
                button = n.querySelector("button").getBoundingClientRect();
              return {
                width: b.width,
                height: b.height,
                top: b.top,
                buttonY: button.y,
                buttonHeight: button.height,
              };
            }),
          );
          assert.equal(cards.length, 3);
          assert.ok(
            cards.every(
              (c) =>
                c.width > 430 &&
                Math.abs(c.width - cards[0].width) < 1 &&
                Math.abs(c.height - cards[0].height) < 1,
            ),
          );
          assert.ok(
            cards.every((c) => Math.abs(c.buttonY - cards[0].buttonY) < 1 && c.buttonHeight === 44),
            JSON.stringify(cards),
          );
        }
      }
      // Покупка действительно проходит существующее подтверждение; потерянный ответ восстанавливается.
      let losePayment = true;
      await page.route("**/api/mock-payments/confirm", async (route) => {
        if (losePayment) {
          losePayment = false;
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      });
      await page.locator(".account-plan.lite button").click();
      const modal = page.locator("#mockPaymentDialog");
      assert.equal(await modal.locator(".mock-payment-price").innerText(), "50 голосов");
      await modal.getByRole("button", { name: "Подтвердить", exact: true }).click();
      await page.waitForFunction(
        () => document.getElementById("mockPaymentDialog").dataset.state === "error",
      );
      assert.equal(p().roulette.tickets, 50);
      await modal.getByRole("button", { name: "Проверить операцию", exact: true }).click();
      await page.waitForFunction(
        () => document.getElementById("mockPaymentDialog").dataset.state === "success",
      );
      assert.equal(p().roulette.tickets, 50);
      assert.equal(
        await page.locator("#rouletteDialog").getAttribute("data-account"),
        "lite",
        "Вид меняется сразу после покупки, без перезагрузки",
      );
      await modal.getByRole("button", { name: "Готово", exact: true }).click();
      await ready();
      await wheel();
      assert.equal(await page.locator(".roulette-spin-five").isDisabled(), false);
      assert.match(await page.locator(".roulette-lite-button").innerText(), /Lite активен/);
      for (const width of [1440, 1040, 900, 390]) {
        await geometry("#rouletteDialog", width, "lite-active");
        for (const id of ["tickets", "info", "wheel"]) {
          await panel(id);
          await geometry("#rouletteDialog", width, "active-" + id);
        }
      }
      await panel("tickets");
      const coins = page.locator('.roulette-ticket-offer[data-currency="coins"]');
      await coins.locator("input").fill("50");
      assert.match(await coins.locator(".roulette-ticket-cost").innerText(), /5\s000/);
      await coins.getByRole("button", { name: "Купить", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector(".roulette-tickets strong").textContent === "100",
      );
      assert.equal(p().wallet.coins, 95000);
      assert.match(await coins.locator("small").innerText(), /Осталось 0/);
      assert.equal(await coins.getByRole("button").isDisabled(), true);
      // Потеря ответа пакетного вращения и перезагрузка страницы: все 5 призов, одно списание.
      let loseFive = true,
        loseTickets = true;
      await page.route("**/api/roulette/action", async (route) => {
        const b = route.request().postDataJSON();
        if ((b.action === "spin-five" && loseFive) || (b.action === "tickets" && loseTickets)) {
          if (b.action === "spin-five") loseFive = false;
          else loseTickets = false;
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      });
      await panel("wheel");
      await page.locator(".roulette-spin-five").click();
      await page.getByRole("button", { name: "Восстановить результат", exact: true }).waitFor();
      assert.equal(p().roulette.tickets, 95);
      const before = structuredClone(p().roulette.results);
      await ready();
      await wheel();
      await page.locator(".roulette-result-batch li").nth(4).waitFor();
      assert.equal(await page.locator(".roulette-result-batch li").count(), 5);
      assert.equal(p().roulette.tickets, 95);
      assert.deepEqual(p().roulette.results, before);
      for (const width of [1440, 1040, 900, 390])
        await geometry("#rouletteDialog", width, "five-prizes");
      await panel("tickets");
      const bucks = page.locator('.roulette-ticket-offer[data-currency="bucks"]');
      await bucks.locator("input").fill("7");
      await bucks.getByRole("button", { name: "Купить", exact: true }).click();
      await page.getByRole("button", { name: "Восстановить результат", exact: true }).waitFor();
      assert.equal(p().roulette.tickets, 102);
      const wallet = structuredClone(p().wallet);
      await page.getByRole("button", { name: "Восстановить результат", exact: true }).click();
      await page.waitForFunction(() =>
        document.querySelector(".roulette-status").textContent.includes("Покупка восстановлена"),
      );
      assert.deepEqual(p().wallet, wallet);
      assert.equal(p().roulette.tickets, 102);
      assert.equal(p().roulette.spent, 5, "Восстановление покупки не запускает вращение");
      // Открытое окно возвращается к базовому виду по окончании срока, без перезагрузки страницы.
      store.rouletteConfig = roulette.configuration({
        events: [{ id: "ui-event", startsAt, endsAt: Date.now() + 2500 }],
      });
      await page.evaluate(async () => {
        const { profile } = await (await fetch("/api/profile")).json();
        document.dispatchEvent(new CustomEvent("killex:profile", { detail: profile }));
      });
      await page.waitForFunction(
        () => document.getElementById("rouletteDialog").dataset.account === "base",
      );
      assert.equal(await page.locator(".roulette-spin-five").isVisible(), false);
      assert.equal(await page.locator(".roulette-ticket-shop").isVisible(), false);
      assert.equal(
        await page.locator("#accountDialog").evaluate((n) => n.classList.contains("has-lite")),
        false,
      );
      assert.equal(p().roulette.tickets, 102, "Смена вида не расходует билеты");
      // После завершения ивента кнопка Lite остаётся, но предложение и дополнительные функции скрыты.
      store.rouletteConfig = roulette.configuration({
        testEnabled: true,
        events: [{ id: "past", startsAt: 1, endsAt: 2 }],
      });
      await ready();
      await wheel();
      for (const width of [1440, 1040, 900, 390])
        await geometry("#rouletteDialog", width, "base-after-event");
      assert.equal(await page.locator(".roulette-lite-button").isVisible(), true);
      assert.equal(await page.locator(".roulette-ticket-shop").isVisible(), false);
      assert.equal(await page.locator(".roulette-spin-five").isVisible(), false);
      await page.locator(".roulette-lite-button").click();
      assert.equal(await page.locator(".account-plan.vip").isVisible(), true);
      assert.equal(await page.locator(".account-plan.lite").isVisible(), false);
      assert.equal(await page.locator('.account-plan-tabs [data-kind="lite"]').isVisible(), false);
      assert.deepEqual(errors, []);
      assert.deepEqual(missing, []);
      console.log(
        `${engine}: Lite layout, confirmation/replay, ticket limit/cost, five prizes/reload, purchase recovery and event hiding passed`,
      );
      await browser.close();
      browser = null;
    }
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
