"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  engines = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  chests = require("../../src/server/clans/clan-chest-rewards"),
  quests = require("../../src/server/progression/personal-quests"),
  { fresh, WEEK } = require("../../src/server/accounts/account-benefits"),
  { xpForLevel } = require("../../src/server/progression/experience-progression");
const out = path.resolve(__dirname, "../../../../artifacts/ether-20261026/browser");
fs.mkdirSync(out, { recursive: true });
const report = [];
async function until(check) {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(check(), "Receipt did not persist");
}
(async () => {
  for (const engine of process.argv[2] ? [process.argv[2]] : ["chromium", "firefox", "webkit"]) {
    const profiles = new ProfileStore(),
      auth = profiles.open(),
      get = () => profiles.find(auth.token);
    get().level = 12;
    get().progress.xp = xpForLevel(12);
    get().account = fresh();
    get().account.premiumUntil = Date.now() + WEEK;
    chests.grant(get(), "high", profiles.now(), { claimRequired: true });
    chests.notice(get(), "Награда за неделю: Бронзовая. Призовое место: 1.", profiles.now());
    const q = quests.ensure(get(), profiles.now());
    q.pending.push({
      ...quests.makeReward("large", profiles.now(), false),
      id: "quest-first",
      questId: "giant",
      title: "Великан",
      stored: true,
    });
    const app = createGameServer({ profiles, autoTick: false, testBots: { enabled: false } });
    let browser;
    try {
      app.httpServer.listen(0, "127.0.0.1");
      await once(app.httpServer, "listening");
      const url = `http://127.0.0.1:${app.httpServer.address().port}`;
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await context.addCookies([
        { name: "sferorumiya_session", value: auth.token, url, httpOnly: true },
      ]);
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const ready = () =>
        page.waitForFunction(() => !document.getElementById("playButton").disabled);
      const refresh = () =>
        page.evaluate(() => document.dispatchEvent(new CustomEvent("killex:events-changed")));
      const toast = page.locator(".clan-reward-toast:popover-open");
      await page.goto(url);
      await ready();
      await toast.waitFor();
      assert.equal(await toast.locator(".clan-notice-card").count(), 3);
      await until(
        () =>
          get().clanChests.notices.every((n) => n.notifiedAt !== undefined) &&
          get().quests.pending[0].notifiedAt !== undefined,
      );
      // Acknowledging the display must not close the visible notification or claim rewards.
      assert.equal(await toast.count(), 1);
      assert.equal(get().clanChests.items[0].stored, false);
      for (const width of [1366, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const box = await toast.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 901);
        await toast.screenshot({ path: path.join(out, `${engine}-${width}-notices.png`) });
      }
      // Reload without dismissing: neither server nor local fallback may repeat the popup.
      await page.reload();
      await ready();
      assert.equal(await toast.count(), 0);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await ready();
      assert.equal(await toast.count(), 0);
      await page.route("**/api/clan-chests/action", (r) =>
        r.request().postDataJSON()?.action === "notice" ? r.abort() : r.continue(),
      );
      chests.notice(get(), "Новая награда при обрыве связи", profiles.now());
      get().revision++;
      await refresh();
      await toast.waitFor();
      assert.equal(await toast.locator(".clan-notice-card").count(), 1);
      assert.equal(get().clanChests.notices.at(-1).notifiedAt, undefined);
      await page.reload();
      await ready();
      assert.equal(await toast.count(), 0);
      await page.unroute("**/api/clan-chests/action");
      await until(() => get().clanChests.notices.at(-1).notifiedAt !== undefined);
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.locator("#inventorySection").click();
      assert.match(await page.locator("#boosterDialog").textContent(), /с Premium — 6\./);
      chests.notice(get(), "Новая награда после закрытия окна", profiles.now());
      get().revision++;
      await refresh();
      await page.waitForTimeout(250);
      assert.equal(await toast.count(), 0);
      assert.equal(get().clanChests.notices.at(-1).notifiedAt, undefined);
      await page.getByRole("button", { name: "Закрыть бустеры" }).click();
      await toast.waitFor();
      assert.equal(await toast.locator(".clan-notice-card").count(), 1);
      await until(() => get().clanChests.notices.at(-1).notifiedAt !== undefined);
      await page.getByRole("button", { name: "Закрыть уведомления о наградах" }).click();
      await page.locator('#walletStatus .currency-add[data-currency="bucks"]').click();
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#donationDialog img")].every(
          (i) => i.complete && i.naturalWidth,
        ),
      );
      const purchase = page.locator("#donationDialog");
      assert.match(await purchase.innerText(), /Покупка эфира/);
      assert.doesNotMatch(await purchase.innerText(), /бакс/i);
      assert.ok(
        (
          await purchase.locator(".donation-card[data-package-id] img").first().getAttribute("src")
        ).includes("ether-v1/change.webp"),
      );
      await purchase.screenshot({ path: path.join(out, `${engine}-ether-purchase.png`) });
      await page.getByRole("button", { name: "Закрыть покупку эфира" }).click();
      await page.screenshot({ path: path.join(out, `${engine}-lobby-ether.png`) });
      const themeColors = [];
      for (const theme of [
        "default",
        "bronze",
        "silver",
        "gold",
        "platinum",
        "diamond",
        "champions",
      ]) {
        get().appearance.uiTheme = theme;
        if (theme !== "default")
          get().appearance.grants[theme] = theme === "champions" ? null : Date.now() + WEEK;
        get().revision++;
        await refresh();
        await page.waitForFunction((id) => document.documentElement.dataset.uiTheme === id, theme);
        await page.locator("#petsSection").click();
        await page.locator("#petsDialog").waitFor({ state: "visible" });
        const heading = page.locator(".pets-heading");
        const colors = await heading.evaluate((h) => {
          const style = getComputedStyle(h);
          const probe = document.createElement("div");
          probe.style.background =
            "linear-gradient(115deg, var(--ui-c-701c88), var(--ui-c-a94bc5) 60%, var(--ui-c-701c88))";
          h.append(probe);
          const expected = getComputedStyle(probe).backgroundImage;
          probe.remove();
          return { actual: style.backgroundImage, expected };
        });
        assert.equal(colors.actual, colors.expected);
        themeColors.push(colors.actual);
        if (["default", "diamond", "champions"].includes(theme))
          await heading.screenshot({ path: path.join(out, `${engine}-pets-${theme}.png`) });
        await page.locator("#petsDialog .pets-close").click();
      }
      assert.equal(new Set(themeColors).size, 7);
      const gold = await page.evaluate(async () => {
        const renderer = new KillexArenaArt.FoodRenderer();
        for (let i = 0; i < 100 && !renderer.tiles.size; i++)
          await new Promise((r) => setTimeout(r, 20));
        const canvas = document.createElement("canvas");
        canvas.width = 400;
        canvas.height = 100;
        canvas.id = "ether-test";
        canvas.style.cssText = "position:fixed;z-index:99999;left:10px;top:10px;background:#171637";
        document.body.append(canvas);
        const ctx = canvas.getContext("2d"),
          bounds = { left: 0, top: 0, right: 400, bottom: 100 };
        const orbs = [1, 2, 3, 5, 10, 50].map((value, i) => ({
          id: String(i),
          value,
          color: "#ff00ff",
          radius: 10,
          x: 32 + i * 64,
          y: 32,
        }));
        let draws = 0;
        const draw = renderer.draw.bind(renderer);
        renderer.draw = (...args) => {
          draws++;
          return draw(...args);
        };
        renderer.sync(orbs);
        renderer.drawVisible(ctx, bounds);
        const firstDraws = draws,
          layers = [...renderer.layers.values()];
        ctx.clearRect(0, 0, 400, 100);
        renderer.sync(orbs);
        renderer.drawVisible(ctx, bounds);
        const cached =
          draws === firstDraws &&
          layers.every((layer, i) => layer === [...renderer.layers.values()][i]);
        ctx.clearRect(0, 0, 400, 100);
        renderer.drawMoving(ctx, orbs, bounds);
        const pixel = [...ctx.getImageData(32, 32, 1, 1).data];
        const allGold = orbs.every((orb) => {
          const [r, g, b, a] = ctx.getImageData(orb.x, orb.y, 1, 1).data;
          return r > g && g > b + 30 && a > 200;
        });
        return {
          tileCount: renderer.tiles.size,
          uniqueTiles: new Set(renderer.tiles.values()).size,
          cached,
          movingDraws: draws - firstDraws,
          allGold,
          pixel,
        };
      });
      assert.equal(gold.tileCount, 5);
      assert.equal(gold.uniqueTiles, 1);
      assert.ok(gold.cached && gold.allGold && gold.movingDraws === 6, JSON.stringify(gold));
      assert.ok(
        gold.pixel[0] > gold.pixel[1] && gold.pixel[1] > gold.pixel[2] + 30 && gold.pixel[3] > 200,
        JSON.stringify(gold),
      );
      await page
        .locator("#ether-test")
        .screenshot({ path: path.join(out, `${engine}-ether-renderer.png`) });
      assert.deepEqual(errors, []);
      report.push({
        engine,
        noticesOnce: true,
        retryAfterDisconnect: true,
        deferredWhileDialogOpen: true,
        premiumHint: 6,
        gold,
      });
    } finally {
      if (browser) await browser.close();
      await app.close();
    }
  }
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
