"use strict";
// Isolated in-memory profiles, no production data or live server restarts.
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { once } = require("node:events");
const { chromium } = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { createGameServer } = require("../../src/server/game-server");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const C = require("../../src/server/clans/clan-chest-rewards");
const T = require("../../src/server/progression/treasury-capacity");
const accounts = require("../../src/server/accounts/account-benefits");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
const view = require("../../public/shared/arena-camera-and-layout");
const out = path.resolve(__dirname, "../../../../backups/treasury-queue-20261105/browser");
fs.mkdirSync(out, { recursive: true });
let wall = Date.now(),
  clock = 1000,
  browser,
  broadcast;
const profiles = new ProfileStore({ now: () => wall });
const auth = profiles.open(),
  p = profiles.find(auth.token);
p.name = "Проверка камеры";
p.account = { ...accounts.fresh(), vipUntil: wall + 60000, premiumUntil: wall + 60000 };
for (let i = 0; i < 12; i++) {
  const c = C.grant(p, ["low", "medium", "high"][i % 3], wall);
  C.act(p, "claim", c.id, wall);
}
C.grant(p, "high", wall);
for (const b of [...BOOSTERS.values()].filter((b) => b.ready)) p.inventory[b.id] = 30;
p.easter = {
  runs: {},
  chests: [],
  batches: [
    { count: 30, expiresAt: require("../../src/server/events/easter-hunt").expiresAt(wall) },
  ],
  trophies: [],
};
p.loginReward = { date: accounts.loginRewardDay(wall), day: 1 };
for (const n of p.clanChests.notices) n.notifiedAt = wall;
profiles.save(profiles.data);
const app = createGameServer({
  profiles,
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  wallNow: () => wall,
  now: () => clock,
  rateNow: () => performance.now(),
  testBots: { enabled: false },
});
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await context.addCookies([{ name: "sferorumiya_session", value: auth.token, url }]);
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
    await page.locator("#inventorySection").click();
    const dialog = page.locator("#boosterDialog");
    await page.waitForFunction(
      () => document.querySelectorAll("#boosterGrid .booster-card").length > 10,
    );
    assert.equal(await dialog.locator(".booster-filters").count(), 0);
    const ids = await dialog
      .locator("#boosterGrid .booster-card")
      .evaluateAll((els) => els.map((e) => e.dataset.boosterId));
    const rarity = { common: 0, advanced: 1, rare: 2, clan: 3, event: 4 };
    const tiers = ids.map((id) => rarity[BOOSTERS.get(id).tier]);
    assert.deepEqual(
      tiers,
      [...tiers].sort((a, b) => a - b),
    );
    assert.ok(
      tiers.includes(0) &&
        tiers.includes(1) &&
        tiers.includes(2) &&
        tiers.includes(3) &&
        tiers.includes(4),
    );
    await dialog.locator('[data-booster-id="candy"] .booster-action').click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-booster-id="candy"] .booster-action')
          .getAttribute("aria-pressed") === "true",
    );
    assert.ok(profiles.find(auth.token).quickSlots.includes("candy"));
    await dialog.screenshot({ path: path.join(out, "inventory.png") });
    await dialog.getByRole("button", { name: "Сундуки", exact: true }).click();
    await dialog.getByRole("button", { name: "Сокровищница", exact: true }).click();
    assert.equal(await dialog.locator(".clan-owned-chest").count(), 12);
    assert.match(await dialog.locator(".treasury-waiting").innerText(), /Вне Сокровищницы: 1/);
    await dialog.getByRole("button", { name: "Закрыть бустеры" }).click();
    wall += 61000;
    profiles.refreshCompetition();
    assert.equal(T.stored(profiles.find(auth.token)), 7);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
    await page.evaluate(() =>
      document.dispatchEvent(
        new CustomEvent("killex:open-chests", { detail: { category: "treasury" } }),
      ),
    );
    await dialog.waitFor({ state: "visible" });
    assert.equal(await dialog.locator(".clan-owned-chest").count(), 7);
    const queue = dialog.locator(".treasury-waiting");
    assert.match(await queue.innerText(), /Вне Сокровищницы: 6/);
    const rows = await queue.locator(".treasury-waiting-row").allTextContents();
    assert.ok(rows.every((s) => s.includes("Сгорит")));
    assert.equal(await queue.getByRole("button", { name: "Получить", exact: true }).count(), 1);
    await queue.scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: path.join(out, "treasury-expired-accounts.png") });
    await dialog.getByRole("button", { name: "Закрыть бустеры" }).click();
    await page.setViewportSize({ width: 1920, height: 960 });
    await page.evaluate(() => {
      const original = window.KillexArenaView.updateZoom;
      window.KillexArenaView.updateZoom = function (camera, target, ...args) {
        original(camera, target, ...args);
        window.cameraSample = { target, scale: camera.scale, x: camera.x, y: camera.y };
      };
    });
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    const me = [...app.arena.players.values()].find((x) => x.profileId === p.id);
    assert.ok(me);
    const results = [];
    // Advance snapshot timestamps without moving the fixed test arrangement.
    // Interpolation needs new ticks to finish the normal spawn fade-in.
    broadcast = setInterval(() => {
      clock += 50;
      app.arena.tick++;
      app.broadcast();
    }, 50);
    for (const orientation of ["vertical", "horizontal"]) {
      const mass = 65000,
        radius = radiusForMass(mass / 16);
      me.parts = Array.from({ length: 16 }, (_, i) => {
        const x = (Math.floor(i / 4) - 1.5) * radius * 1.6,
          y = ((i % 4) - 1.5) * radius * 2.5;
        return {
          id: "fixture-" + i,
          mass: mass / 16,
          radius,
          x: 3000 + (orientation === "vertical" ? x : y),
          y: 2000 + (orientation === "vertical" ? y : x),
          vx: 0,
          vy: 0,
          mergeAt: 1000000,
        };
      });
      me.stopped = true;
      me.spawnSerial++;
      app.arena.syncParts(me);
      app.broadcast();
      const expected = view.desiredScale(me, 1920, 960, app.arena.world);
      await page.waitForFunction(
        (target) => Math.abs(window.cameraSample?.scale - target) < 0.001,
        expected,
      );
      await page.waitForTimeout(200);
      const sample = await page.evaluate(() => window.cameraSample);
      results.push({ orientation, ...sample });
      await page.screenshot({ path: path.join(out, "camera-" + orientation + ".png") });
    }
    assert.ok(results[0].scale / results[1].scale > 0.82);
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(out, "results.json"),
      JSON.stringify(
        { inventoryItems: ids.length, queueRows: rows.length, camera: results },
        null,
        2,
      ),
    );
    console.log(
      "Browser OK: grouped inventory + equip, 12→7 treasury with timed queue, vertical/horizontal 65k arena",
      results,
    );
  } finally {
    clearInterval(broadcast);
    if (browser) await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
