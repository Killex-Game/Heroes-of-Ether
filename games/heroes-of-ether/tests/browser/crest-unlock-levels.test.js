"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  playwright = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { xpForLevel } = require("../../src/server/progression/experience-progression"),
  { clanProgress } = require("../../src/server/clans/clan-level-progress"),
  kit = require("../../public/shared/clan-crest-rules");
const engine = process.argv[2] || "chromium",
  out = path.resolve(__dirname, "../../../../artifacts/clan-crest-unlocks-20261026"),
  profiles = new ProfileStore(),
  clans = new ClanService(profiles),
  user = profiles.open(),
  p = profiles.find(user.token);
p.level = 12;
p.progress.xp = xpForLevel(12);
p.wallet.coins = 5000;
p.wallet.crystals = 1000;
clans.mutate(user.token, {
  action: "create",
  name: "Уровни герба",
  prefix: "LVLS",
  privacy: "open",
  emblem: "astral",
  crest: kit.DEFAULT,
  requestId: randomUUID(),
});
const clanId = profiles.find(user.token).clanId,
  app = createGameServer({ profiles, clans, arena: new Arena({ etherCount: 0 }), autoTick: false });
fs.mkdirSync(out, { recursive: true });
let browser,
  page,
  phase = "start";
const labels = { frames: "Форма", metals: "Рамка", symbols: "Символ" };
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await playwright[engine].launch({
      headless: true,
      ...(engine === "chromium" ? { channel: "chrome" } : {}),
    });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      screen: { width: 1920, height: 1080 },
    });
    await context.addCookies([{ name: "sferorumiya_session", value: user.token, url }]);
    const errors = [],
      results = [],
      onPageError = (e) => errors.push(e.message);
    const openEditor = async (viewport) => {
      if (page) {
        page.off("pageerror", onPageError);
        await page.close();
      }
      page = await context.newPage();
      if (viewport) await page.setViewportSize(viewport);
      page.setDefaultTimeout(15000);
      page.on("pageerror", onPageError);
      await page.goto(url);
      await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
      await page.locator("#clanSection").click();
      await page.getByRole("button", { name: "Оформление", exact: true }).click();
      await page.locator("#clanForm").waitFor();
      await page.waitForFunction(() => {
        const root = document.querySelector(".clan-crest-builder"),
          builder = root?.crestBuilder,
          controls = root?.querySelector(".clan-crest-controls");
        if (!builder || !controls) return false;
        const available =
            root.getBoundingClientRect().bottom -
            controls.getBoundingClientRect().top -
            (parseFloat(getComputedStyle(root).paddingBottom) || 0),
          overview = controls.clientWidth >= 620 && available >= 340;
        return (
          builder.overview === overview &&
          (!overview || Object.keys(builder.pageSizes).length === 5)
        );
      });
    };
    async function category(tab) {
      const tabs = page.locator(".clan-crest-tabs");
      if (await tabs.isVisible())
        await tabs.getByRole("button", { name: labels[tab], exact: true }).click();
      const section = page.locator(`section.clan-crest-category[data-category="${tab}"]`),
        prev = section.getByRole("button", { name: "Предыдущие варианты герба", exact: true });
      while ((await prev.count()) && (await prev.isEnabled())) await prev.click();
      return section;
    }
    async function inspect(tab, level) {
      const section = await category(tab),
        found = [];
      let pages = 0;
      while (true) {
        const current = await section.locator("button[data-choice]").evaluateAll((nodes) =>
          nodes.map((n) => ({
            id: n.dataset.choice,
            disabled: n.disabled,
            badge: n.querySelector(".clan-crest-level-lock")?.textContent || null,
            title: n.title,
          })),
        );
        for (const item of current) {
          const required = kit.requiredLevel(item.id);
          assert.equal(item.disabled, required > level, item.id);
          assert.equal(item.badge, required > level ? `${required} ур.` : null, item.id);
          if (required > level) assert.ok(item.title.includes(`${required} уровня клана`));
        }
        found.push(...current.map((x) => x.id));
        const next = section.getByRole("button", { name: "Следующие варианты герба", exact: true });
        if (!(await next.count()) || !(await next.isEnabled())) break;
        assert.ok(++pages < 30);
        await next.click();
      }
      assert.equal(found.length, new Set(found).size);
      assert.deepEqual(
        found,
        kit.choicesForLevel(tab, level).map((x) => x.id),
      );
      return found.length;
    }
    async function choose(tab, id) {
      const section = await category(tab);
      while (!(await section.locator(`[data-choice="${id}"]`).count()))
        await section
          .getByRole("button", { name: "Следующие варианты герба", exact: true })
          .click();
      await section.locator(`[data-choice="${id}"]`).click();
    }
    for (const level of [1, 3, 5, 7, 10]) {
      phase = "level " + level;
      let xp = 0;
      while (clanProgress(xp).level < level) xp += clanProgress(xp).nextLevelXp;
      profiles.data.clans[clanId].xp = xp;
      profiles.save(profiles.data);
      await openEditor();
      for (const tab of Object.keys(labels))
        results.push({ level, tab, count: await inspect(tab, level) });
      if (level === 1 || level === 10)
        await page.screenshot({ path: path.join(out, `${engine}-level-${level}.png`) });
    }
    phase = "save unlocked crest";
    await choose("frames", "f10_grand");
    await choose("metals", "gold");
    await choose("symbols", "s25_rose");
    const [saved] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/clans/action") && r.request().method() === "POST",
      ),
      page.locator('#clanForm button[type="submit"]').click(),
    ]);
    assert.equal(saved.status(), 200);
    assert.equal(profiles.data.clans[clanId].crest.frame, "f10_grand");
    assert.equal(profiles.data.clans[clanId].crest.metal, undefined);
    assert.equal(profiles.data.clans[clanId].crest.symbol, "s25_rose");
    assert.equal(profiles.find(user.token).wallet.crystals, 950);
    for (const [width, height] of [
      [1366, 900],
      [390, 844],
    ]) {
      phase = "layout " + width;
      await openEditor({ width, height });
      for (const tab of Object.keys(labels)) await inspect(tab, 10);
      assert.ok(
        await page.locator("#clanDialog").evaluate((d) => d.scrollWidth <= d.clientWidth + 1),
      );
      await page.screenshot({ path: path.join(out, `${engine}-crest-${width}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ engine, passed: true, results }));
  } catch (e) {
    console.error("Phase:", phase);
    await page?.screenshot({ path: path.join(out, `${engine}-crest-failure.png`) }).catch(() => {});
    throw e;
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
