"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  playwright = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { createGameServer } = require("../../src/server/game-server"),
  daily = require("../../src/server/rankings/daily-leaderboards"),
  lucky = require("../../src/server/events/lucky-week");
const artifacts = path.resolve(__dirname, "../../../../artifacts/daily-top-notice-20261024/browser");
fs.mkdirSync(artifacts, { recursive: true });
let at = Date.parse("2026-10-21T20:59:00Z"),
  browser;
const profiles = new ProfileStore({ now: () => at });
const app = createGameServer({ profiles, autoTick: false, wallNow: () => at });
const report = [];
async function deliver(page) {
  await page.evaluate(async () => {
    const { profile } = await (await fetch("/api/profile")).json();
    document.dispatchEvent(new CustomEvent("killex:profile", { detail: profile }));
  });
}
(async () => {
  try {
    await new Promise((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    for (const engine of ["chromium", "firefox", "webkit"]) {
      browser = await playwright[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      for (const width of [1366, 390, 320]) {
        const users = [profiles.open(), profiles.open(), profiles.open()],
          user = users[0];
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        await context.addCookies([{ name: "sferorumiya_session", value: user.token, url }]);
        const page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        for (const [i, u] of users.entries())
          profiles.transact(u.token, randomUUID(), "seed", (p) => {
            p.daily = {
              day: daily.dayAt(at),
              kills: 30 - i,
              arenaSeconds: 30 - ((i + 1) % 3),
              greatness: 30 - ((i + 2) % 3),
            };
          });
        await page.goto(url);
        await page.waitForFunction(() => !document.getElementById("playButton").disabled);
        assert.equal(await page.locator("#dailyRankingNotice").isVisible(), false);
        // A rollover while the player is on the arena must wait for the lobby.
        await page.evaluate(() => {
          document.body.dataset.screen = "arena";
        });
        at = daily.nextReset(at);
        profiles.refreshCompetition();
        const before = structuredClone(profiles.find(user.token));
        await deliver(page);
        assert.equal(await page.locator("#dailyRankingNotice").isVisible(), false);
        // Another open modal has priority, then the pending prize is shown automatically.
        await page.evaluate(() => {
          const d = document.createElement("dialog");
          d.id = "testBlockingDialog";
          document.body.append(d);
          d.showModal();
          document.body.dataset.screen = "lobby";
        });
        assert.equal(await page.locator("#dailyRankingNotice").isVisible(), false);
        await page.evaluate(() => document.getElementById("testBlockingDialog").close());
        const notice = page.locator("#dailyRankingNotice");
        await notice.waitFor({ state: "visible" });
        assert.equal(await notice.locator("article").count(), 3);
        const copy = await notice.textContent();
        for (const text of [
          "1 место",
          "2 место",
          "3 место",
          "+100 монет",
          "+7 кристаллов",
          "+1 величия",
          "уже зачислены",
        ])
          assert.ok(copy.includes(text), text);
        await page.waitForFunction(() =>
          [...document.querySelectorAll("#dailyRankingNotice img")].every(
            (n) => n.complete && n.naturalWidth,
          ),
        );
        const bounds = await notice.evaluate((n) => ({
          scroll: n.scrollWidth,
          width: n.clientWidth,
          left: n.getBoundingClientRect().left,
          right: n.getBoundingClientRect().right,
          viewport: innerWidth,
        }));
        assert.ok(
          bounds.scroll <= bounds.width + 1 && bounds.left >= 0 && bounds.right <= bounds.viewport,
          JSON.stringify(bounds),
        );
        await notice.screenshot({ path: path.join(artifacts, `${engine}-${width}.png`) });
        // Losing the response after the server commits must not change prizes on retry.
        if (engine === "chromium" && width === 1366) {
          let lose = true;
          await page.route("**/api/profile/daily-ranking-rewards/dismiss", async (route) => {
            if (!lose) return route.continue();
            lose = false;
            await route.fetch();
            await route.abort("failed");
          });
          await notice.getByRole("button", { name: "Отлично!", exact: true }).click();
          await page.waitForFunction(() =>
            document
              .querySelector(".daily-ranking-notice-error")
              .textContent.includes("Награды уже у тебя"),
          );
        }
        await notice.getByRole("button", { name: "Отлично!", exact: true }).click();
        await notice.waitFor({ state: "hidden" });
        assert.deepEqual(profiles.find(user.token).dailyRankingRewards, []);
        assert.deepEqual(profiles.find(user.token).wallet, before.wallet);
        assert.equal(profiles.find(user.token).greatness, before.greatness);
        await page.reload();
        await page.waitForFunction(() => !document.getElementById("playButton").disabled);
        assert.equal(await notice.isVisible(), false);
        assert.deepEqual(errors, []);
        report.push({
          engine,
          width,
          rows: 3,
          reloadSilent: true,
          arenaDeferred: true,
          walletUnchanged: true,
        });
        console.log(engine + " " + width + " passed");
        await context.close();
        at += 1000;
      }
      await browser.close();
      browser = null;
    }
    fs.writeFileSync(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
