/* Браузерный сценарий: cosmetics. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { chromium } = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation");
const directory = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(directory, ".tmp-cosmetics-"));
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
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(r.status() + " " + r.url());
    });
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const saved = JSON.stringify(app.profiles.data);
    assert.equal(await page.locator(".showcase .skin-list").count(), 0);
    await page.locator("#wardrobeSection").click();
    assert.equal(await page.locator("#skinList .account-avatar").count(), 10);
    await page
      .locator("#skinList")
      .getByRole("button", { name: "Лесная хранительница", exact: true })
      .click();
    assert.equal(await page.locator(".collection-selection").textContent(), "Лесная хранительница");
    assert.equal(
      await page
        .locator("#skinList")
        .getByRole("button", { name: "Лесная хранительница", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#skinsDialog img")].every((i) => i.complete && i.naturalWidth),
    );
    await page.screenshot({ path: path.join(artifacts, "skins-collection-desktop.png") });
    await page.getByRole("button", { name: "Наборы", exact: true }).click();
    assert.equal(await page.locator(".skin-defaults").isVisible(), false);
    assert.equal(await page.locator(".skin-owned-sets").isVisible(), true);
    await page.getByRole("button", { name: "Купить скины", exact: true }).click();
    assert.equal(
      await page.locator("#skinsDialog").evaluate((d) => d.open),
      true,
      "collection stays underneath the shop",
    );
    assert.equal(await page.locator(".skin-shop").isVisible(), true);
    assert.equal(await page.locator(".booster-grid").isVisible(), false);
    assert.equal(
      await page.getByRole("button", { name: "Распродано", exact: true }).isDisabled(),
      true,
    );
    assert.equal(await page.locator(".skin-pack-stage .skin-silhouette").count(), 5);
    await page.screenshot({ path: path.join(artifacts, "skins-shop-desktop.png") });
    await page.getByRole("button", { name: "Бустеры", exact: true }).click();
    assert.equal(await page.locator(".booster-grid").isVisible(), true);
    await page
      .locator(".shop-categories")
      .getByRole("button", { name: "Скины", exact: true })
      .click();
    assert.equal(await page.locator(".skin-shop").isVisible(), true);
    await page.getByRole("button", { name: "В гардероб", exact: true }).click();
    assert.equal(
      await page.locator("#boosterDialog").evaluate((d) => d.open),
      true,
      "shop stays underneath the raised collection",
    );
    await page.getByRole("button", { name: "Все", exact: true }).click();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page.locator("#skinsDialog").evaluate((d) => d.scrollWidth <= d.clientWidth + 1),
        true,
      );
      await page.screenshot({ path: path.join(artifacts, "skins-collection-" + width + ".png") });
      await page.getByRole("button", { name: "Купить скины", exact: true }).click();
      assert.equal(
        await page.locator("#boosterDialog").evaluate((d) => d.scrollWidth <= d.clientWidth + 1),
        true,
      );
      await page.screenshot({ path: path.join(artifacts, "skins-shop-" + width + ".png") });
      await page.getByRole("button", { name: "В гардероб", exact: true }).click();
    }
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("skinsDialog").open);
    assert.equal(await page.locator("#boosterDialog").evaluate((d) => d.open), true);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("boosterDialog").open);
    assert.equal(
      await page.locator("#wardrobeSection").evaluate((e) => e === document.activeElement),
      true,
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator("#walletStatus .bucks-add").click();
    for (const [id, base, bonus, total, votes, rubles] of [
      ["gift", 500, 50, 550, 25, 175],
      ["treasure", 1000, 200, 1200, 50, 350],
    ]) {
      const card = page.locator('[data-package-id="' + id + '"]');
      assert.equal(
        (await card.locator(".donation-amount strong").textContent()).replace(/\s/g, ""),
        String(total),
      );
      assert.ok(
        (await card.locator(".donation-base").textContent())
          .replace(/\s/g, "")
          .includes(String(base)),
      );
      assert.match(
        await card.locator(".donation-bonus").textContent(),
        new RegExp("\\+" + bonus + " "),
      );
      assert.ok((await card.locator(".donation-prices").textContent()).includes(String(votes)));
      assert.ok((await card.locator(".donation-prices").textContent()).includes(String(rubles)));
      assert.equal(await card.locator("button").isDisabled(), true);
    }
    await page.screenshot({ path: path.join(artifacts, "bucks-rebalanced.png") });
    await page.keyboard.press("Escape");
    assert.equal(
      JSON.stringify(app.profiles.data),
      saved,
      "витрины не списали деньги и не выдали предметы",
    );
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    assert.equal(await page.locator("#lobbySkin").getAttribute("alt"), "Лесная хранительница");
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    assert.equal(
      [...app.arena.players.values()][0].skinId,
      "forest-spirit",
      "выбор передан серверу арены",
    );
    assert.deepEqual(errors, []);
    console.log(
      "Cosmetics browser OK: four default skins, selection persistence/arena, collection→shop and back, sold-out sets of five, 320/390/1280 layouts, updated bucks and unchanged wallet.",
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== directory ||
      !path.basename(scratch).startsWith(".tmp-cosmetics-")
    )
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
