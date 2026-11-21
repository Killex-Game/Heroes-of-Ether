"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  engines = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { xpForLevel } = require("../../src/server/progression/experience-progression"),
  appearance = require("../../src/server/profiles/league-appearance"),
  catalog = require("../../public/shared/league-appearance");
const engine = process.argv.find((a) => a.startsWith("--engine="))?.split("=")[1] || "chromium";
const testFrames = process.argv.includes("--test-frames");
const selectedProfileFrame = testFrames ? "bronze" : "champions";
const selectedArenaFrame = selectedProfileFrame;
let now = Date.now();
const profiles = new ProfileStore({
    now: () => now,
    unlockLeagueBackgrounds: true,
    unlockLeagueFrames: testFrames,
  }),
  clans = new ClanService(profiles),
  own = profiles.open(),
  other = profiles.open(),
  p = profiles.find(own.token);
p.name = "Хранитель лиг";
p.level = 12;
p.progress.xp = xpForLevel(12);
p.wallet.coins = 10000;
if (!testFrames) {
  clans.mutate(own.token, {
    action: "create",
    requestId: randomUUID(),
    name: "Легенды",
    prefix: "ART",
    emblem: "astral",
    privacy: "open",
  });
  for (let rank = 1; rank <= 5; rank++) appearance.grant(profiles.find(own.token), rank, now);
}
const app = createGameServer({
  profiles,
  clans,
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  wallNow: () => now,
});
const artifacts = path.resolve(__dirname, "../artifacts/league-appearance");
fs.mkdirSync(artifacts, { recursive: true });
let browser;
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await engines[engine].launch({
      headless: true,
      ...(engine === "chromium" ? { channel: "chrome" } : {}),
    });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await context.addCookies([{ name: "sferorumiya_session", value: own.token, url }]);
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(r.status() + " " + r.url());
    });
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const openBackground = async () => {
      await page.locator("#settingsButton").click();
      await fits("#settingsMenu");
      assert.equal(await page.locator("#lobby #lobbyAppearanceButton").count(), 0);
      await page.locator("#settingsMenu").screenshot({
        path: path.join(artifacts, `${engine}-settings-${page.viewportSize().width}.png`),
      });
      await page.locator("#lobbyAppearanceButton").click();
      assert.equal(await page.locator("#settingsMenu").isVisible(), false);
    };
    const select = async (slot, id) => {
      const card = page.locator(`[data-appearance-slot="${slot}"] [data-theme-id="${id}"]`);
      await card.locator("button").click();
      await page.waitForFunction(
        ([slot, id]) =>
          document.querySelector(`[data-appearance-slot="${slot}"] [data-theme-id="${id}"]`)
            ?.dataset.selected === "true",
        [slot, id],
      );
    };
    const fits = async (selector) => {
      const box = await page.locator(selector).evaluate((el) => ({
        w: el.clientWidth,
        sw: el.scrollWidth,
        ...Object.fromEntries(
          ["left", "right", "top", "bottom"].map((k) => [k, el.getBoundingClientRect()[k]]),
        ),
        vw: innerWidth,
        vh: innerHeight,
      }));
      assert.ok(box.sw <= box.w + 1, selector + " horizontal overflow " + JSON.stringify(box));
      assert.ok(
        box.left >= -1 && box.right <= box.vw + 1 && box.top >= -1 && box.bottom <= box.vh + 1,
        selector + " outside viewport " + JSON.stringify(box),
      );
    };
    await openBackground();
    assert.equal(await page.locator("#appearanceDialog .appearance-card").count(), 7);
    await page
      .locator("#appearanceDialog")
      .screenshot({ path: path.join(artifacts, engine + "-background-gallery.png") });
    for (const theme of catalog.themes) {
      await select("theme", theme.id);
      await page.getByRole("button", { name: "Закрыть выбор оформления", exact: true }).click();
      assert.equal(await page.locator("#lobby").getAttribute("data-league-background"), theme.id);
      assert.ok(
        (
          await page.locator("#lobby").evaluate((el) => getComputedStyle(el).backgroundImage)
        ).includes(theme.id + "-lobby.svg"),
      );
      if (engine === "chromium")
        await page.screenshot({ path: path.join(artifacts, "lobby-" + theme.id + ".png") });
      await openBackground();
    }
    await page.keyboard.press("Escape");
    await page.locator("#wardrobeSection").click();
    await page
      .locator("#skinsDialog")
      .getByRole("button", { name: "Рамки профиля", exact: true })
      .click();
    if (testFrames) {
      assert.deepEqual(profiles.find(own.token).appearance.grants, {});
      assert.equal(
        await page.locator('[data-appearance-slot="frames"] [data-locked="true"]').count(),
        0,
      );
      for (const theme of [...catalog.accountFrames, ...catalog.themes])
        await select("frames", theme.id);
      await select("frames", selectedProfileFrame);
      assert.equal(
        await page
          .locator('[data-appearance-slot="frames"] .appearance-availability')
          .getByText("Тестовый доступ", { exact: true })
          .count(),
        8,
      );
    } else await select("frames", "champions");
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".appearance-avatar .league-avatar-frame")].every(
        (i) => i.complete && i.naturalWidth,
      ),
    );
    await page
      .locator("#skinsDialog")
      .screenshot({ path: path.join(artifacts, engine + "-frames.png") });
    assert.equal(await page.getByRole("button", { name: "Рамки арены", exact: true }).count(), 0);
    assert.equal(profiles.find(own.token).appearance.avatarFrame, selectedProfileFrame);
    assert.equal(profiles.find(own.token).appearance.arenaFrame, selectedArenaFrame);
    assert.equal(
      await page
        .locator("#skinsDialog .cosmetics-tabs")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
    await page
      .locator("#skinsDialog")
      .screenshot({ path: path.join(artifacts, engine + "-arena-frames.png") });
    // Сам ободок меняется между кадрами; при reduced motion рисунок стабилен.
    const render = () =>
      page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 400;
        const ctx = canvas.getContext("2d"),
          results = [];
        for (const theme of [
          ...window.KillexLeagueAppearance.themes,
          ...window.KillexLeagueAppearance.accountFrames,
        ]) {
          const frames = [];
          for (const at of [0, 1900]) {
            ctx.clearRect(0, 0, 400, 400);
            window.KillexArenaArt.selectedFrame(ctx, theme.id, null, 200, 200, 140, 1, at);
            const pixels = ctx.getImageData(0, 0, 400, 400).data;
            let maxRadius = 0;
            for (let y = 0; y < 400; y++)
              for (let x = 0; x < 400; x++)
                if (pixels[(y * 400 + x) * 4 + 3])
                  maxRadius = Math.max(maxRadius, Math.hypot(x + 0.5 - 200, y + 0.5 - 200));
            frames.push({ data: canvas.toDataURL(), pixels, maxRadius });
          }
          results.push({
            id: theme.id,
            changes: frames[0].data !== frames[1].data,
            delta: frames[0].pixels.reduce(
              (max, value, i) => Math.max(max, Math.abs(value - frames[1].pixels[i])),
              0,
            ),
            extent: Math.max(...frames.map((f) => f.maxRadius)),
          });
        }
        return results;
      });
    assert.ok((await render()).every((result) => result.delta > 20 && result.extent <= 148.7));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    // Повторная растеризация Canvas может отличаться на 1–2 единицы канала.
    assert.ok((await render()).every((result) => result.delta <= 2));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForFunction(() => !matchMedia("(prefers-reduced-motion: reduce)").matches);
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#openSelfProfile").getAttribute("data-avatar-frame"),
      selectedProfileFrame,
    );
    assert.equal(
      await page.locator("#skinPreview").getAttribute("data-arena-frame"),
      selectedArenaFrame,
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#lobby .appearance-rim-canvas")].every(
        (c) =>
          c.width > 16 &&
          c
            .getContext("2d")
            .getImageData(0, 0, c.width, c.height)
            .data.some((v, i) => i % 4 === 3 && v > 0),
      ),
    );
    await page.screenshot({ path: path.join(artifacts, `${engine}-lobby-arena-frame.png`) });
    await page.locator("#openSelfProfile").click();
    assert.equal(
      await page.locator(".public-player-avatar").getAttribute("data-avatar-frame"),
      selectedProfileFrame,
    );
    const headerFrame = page.locator("#openSelfProfile .league-avatar-frame");
    const profileFrame = page.locator(".public-player-avatar .league-avatar-frame");
    assert.equal(
      await headerFrame.getAttribute("src"),
      catalog.source(selectedProfileFrame, "frame"),
    );
    assert.equal(await profileFrame.getAttribute("src"), await headerFrame.getAttribute("src"));
    await page.waitForFunction(() =>
      [
        ...document.querySelectorAll(
          "#openSelfProfile .league-avatar-frame, .public-player-avatar .league-avatar-frame",
        ),
      ].every((img) => img.complete && img.naturalWidth > 0),
    );
    await page.getByRole("button", { name: "Изменить фон мини-профиля", exact: true }).click();
    for (const theme of catalog.themes) {
      await select("profileBackground", theme.id);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#playerProfileDialog").isVisible(), true);
      assert.equal(
        await page.locator(".public-player-hero").getAttribute("data-league-background"),
        theme.id,
      );
      if (engine === "chromium")
        await page
          .locator("#playerProfileDialog")
          .screenshot({ path: path.join(artifacts, "profile-" + theme.id + ".png") });
      await page.getByRole("button", { name: "Изменить фон мини-профиля", exact: true }).click();
    }
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    assert.equal(await page.locator("#lobby").getAttribute("data-league-background"), "champions");
    assert.equal(
      await page.locator("#openSelfProfile").getAttribute("data-avatar-frame"),
      selectedProfileFrame,
    );
    await page.evaluate((id) => window.KillexPlayerProfile.open(id), other.profile.id);
    await page.locator(".public-player-hero").waitFor();
    assert.equal(await page.locator(".public-background-edit").count(), 0);
    await page.keyboard.press("Escape");
    for (const size of [
      { width: 1366, height: 768 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(size);
      assert.ok(
        await page.locator("#lobby").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        "lobby horizontal overflow",
      );
      await openBackground();
      await fits("#appearanceDialog");
      await page
        .locator("#appearanceDialog")
        .screenshot({ path: path.join(artifacts, `${engine}-picker-${size.width}.png`) });
      await page.keyboard.press("Escape");
      await page.locator("#wardrobeSection").click();
      await page
        .locator("#skinsDialog")
        .getByRole("button", { name: "Рамки профиля", exact: true })
        .click();
      await fits("#skinsDialog");
      await page
        .locator("#skinsDialog")
        .screenshot({ path: path.join(artifacts, `${engine}-frames-${size.width}.png`) });
      await page.keyboard.press("Escape");
      await page.locator("#openSelfProfile").click();
      await page.locator(".public-player-hero").waitFor();
      await fits("#playerProfileDialog");
      await page
        .locator("#playerProfileDialog")
        .screenshot({ path: path.join(artifacts, `${engine}-profile-${size.width}.png`) });
      await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.evaluate(() => {
      window.drawnLeagueFrames = [];
      const draw = window.KillexArenaArt.selectedFrame;
      window.KillexArenaArt.selectedFrame = function (ctx, id, ...args) {
        if (ctx.canvas.id === "game") window.drawnLeagueFrames.push(id);
        if (window.drawnLeagueFrames.length > 100) window.drawnLeagueFrames.shift();
        return draw(ctx, id, ...args);
      };
    });
    await page.locator("#playButton").click();
    await page.waitForFunction(
      (id) => document.body.dataset.screen === "arena" && window.drawnLeagueFrames.includes(id),
      selectedArenaFrame,
    );
    await page.screenshot({
      path: path.join(artifacts, `${engine}-arena-${selectedArenaFrame}.png`),
    });
    await page.locator("#settingsButton").click();
    assert.equal(await page.locator("#lobbyAppearanceButton").isVisible(), false);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    now += appearance.MONTH + 1;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await openBackground();
    assert.equal(
      await page
        .locator('[data-appearance-slot="theme"] [data-theme-id="silver"] button')
        .isDisabled(),
      false,
    );
    assert.equal(
      await page
        .locator('[data-appearance-slot="theme"] [data-theme-id="champions"]')
        .getAttribute("data-selected"),
      "true",
    );
    assert.deepEqual(errors, []);
    if (testFrames) assert.deepEqual(profiles.find(own.token).appearance.grants, {});
    console.log(
      engine +
        (testFrames ? " (all frames, no league grants)" : "") +
        ": 18 assets, selection, reload, own/other profile, nested dialogs, 3 viewports, expiry OK",
    );
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
