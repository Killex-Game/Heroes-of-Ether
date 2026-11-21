"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const playwright = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { createGameServer } = require("../../src/server/game-server");
const { xpForLevel } = require("../../src/server/progression/experience-progression"),
  rules = require("../../public/shared/daily-ranking-rules"),
  daily = require("../../src/server/rankings/daily-leaderboards"),
  kit = require("../../public/shared/clan-crest-rules");
const artifacts = path.resolve(__dirname, "../artifacts/daily-regalia");
fs.mkdirSync(artifacts, { recursive: true });
let at = Date.parse("2026-10-21T20:59:00Z");
const profiles = new ProfileStore({
    now: () => at,
    unlockLeagueBackgrounds: true,
    unlockLeagueFrames: true,
  }),
  clans = new ClanService(profiles);
const users = Array.from({ length: 4 }, () => profiles.open()),
  owner = users[0];
for (let day = 0; day < 3; day++) {
  for (let i = 0; i < 3; i++)
    profiles.transact(users[i].token, randomUUID(), "seed", (p) => {
      const score = 30 - ((i + day) % 3);
      p.daily = { day: daily.dayAt(at), kills: score, arenaSeconds: score * 100, greatness: score };
    });
  at += 86400000;
  profiles.refreshCompetition();
}
const p = profiles.find(owner.token);
p.level = 12;
p.progress.xp = xpForLevel(12);
p.wallet.coins = 10000;
clans.mutate(owner.token, {
  action: "create",
  requestId: randomUUID(),
  name: "Тестовый союз",
  prefix: "TEST",
  emblem: "astral",
  crest: { ...kit.DEFAULT, color: kit.colors[10].id },
  privacy: "open",
});
const clanId = profiles.find(owner.token).clanId;
for (let i = 0; i < 3; i++)
  profiles.transact(users[i].token, randomUUID(), "seed", (p) => {
    p.daily = { day: daily.dayAt(at), kills: 30 - i, arenaSeconds: 3000 - i, greatness: 30 - i };
  });
const app = createGameServer({ profiles, clans, autoTick: false, wallNow: () => at });
let browser;
const results = [];
async function until(fn) {
  for (let i = 0; i < 120; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error("Condition timed out");
}
(async () => {
  try {
    await new Promise((r) => app.httpServer.listen(0, "127.0.0.1", r));
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    for (const engine of ["chromium", "firefox", "webkit"]) {
      browser = await playwright[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const context = await browser.newContext();
      await context.addCookies([{ name: "sferorumiya_session", value: owner.token, url }]);
      for (const width of [1366, 390]) {
        profiles.data.clans[clanId].appearance.background = "default";
        const page = await context.newPage(),
          errors = [];
        await page.setViewportSize({ width, height: 900 });
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(url);
        await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
        await page.locator("#rankingsButton").click();
        for (const board of rules.boards) {
          await page.getByRole("button", { name: board.name, exact: true }).click();
          await until(() =>
            page
              .locator("[data-podium] .daily-rank-medal img")
              .first()
              .getAttribute("src")
              .then((s) => s.includes(board.medal + "-1")),
          );
          assert.equal(await page.locator("[data-podium]").count(), 3);
        }
        await page.locator('[data-podium="1"] .daily-rank-medal').hover();
        await page.locator("#boosterTooltip:popover-open").waitFor();
        assert.match(await page.locator("#boosterTooltip").textContent(), /100 монет/);
        await page.mouse.move(0, 0);
        await page.screenshot({ path: path.join(artifacts, `${engine}-tops-${width}.png`) });
        await page.locator('[data-podium="1"]').click();
        await page.locator(".daily-regalia").first().waitFor();
        assert.equal(await page.locator(".daily-regalia").count(), 9);
        await page.locator(".daily-regalia").first().hover();
        await page.locator("#boosterTooltip:popover-open").waitFor();
        assert.match(await page.locator("#boosterTooltip").textContent(), /За 1 место/);
        await page.mouse.move(0, 0);
        await page.screenshot({ path: path.join(artifacts, `${engine}-profile-${width}.png`) });
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        await page.locator("#clanSection").click();
        await page.getByRole("button", { name: "Настройки клана", exact: true }).click();
        assert.equal(
          await page
            .locator(".clan-nav")
            .getByRole("button", { name: "Фон клана", exact: true })
            .count(),
          0,
        );
        await page.locator("#clan-description").fill("Черновик сохраняется при выборе оформления");
        await page.getByRole("button", { name: "Фон клана: Бриллиантовая", exact: true }).click();
        await until(() =>
          Promise.resolve(profiles.data.clans[clanId].appearance.background === "diamond"),
        );
        await until(() =>
          page
            .locator('.clan-backgrounds [data-theme-id="diamond"]')
            .getAttribute("data-selected")
            .then((s) => s === "true"),
        );
        await until(() => page.locator(".clan-nav button").first().isEnabled());
        await until(() =>
          page
            .locator("#clan-description")
            .inputValue()
            .then((s) => s === "Черновик сохраняется при выборе оформления"),
        );
        const colors = await page
          .locator(".appearance-clan-preview")
          .evaluateAll((nodes) =>
            nodes.map((n) => getComputedStyle(n.querySelector("span")).backgroundImage),
          );
        assert.equal(new Set(colors).size, 7);
        await page.locator(".clan-backgrounds").scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(artifacts, `${engine}-sets-${width}.png`) });
        await page
          .locator(".clan-nav")
          .getByRole("button", { name: "Мой клан", exact: true })
          .click();
        const panels = page.locator(".clan-home-grid > .clan-panel");
        await panels.first().waitFor();
        assert.ok(
          (await panels.first().evaluate((n) => getComputedStyle(n).backgroundImage)).includes(
            "145deg",
          ),
        );
        assert.equal(
          await page.locator("#clanDialog").evaluate((n) => n.scrollWidth <= n.clientWidth + 2),
          true,
        );
        await page.screenshot({ path: path.join(artifacts, `${engine}-clan-${width}.png`) });
        assert.deepEqual(errors, []);
        results.push({ engine, width, medals: 9, prizeRows: 3, distinctSets: 7 });
        if (engine === "chromium" && width === 1366) {
          await page.keyboard.press("Escape");
          await page.evaluate(async () => {
            const kit = window.KillexClanCrests,
              grid = document.createElement("div");
            grid.id = "crestQA";
            grid.style =
              "position:fixed;inset:0;z-index:99999;background:#efe0cd;overflow:auto;display:grid;grid-template-columns:repeat(10,1fr);gap:4px;padding:14px";
            for (const symbol of kit.symbols)
              for (const frame of kit.frames) {
                const img = new Image();
                img.src = await kit.renderRaster({
                  frame: frame.id,
                  color: kit.colors[10].id,
                  symbol: symbol.id,
                });
                img.style = "width:100%;height:124px;object-fit:contain";
                img.title = frame.name + " / " + symbol.name;
                await img.decode();
                grid.append(img);
              }
            document.body.append(grid);
          });
          assert.equal(await page.locator("#crestQA img").count(), 200);
          await page.screenshot({ path: path.join(artifacts, "crest-combinations.png") });
          await page.locator("#crestQA").evaluate((n) => n.remove());
        }
        console.log(engine + " " + width + " passed");
        await page.close();
      }
      await browser.close();
      browser = null;
    }
    fs.writeFileSync(path.join(artifacts, "checks.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
