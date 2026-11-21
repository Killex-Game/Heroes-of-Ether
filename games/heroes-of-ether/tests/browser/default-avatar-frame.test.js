"use strict";
const path = require("node:path"),
  fs = require("node:fs"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  playwright = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation");
const engine = process.argv[2] || "chromium",
  out = path.resolve(__dirname, "../../../../artifacts/clan-crest-unlocks-20261026"),
  profiles = new ProfileStore(),
  user = profiles.open(),
  p = profiles.find(user.token);
p.account = require("../../src/server/accounts/account-benefits").fresh();
p.account.vipUntil = Date.now() + 3600000;
p.account.premiumUntil = Date.now() + 3600000;
profiles.save(profiles.data);
const app = createGameServer({ profiles, arena: new Arena({ etherCount: 0 }) });
let browser,
  page,
  phase = "start";
fs.mkdirSync(out, { recursive: true });
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await playwright[engine].launch({
      headless: true,
      ...(engine === "chromium" ? { channel: "chrome" } : {}),
    });
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      screen: { width: 1920, height: 1080 },
    });
    await context.addCookies([{ name: "sferorumiya_session", value: user.token, url }]);
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
    async function noFrame(selector) {
      const info = await page.locator(selector).evaluate((n) => {
        const s = getComputedStyle(n),
          a = getComputedStyle(n, "::after");
        return {
          frame: n.dataset.avatarFrame || n.dataset.arenaFrame,
          images: n.querySelectorAll(".league-avatar-frame,.appearance-rim-canvas").length,
          shadow: s.boxShadow,
          border: s.borderTopColor,
          background: s.backgroundColor,
          after: a.display,
          content: a.content,
        };
      });
      assert.equal(info.frame, "default");
      assert.equal(info.images, 0);
      assert.equal(info.shadow, "none");
      assert.equal(info.border, "rgba(0, 0, 0, 0)");
      assert.equal(info.background, "rgba(0, 0, 0, 0)");
      assert.ok(info.after === "none" || info.content === "none", JSON.stringify(info));
    }
    await noFrame("#openSelfProfile");
    await noFrame("#skinPreview");
    phase = "explicit account frame then default";
    await page.locator("#wardrobeSection").click();
    await page.getByRole("button", { name: "Рамки профиля", exact: true }).click();
    const gallery = page.locator('[data-appearance-slot="frames"]');
    for (const id of ["vip", "premium", "default"]) {
      await gallery.locator(`[data-theme-id="${id}"] button`).click();
      await page.waitForFunction(
        (id) => document.querySelector("#openSelfProfile").dataset.avatarFrame === id,
        id,
      );
      assert.equal(profiles.find(user.token).appearance.avatarFrame, id);
      assert.equal(profiles.find(user.token).appearance.arenaFrame, id);
    }
    await noFrame("#openSelfProfile");
    await noFrame("#skinPreview");
    await page.screenshot({ path: path.join(out, `${engine}-default-selected.png`) });
    await page.keyboard.press("Escape");
    phase = "public profile";
    await page.locator("#openSelfProfile").click();
    await page.locator("#playerProfileDialog").waitFor({ state: "visible" });
    await noFrame("#playerProfileDialog .public-player-avatar");
    await page.screenshot({ path: path.join(out, `${engine}-profile-no-frame.png`) });
    await page.keyboard.press("Escape");
    await page.reload();
    await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
    await noFrame("#openSelfProfile");
    await noFrame("#skinPreview");
    phase = "arena";
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    const drawn = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const ctx = c.getContext("2d"),
        result = window.KillexArenaArt.selectedFrame(
          ctx,
          "default",
          { vip: true, premium: true },
          64,
          64,
          40,
          1,
          0,
        );
      return { result, pixels: Array.from(ctx.getImageData(0, 0, 128, 128).data).some(Boolean) };
    });
    assert.equal(drawn.result, false);
    assert.equal(drawn.pixels, false);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        engine,
        passed: true,
        surfaces: ["lobby avatar", "lobby preview", "public profile", "arena"],
        accountFramesSelectable: true,
        reload: true,
      }),
    );
  } catch (e) {
    console.error("Phase:", phase);
    await page?.screenshot({ path: path.join(out, `${engine}-frame-failure.png`) }).catch(() => {});
    throw e;
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
