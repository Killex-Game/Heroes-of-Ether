"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  playwright = require("playwright");
const { setup } = require("../fixtures/season-trophies"),
  { createGameServer } = require("../../src/server/game-server"),
  accounts = require("../../src/server/accounts/account-benefits"),
  { medals } = require("../../public/shared/daily-ranking-rules");
const out = path.resolve(__dirname, "../artifacts/account-ui-regalia");
fs.mkdirSync(out, { recursive: true });
const f = setup(),
  head = f.heads[0];
f.profiles.unlockLeagueBackgrounds = true;
f.profiles.unlockLeagueFrames = true;
for (const league of [0, 1, 2, 3, 4, 5, 5]) {
  f.c(head).competition.league = league;
  f.profiles.save(f.profiles.data);
  f.time(f.profiles.data.competition.season.end);
  f.profiles.refreshCompetition();
}
f.p(head).clanChests.notices = [];
f.p(head).account = {
  ...accounts.fresh(),
  vipUntil: f.now() + accounts.WEEK,
  premiumUntil: f.now() + accounts.WEEK,
};
const oldRegaliaDay =
  Math.floor(Math.min(...f.p(head).seasonTrophies.map((t) => t.awardedAt)) / 86400000) - 10;
f.p(head).regalia = Object.fromEntries(
  medals.map((m) => [
    m.id,
    {
      count: 2,
      firstDay: oldRegaliaDay - 10,
      lastDay: oldRegaliaDay,
    },
  ]),
);
const app = createGameServer({
  profiles: f.profiles,
  clans: f.clans,
  autoTick: false,
  wallNow: f.now,
});
let browser, timer;
const results = [];
async function healthyWindow(page, id) {
  const result = await page.locator(id).evaluate((n) => {
    const r = n.getBoundingClientRect(),
      c = n.querySelector(".interface-content");
    return {
      fits: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1,
      width: n.scrollWidth <= n.clientWidth + 2,
      content: !c || c.scrollWidth <= c.clientWidth + 2,
    };
  });
  assert.deepEqual(result, { fits: true, width: true, content: true }, id + " overflows");
}
(async () => {
  try {
    await new Promise((r) => app.httpServer.listen(0, "127.0.0.1", r));
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
        const menu = await page.locator(".side-nav .menu-tile").evaluateAll((ns) =>
          ns.map((n) => {
            const b = n.getBoundingClientRect(),
              t = n.querySelector("strong").getBoundingClientRect();
            return {
              text: n.textContent.trim(),
              dx: Math.abs((b.left + b.right - t.left - t.right) / 2),
              dy: Math.abs((b.top + b.bottom - t.top - t.bottom) / 2),
            };
          }),
        );
        assert.ok(
          menu.every((x) => x.dx < 1.5 && x.dy < 1.5),
          JSON.stringify(menu),
        );
        await page.screenshot({ path: path.join(out, `${engine}-lobby-${width}.png`) });
        await page
          .locator(".side-nav")
          .screenshot({ path: path.join(out, `${engine}-menu-${width}.png`) });
        for (const [vip, premium, slots] of [
          [false, false, 4],
          [true, false, 5],
          [false, true, 7],
          [true, true, 7],
        ]) {
          f.p(head).account = {
            ...accounts.fresh(),
            vipUntil: vip ? f.now() + accounts.WEEK : 0,
            premiumUntil: premium ? f.now() + accounts.WEEK : 0,
          };
          await page.reload();
          await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
          await page.waitForFunction(
            (n) => document.querySelectorAll('#lobbyLoadout [data-locked="false"]').length === n,
            slots,
          );
          assert.equal(await page.locator('#lobbyLoadout [data-locked="true"]').count(), 7 - slots);
          if (slots === 5)
            assert.match(
              await page
                .locator('#lobbyLoadout [data-loadout-slot="5"]')
                .getAttribute("aria-label"),
              /нужен Premium/,
            );
          await page.locator("#playButton").click();
          await page.locator("#arena").waitFor({ state: "visible" });
          const totalMs = ((vip ? 1 : 0) + (premium ? 2 : 0)) * 60000;
          const turboButton = page.locator("#turboButton");
          await turboButton.waitFor({ state: totalMs ? "visible" : "hidden" });
          const player = [...app.arena.players.values()].find(
            (p) => p.profileId === head.profile.id,
          );
          assert.equal(player.account.turboMs, totalMs);
          await page.keyboard.press("KeyT");
          if (totalMs) {
            await page.waitForFunction(
              () => document.querySelector("#turboButton").dataset.active === "true",
            );
            assert.equal(player.turbo.active, true);
            await page.keyboard.press("KeyT");
            await page.waitForFunction(
              () => document.querySelector("#turboButton").dataset.active === "false",
            );
          } else {
            await page.waitForTimeout(100);
            assert.equal(player.turbo.active, false);
            assert.equal(player.turbo.sequence, 0);
          }
          await page.locator("#leaveButton").click();
          await page.locator("#leaveYes").click();
          await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
          await page.locator("#lifeLobby").click();
          await page.locator("#lobby").waitFor({ state: "visible" });
        }
        await page.locator("#wardrobeSection").click();
        await page
          .locator("#skinsDialog .cosmetics-tabs")
          .getByRole("button", { name: "Наборы лиг", exact: true })
          .click();
        if (await page.evaluate(() => document.documentElement.dataset.uiTheme !== "silver"))
          await page
            .locator(
              '#skinsDialog [data-appearance-slot="set"] .appearance-card[data-theme-id="silver"] button',
            )
            .click();
        await page.waitForFunction(() => document.documentElement.dataset.uiTheme === "silver");
        const note = page.locator("#skinsDialog .interface-toolbar .cosmetics-season-discount"),
          tabs = page.locator("#skinsDialog .interface-toolbar .cosmetics-tabs");
        assert.match(await note.textContent(), /15%/);
        const before = [await tabs.boundingBox(), await note.boundingBox()];
        assert.ok(before[0].y + before[0].height <= before[1].y + 1);
        await healthyWindow(page, "#skinsDialog");
        const compactButtons = await page
          .locator("#skinsDialog .appearance-card button:visible")
          .evaluateAll((ns) =>
            ns.map((n) => {
              const p = getComputedStyle(n, "::before"),
                s = getComputedStyle(n);
              return {
                height: n.clientHeight,
                borders: parseFloat(p.borderTopWidth) + parseFloat(p.borderBottomWidth),
                align: s.alignItems,
                justify: s.justifyContent,
              };
            }),
          );
        assert.ok(
          compactButtons.every(
            (x) => x.borders <= x.height && x.align === "center" && x.justify === "center",
          ),
          JSON.stringify(compactButtons),
        );
        await page.screenshot({ path: path.join(out, `${engine}-skins-${width}.png`) });
        await page
          .locator("#skinsDialog .interface-content")
          .evaluate((n) => (n.scrollTop = n.scrollHeight));
        await page.waitForTimeout(100);
        const after = [await tabs.boundingBox(), await note.boundingBox()];
        assert.ok(after.every((r, i) => Math.abs(r.y - before[i].y) < 1));
        await tabs.getByRole("button", { name: "Наборы", exact: true }).click();
        assert.match(
          await page.locator("#skinsDialog .account-skin-sets").textContent(),
          /Золотой набор аватаров/,
        );
        assert.match(
          await page.locator("#skinsDialog .account-skin-sets").textContent(),
          /Премиальный набор аватаров/,
        );
        await healthyWindow(page, "#skinsDialog");
        await page.locator("#skinsDialog .booster-close").click();
        await page.locator("#accountButton").click();
        await healthyWindow(page, "#accountDialog");
        assert.match(await page.locator(".account-plan.vip").textContent(), /5 слотов бустеров/);
        assert.match(await page.locator(".account-plan.premium").textContent(), /до 12 сундуков/);
        await page.screenshot({ path: path.join(out, `${engine}-accounts-${width}.png`) });
        await page.locator("#accountDialog .booster-close").click();
        await page.locator("#rankingsButton").click();
        await page.getByRole("button", { name: "Киллы за день", exact: true }).click();
        const gap = await (
          await page.waitForFunction(() => {
            const n = document.querySelector("#topsDialog .ranking-board"),
              value =
                n?.querySelector(".ranking-table")?.getBoundingClientRect().top -
                n?.querySelector(".tops-sort")?.getBoundingClientRect().bottom;
            return value >= 9 ? value : false;
          })
        ).jsonValue();
        assert.ok(gap >= 9, "top gap " + gap);
        await healthyWindow(page, "#topsDialog");
        await page.screenshot({ path: path.join(out, `${engine}-tops-${width}.png`) });
        await page.locator("#topsDialog .booster-close").click();
        await page.evaluate((id) => window.KillexPlayerProfile.open(id), head.profile.id);
        await page.waitForFunction(
          () => document.querySelectorAll(".personal-season-trophy").length === 6,
        );
        const cups = await page.locator(".personal-season-trophy").evaluateAll((ns) =>
          ns.map((n) => {
            const image = n.querySelector("img"),
              s = getComputedStyle(n),
              r = image.getBoundingClientRect();
            return {
              league: n.dataset.league,
              ratio: parseFloat(s.getPropertyValue("--clan-trophy-scale")) || 1,
              artHeight: parseFloat(s.getPropertyValue("--trophy-art-height")) || 127,
              visibleHeight:
                (r.height * (parseFloat(s.getPropertyValue("--trophy-art-height")) || 127)) / 128,
            };
          }),
        );
        const ordered = ["bronze", "silver", "gold", "platinum", "diamond", "champions"].map((id) =>
          cups.find((x) => x.league === id),
        );
        for (let i = 1; i < ordered.length; i++)
          assert.ok(
            ordered[i].visibleHeight > ordered[i - 1].visibleHeight,
            JSON.stringify(ordered),
          );
        assert.equal(
          await page
            .locator('.personal-season-trophy[data-league="champions"] .regalia-count')
            .textContent(),
          "2",
        );
        await page.waitForFunction(() =>
          [...document.querySelectorAll(".public-player-shelf img")].every(
            (n) => n.complete && n.naturalWidth,
          ),
        );
        await page.screenshot({ path: path.join(out, `${engine}-cups-${width}.png`) });
        assert.deepEqual(errors, []);
        results.push({
          engine,
          width,
          slots: [4, 5, 7, 7],
          turboMs: [0, 60000, 120000, 180000],
          pinnedTabs: true,
          topGap: gap,
          cups: ordered,
        });
        await page.close();
      }
      // Preview actual regalia assets at their UI size and at inspection size.
      const gallery = await context.newPage();
      await gallery.goto(url);
      await gallery.setContent(
        "<style>body{background:#fff5df;color:#61386d;font:15px Arial;padding:24px}main{display:grid;grid-template-columns:repeat(3,240px);gap:16px}article{display:flex;align-items:center;gap:16px;padding:16px;background:#fffaf0;border-radius:16px}img{object-fit:contain}h2{font-size:16px}</style><main>" +
          medals
            .map(
              (m) =>
                `<article><img src="${url}/${m.image}" width="112" height="116"><div><img src="${url}/${m.image}" width="32" height="34"><h2>${m.name}</h2></div></article>`,
            )
            .join("") +
          "</main>",
      );
      await gallery.waitForFunction(() =>
        [...document.images].every((n) => n.complete && n.naturalWidth),
      );
      await gallery.screenshot({ path: path.join(out, `${engine}-regalia.png`), fullPage: true });
      await context.close();
      await browser.close();
      browser = null;
    }
    fs.writeFileSync(path.join(out, "verification.json"), JSON.stringify(results, null, 2));
    console.log(
      "PASS",
      results.length,
      "browser/viewport checks: cup scale, stacks, pinned skins tabs, layout, buttons, 4/5/7 slots",
    );
  } finally {
    clearInterval(timer);
    if (browser) await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
