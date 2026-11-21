"use strict";
// Isolated server and profiles. Never reads production saves or changes their grants.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { once } = require("node:events"),
  engines = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { createGameServer } = require("../../src/server/game-server");
const { Arena } = require("../../src/server/arena/arena-simulation");
const chests = require("../../src/server/clans/clan-chest-rewards");
const accounts = require("../../src/server/accounts/account-benefits");
const out = path.resolve(__dirname, "../../../../artifacts/arena-chests-frames-20261101/browser");
fs.mkdirSync(out, { recursive: true });
(async () => {
  for (const engine of ["chromium", "firefox", "webkit"]) {
    let now = Date.now();
    const start = now,
      profiles = new ProfileStore({ now: () => now, unlockLeagueFrames: true });
    const user = profiles.open(),
      p = profiles.find(user.token);
    p.name = "Проверка хранилища";
    p.account = { ...accounts.fresh(), vipUntil: now + 3600000, premiumUntil: now + 60000 };
    p.appearance = {
      ...p.appearance,
      avatarFrame: "premium",
      arenaFrame: "premium",
      uiTheme: "glass",
      lobbyBackground: "glass",
      purchasedThemes: { glass: now },
    };
    for (let n = 0; n < 15; n++) {
      const chest = chests.grant(p, ["low", "medium", "high"][n % 3], now + n);
      chests.act(p, "claim", chest.id, now + n);
    }
    for (const n of p.clanChests.notices) n.notifiedAt = now;
    profiles.save(profiles.data);
    const app = createGameServer({
      profiles,
      arena: new Arena({ etherCount: 0 }),
      autoTick: false,
      wallNow: () => now,
    });
    let browser;
    try {
      app.httpServer.listen(0, "127.0.0.1");
      await once(app.httpServer, "listening");
      const url = "http://127.0.0.1:" + app.httpServer.address().port;
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await context.addCookies([{ name: "sferorumiya_session", value: user.token, url }]);
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.clock.install({ time: new Date(now) });
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
      assert.equal(await page.locator("#skinPreview").getAttribute("data-arena-frame"), "premium");
      for (const size of [
        { width: 1366, height: 900 },
        { width: 900, height: 700 },
      ]) {
        await page.setViewportSize(size);
        await page.evaluate(() =>
          document.dispatchEvent(
            new CustomEvent("killex:open-chests", { detail: { category: "treasury" } }),
          ),
        );
        const dialog = page.locator("#boosterDialog"),
          queue = dialog.locator(".treasury-waiting");
        await dialog.waitFor({ state: "visible" });
        assert.equal(await dialog.locator(".clan-owned-chest").count(), 12);
        assert.match(await queue.innerText(), /Вне Сокровищницы: 3/);
        assert.equal(await queue.locator(".treasury-waiting-row").count(), 3);
        assert.equal(
          await dialog
            .locator(".clan-owned-chest")
            .first()
            .getByText("Без срока открытия", { exact: true })
            .count(),
          1,
        );
        const dimensions = await dialog.evaluate((el) => ({
          w: el.clientWidth,
          sw: el.scrollWidth,
          r: el.getBoundingClientRect().right,
          b: el.getBoundingClientRect().bottom,
          vw: innerWidth,
          vh: innerHeight,
        }));
        assert.ok(
          dimensions.sw <= dimensions.w + 1 &&
            dimensions.r <= dimensions.vw + 1 &&
            dimensions.b <= dimensions.vh + 1,
          JSON.stringify(dimensions),
        );
        await queue.scrollIntoViewIfNeeded();
        await dialog.screenshot({ path: path.join(out, `${engine}-${size.width}-queue.png`) });
        await dialog.locator(".clan-reward-notices").evaluate((el) => {
          el.open = true;
        });
        const actions = dialog.locator(".clan-notice-actions").first();
        await actions.scrollIntoViewIfNeeded();
        const gap = await actions.evaluate((el) => {
          const a = el.children[0].getBoundingClientRect(),
            b = el.children[1].getBoundingClientRect();
          return b.left - a.right;
        });
        assert.ok(gap >= 7, "notification buttons gap: " + gap);
        await actions
          .locator("..")
          .screenshot({ path: path.join(out, `${engine}-${size.width}-notice.png`) });
        await page.evaluate(() => document.getElementById("boosterDialog").close());
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.locator("#skinsSection").click();
      await page.getByRole("button", { name: "Рамки профиля", exact: true }).click();
      const premium = page.locator('[data-appearance-slot="frames"] [data-theme-id="premium"]');
      assert.equal(await premium.getAttribute("data-locked"), "false");
      assert.doesNotMatch(await premium.innerText(), /Бессрочно|Тестовый доступ/);
      await premium.screenshot({ path: path.join(out, engine + "-premium-active.png") });
      // Real expiry timer, without closing/reopening the selection window.
      now = start + 61000;
      await page.clock.fastForward(61000);
      await page.waitForFunction(
        () =>
          document.querySelector('[data-appearance-slot="frames"] [data-theme-id="premium"]')
            .dataset.locked === "true",
      );
      assert.equal(await premium.locator("button").isDisabled(), true);
      assert.equal(await page.locator("#skinPreview").getAttribute("data-arena-frame"), "default");
      assert.equal(
        await page.locator("#openSelfProfile").getAttribute("data-avatar-frame"),
        "default",
      );
      await premium.screenshot({ path: path.join(out, engine + "-premium-expired.png") });
      // Premium expiry leaves VIP capacity: the two newest stored chests join the queue.
      profiles.open(user.token);
      assert.equal(profiles.find(user.token).clanChests.items.filter((c) => c.stored).length, 10);
      assert.equal(profiles.find(user.token).clanChests.items.filter((c) => !c.stored).length, 5);
      assert.ok(
        profiles
          .find(user.token)
          .clanChests.items.filter((c) => c.stored)
          .every((c) => c.expiresAt === null),
      );
      assert.deepEqual(errors, []);
      console.log(
        engine + ": treasury queue, 8px actions, live account expiry passed at 1366 and 900px",
      );
    } finally {
      await browser?.close();
      await app.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
