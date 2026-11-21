"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const engines = require("playwright");
const { createGameServer } = require("../../src/server/game-server");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { ClanService } = require("../../src/server/clans/clan-service");
const Q = require("../../src/server/progression/personal-quests");
const { xpForLevel } = require("../../src/server/progression/experience-progression");
const out = path.resolve(__dirname, "../../../../artifacts/crest-expansion-20261025");
fs.mkdirSync(out, { recursive: true });
const report = [];
(async () => {
  for (const engine of process.argv[2] ? [process.argv[2]] : ["chromium", "firefox", "webkit"]) {
    const profiles = new ProfileStore(),
      clans = new ClanService(profiles),
      auth = profiles.open();
    const get = () => profiles.find(auth.token);
    get().level = 12;
    get().progress.xp = xpForLevel(12);
    get().wallet.coins = 10000;
    get().wallet.crystals = 10000;
    clans.mutate(auth.token, {
      action: "create",
      name: "Проверка герба",
      prefix: "TEST",
      emblem: "astral",
      privacy: "open",
      requestId: randomUUID(),
    });
    const reward = (suffix) => {
      const p = get(),
        q = Q.ensure(p, profiles.now());
      q.pending.push({
        ...Q.makeReward("large", profiles.now(), false),
        id: "notice-" + suffix,
        questId: "giant",
        title: "Великан",
        stored: true,
      });
      p.revision++;
    };
    reward("one");
    const app = createGameServer({
      profiles,
      clans,
      autoTick: false,
      testBots: { enabled: false },
    });
    let browser, page;
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
      page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const ready = () =>
        page.waitForFunction(() => !document.getElementById("playButton").disabled);
      const refresh = () =>
        page.evaluate(() => document.dispatchEvent(new CustomEvent("killex:events-changed")));
      const toast = page.locator(".clan-reward-toast:popover-open");
      await page.goto(url);
      await ready();
      await toast.waitFor();
      for (let i = 0; i < 100 && get().quests.pending[0].notifiedAt === undefined; i++)
        await page.waitForTimeout(50);
      assert.ok(get().quests.pending[0].notifiedAt !== undefined);
      await page.getByRole("button", { name: "Закрыть уведомления о наградах" }).click();
      await page.reload();
      await ready();
      assert.equal(await toast.count(), 0);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await ready();
      assert.equal(await toast.count(), 0);
      // Обрыв ответа: локальная отметка не даёт повторного показа, запись повторяется.
      await page.route("**/api/quests/action", (r) =>
        r.request().postDataJSON()?.action === "notice" ? r.abort() : r.continue(),
      );
      reward("two");
      await refresh();
      await toast.waitFor();
      assert.equal(await toast.locator(".clan-notice-card").count(), 1);
      await page.reload();
      await ready();
      assert.equal(await toast.count(), 0);
      await page.unroute("**/api/quests/action");
      await page.waitForResponse(
        (r) => r.url().endsWith("/api/quests/action") && r.status() === 200,
        { timeout: 15000 },
      );
      assert.ok(get().quests.pending.find((r) => r.id === "notice-two").notifiedAt !== undefined);
      reward("three");
      await refresh();
      await toast.waitFor();
      assert.equal(await toast.locator(".clan-notice-card").count(), 1);
      await page.getByRole("button", { name: "Закрыть уведомления о наградах" }).click();
      await page.locator("#inventorySection").click();
      reward("four");
      reward("five");
      await refresh();
      await page.waitForTimeout(200);
      assert.equal(await toast.count(), 0);
      await page.getByRole("button", { name: "Закрыть бустеры" }).click();
      await toast.waitFor();
      await page.getByRole("button", { name: "Закрыть уведомления о наградах" }).click();
      await page.locator("#inventorySection").click();
      for (const [width, height] of [
        [1366, 900],
        [390, 844],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        await page.getByRole("button", { name: "Инвентарь", exact: true }).click();
        const inventory = await page.locator("#boosterDialog").boundingBox();
        await page.getByRole("button", { name: "Сундуки", exact: true }).click();
        await page.getByRole("button", { name: "Сокровищница", exact: true }).click();
        await page.waitForTimeout(120);
        const treasury = await page.locator("#boosterDialog").boundingBox();
        assert.ok(
          Math.abs(inventory.width - treasury.width) < 2 &&
            Math.abs(inventory.height - treasury.height) < 2,
          JSON.stringify({ inventory, treasury }),
        );
        const alignment = await page.locator(".clan-owned-chests").evaluate((n) => ({
          justify: getComputedStyle(n).justifyContent,
          overflow: n.scrollWidth - n.clientWidth,
        }));
        assert.equal(alignment.justify, "start");
        assert.ok(alignment.overflow <= 1);
        const cards = await page.locator(".clan-owned-chests").evaluate((grid) => {
          const rect = grid.getBoundingClientRect();
          return [...grid.children]
            .filter((n) => n.checkVisibility())
            .map((n) => {
              const b = n.getBoundingClientRect();
              return { width: b.width, height: b.height, left: b.left - rect.left, top: b.top };
            });
        });
        const rows = new Map();
        for (const card of cards)
          rows.set(Math.round(card.top), (rows.get(Math.round(card.top)) || 0) + 1);
        assert.ok([...rows.values()].every((count) => count <= 4));
        assert.ok(Math.abs(cards[0].left) < 1);
        assert.ok(cards.every((c) => Math.abs(c.width - 240) < 1));
        if (width >= 1100) {
          assert.equal([...rows.values()][0], 4);
          assert.equal(cards.length, 5);
        }
        assert.equal(cards.length, 5);
        assert.equal(await page.locator(".clan-chest-inventory .collection-pages").count(), 0);
        const headerBefore = await page.locator("#boosterDialog .booster-heading").boundingBox();
        const scroll = await page.locator("#boosterDialog .interface-content").evaluate((n) => {
          n.scrollTop = n.scrollHeight;
          return {
            top: n.scrollTop,
            max: n.scrollHeight - n.clientHeight,
            overflow: getComputedStyle(n).overflowY,
          };
        });
        assert.equal(scroll.overflow, "auto");
        if (width < 1100) assert.ok(scroll.top > 0, JSON.stringify(scroll));
        assert.ok(Math.abs(scroll.top - scroll.max) < 2);
        const headerAfter = await page.locator("#boosterDialog .booster-heading").boundingBox();
        assert.ok(Math.abs(headerAfter.y - headerBefore.y) < 1);
        await page.screenshot({ path: path.join(out, `${engine}-treasury-${width}.png`) });
      }
      await page.getByRole("button", { name: "Закрыть бустеры" }).click();
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.locator("#clanSection").click();
      await page.getByRole("button", { name: "Оформление", exact: true }).click();
      await page.locator("#clanForm").waitFor();
      for (const [width, height] of [
        [1366, 900],
        [390, 844],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(150);
        for (const tab of ["Форма", "Рамка", "Поле", "Цвета", "Символ"]) {
          if (await page.locator(".clan-crest-tabs").count())
            await page.getByRole("button", { name: tab, exact: true }).click();
          await page.waitForTimeout(100);
          const geometry = await page.locator("#clanDialog").evaluate((d) => {
            const r = d.getBoundingClientRect();
            const targets = [
              ...d.querySelectorAll(".clan-crest-controls button,.clan-form-actions button"),
            ].filter((n) => n.checkVisibility());
            return {
              width: r.width,
              height: r.height,
              overflow: d.scrollHeight - d.clientHeight,
              outside: targets
                .filter((n) => {
                  const b = n.getBoundingClientRect();
                  return b.left < r.left - 1 || b.right > r.right + 1 || b.bottom > r.bottom + 1;
                })
                .map((n) => n.textContent || n.title),
              errors: d.querySelectorAll("[data-art-error]").length,
            };
          });
          report.push({ engine, width, tab, ...geometry });
          assert.ok(
            geometry.width >= width - 32 && geometry.height >= height - 32,
            JSON.stringify(geometry),
          );
          assert.deepEqual(geometry.outside, []);
          assert.ok(geometry.overflow <= 2, JSON.stringify(geometry));
          assert.equal(geometry.errors, 0);
          await page.screenshot({ path: path.join(out, `${engine}-crest-${width}-${tab}.png`) });
        }
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      const choose = async (tab, name) => {
        await page.waitForTimeout(150);
        if (await page.locator(".clan-crest-tabs").count())
          await page.getByRole("button", { name: tab, exact: true }).click();
        const section = page.locator(`.clan-crest-category[aria-label="${tab}"]`);
        while (!(await section.getByRole("button", { name, exact: true }).count()))
          await section
            .getByRole("button", { name: "Следующие варианты герба", exact: true })
            .click();
        await section.getByRole("button", { name, exact: true }).click();
      };
      await choose("Форма", "Крепостной щит");
      await choose("Поле", "Косой крест");
      await choose("Рамка", "Серебро");
      await choose("Символ", "Геральдическая роза");
      const draft = await page
        .locator(".clan-crest-builder")
        .evaluate((n) => window.KillexClanCrests.normalize(n.crestBuilder.value));
      assert.equal(draft.symbol, "s25_rose");
      assert.equal(draft.metal, "silver");
      const coinsBefore = get().wallet.crystals;
      await page.locator('#clanForm button[type="submit"]').click();
      await page.locator("#clanForm").waitFor({ state: "hidden" });
      assert.deepEqual(profiles.data.clans[get().clanId].crest, draft);
      assert.equal(get().wallet.crystals, coinsBefore - 50);
      await page.reload();
      await ready();
      assert.equal(await toast.count(), 0);
      // Рендер всей библиотеки, включая необычные контуры и новые золотые символы.
      const samples = await page.evaluate(async () => {
        const k = window.KillexClanCrests,
          cases = k.frames.map((f, i) => ({
            ...k.DEFAULT,
            frame: f.id,
            color: "c23_navy",
            secondary: "c21_snow",
            pattern: k.patterns[i % k.patterns.length].id,
            symbol: k.symbols[i % k.symbols.length].id,
          }));
        for (const p of k.patterns)
          cases.push({
            ...k.DEFAULT,
            frame: "f15_polish",
            color: "c24_scarlet",
            secondary: "c21_snow",
            pattern: p.id,
            symbol: "s25_rose",
          });
        const result = [];
        for (const c of cases) {
          const src = await k.renderRaster(c);
          if (!src.startsWith("data:image/")) throw Error("missing raster");
          result.push({ c, src });
        }
        return result;
      });
      await page.evaluate((samples) => {
        document.querySelectorAll("dialog[open]").forEach((d) => d.close());
        const sheet = document.createElement("div");
        sheet.id = "crestSheet";
        sheet.style =
          "position:fixed;inset:0;background:#ede0c6;z-index:9999;display:grid;grid-template-columns:repeat(9,1fr);align-content:start;";
        for (const s of samples) {
          const img = new Image();
          img.src = s.src;
          img.style = "width:142px;height:142px;object-fit:contain";
          img.title = s.c.frame;
          sheet.append(img);
        }
        document.body.append(sheet);
      }, samples);
      await page.screenshot({ path: path.join(out, `${engine}-crest-sheet.png`) });
      assert.deepEqual(errors, []);
      console.log(
        engine,
        "notification once, reload, failed request recovery, stable treasury, crest layouts and",
        samples.length,
        "compositions OK",
      );
    } catch (e) {
      if (page)
        await page.screenshot({ path: path.join(out, `${engine}-failure.png`) }).catch(() => {});
      throw e;
    } finally {
      await browser?.close();
      await app.close();
      fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
    }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
