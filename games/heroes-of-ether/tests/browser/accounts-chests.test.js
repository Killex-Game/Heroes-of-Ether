/* Браузерный сценарий: accounts chests. */
"use strict";
const { setNickname } = require("./helpers/profile-controls");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events");
const { chromium } = require("playwright"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation"),
  { ProfileStore } = require("../../src/server/profiles/profile-store");
const directory = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(directory, ".tmp-accounts-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
const artifacts = path.join(directory, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let time = 5000,
  wall = Date.UTC(2026, 9, 19, 12);
const profiles = new ProfileStore({ now: () => wall }),
  app = createGameServer({
    profiles,
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => time,
    wallNow: () => wall,
    rateNow: () => performance.now(),
  });
let browser, timer;
const errors = [];
const lanMode = process.argv.includes("--lan");
async function until(fn, label) {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Timeout: " + label);
}
(async () => {
  try {
    app.httpServer.listen(0, lanMode ? "0.0.0.0" : "127.0.0.1");
    await once(app.httpServer, "listening");
    const host = lanMode ? process.env.SF_BROWSER_HOST || "game-lan.test" : "127.0.0.1";
    const url = "http://" + host + ":" + app.httpServer.address().port;
    browser = await chromium.launch({
      headless: true,
      channel: "chrome",
      args: lanMode
        ? ["--host-resolver-rules=MAP game-lan.test 127.0.0.1", "--no-proxy-server"]
        : [],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 } }),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(r.status() + " " + r.url());
    });
    const ready = async () => {
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    };
    await ready();
    if (lanMode) {
      const capabilities = await page.evaluate(() => ({
        secure: window.isSecureContext,
        randomUUID: typeof crypto.randomUUID,
        randomValues: typeof crypto.getRandomValues,
      }));
      console.log("LAN HTTP browser capabilities:", JSON.stringify(capabilities));
      assert.deepEqual(capabilities, {
        secure: false,
        randomUUID: "undefined",
        randomValues: "function",
      });
    }
    const profile = (await (await context.request.get(url + "/api/profile")).json()).profile,
      p = () => profiles.byId(profile.id);
    await setNickname(page, "Killex");
    await page.locator("#accountButton").click();
    await page.locator(".account-plan.vip button").click();
    await page
      .locator("#mockPaymentDialog")
      .getByRole("button", { name: "Подтвердить", exact: true })
      .click();
    await page
      .locator("#mockPaymentDialog")
      .getByRole("button", { name: "Готово", exact: true })
      .click();
    await until(() => p().account?.vipUntil > wall, "VIP");
    await until(() => page.locator(".account-plan.premium button").isEnabled(), "premium enabled");
    await page.locator(".account-plan.premium button").click();
    await page
      .locator("#mockPaymentDialog")
      .getByRole("button", { name: "Подтвердить", exact: true })
      .click();
    await page
      .locator("#mockPaymentDialog")
      .getByRole("button", { name: "Готово", exact: true })
      .click();
    await until(() => p().account?.premiumUntil > wall, "Premium");
    await page.waitForFunction(() => document.querySelector("#accountMarks").children.length === 2);
    await page.screenshot({ path: path.join(artifacts, "accounts-plans-desktop.png") });
    await page.keyboard.press("Escape");
    await page.locator("#rankingsButton").click();
    await page.locator("#topsDialog").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("#wardrobeSection").click();
    await page.locator("#skinsDialog").getByRole("button", { name: "Наборы", exact: true }).click();
    assert.equal(await page.locator(".account-avatar").count(), 10);
    await page.locator(".account-avatar").first().click();
    assert.equal(await page.locator(".collection-selection").textContent(), "Король");
    await page.keyboard.press("Escape");
    // Вернуть основной скин для снимков щитов, сохранив проверку доступа к статусным.
    await page.locator("#wardrobeSection").click();
    await page
      .locator("#skinsDialog")
      .getByRole("button", { name: "По умолчанию", exact: true })
      .click();
    await page.locator("#skinList button").first().click();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".profile-card img")].every(
        (i) => i.complete && i.naturalWidth,
      ),
    );
    assert.equal(await page.locator("#profileTitle .title-medal").count(), 0);
    assert.equal(await page.locator("#profileMedal .title-medal").count(), 1);
    assert.equal(await page.locator("#accountMarks time").count(), 2);
    assert.match(await page.locator("#accountMarks").textContent(), /26.10.2026/);
    const positions = await page
      .locator("#accountMarks .profile-account")
      .evaluateAll((rows) =>
        rows.map((r) => ({ x: r.getBoundingClientRect().x, y: r.getBoundingClientRect().y })),
      );
    assert.equal(positions[0].x, positions[1].x);
    assert.ok(positions[1].y > positions[0].y);
    await page.screenshot({ path: path.join(artifacts, "accounts-lobby-desktop.png") });
    assert.ok(
      (await page.locator(".profile-card").boundingBox()).width <= 500,
      "profile card stays within its fixed 500px width",
    );
    assert.match(
      await page.locator(".skin-art").evaluate((e) => getComputedStyle(e).boxShadow),
      /216, 90, 255/,
    );
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page.locator(".profile-card").evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        true,
      );
      const cardBox = await page.locator(".profile-card").boundingBox();
      assert.ok(cardBox.x + cardBox.width <= width + 1, JSON.stringify(cardBox));
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({ path: path.join(artifacts, "accounts-lobby-" + width + ".png") });
    }
    await setNickname(page, "Ш".repeat(16));
    await until(
      () => page.locator("#previewName").evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      "full long nickname fits",
    );
    assert.equal(
      await page.locator(".profile-card").evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      true,
      "long nickname fits at 320",
    );
    await page.locator(".profile-card").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, "profile-long-name-320.png") });
    await setNickname(page, "Killex");
    await page.setViewportSize({ width: 1280, height: 960 });
    await page.locator("#lobbyAccessorySlots button").first().click();
    // Equip both sample accessories through the existing wardrobe.
    await page.getByRole("button", { name: "Шапки", exact: true }).click();
    await page.getByRole("button", { name: "Надеть Шапка новичка", exact: true }).click();
    await page.getByRole("button", { name: "Снять Шапка новичка", exact: true }).waitFor();
    await page.getByRole("button", { name: "Бабочки", exact: true }).click();
    await page.getByRole("button", { name: "Надеть Бабочка новичка", exact: true }).click();
    await page.getByRole("button", { name: "Снять Бабочка новичка", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.screenshot({ path: path.join(artifacts, "accounts-lobby-accessories.png") });
    await page.locator("#shopSection").click();
    await page
      .locator("#boosterDialog")
      .getByRole("button", { name: "Сундуки", exact: true })
      .click();
    const open = () => page.locator('[data-chest-id="novice"]').getByRole("button").click();
    const wallet = structuredClone(p().wallet),
      inventory = structuredClone(p().inventory);
    await open();
    await page
      .locator("#chestConfirmDialog")
      .getByRole("button", { name: "Нет", exact: true })
      .click();
    assert.equal(p().honors.pending, undefined);
    assert.deepEqual(p().wallet, wallet);
    await open();
    await page.screenshot({ path: path.join(artifacts, "chest-confirm-desktop.png") });
    await page
      .locator("#chestConfirmDialog")
      .getByRole("button", { name: "Да", exact: true })
      .click();
    await page.locator("#chestRewardDialog").waitFor({ state: "visible" });
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#chestRewardDialog img")].every(
        (i) => i.complete && i.naturalWidth,
      ),
    );
    const noviceReward = structuredClone(p().honors.pending);
    assert.deepEqual(p().wallet, wallet);
    assert.deepEqual(p().inventory, inventory);
    assert.equal(
      await page.locator(".chest-reward-item").count(),
      Object.keys(noviceReward.items).length + 3,
    );
    await page.screenshot({ path: path.join(artifacts, "chest-reward-desktop.png") });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page
          .locator("#chestRewardDialog")
          .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        true,
      );
      await page.screenshot({ path: path.join(artifacts, "chest-reward-" + width + ".png") });
    }
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page.locator("#shopSection").click();
    await page
      .locator("#boosterDialog")
      .getByRole("button", { name: "Сундуки", exact: true })
      .click();
    await page.getByRole("button", { name: "Забрать награду", exact: true }).click();
    await page
      .locator("#chestRewardDialog")
      .getByRole("button", { name: "Отлично", exact: true })
      .click();
    await until(() => p().honors.chests.novice === "opened", "claim");
    assert.equal(p().wallet.coins, wallet.coins + 2000);
    assert.deepEqual(p().inventory, noviceReward.items);
    await page.locator("#chestRewardDialog").waitFor({ state: "hidden" });
    await page.keyboard.press("Escape");
    // Exercise the newly available clan chest through the full UI, on a test profile.
    p().greatness = 500000;
    require("../../src/server/progression/title-chest-rewards").awardTitles(p(), wall);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page.locator("#shopSection").click();
    await page
      .locator("#boosterDialog")
      .getByRole("button", { name: "Сундуки", exact: true })
      .click();
    assert.equal(await page.locator(".chest-card h3").first().textContent(), "Сундук Новичка");
    assert.equal(await page.locator(".chest-card button:enabled").count(), 5);
    await page.screenshot({ path: path.join(artifacts, "chests-updated-320.png") });
    const vipBefore = p().account.vipUntil;
    await page.locator('[data-chest-id="experienced"] button').click();
    await page
      .locator("#chestConfirmDialog")
      .getByRole("button", { name: "Да", exact: true })
      .click();
    await page.locator("#chestRewardDialog").waitFor({ state: "visible" });
    assert.equal(
      await page.locator(".chest-reward-item").count(),
      Object.keys(p().honors.pending.items).length + 4,
    );
    assert.equal(p().account.vipUntil, vipBefore);
    await page.screenshot({ path: path.join(artifacts, "chest-experienced-reward-320.png") });
    await page
      .locator("#chestRewardDialog")
      .getByRole("button", { name: "Отлично", exact: true })
      .click();
    await until(() => p().honors.chests.experienced === "opened", "experienced claim");
    assert.equal(p().account.vipUntil, vipBefore + 3 * 86400000);
    await page.locator("#chestRewardDialog").waitFor({ state: "hidden" });
    await page.locator('[data-chest-id="pro"] button').click();
    await page
      .locator("#chestConfirmDialog")
      .getByRole("button", { name: "Да", exact: true })
      .click();
    await page.locator("#chestRewardDialog").waitFor({ state: "visible" });
    assert.equal(
      await page.locator(".chest-reward-item").count(),
      Object.keys(p().honors.pending.items).length + 4,
    );
    assert.equal(
      await page.locator("#chestRewardDialog").evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      true,
    );
    await page
      .locator("#chestRewardDialog")
      .getByRole("button", { name: "Отлично", exact: true })
      .click();
    await until(() => p().honors.chests.pro === "opened", "pro claim");
    await page.locator("#chestRewardDialog").waitFor({ state: "hidden" });
    if (lanMode) {
      // Кнопка «Получить» в сокровищнице использует отдельный обработчик запросов.
      const chest = require("../../src/server/clans/clan-chest-rewards").grant(p(), "high", wall, {
        claimRequired: true,
      });
      p().revision++;
      await ready();
      await page.locator("#inventorySection").click();
      await page.getByRole("button", { name: "Сундуки", exact: true }).click();
      await page.getByRole("button", { name: "Сокровищница", exact: true }).click();
      const card = page.locator(`[data-chest-id="${chest.id}"]`);
      await card.getByRole("button", { name: "Получить", exact: true }).click();
      await until(
        () => p().clanChests.items.find((c) => c.id === chest.id)?.stored,
        "LAN chest claim",
      );
      const coinsBefore = p().wallet.coins;
      await card.getByRole("button", { name: "Открыть", exact: true }).click();
      await page
        .locator("#chestConfirmDialog")
        .getByRole("button", { name: "Да", exact: true })
        .click();
      await page.locator("#chestRewardDialog").waitFor({ state: "visible" });
      const reward = structuredClone(p().clanChests.items.find((c) => c.id === chest.id).reward);
      assert.equal(p().wallet.coins, coinsBefore);
      await page
        .locator("#chestRewardDialog")
        .getByRole("button", { name: "Отлично", exact: true })
        .click();
      await until(() => !p().clanChests.items.some((c) => c.id === chest.id), "LAN chest reward");
      assert.equal(p().wallet.coins, coinsBefore + reward.coins);
      console.log("PASS: LAN treasury claim, chest opening and reward credit.");
    }
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1280, height: 960 });
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    const player = [...app.arena.players.values()][0];
    player.parts = [400, 1600].map((mass, i) => ({
      id: i ? "part-small" : player.id,
      mass,
      radius: radiusForMass(mass),
      x: 1000 + i * 400,
      y: 800,
      vx: 0,
      vy: 0,
    }));
    player.stopped = true;
    app.arena.syncParts(player);
    await page.evaluate(() => {
      window.shieldDraws = [];
      window.nameDraws = [];
      const proto = CanvasRenderingContext2D.prototype,
        draw = proto.drawImage,
        fill = proto.fillText,
        clear = proto.fillRect;
      proto.fillRect = function (...args) {
        if (this.canvas.id === "game" && args[0] === 0 && args[1] === 0) {
          window.shieldDraws = [];
          window.nameDraws = [];
        }
        return clear.apply(this, args);
      };
      proto.drawImage = function (img, ...args) {
        if (this.canvas.id === "game" && img.src?.includes("/shields/"))
          window.shieldDraws.push({ src: img.src, args });
        return draw.call(this, img, ...args);
      };
      proto.fillText = function (text, ...args) {
        if (this.canvas.id === "game" && String(text).includes("Killex"))
          window.nameDraws.push({
            fill: this.fillStyle,
            shadow: this.shadowColor,
            blur: this.shadowBlur,
          });
        return fill.call(this, text, ...args);
      };
    });
    timer = setInterval(() => app.broadcast(), 50);
    for (const id of ["golden_shield", "clan_shield", "colorful_shield"]) {
      player.effects = { [id]: time + 35000 };
      app.broadcast();
      await until(
        () =>
          page.evaluate(
            (id) =>
              window.shieldDraws.length === 2 &&
              window.shieldDraws.every((d) => d.src.endsWith(id + ".png")),
            id,
          ),
        "shield parts " + id,
      );
      assert.ok(
        (await page.evaluate(() => window.shieldDraws)).every((d) => d.src.endsWith(id + ".png")),
      );
      await page.screenshot({ path: path.join(artifacts, "shield-" + id + "-arena.png") });
    }
    assert.equal(await page.locator("#leaderList .title-medal").count(), 0);
    assert.equal(await page.locator("#leaderList .name-premium").count(), 1);
    await until(
      () => page.evaluate(() => window.nameDraws.some((d) => d.blur === 7 && d.fill === "#ef8cff")),
      "glowing name",
    );
    player.effects = {};
    await until(() => page.evaluate(() => window.shieldDraws.length === 0), "shield removed");
    await page.locator("#game").focus();
    await page.keyboard.press("KeyT");
    await until(
      () =>
        page
          .locator("#turboButton")
          .getAttribute("aria-pressed")
          .then((v) => v === "true"),
      "turbo active",
    );
    assert.equal(player.turbo.active, true);
    time += 10000;
    app.tick();
    await page.keyboard.press("KeyT");
    await until(
      () =>
        page
          .locator("#turboButton")
          .getAttribute("aria-pressed")
          .then((v) => v === "false"),
      "turbo paused",
    );
    const remaining = player.turbo.usedMs;
    assert.equal(remaining, 10000);
    const sweep = await page.locator("#turboButton .booster-slot-cooldown").getAttribute("style");
    await page.waitForTimeout(400);
    assert.equal(
      await page.locator("#turboButton .booster-slot-cooldown").getAttribute("style"),
      sweep,
    );
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const b = await page.locator(".booster-quick").boundingBox();
      assert.ok(b.x >= 0 && b.x + b.width <= width + 1);
      await page.screenshot({ path: path.join(artifacts, "turbo-arena-" + width + ".png") });
    }
    player.turbo.usedMs = 180000;
    app.broadcast();
    await page.keyboard.press("KeyT");
    await page.getByText("Турбо закончилось!", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: compact profile + long nickname at 320, Premium frame, account dates, chest names + six available, Novice reload/claim, Experienced + Pro claim/status extension, 3 shields × 2 parts, name glow, Turbo pause.",
    );
  } finally {
    clearInterval(timer);
    if (browser) await browser.close();
    await app.close();
    if (scratch.startsWith(directory + path.sep + ".tmp-accounts-"))
      fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
