"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  engines = require("playwright"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { xpForLevel } = require("../../src/server/progression/experience-progression"),
  chests = require("../../src/server/clans/clan-chest-rewards");
const output = path.resolve(
  __dirname,
  "../../../../artifacts/pet-access-clan-reward-20261025/browser",
);
fs.mkdirSync(output, { recursive: true });
const report = [];
(async () => {
  for (const engine of process.argv[2] ? [process.argv[2]] : ["chromium", "firefox", "webkit"]) {
    const profiles = new ProfileStore(),
      clans = new ClanService(profiles),
      auth = profiles.open(),
      get = () => profiles.find(auth.token),
      app = createGameServer({
        profiles,
        clans,
        arena: new Arena({ etherCount: 0 }),
        autoTick: false,
        testBots: { enabled: false },
      });
    get().level = 11;
    get().progress.xp = xpForLevel(11);
    get().wallet.coins = 20000;
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
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      for (const size of [
        { width: 1366, height: 900 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(size);
        assert.equal(await page.locator("#petsSection").isDisabled(), true);
        assert.match(await page.locator("#petsSection").getAttribute("title"), /12/);
        const [pet, clan] = await Promise.all([
          page.locator("#petsSection").boundingBox(),
          page.locator("#clanSection").boundingBox(),
        ]);
        assert.ok(Math.abs(pet.height - clan.height) <= 1);
        await page.locator(".promo-events").dispatchEvent("click");
        assert.equal(await page.locator("#petsDialog").evaluate((n) => n.open), false);
        await page.screenshot({ path: path.join(output, `${engine}-locked-${size.width}.png`) });
      }
      get().level = 12;
      get().progress.xp = xpForLevel(12);
      get().revision++;
      await page.evaluate(() =>
        document.dispatchEvent(new CustomEvent("killex:events-changed")),
      );
      await page.waitForFunction(() => !document.getElementById("petsSection").disabled);
      assert.equal(await page.locator(".promo-events").getAttribute("aria-disabled"), "false");
      await page.locator("#petsSection").click();
      await page.locator("#petsDialog[open]").waitFor();
      await page.keyboard.press("Escape");
      clans.mutate(auth.token, {
        action: "create",
        name: "Награда",
        prefix: "TEST",
        privacy: "open",
        emblem: "astral",
        requestId: randomUUID(),
      });
      const item = chests.grant(get(), "high", profiles.now(), {
        claimRequired: true,
        clanId: get().clanId,
      });
      get().revision++;
      await page.reload();
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      const treasury = async () => {
        await page.locator("#inventorySection").click();
        await page.getByRole("button", { name: "Сундуки", exact: true }).click();
        await page.getByRole("button", { name: "Сокровищница", exact: true }).click();
      };
      await treasury();
      assert.equal(await page.locator(`.clan-owned-chest[data-chest-id="${item.id}"]`).count(), 0);
      assert.match(await page.locator(".clan-owned-chests").innerText(), /Здесь хранятся/);
      const denied = await context.request.post(url + "/api/clan-chests/action", {
        data: { action: "prepare", chestId: item.id, requestId: randomUUID() },
      });
      assert.equal(denied.status(), 409);
      await page.keyboard.press("Escape");
      await page.locator("#clanSection").click();
      await page.locator(".clan-personal-reward-claim").waitFor();
      for (const size of [
        { width: 1366, height: 900 },
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(size);
        await page.waitForTimeout(200);
        await page.locator(".clan-personal-reward").scrollIntoViewIfNeeded();
        const geometry = await page.evaluate(() => {
          const rect = (s) => document.querySelector(s).getBoundingClientRect(),
            card = rect(".clan-personal-reward"),
            button = rect(".clan-personal-reward-claim"),
            note = rect(".clan-personal-reward-note"),
            row = rect(".clan-personal-reward-row");
          return {
            width: card.width,
            height: card.height,
            centered: Math.abs(card.x + card.width / 2 - row.x - row.width / 2) < 1,
            contained:
              button.x >= card.x && button.right <= card.right && button.bottom <= card.bottom,
            belowDate: button.top >= note.bottom,
            inViewport: card.bottom <= innerHeight && card.right <= innerWidth,
          };
        });
        assert.ok(
          geometry.centered &&
            geometry.contained &&
            geometry.belowDate &&
            geometry.inViewport &&
            geometry.width <= 361 &&
            geometry.height <= 125,
          JSON.stringify({ engine, size, geometry }),
        );
        await page.screenshot({ path: path.join(output, `${engine}-reward-${size.width}.png`) });
        report.push({ engine, size, geometry });
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      const response = page.waitForResponse(
        (r) => r.url().endsWith("/api/clan-chests/action") && r.request().method() === "POST",
      );
      await page.locator(".clan-personal-reward-claim").click();
      const claimed = await response;
      assert.equal(claimed.status(), 200);
      const retry = await context.request.post(url + "/api/clan-chests/action", {
        data: claimed.request().postDataJSON(),
      });
      assert.equal((await retry.json()).replay, true);
      assert.equal(get().clanChests.items.filter((c) => c.stored).length, 1);
      await page.getByRole("button", { name: "Закрыть кланы", exact: true }).click();
      await treasury();
      await page.locator(`.clan-owned-chest[data-chest-id="${item.id}"]`).waitFor();
      assert.equal(await page.locator(`.clan-owned-chest[data-chest-id="${item.id}"]`).count(), 1);
      assert.equal(await page.locator(".clan-owned-chest button").innerText(), "Открыть");
      assert.deepEqual(errors, []);
      console.log(`${engine}: level 11 locked, 12 unlocked, clan chest claimed once into Treasury`);
    } finally {
      await browser?.close();
      await app.close();
    }
  }
  fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify(report, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
