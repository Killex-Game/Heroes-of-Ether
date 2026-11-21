"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  engines = require("playwright");
const publicRoot = path.resolve(__dirname, "../../public"),
  out = path.resolve(__dirname, "../../../../artifacts/clan-notice-expiry-20261026/browser"),
  styles = fs
    .readFileSync(path.join(publicRoot, "index.html"), "utf8")
    .match(/<link rel="stylesheet"[^>]+>/g)
    .join("\n");
fs.mkdirSync(out, { recursive: true });
const html =
  '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
  styles +
  "</head><body>" +
  '<script src="/shared/clan-competition-rules.js"></script>' +
  '<script src="/shared/progression-asset-paths.js"></script>' +
  '<script src="/ui/clans/clan-battle-and-treasury.js"></script></body></html>';
(async () => {
  for (const engine of ["chromium", "firefox", "webkit"]) {
    const browser = await engines[engine].launch({
      headless: true,
      ...(engine === "chromium" ? { channel: "chrome" } : {}),
    });
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } }),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", async (route) => {
        const relative = decodeURIComponent(new URL(route.request().url()).pathname).replace(
          /^\/+/,
          "",
        );
        if (!relative) return route.fulfill({ contentType: "text/html", body: html });
        const file = path.resolve(publicRoot, relative);
        if (!file.startsWith(publicRoot + path.sep)) return route.abort();
        try {
          await route.fulfill({ path: file });
        } catch {
          await route.abort();
        }
      });
      await page.clock.install({ time: new Date("2026-11-15T10:00:00Z") });
      await page.goto("http://notice-expiry.test/");
      await page.clock.pauseAt(new Date("2026-11-15T10:00:10Z"));
      await page.evaluate(() => {
        const day = KillexClanRules.DAY,
          at = Date.UTC(2026, 9, 26, 10),
          received = performance.now();
        // Server time deliberately differs from the computer's clock.
        window.KillexAppearance = { now: () => at + performance.now() - received };
        window.profile = {
          clanChests: {
            capacity: 7,
            totalStored: 1,
            items: [
              {
                id: "saved-chest",
                stored: true,
                tier: "high",
                art: "master",
                name: "Клановый сундук",
                expiresAt: at + day,
              },
            ],
            notices: [
              { id: "expired", at: at - day, text: "Старое уведомление" },
              { id: "first", at: at - day + 1000, text: "Первая награда", notifiedAt: at },
              { id: "second", at: at - day + 2000, text: "Вторая награда" },
            ],
          },
        };
        window.inventory = new KillexClanChestInventory({
          profile,
          purchasesBlocked: () => false,
        });
        document.body.append(inventory.root);
        inventory.render();
        inventory.root.querySelector("details").open = true;
        window.chestNode = inventory.root.querySelector(".clan-owned-chest");
        window.beforeChests = JSON.stringify(profile.clanChests.items);
      });
      const details = page.locator(".clan-reward-notices");
      assert.equal(await details.locator(".clan-notice-card").count(), 2);
      await page.clock.runFor(999);
      assert.equal(await details.locator(".clan-notice-card").count(), 2);
      await page.clock.runFor(1);
      assert.equal(await details.locator(".clan-notice-card").count(), 1);
      assert.equal(await details.locator("summary").innerText(), "Уведомления о наградах: 1");
      assert.equal(await details.evaluate((node) => node.open), true);
      assert.equal(
        await page.evaluate(() => chestNode === inventory.root.querySelector(".clan-owned-chest")),
        true,
      );
      await details.screenshot({ path: path.join(out, engine + "-remaining.png") });
      await page.clock.runFor(1000);
      assert.equal(await details.isVisible(), false);
      assert.equal(
        await page.evaluate(() => JSON.stringify(profile.clanChests.items) === beforeChests),
        true,
      );
      await page.evaluate(() => {
        profile.clanChests.notices.push({
          id: "new",
          at: KillexAppearance.now(),
          text: "Новая награда",
        });
        inventory.render();
        inventory.act = (action, id) => {
          if (action !== "dismiss") throw Error("Wrong action");
          profile.clanChests.notices = profile.clanChests.notices.filter((n) => n.id !== id);
          inventory.render();
        };
      });
      assert.equal(await details.locator(".clan-notice-card").count(), 1);
      await details.getByRole("button", { name: "Прочитано", exact: true }).click();
      assert.equal(await details.isVisible(), false);
      assert.deepEqual(errors, []);
      console.log(engine + ": passed");
    } finally {
      await browser.close();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
