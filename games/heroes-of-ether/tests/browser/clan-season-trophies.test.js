"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  playwright = require("playwright");
const { setup } = require("../fixtures/season-trophies"),
  { createGameServer } = require("../../src/server/game-server");
const artifacts = path.resolve(__dirname, "../artifacts/season-trophies");
fs.mkdirSync(artifacts, { recursive: true });
const f = setup(),
  head = f.heads[0];
for (const league of [0, 1, 2, 3, 4, 5, 2]) {
  f.c(head).competition.league = league;
  f.profiles.save(f.profiles.data);
  f.time(f.profiles.data.competition.season.end);
  f.profiles.refreshCompetition();
}
f.c(head).competition.medals = {
  bronze: 2,
  silver: 1,
  gold: 3,
  platinum: 1,
  diamond: 1,
  champions: 1,
};
f.c(head).treasury = 100000;
// Сезоны проверяются в этой витрине; накопленные за годы уведомления проверены отдельно.
f.p(head).dailyRankingRewards = [];
f.p(head).honors.notified = f.p(head).honors.claimed;
f.p(head).clanChests.notices = [];
const app = createGameServer({
  profiles: f.profiles,
  clans: f.clans,
  autoTick: false,
  wallNow: f.now,
});
let browser;
const results = [];
(async () => {
  try {
    await new Promise((r) => app.httpServer.listen(0, "127.0.0.1", r));
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    for (const engine of process.env.ENGINE
      ? [process.env.ENGINE]
      : ["chromium", "firefox", "webkit"]) {
      browser = await playwright[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const context = await browser.newContext();
      await context.addCookies([{ name: "sferorumiya_session", value: head.token, url }]);
      for (const width of process.env.WIDTH
        ? [Number(process.env.WIDTH)]
        : [1920, 1366, 900, 390]) {
        const page = await context.newPage(),
          errors = [];
        await page.setViewportSize({ width, height: 900 });
        await page.addLocatorHandler(page.locator("#dailyRankingNotice[open]"), async () => {
          await page.locator("#dailyRankingNotice .booster-close").click();
        });
        await page.addLocatorHandler(
          page.locator("#titleEarnedDialog[open]"),
          async () => {
            await page
              .locator("#titleEarnedDialog")
              .getByRole("button", { name: "Отлично", exact: true })
              .click();
          },
          { noWaitAfter: true },
        );
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(url);
        await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
        await page.locator("#clanSection").click();
        await page.locator(".clan-trophy-shelf").waitFor();
        assert.equal(await page.locator(".clan-season-trophy").count(), 6);
        await page.waitForFunction(() =>
          [...document.querySelectorAll(".clan-season-trophy img")].every(
            (i) => i.complete && i.naturalWidth > 0,
          ),
        );
        const bottoms = await page.locator(".clan-season-trophy img").evaluateAll((imgs) =>
          imgs.map((img) => {
            const c = document.createElement("canvas");
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const p = ctx.getImageData(0, 0, c.width, c.height).data;
            let bottom = 0;
            for (let y = 0; y < c.height; y++)
              for (let x = 0; x < c.width; x++)
                if (p[(y * c.width + x) * 4 + 3] > 20) bottom = y + 1;
            const r = img.getBoundingClientRect();
            return r.top + (bottom / c.height) * r.height;
          }),
        );
        assert.ok(
          Math.max(...bottoms) - Math.min(...bottoms) < 1,
          "visible trophy bases must align",
        );
        assert.equal(
          await page.locator("#clanDialog").evaluate((n) => n.scrollWidth <= n.clientWidth + 2),
          true,
          "horizontal overflow",
        );
        const shelves = await page.locator(".clan-medal-shelf").evaluateAll((ns) =>
          ns.map((n) => {
            const r = n.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }),
        );
        if (width >= 1366)
          assert.ok(Math.abs(shelves[0].y - shelves[1].y) < 2, "shelves should be adjacent");
        if (width <= 620) {
          const panels = await page.locator(".clan-home-grid > .clan-panel").evaluateAll((nodes) =>
            nodes.map((n) => {
              const r = n.getBoundingClientRect();
              return {
                top: r.top,
                bottom: r.bottom,
                height: r.height,
                scroll: n.scrollHeight,
                client: n.clientHeight,
              };
            }),
          );
          for (let i = 0; i < panels.length; i++) {
            if (panels[i].scroll > panels[i].client + 2) {
              await page.screenshot({ path: path.join(artifacts, "layout-failure.png") });
              console.log(
                await page
                  .locator(".clan-home-grid, .clan-content, .clan-home-grid > .clan-panel")
                  .evaluateAll((ns) =>
                    ns.map((n) => ({
                      name: n.className,
                      rect: n.getBoundingClientRect().toJSON(),
                      height: getComputedStyle(n).height,
                      min: getComputedStyle(n).minHeight,
                      max: getComputedStyle(n).maxHeight,
                      display: getComputedStyle(n).display,
                      overflow: getComputedStyle(n).overflow,
                      rows: getComputedStyle(n).gridTemplateRows,
                      scroll: n.scrollHeight,
                      client: n.clientHeight,
                    })),
                  ),
              );
            }
            assert.ok(panels[i].scroll <= panels[i].client + 2, "panel content should fit");
            if (i) assert.ok(panels[i].top >= panels[i - 1].bottom, "panels should not overlap");
          }
        }
        await page.screenshot({ path: path.join(artifacts, `${engine}-${width}.png`) });
        // Мини-профиль не меняет размеры и основания кубков за открытым окном клана.
        await page.evaluate((id) => window.KillexPlayerProfile.open(id), head.profile.id);
        await page.locator("#playerProfileDialog .personal-season-trophy").first().waitFor();
        assert.equal(await page.locator("#playerProfileDialog .personal-season-trophy").count(), 6);
        await page.screenshot({ path: path.join(artifacts, `${engine}-profile-${width}.png`) });
        await page.getByRole("button", { name: "Закрыть профиль игрока", exact: true }).click();
        const after = await page
          .locator(".clan-season-trophy img")
          .evaluateAll((imgs) => imgs.map((img) => img.getBoundingClientRect().bottom));
        await page
          .locator(".clan-nav")
          .getByRole("button", { name: "Оформление", exact: true })
          .click();
        if (width >= 1366) {
          const form = page.locator("#clanForm"),
            name = form.locator('[name="name"]'),
            prefix = form.locator('[name="prefix"]'),
            submit = form.locator('[type="submit"]');
          const oldName = await name.inputValue(),
            oldPrefix = await prefix.inputValue();
          await name.fill(oldName + " новый");
          assert.match(await submit.textContent(), /50/);
          await prefix.fill("NEW");
          assert.match(await submit.textContent(), /50/);
          await name.fill(oldName);
          await prefix.fill(oldPrefix);
          assert.equal((await submit.textContent()).trim(), "Сохранить изменения");
        }
        await page
          .locator(".clan-nav")
          .getByRole("button", { name: "Мой клан", exact: true })
          .click();
        await page.locator(".clan-season-trophy img").first().waitFor();
        const restored = await page
          .locator(".clan-season-trophy img")
          .evaluateAll((imgs) => imgs.map((img) => img.getBoundingClientRect().bottom));
        assert.deepEqual(restored, after);
        const gold = page.locator('.clan-season-trophy[data-league="gold"]');
        assert.equal(await gold.locator(".clan-medal-count").textContent(), "2");
        await gold.hover();
        await page.locator("#boosterTooltip:popover-open").waitFor();
        const text = await page.locator("#boosterTooltip").textContent();
        assert.match(text, /Кубок за 8 сезон Золотая 2030/);
        assert.match(text, /Кубок за 4 сезон Золотая 2028/);
        assert.match(text, /3.500 монет/);
        assert.match(text, /6%/);
        await page.screenshot({ path: path.join(artifacts, `${engine}-tooltip-${width}.png`) });
        await page.mouse.move(0, 0);
        await page
          .locator(".clan-nav")
          .getByRole("button", { name: "Оружейная", exact: true })
          .click();
        await page.locator(".clan-shop-discount").first().waitFor();
        assert.match(await page.locator(".clan-shop-discount").first().textContent(), /15%/);
        await page.keyboard.press("Escape");
        await page.locator("#wardrobeSection").click();
        await page.getByRole("button", { name: "Бабочки", exact: true }).click();
        await page.locator("#skinsDialog .cosmetics-season-discount:not([hidden])").waitFor();
        assert.match(
          await page.locator("#skinsDialog .cosmetics-season-discount").textContent(),
          /15%/,
        );
        assert.deepEqual(errors, []);
        results.push({ engine, width, trophies: 6, history: 7 });
        console.log(JSON.stringify(results.at(-1)));
        await page.close();
      }
      await browser.close();
      browser = null;
    }
    fs.writeFileSync(path.join(artifacts, "checks.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
