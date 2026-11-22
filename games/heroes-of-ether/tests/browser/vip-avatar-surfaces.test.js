/* Пять VIP-портретов в наборе, лобби, гардеробе, топах, клане, чужом профиле и Canvas арены. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const WebSocket = require("ws");
const { chromium } = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { ClanService } = require("../../src/server/clans/clan-service");
const { createGameServer } = require("../../src/server/game-server");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { xpForLevel } = require("../../src/server/progression/experience-progression");
const skins = require("../../public/shared/player-identity").accountSkins.filter(
  (s) => s.tier === "vip",
);
const now = Date.now();
const profiles = new ProfileStore({ now: () => now });
const clans = new ClanService(profiles);
const users = skins.map((skin) => {
  const user = profiles.open();
  const profile = profiles.find(user.token);
  profile.name = skin.name;
  profile.level = 12;
  profile.progress.xp = xpForLevel(12);
  profile.wallet.coins = 10000;
  profile.account = {
    ...require("../../src/server/accounts/account-benefits").fresh(),
    vipUntil: now + 86400000,
  };
  profile.skinId = skin.id;
  return user;
});
clans.mutate(users[0].token, {
  action: "create",
  requestId: randomUUID(),
  name: "Золотой набор",
  prefix: "VIP",
  emblem: "astral",
  privacy: "open",
});
const clanId = profiles.find(users[0].token).clanId;
for (const user of users.slice(1))
  clans.mutate(user.token, { action: "apply", clanId, requestId: randomUUID() });
const app = createGameServer({
  profiles,
  clans,
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  now: () => 5000,
  wallNow: () => now,
  rateNow: () => performance.now(),
});
const artifacts = path.resolve(__dirname, "../artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let browser, timer;
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      deviceScaleFactor: 2,
    });
    await context.addCookies([{ name: "sferorumiya_session", value: users[0].token, url }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(response.status() + " " + response.url());
    });
    await page.addInitScript(() => {
      localStorage.setItem("sferorumiya.preferences.v1", JSON.stringify({ previewSkin: "vip-1" }));
      window.drawnVipAvatars = [];
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
        if (this.canvas.id === "game" && /\/skins\/transparent-v2\/1024\/vip-/.test(source?.src))
          if (!window.drawnVipAvatars.includes(source.src)) window.drawnVipAvatars.push(source.src);
        return draw.call(this, source, ...args);
      };
    });
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const loaded = async (selector, count) =>
      page.waitForFunction(
        ([selector, count]) => {
          const images = [...document.querySelectorAll(selector)];
          return (
            images.length === count &&
            images.every((image) => image.complete && image.naturalWidth > 0)
          );
        },
        [selector, count],
      );
    const assertAllFive = async (selector) => {
      await loaded(selector, 5);
      assert.deepEqual(
        (
          await page
            .locator(selector)
            .evaluateAll((images) => images.map((image) => image.dataset.skinId))
        ).sort(),
        skins.map((skin) => skin.id),
      );
    };
    await page.locator("#wardrobeSection").click();
    await page.locator("#skinsDialog").getByRole("button", { name: "Наборы", exact: true }).click();
    await page.locator('.avatar-set-showcase[data-set-id="vip"]').waitFor();
    await assertAllFive(".account-avatar img");
    assert.equal(
      await page.getByText("Купленных наборов пока нет.", { exact: false }).isVisible(),
      false,
    );
    for (const skin of skins) {
      await page.locator(".account-avatar").filter({ hasText: skin.name }).click();
      await loaded("#profileSkin,#lobbySkin,.collection-preview-image", 3);
      assert.equal(await page.locator("#lobbySkin").getAttribute("data-skin-id"), skin.id);
      assert.match(
        await page.locator("#profileSkin").evaluate((image) => image.currentSrc),
        /\/transparent-v2\/128\/vip-/,
      );
      assert.match(
        await page.locator("#lobbySkin").evaluate((image) => image.currentSrc),
        /\/transparent-v2\/1024\/vip-/,
      );
    }
    await page.locator(".account-avatar").filter({ hasText: "Король" }).click();
    await page
      .locator("#skinsDialog")
      .screenshot({ path: path.join(artifacts, "vip-avatar-set.png") });
    await page.keyboard.press("Escape");
    await page.locator("#wardrobeSection").click();
    await loaded(".wardrobe-preview img[data-skin-id]", 1);
    await page.keyboard.press("Escape");
    await page.locator("#rankingsButton").click();
    await assertAllFive("#topsDialog .avatar-disc img");
    for (const skin of skins) {
      await page
        .getByRole("button", { name: "Открыть профиль: " + skin.name, exact: true })
        .click();
      await loaded("#playerProfileDialog .avatar-disc img", 2);
      assert.equal(
        await page
          .locator("#playerProfileDialog .public-player-avatar img")
          .first()
          .getAttribute("data-skin-id"),
        skin.id,
      );
      await page.getByRole("button", { name: "Закрыть профиль игрока", exact: true }).click();
    }
    await page.keyboard.press("Escape");
    await page.locator("#clanSection").click();
    await assertAllFive(".clan-member-avatar .avatar-disc img");
    await page
      .locator("#clanDialog")
      .screenshot({ path: path.join(artifacts, "vip-avatar-clan.png") });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 320, height: 800 });
    await loaded("#profileSkin,#lobbySkin", 2);
    assert.ok(await page.locator("#profileSkin").evaluate((image) => image.naturalWidth > 0));
    await page.screenshot({ path: path.join(artifacts, "vip-avatar-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    for (const user of users.slice(1)) {
      const socket = new WebSocket(url.replace("http:", "ws:"), {
        headers: { Cookie: "sferorumiya_session=" + user.token },
      });
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error("No arena welcome")), 5000);
        socket.on("error", reject);
        socket.on("message", (raw) => {
          if (JSON.parse(raw).type === "welcome") {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
    }
    const positions = [
      [1200, 800],
      [950, 620],
      [1450, 620],
      [950, 980],
      [1450, 980],
    ];
    [...app.arena.players.values()].forEach((player, index) => {
      Object.assign(player, {
        x: positions[index][0],
        y: positions[index][1],
        mass: 600,
        radius: radiusForMass(600),
      });
    });
    app.broadcast();
    timer = setInterval(() => app.broadcast(), 100);
    await page.waitForFunction(() => window.drawnVipAvatars.length === 5);
    await page.waitForTimeout(800); // Камера завершает плавный переход к тестовым координатам.
    await page.screenshot({ path: path.join(artifacts, "vip-avatars-arena.png") });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: five VIP avatars in set, preview, lobby, wardrobe, rankings, player profiles, clan and arena; DPR 2 and mobile; no broken images.",
    );
  } finally {
    clearInterval(timer);
    if (browser) await browser.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
