"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  playwright = require("playwright"),
  { setup } = require("../fixtures/season-trophies"),
  { createGameServer } = require("../../src/server/game-server"),
  { THEMES } = require("../../public/shared/arena-backgrounds"),
  { medals } = require("../../public/shared/daily-ranking-rules");
const artifacts = path.resolve(__dirname, "../artifacts/personal-cups-arenas");
fs.mkdirSync(artifacts, { recursive: true });
const f = setup(),
  head = f.heads[0],
  newcomer = f.user();
for (const league of [0, 1, 2, 3, 4, 5, 2]) {
  f.c(head).competition.league = league;
  f.profiles.save(f.profiles.data);
  f.time(f.profiles.data.competition.season.end);
  f.profiles.refreshCompetition();
}
f.p(head).clanChests.notices = [];
const veteran = f.user();
f.p(veteran).seasonTrophies = Array.from({ length: 35 }, (_, i) => {
  const awardedAt = f.now() - i * 86400000;
  return {
    seasonId: "visual-history-" + i,
    number: 35 - i,
    league: 5,
    awardedAt,
    year: new Date(awardedAt + 10800000).getUTCFullYear(),
  };
});
const lastDay = Math.floor(f.now() / 86400000) - 10;
f.p(head).regalia = Object.fromEntries(
  medals.map((m) => [m.id, { count: 2, firstDay: lastDay - 10, lastDay }]),
);
const app = createGameServer({
  profiles: f.profiles,
  clans: f.clans,
  autoTick: false,
  wallNow: f.now,
});
let browser, timer;
const checks = [];
(async () => {
  try {
    await new Promise((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    timer = setInterval(() => app.broadcast(), 50);
    for (const engine of process.env.ENGINE
      ? [process.env.ENGINE]
      : ["chromium", "firefox", "webkit"]) {
      browser = await playwright[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const context = await browser.newContext();
      await context.addCookies([{ name: "sferorumiya_session", value: head.token, url }]);
      for (const width of [1366, 390]) {
        const page = await context.newPage(),
          errors = [];
        await page.setViewportSize({ width, height: 900 });
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("response", (r) => {
          if (r.status() >= 400) errors.push(r.status() + " " + r.url());
        });
        await page.goto(url);
        await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
        await page.evaluate((id) => window.KillexPlayerProfile.open(id), head.profile.id);
        const shelf = page.locator(".public-player-shelf"),
          track = page.locator(".public-shelf-track"),
          next = shelf.getByRole("button", { name: "Следующие награды" }),
          previous = shelf.getByRole("button", { name: "Предыдущие награды" });
        await next.waitFor({ state: "visible" });
        assert.equal(await page.locator(".personal-season-trophy").count(), 6);
        assert.equal(
          await track.locator(".public-trophy").first().getAttribute("data-league"),
          "gold",
        );
        assert.equal(await previous.isDisabled(), true);
        const gold = page.locator('.personal-season-trophy[data-league="gold"]');
        assert.equal(await gold.locator(".regalia-count").textContent(), "2");
        await gold.focus();
        await page.locator("#boosterTooltip:popover-open").waitFor();
        const hint = await page.locator("#boosterTooltip").textContent();
        assert.match(hint, /Кубок за 8 сезон Золотая 2030/);
        assert.match(hint, /Кубок за 4 сезон Золотая 2028/);
        assert.ok(hint.indexOf("8 сезон") < hint.indexOf("4 сезон"));
        await page.waitForFunction(() =>
          [...document.querySelectorAll(".public-player-shelf img")].every(
            (i) => i.complete && i.naturalWidth,
          ),
        );
        await page.screenshot({ path: path.join(artifacts, `${engine}-profile-${width}.png`) });
        await next.click();
        await page.waitForFunction(
          () => document.querySelector(".public-shelf-track").scrollLeft > 50,
        );
        assert.equal(await previous.isDisabled(), false);
        await previous.click();
        await page.waitForFunction(
          () => document.querySelector(".public-shelf-track").scrollLeft < 3,
        );
        await gold.focus();
        await page.keyboard.press("End");
        await page.waitForFunction(
          () => document.querySelector(".public-shelf-track").scrollLeft > 50,
        );
        const positions = await track
          .locator(".public-trophy")
          .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().top));
        assert.ok(Math.max(...positions) - Math.min(...positions) < 15, "awards remain in one row");
        await page.evaluate(async () => {
          const data = await (await fetch("/api/profile")).json();
          document.dispatchEvent(new CustomEvent("killex:profile", { detail: data.profile }));
        });
        assert.ok(
          await track.evaluate((n) => n.scrollLeft > 50),
          "unchanged profile refresh preserves carousel position",
        );
        assert.equal(
          await page
            .locator("#playerProfileDialog")
            .evaluate((n) => n.scrollWidth <= n.clientWidth + 2),
          true,
        );
        await page.evaluate((id) => window.KillexPlayerProfile.open(id), veteran.profile.id);
        const veteranCup = page.locator(".personal-season-trophy");
        assert.equal(await veteranCup.locator(".regalia-count").textContent(), "35");
        await veteranCup.hover();
        const tooltip = page.locator("#boosterTooltip:popover-open");
        await tooltip.waitFor();
        await tooltip.hover();
        await page.waitForTimeout(250);
        assert.equal(await tooltip.isVisible(), true);
        await page.mouse.wheel(0, 400);
        await page.waitForFunction(() => document.querySelector("#boosterTooltip").scrollTop > 0);
        assert.match(await tooltip.textContent(), /Кубок за 1 сезон/);
        await page.mouse.move(0, 0);
        await page.evaluate((id) => window.KillexPlayerProfile.open(id), newcomer.profile.id);
        assert.equal(await page.locator(".personal-season-trophy").count(), 0);
        assert.equal(await shelf.locator(".public-shelf-arrow:not([hidden])").count(), 0);
        await page.locator("#playerProfileDialog .personal-close").click();
        // Exercise the real arena renderer and server snapshots for all new terrain.
        await page.setViewportSize({
          width: width === 390 ? 844 : 1366,
          height: width === 390 ? 390 : 900,
        });
        const arena = app.arena;
        for (const theme of THEMES) {
          const choices = THEMES.filter((t) => t.id !== arena.backgroundId),
            index = choices.findIndex((t) => t.id === theme.id);
          arena.backgroundRandom = () => (index + 0.1) / choices.length;
          await page.locator("#playButton").click();
          await page.waitForFunction(
            (id) => document.querySelector("#game").dataset.background === id,
            theme.id,
          );
          if (theme.source)
            await page.waitForFunction(
              (src) => performance.getEntriesByType("resource").some((r) => r.name.includes(src)),
              theme.source.split("?")[0],
            );
          await page.waitForTimeout(200);
          await page.screenshot({
            path: path.join(artifacts, `${engine}-${theme.id}-${width}.png`),
          });
          await page.locator("#leaveButton").click();
          await page.locator("#leaveYes").click();
          await page.locator("#lifeLobby").click();
          await page.locator("#lobby").waitFor({ state: "visible" });
        }
        assert.deepEqual(errors, []);
        checks.push({
          engine,
          width,
          cupTypes: 6,
          cupHistory: 7,
          carousel: true,
          terrains: THEMES.length,
        });
        await page.close();
      }
      await browser.close();
      browser = null;
    }
    fs.writeFileSync(path.join(artifacts, "checks.json"), JSON.stringify(checks, null, 2));
    console.log(JSON.stringify(checks));
  } finally {
    clearInterval(timer);
    if (browser) await browser.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
