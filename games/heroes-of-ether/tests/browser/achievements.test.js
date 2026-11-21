/* Браузерный сценарий: achievements. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { chromium } = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation");
const directory = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(directory, ".tmp-achievements-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
const artifacts = path.join(directory, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const app = createGameServer({ arena: new Arena({ etherCount: 0 }), autoTick: false }),
  errors = [];
let browser;
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
    async function open() {
      await page.locator("#achievementsButton").click();
      await page.waitForFunction(
        () =>
          document.querySelector("#achievementsDialog .clan-status").textContent ===
          "Прогресс сохраняется на сервере.",
      );
    }
    const close = () => page.getByRole("button", { name: "Закрыть достижения" }).click();
    const ids = () =>
      page.locator(".achievement-card").evaluateAll((ns) => ns.map((n) => n.dataset.achievement));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await open();
    assert.equal(await page.locator(".honor-name").textContent(), "Без звания");
    assert.equal(await page.locator(".achievement-card").count(), 12);
    assert.equal(await page.locator(".showcase-count").textContent(), "30 / 30");
    assert.equal(
      (await page.locator(".honor-greatness").textContent()).replace(/\s+/g, " "),
      "0 / 10 величия",
    );
    await page.getByLabel("Не начаты", { exact: true }).uncheck();
    await page.getByLabel("В процессе", { exact: true }).uncheck();
    await page.getByLabel("Пока недоступны", { exact: true }).uncheck();
    assert.equal(await page.locator(".achievement-card").count(), 0);
    assert.equal(await page.locator(".achievement-detail .achievement-empty").count(), 1);
    await page.getByLabel("Не начаты", { exact: true }).check();
    await page.getByLabel("В процессе", { exact: true }).check();
    await close();
    const profile = (await (await context.request.get(url + "/api/profile")).json()).profile,
      stored = app.profiles.byId(profile.id);
    Object.assign(stored.progress, { kills: 9, absorbedMass: 1000, boosterUses: 6600 });
    app.profiles.applyArenaProgress(
      "achievements-fixture",
      [{ type: "massPeak", profileId: profile.id, mass: 0 }],
      Date.now(),
    );
    const walletBefore = { ...stored.wallet };
    await open();
    assert.equal(await page.locator(".honor-name").textContent(), "Новичок");
    assert.equal(await page.locator(".honor-trophy-degree").textContent(), "1");
    assert.match(await page.locator(".honor-chest-state").textContent(), /можно открыть/);
    await page.locator('[data-achievement="king"]').hover();
    assert.equal(await page.locator(".achievement-detail-heading h3").textContent(), "Царь");
    assert.equal(await page.locator(".achievement-value").textContent(), "9 / 10");
    assert.equal(
      await page.locator("#achievementDetail [role=progressbar]").getAttribute("aria-valuenow"),
      "9",
    );
    await page.locator('[data-achievement="eaten"]').focus();
    assert.equal(await page.locator(".achievement-detail-heading h3").textContent(), "Толстяк");
    assert.equal(await page.locator(".achievement-milestones .achievement-earned").count(), 1);
    await page.locator('[data-achievement="king"]').hover();
    await page.mouse.move(5, 5);
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#achievementsDialog img")].every(
        (i) => i.complete && i.naturalWidth,
      ),
    );
    const panels = await page.locator(".achievements-layout").evaluate((n) =>
      [...n.children].map((c) => ({
        x: c.getBoundingClientRect().x,
        y: c.getBoundingClientRect().y,
      })),
    );
    assert.ok(
      panels[0].x < panels[1].x && Math.abs(panels[0].y - panels[1].y) < 1,
      "трофей слева, витрина справа",
    );
    await page.screenshot({ path: path.join(artifacts, "achievements-showcase-desktop.png") });
    await page.getByLabel("Сортировка достижений").selectOption("nearest");
    assert.equal((await ids())[0], "king");
    await page.getByLabel("Сортировка достижений").selectOption("name");
    const sortedNames = await page.locator(".achievement-card .achievement-name").allTextContents();
    assert.deepEqual(
      sortedNames,
      [...sortedNames].sort((a, b) => a.localeCompare(b, "ru")),
    );
    await page.getByLabel("Не начаты", { exact: true }).uncheck();
    await page.getByLabel("В процессе", { exact: true }).uncheck();
    assert.deepEqual(await ids(), ["boosters"]);
    assert.match(await page.locator(".achievement-state").textContent(), /Все степени/);
    await page.getByLabel("Выполнены", { exact: true }).uncheck();
    assert.equal(await page.locator(".achievement-card").count(), 0);
    await page.getByRole("button", { name: "Все звания", exact: true }).click();
    assert.equal(await page.locator(".achievement-detail-heading h3").textContent(), "Карьера");
    assert.equal(await page.getByLabel("В процессе", { exact: true }).isChecked(), true);
    for (const name of ["Не начаты", "Выполнены"])
      await page.getByLabel(name, { exact: true }).check();
    await page.getByLabel("Сортировка достижений").selectOption("default");
    assert.deepEqual(
      app.profiles.byId(profile.id).wallet,
      walletBefore,
      "просмотр наград не меняет баланс",
    );
    await page.getByRole("button", { name: "К сундукам", exact: true }).click();
    await page.locator('#boosterDialog[data-mode="chests"]').waitFor();
    assert.equal(await page.locator("#achievementsDialog").isVisible(), false);
    await page.locator('[data-chest-id="novice"] button:enabled').waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".chest-art")].every((i) => i.complete && i.naturalWidth),
    );
    await page.screenshot({ path: path.join(artifacts, "progression-chests-desktop.png") });
    await page.locator('[data-chest-id="novice"] button').click();
    await page
      .locator("#chestConfirmDialog")
      .getByRole("button", { name: "Да", exact: true })
      .click();
    await page
      .locator("#chestRewardDialog")
      .getByRole("button", { name: "Отлично", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelector('[data-chest-id="novice"]').dataset.state === "opened",
    );
    await page.getByRole("button", { name: "Закрыть бустеры" }).click();
    await open();
    assert.match(await page.locator(".honor-chest-state").textContent(), /награды получены/);
    await close();
    app.profiles.byId(profile.id).greatness = 2000000;
    app.profiles.applyArenaProgress(
      "achievements-all-titles",
      [{ type: "massPeak", profileId: profile.id, mass: 0 }],
      Date.now(),
    );
    await open();
    await page.getByRole("button", { name: "Все звания", exact: true }).click();
    assert.equal(await page.locator(".honor-name").textContent(), "Герой");
    assert.equal(await page.locator(".honor-trophy-degree").textContent(), "10");
    assert.equal(await page.locator(".career-milestones .achievement-earned").count(), 10);
    assert.match(await page.locator(".honor-chest-state").textContent(), /можно открыть/);
    assert.equal(
      await page.locator("#achievementsDialog").evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
      true,
    );
    await page.locator("#achievementsDialog").evaluate((n) => (n.scrollTop = 0));
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#achievementsDialog img")].every(
        (i) => i.complete && i.naturalWidth,
      ),
    );
    await page.screenshot({ path: path.join(artifacts, "achievements-showcase-highest.png") });
    await close();
    for (const width of [768, 390, 320]) {
      const mobile = await browser.newContext({
        viewport: { width, height: 900 },
        hasTouch: true,
        isMobile: width < 700,
        storageState: await context.storageState(),
      });
      const mp = await mobile.newPage();
      mp.on("pageerror", (e) => errors.push(e.message));
      await mp.goto(url);
      await mp.waitForFunction(() => !document.getElementById("playButton").disabled);
      await mp.locator("#achievementsButton").tap();
      await mp.locator(".achievement-card").first().waitFor();
      assert.equal(
        await mp.locator("#achievementsDialog").evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
        true,
        "без переполнения " + width,
      );
      await mp.locator('[data-achievement="king"]').tap();
      assert.equal(await mp.locator(".achievement-detail-heading h3").textContent(), "Царь");
      assert.equal(await mp.locator(".achievement-value").textContent(), "9 / 10");
      const detail = await mp.locator("#achievementDetail").boundingBox();
      assert.ok(detail.y + detail.height > 0 && detail.y < 900);
      await mp.screenshot({
        path: path.join(artifacts, `achievements-showcase-detail-${width}.png`),
      });
      await mp.locator("#achievementsDialog").evaluate((n) => (n.scrollTop = 0));
      await mp.screenshot({ path: path.join(artifacts, `achievements-showcase-${width}.png`) });
      await mp.getByRole("button", { name: "Закрыть достижения" }).tap();
      await mobile.close();
    }
    assert.deepEqual(errors, []);
    console.log(
      "Achievements browser OK: trophy/rewards, server progress, hover/focus/touch, filters/sorting, empty/partial/completed states, all 10 titles, chest navigation, 1280/768/390/320.",
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== directory ||
      !path.basename(scratch).startsWith(".tmp-achievements-")
    )
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
