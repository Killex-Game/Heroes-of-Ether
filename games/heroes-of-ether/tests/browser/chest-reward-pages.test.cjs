"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  { once } = require("node:events"),
  { chromium } = require("playwright");
const { publicCatalog } = require("../../src/server/boosters/booster-catalog");
const root = path.resolve(__dirname, "../../public"),
  artifacts = path.resolve(__dirname, "../../../../artifacts/chest-single-row-20261105");
fs.mkdirSync(artifacts, { recursive: true });
const styles = fs
  .readFileSync(path.join(root, "index.html"), "utf8")
  .match(/<link\s+rel="stylesheet"[^>]+>/g)
  .join("\n");
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">${styles}</head>
  <body data-screen="lobby"><script src="shared/easter-rules.js"></script><script src="ui/layout/modal-stack.js"></script>
  <script src="ui/progression/chest-opening-dialog.js"></script>
  <script src="ui/layout/dialog-content-layout.js"></script></body></html>`;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  }
  const file = path.resolve(root, "." + decodeURIComponent(pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    return res.end();
  }
  const types = {
    ".js": "text/javascript",
    ".css": "text/css",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});
let browser;
(async () => {
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage(),
      errors = [],
      measurements = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate((catalog) => {
      const art = "assets/menu-icons/128/nav_inventory.webp";
      window.KillexProgressionArt = {
        chest: () => art,
        questChest: () => art,
        clanChest: () => art,
      };
      window.KillexGreatnessUI = { SOURCE: "assets/menu-icons/128/nav_achievements.webp" };
      const makeReward = (id, count) => ({
        id,
        items: Object.fromEntries(catalog.items.slice(0, count).map((i) => [i.id, 123])),
        prepared: true,
        fragmentId: null,
      });
      const titleReward = makeReward("sage", 19),
        questReward = makeReward("quest-test", 10),
        clanReward = makeReward("clan-test", 20),
        eventReward = makeReward("event-test", 1);
      Object.assign(eventReward, {
        items: { easter_egg: 30 },
        coins: 375,
        crystals: 33,
        greatness: 15,
        fragment: { index: 24, duplicate: false },
      });
      window.chestTest = new KillexChestUI({
        purchasesBlocked: () => false,
        item: (id) => catalog.items.find((i) => i.id === id),
        profile: {
          honors: {
            pending: titleReward,
            tiers: [{ id: "sage", name: "Мудрец", chestName: "Сундук Мудреца" }],
          },
          quests: {
            pending: [
              {
                ...questReward,
                title: "Богатый урожай",
                chest: { art: "large", name: "Большой сундук" },
              },
            ],
          },
          clanChests: {
            items: [
              {
                id: "clan-test",
                tier: "high",
                chestName: "Клановый сундук высшей степени",
                reward: clanReward,
              },
            ],
          },
          easter: { chests: [{ id: "event-test", reward: eventReward }] },
        },
      });
    }, publicCatalog());
    const next = page
      .locator("#chestRewardDialog .collection-pages")
      .getByRole("button", { name: "Следующая страница" });
    const settle = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    const geometry = () =>
      page.locator("#chestRewardDialog").evaluate((d) => {
        const rect = (e) => {
          const r = e.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        };
        const g = d.querySelector(".chest-reward-grid"),
          visible = [...g.children].filter((e) => !e.classList.contains("collection-page-hidden"));
        return {
          dialog: rect(d),
          grid: rect(g),
          footer: rect(d.querySelector("footer")),
          nav: rect(d.querySelector("nav")),
          count: visible.length,
          layout: d.dataset.rewardLayout,
          rows: getComputedStyle(g).gridTemplateRows.split(" ").length,
          cardTops: [...new Set(visible.map((e) => Math.round(e.getBoundingClientRect().top)))],
          overflow: d.scrollHeight - d.clientHeight,
          horizontalOverflow: d.scrollWidth - d.clientWidth,
        };
      });
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [390, 844],
      [844, 390],
      [568, 320],
    ]) {
      await page.setViewportSize({ width, height });
      for (const id of ["sage", "quest-test", "clan-test", "event-test"]) {
        await page.evaluate((id) => chestTest.open(id), id);
        await page
          .locator("#chestConfirmDialog")
          .getByRole("button", { name: "Да", exact: true })
          .click();
        await settle();
        await page.evaluate(() => document.fonts.ready);
        assert.match(await page.locator("#chestRewardDialog nav span").textContent(), /^1 \/ /);
        const first = await geometry();
        const singleRow = id === "event-test" && width >= 680;
        assert.equal(first.layout, singleRow ? "single-row" : "two-rows");
        assert.equal(first.rows, singleRow ? 1 : 2);
        if (singleRow) {
          assert.equal(first.count, 5);
          assert.equal(first.cardTops.length, 1, "all five Easter rewards fit in one row");
          assert.ok(
            first.dialog[3] < 430,
            "no empty second row or pagination space: " + JSON.stringify(first),
          );
          assert.equal(first.nav[3], 0);
          if (width === 1366)
            await page.screenshot({ path: path.join(artifacts, "easter-single-row.png") });
        }
        assert.ok(first.overflow <= 1 && first.horizontalOverflow <= 1, JSON.stringify(first));
        assert.ok(
          first.dialog[0] >= 0 &&
            first.dialog[1] >= 0 &&
            first.dialog[1] + first.dialog[3] <= height,
        );
        while ((await next.isVisible()) && (await next.isEnabled())) {
          await next.click();
          await settle();
          const current = await geometry();
          for (const key of ["dialog", "grid", "footer", "nav"])
            assert.deepEqual(
              current[key],
              first[key],
              `${id} ${width} ${key} changed between pages`,
            );
        }
        const last = await geometry();
        if (id !== "event-test") {
          assert.ok(last.count <= 4, "paginated fixtures end with at most one row");
          assert.equal(last.rows, 2, "empty second row retained");
          assert.equal(last.cardTops.length, 1);
        }
        measurements.push({ width, height, id, first, last });
        if (width === 1366 && id === "sage")
          await page.screenshot({ path: path.join(artifacts, "last-page.png") });
        await page.locator("#chestRewardDialog .chest-modal-close").click();
        // Reopen the same prepared chest as well as a different source.
        await page.evaluate((id) => chestTest.open(id), id);
        await page
          .locator("#chestConfirmDialog")
          .getByRole("button", { name: "Да", exact: true })
          .click();
        await settle();
        assert.match(await page.locator("#chestRewardDialog nav span").textContent(), /^1 \/ /);
        if (width === 1366 && id === "sage")
          await page.screenshot({ path: path.join(artifacts, "first-page.png") });
        await page.locator("#chestRewardDialog .chest-modal-close").click();
      }
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(artifacts, "layout-checks.json"),
      JSON.stringify(measurements, null, 2),
    );
    console.log(
      "PASS: compact five-item Easter reward; stable two-row paginated rewards; four sources and five viewports; every opening starts at page 1.",
    );
  } finally {
    await browser?.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
