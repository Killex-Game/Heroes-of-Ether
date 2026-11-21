/* Браузерный сценарий: career panel layout. */
"use strict";
const engines = require("playwright"),
  { once } = require("node:events"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store");
const engine = process.argv.find((arg) => arg.startsWith("--engine="))?.split("=")[1] || "chromium";
const profiles = new ProfileStore(),
  u = profiles.open(),
  hero = profiles.find(u.token);
hero.greatness = 1144;
const app = createGameServer({ profiles, autoTick: false });
let browser;
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await engines[engine].launch({
      ...(engine === "chromium" ? { channel: "chrome" } : {}),
      headless: true,
    });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addCookies([{ name: "sferorumiya_session", value: u.token, url }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page.locator("#achievementsButton").click();
    await page.locator(".honor-career-link").click();
    const gridLayout = async () => {
      const cards = await page.locator(".achievement-card").evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        }),
      );
      const rows = new Map();
      for (const card of cards) {
        assert.equal(card.width, 132, "Card width stays fixed");
        assert.equal(card.height, 132, "Card height stays fixed");
        rows.set(Math.round(card.y), (rows.get(Math.round(card.y)) || 0) + 1);
      }
      assert.ok(rows.size <= 5, "At most five rows of achievements");
      assert.equal(
        await page
          .locator(
            ".achievement-locked, .achievement-state, .achievement-unavailable, .achievement-auto-reward",
          )
          .count(),
        0,
      );
      assert.ok(
        await page
          .locator("#achievementsDialog .interface-content")
          .evaluate(
            (node) =>
              node.scrollWidth <= node.clientWidth + 1 &&
              node.scrollHeight <= node.clientHeight + 1,
          ),
        "Achievement content fits without scrolling",
      );
      return { rows: rows.size, columns: Math.max(...rows.values()) };
    };
    for (const size of [
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
      { width: 1024, height: 1600 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(size);
      await page.locator('[data-achievement="career"]').hover();
      await page.waitForTimeout(150);
      const grid = await gridLayout();
      if (size.width >= 1366)
        assert.ok(grid.columns > 5, "Wide showcases use more than five columns");
      if (size.height === 1600) assert.equal(grid.rows, 5, "Tall showcases stop at five rows");
      assert.equal(await page.locator(".achievement-help").count(), 0);
      const selectors = await page.locator(".achievement-selectors").evaluate((g) => {
        const boxes = [...g.children].map((c) => c.getBoundingClientRect());
        return {
          gap: boxes[1].left - boxes[0].right,
          row: Math.abs(boxes[0].top - boxes[1].top) < 1,
          right: g.parentElement.getBoundingClientRect().right - g.getBoundingClientRect().right,
        };
      });
      assert.ok(
        selectors.row && selectors.gap >= 0 && selectors.gap < 20 && selectors.right < 20,
        "Both selectors stay together at the right edge",
      );
      const layout = await page.locator("#achievementDetail").evaluate((d) => {
        const list = d.querySelector(".career-milestones"),
          bounds = d.getBoundingClientRect(),
          content = d.closest(".interface-content").getBoundingClientRect();
        return {
          height: d.offsetHeight,
          listHeight: list.offsetHeight,
          clipped: list.scrollHeight > list.clientHeight + 1,
          count: list.children.length,
          fits: [...list.children].every((c) => {
            const r = c.getBoundingClientRect();
            return (
              r.bottom <= bounds.bottom &&
              r.bottom <= content.bottom + 1 &&
              r.right <= innerWidth &&
              r.left >= 0
            );
          }),
          zoom: d.closest(".interface-page").style.zoom,
        };
      });
      console.log(size, layout);
      assert.equal(layout.count, 10);
      assert.ok(layout.fits && !layout.clipped);
      assert.equal(
        await page
          .getByText("Награды за степени выдаются автоматически, один раз.", { exact: true })
          .count(),
        0,
      );
      await page.screenshot({
        path: path.join(
          __dirname,
          `../artifacts/${engine}-career-full-${size.width}x${size.height}.png`,
        ),
      });
    }
    const pages = page.locator(".achievement-showcase > .achievement-pages"),
      next = pages.getByRole("button", { name: "Следующая страница", exact: true }),
      previous = pages.getByRole("button", { name: "Предыдущая страница", exact: true });
    const expected = (
      await (await context.request.get(url + "/api/profile")).json()
    ).profile.progress.achievements
      .map((a) => a.id)
      .concat("career")
      .sort();
    const seen = [];
    assert.equal(await previous.isDisabled(), true);
    for (let count = 0; count < expected.length; count++) {
      seen.push(
        ...(await page
          .locator(".achievement-card")
          .evaluateAll((nodes) => nodes.map((node) => node.dataset.achievement))),
      );
      await gridLayout();
      if (await next.isDisabled()) break;
      await next.click();
    }
    assert.deepEqual(seen.sort(), expected, "Every achievement is reachable exactly once");
    assert.equal(await next.isDisabled(), true);
    while (!(await previous.isDisabled())) await previous.click();
    assert.equal(await page.locator('[data-achievement="career"]').isVisible(), true);
    await page.getByLabel("Раздел достижений", { exact: true }).selectOption("arena");
    while (!(await page.locator('[data-achievement="jumper"]').count())) {
      assert.equal(await next.isDisabled(), false);
      await next.click();
    }
    await page.locator('[data-achievement="jumper"]').hover();
    assert.match(
      await page.locator(".achievement-remaining").textContent(),
      /До следующей степени: 10соперников/,
    );
    const centered = await page.locator(".achievement-detail-progress").evaluate((node) => {
      const box = node.getBoundingClientRect(),
        first = node.firstElementChild.getBoundingClientRect(),
        last = node.lastElementChild.getBoundingClientRect();
      return Math.abs((first.left + last.right) / 2 - (box.left + box.right) / 2) < 2;
    });
    assert.ok(centered, "Progress and remaining amount form a centered group");
    await page.screenshot({
      path: path.join(__dirname, `../artifacts/${engine}-achievement-jumper.png`),
    });
    for (const size of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(size);
      await page.locator('.achievement-panel-tabs [data-panel="showcase"]').click();
      await page.getByLabel("Раздел достижений", { exact: true }).selectOption("all");
      await page.waitForTimeout(200);
      await gridLayout();
      const first = await page
        .locator(".achievement-card")
        .first()
        .getAttribute("data-achievement");
      await next.click();
      assert.notEqual(
        await page.locator(".achievement-card").first().getAttribute("data-achievement"),
        first,
      );
      await previous.click();
      assert.equal(
        await page.locator(".achievement-card").first().getAttribute("data-achievement"),
        first,
      );
      await page.screenshot({
        path: path.join(__dirname, `../artifacts/${engine}-achievement-grid-${size.width}.png`),
      });
      await page.locator(".achievement-card").first().click();
      assert.equal(await page.locator("#achievementDetail").isVisible(), true);
    }
    assert.deepEqual(errors, []);
    console.log(
      `${engine}: fixed cards, five-row limit, full-width columns, all pages reachable, centered progress, six viewports OK.`,
    );
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
