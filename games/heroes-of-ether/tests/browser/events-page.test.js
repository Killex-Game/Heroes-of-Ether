"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  engines = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager"),
  { manifest } = require("../../src/server/events/lucky-week");
const out = path.resolve(
  __dirname,
  "../../../../artifacts/event-presentation-20261027/events-browser",
);
fs.mkdirSync(out, { recursive: true });
(async () => {
  const report = [];
  for (const engine of ["chromium", "firefox", "webkit"].filter(
    (name) => !process.env.EVENTS_BROWSER || process.env.EVENTS_BROWSER === name,
  )) {
    let now = Math.floor(Date.now() / 60000) * 60000;
    const profiles = new ProfileStore({ now: () => now }),
      events = new EventManager({ now: () => now });
    const act = (action, input) =>
      events.apply("test-owner", action, {
        ...input,
        revision: events.data.revision,
        requestId: randomUUID(),
      });
    act("upload", { manifest });
    act("start", { eventId: manifest.id });
    const auth = profiles.open(),
      app = createGameServer({
        profiles,
        events,
        autoTick: false,
        testBots: { enabled: false },
        wallNow: () => now,
      });
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const browser = await engines[engine].launch({
      headless: true,
      ...(engine === "chromium" ? { channel: "chrome" } : {}),
    });
    try {
      const url = "http://127.0.0.1:" + app.httpServer.address().port,
        context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      await context.addCookies([
        { name: "sferorumiya_session", value: auth.token, url, httpOnly: true },
      ]);
      const page = await context.newPage(),
        errors = [],
        missing = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.status() === 404) missing.push(new URL(r.url()).pathname);
      });
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.locator("#eventAnnouncement[open]").waitFor();
      assert.ok(
        (await page.locator(".event-announcement-banner").getAttribute("src")).endsWith(
          "banner-v3.webp",
        ),
      );
      await page.getByRole("button", { name: "Закрыть объявление об ивенте" }).click();
      await page.locator("#eventsSection").click();
      const dialog = page.locator("#eventsDialog");
      const waitForLayout = () =>
        page.waitForFunction(() => {
          const root = document.getElementById("eventsDialog"),
            stage = root.querySelector(".events-stage").getBoundingClientRect(),
            map = root.querySelector(".events-map").getBoundingClientRect();
          return (
            map.left >= stage.left &&
            map.right <= stage.right &&
            map.top >= stage.top &&
            map.bottom <= stage.bottom
          );
        });
      await dialog.waitFor({ state: "visible" });
      await page.waitForFunction(
        () =>
          document.querySelectorAll("#eventsDialog .event-card img").length === 8 &&
          [...document.querySelectorAll("#eventsDialog .event-card img")].every(
            (i) => i.complete && i.naturalWidth,
          ),
      );
      assert.equal(await dialog.locator(".event-card").count(), 8);
      assert.equal(await dialog.locator(".event-card-lock").count(), 6);
      assert.equal(await dialog.locator('[data-event-index="0"]').isEnabled(), true);
      await page.waitForFunction(() =>
        document
          .getElementById("eventsDialog")
          .getAnimations({ subtree: true })
          .some((animation) => animation.playState === "running"),
      );
      for (const [width, height] of [
        [1920, 1080],
        [1366, 768],
        [1024, 600],
        [844, 390],
        [568, 320],
        [390, 844],
        [320, 568],
      ]) {
        await page.setViewportSize({ width, height });
        await waitForLayout();
        while (
          (await dialog.getByRole("button", { name: "Предыдущие события" }).isVisible()) &&
          (await dialog.getByRole("button", { name: "Предыдущие события" }).isEnabled())
        )
          await dialog.getByRole("button", { name: "Предыдущие события" }).click();
        if (width === 390 || width === 844)
          await dialog.screenshot({ path: path.join(out, engine + "-" + width + ".png") });
        const seen = new Set();
        do {
          const layout = await dialog.evaluate((root) => {
            const visible = [...root.querySelectorAll(".event-card")].filter((n) => !n.hidden);
            const boxes = visible.map((n) => {
              const b = n.getBoundingClientRect();
              return {
                id: Number(n.dataset.eventIndex),
                x: b.x,
                y: b.y,
                right: b.right,
                bottom: b.bottom,
                width: b.width,
                height: b.height,
                overflow: n.scrollHeight > n.clientHeight + 1,
              };
            });
            return {
              boxes,
              lines: root.querySelectorAll(".events-line-base").length,
              scroll:
                root.scrollHeight > root.clientHeight + 1 ||
                root.scrollWidth > root.clientWidth + 1,
              rect: { width: root.clientWidth, height: root.clientHeight },
              stageWidth: root.querySelector(".events-stage").clientWidth,
              columns: root.querySelector(".events-map").style.gridTemplateColumns,
            };
          });
          assert.equal(layout.scroll, false, JSON.stringify(layout));
          assert.ok(
            Math.abs(layout.rect.width - width) < 1 && Math.abs(layout.rect.height - height) < 1,
            JSON.stringify(layout),
          );
          assert.equal(layout.lines, layout.boxes.length === 8 ? 1 : 0);
          for (const b of layout.boxes) {
            seen.add(b.id);
            assert.ok(
              b.x >= 0 && b.y >= 0 && b.right <= width + 1 && b.bottom <= height + 1 && !b.overflow,
              JSON.stringify({ width, height, layout }),
            );
            assert.ok(
              Math.abs(b.width - layout.boxes[0].width) < 1 &&
                Math.abs(b.height - layout.boxes[0].height) < 1,
            );
          }
          if (
            !(await dialog.getByRole("button", { name: "Следующие события" }).isVisible()) ||
            !(await dialog.getByRole("button", { name: "Следующие события" }).isEnabled())
          )
            break;
          await dialog.getByRole("button", { name: "Следующие события" }).click();
        } while (true);
        assert.equal(seen.size, 8);
        report.push({ engine, width, height, passed: true });
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      await waitForLayout();
      await dialog.screenshot({ path: path.join(out, engine + "-default.png") });
      await page.evaluate(() => {
        document.documentElement.dataset.uiTheme = "champions";
      });
      await dialog.screenshot({ path: path.join(out, engine + "-champions.png") });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForFunction(() =>
        document
          .getElementById("eventsDialog")
          .getAnimations({ subtree: true })
          .every((animation) => animation.playState !== "running"),
      );
      assert.equal(
        await dialog
          .locator(".events-line-flow")
          .first()
          .evaluate((n) => getComputedStyle(n).animationName),
        "none",
      );
      await dialog.locator('[data-event-index="0"]').click();
      await page.locator("#rouletteDialog[open]").waitFor();
      assert.equal(await dialog.evaluate((n) => n.open), false);
      assert.equal(await dialog.getAttribute("data-animate"), "false");
      await page.getByRole("button", { name: "Закрыть рулетку" }).click();
      await page.locator("#eventsSection").click();
      now = events.active(now).endsAt;
      await page.evaluate(
        (at) => document.dispatchEvent(new CustomEvent("killex:server-time", { detail: at })),
        now,
      );
      await page.waitForFunction(() => document.querySelector(".event-card-lucky").disabled);
      assert.equal(
        await dialog.locator(".event-card-status").first().innerText(),
        "Ожидает начала",
      );
      await page.keyboard.press("Escape");
      assert.equal(await dialog.evaluate((n) => n.open), false);
      await page.locator("#eventsSection").click();
      await page.waitForFunction(() => document.querySelector(".event-card-lucky").disabled);
      await dialog.getByRole("button", { name: "В лобби" }).click();
      assert.equal(await dialog.evaluate((n) => n.open), false);
      assert.deepEqual(errors, []);
      assert.deepEqual(missing, []);
      console.log(engine + ": passed");
    } finally {
      await browser.close();
      await app.close();
    }
  }
  fs.writeFileSync(path.join(out, "verification.json"), JSON.stringify(report, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
