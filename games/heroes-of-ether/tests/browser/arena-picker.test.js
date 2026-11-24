"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events");
const engines = require("playwright");
const { randomUUID } = require("node:crypto");
const { createGameServer } = require("../../src/server/game-server");
const output = path.resolve(process.env.ARENA_PICKER_OUTPUT || path.join(__dirname, "../../../../artifacts/arena-picker-20261025/browser"));
fs.mkdirSync(output, { recursive: true });
const report = [];
(async () => {
  for (const engine of process.argv[2] ? [process.argv[2]] : ["chromium", "firefox", "webkit"]) {
    const app = createGameServer({
      arenaPolicy: { ...require("../../config/arena-rooms.json"), levelGroups: false },
      testBots: { enabled: false },
    });
    let browser;
    try {
      app.httpServer.listen(0, "127.0.0.1");
      await once(app.httpServer, "listening");
      const url = `http://127.0.0.1:${app.httpServer.address().port}`;
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      const preparePlayer = async context => {
        const auth = app.profiles.open(), profile = app.profiles.find(auth.token);
        profile.name = 'Проверка арены';
        profile.personal = { nameSet: true, introPending: false, gender: 'male', vkUrl: '' };
        profile.loginReward = { date: require('../../src/server/accounts/account-benefits').loginRewardDay(Date.now()), day: 1 };
        await context.addCookies([{ name: 'sferorumiya_session', value: auth.token, url }]);
      };
      await preparePlayer(page.context());
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.status() === 404) errors.push(r.url());
      });
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.getByRole('button', { name: 'Закрыть новости', exact: true }).click();
      const measure = async (label) => {
        const data = await page.locator("#arenaPickerDialog").evaluate((node) => {
          const b = node.getBoundingClientRect();
          return {
            width: b.width,
            height: b.height,
            bottom: b.bottom,
            right: b.right,
            overflowX: node.scrollWidth - node.clientWidth,
            overflowY: node.scrollHeight - node.clientHeight,
            clipped: [...node.querySelectorAll("button")]
              .filter((n) => n.checkVisibility())
              .filter((n) => {
                const r = n.getBoundingClientRect();
                return r.right > b.right + 1 || r.bottom > b.bottom + 1;
              }).length,
          };
        });
        await page.screenshot({ path: path.join(output, `${engine}-${label}.png`) });
        assert.ok(data.bottom <= page.viewportSize().height, JSON.stringify(data));
        assert.ok(data.right <= page.viewportSize().width, JSON.stringify(data));
        assert.ok(
          data.overflowX <= 2 && data.overflowY <= 2 && data.clipped === 0,
          JSON.stringify(data),
        );
        report.push({ engine, label, ...data });
      };
      for (const [width, height] of [
        [1336, 768],
        [900, 650],
        [390, 844],
        [320, 700],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        const play = await page.locator("#playButton").boundingBox();
        const planet = await page.locator("#arenaPickerButton").boundingBox();
        await page.screenshot({ path: path.join(output, `${engine}-lobby-${width}.png`) });
        assert.ok(
          planet.x >= play.x + play.width && Math.abs(planet.y + planet.height / 2 - play.y - play.height / 2) <= 3,
          JSON.stringify({ width, play, planet }),
        );
        assert.ok(planet.x + planet.width <= width);
        await page.locator("#arenaPickerButton").click();
        await page.locator('.arena-choice[data-arena-id="arena-3"]').waitFor();
        assert.equal(await page.locator(".arena-choice:visible").count(), 3);
        await measure(`picker-${width}`);
        await page.getByRole("button", { name: "Закрыть выбор арены", exact: true }).click();
      }
      assert.equal(
        [...app.rooms.values()].reduce((n, room) => n + room.arena.players.size, 0),
        0,
      );
      await page.locator("#arenaPickerButton").click();
      await page.locator('.arena-choice[data-arena-id="arena-2"]').click();
      await page.waitForFunction(() => document.body.dataset.screen === "arena");
      assert.equal(app.rooms.get("arena-2").arena.players.size, 1);
      assert.equal(app.rooms.get("arena-1").arena.players.size, 0);
      await page.locator("#leaveButton").click();
      await page.locator("#leaveYes").click();
      await page.locator("#lifeLobby").click();
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.reload();
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      const newsClose = page.getByRole('button', { name: 'Закрыть новости', exact: true });
      if (await newsClose.isVisible()) await newsClose.click();
      await page.locator("#arenaPickerButton").click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-arena-id="arena-2"]')?.getAttribute("aria-pressed") ===
          "true",
      );
      await page.getByRole("button", { name: "Закрыть выбор арены", exact: true }).click();
      const secondContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await preparePlayer(secondContext);
      const secondPage = await secondContext.newPage();
      await secondPage.goto(url);
      await secondPage.waitForFunction(() => !document.getElementById("playButton").disabled);
      await secondPage.getByRole('button', { name: 'Закрыть новости', exact: true }).click();
      await secondPage.locator("#arenaPickerButton").click();
      await secondPage.locator('.arena-choice[data-arena-id="arena-3"]').waitFor();
      for (let i = 0; i < 30; i++)
        app.arenaRooms.reserve(`full-room-${i}`, {
          requestId: randomUUID(),
          preferredArenaId: "arena-3",
        });
      await secondPage.locator('.arena-choice[data-arena-id="arena-3"]').click();
      await secondPage.waitForFunction(() => document.body.dataset.screen === "arena");
      await secondPage.locator(".arena-transfer-notice").waitFor();
      assert.match(
        await secondPage.locator(".arena-transfer-notice").textContent(),
        /Подключена арена «(Альфа|Бета)»/,
      );
      await secondContext.close();
      for (let i = 0; i < 360; i++)
        app.arenaRooms.reserve(`fixture-${i}`, { requestId: randomUUID() });
      assert.equal(app.rooms.size, 14);
      for (const [width, height] of [
        [1366, 900],
        [320, 700],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        await page.locator("#arenaPickerButton").click();
        await page.waitForFunction(() => document.querySelectorAll(".arena-choice").length === 14);
        const seen = new Set();
        do {
          await measure(`expanded-${width}-${seen.size}`);
          for (const id of await page
            .locator(".arena-choice:visible")
            .evaluateAll((nodes) => nodes.map((n) => n.dataset.arenaId)))
            seen.add(id);
          if (await page.getByRole("button", { name: "Следующие арены", exact: true }).isDisabled())
            break;
          await page.getByRole("button", { name: "Следующие арены", exact: true }).click();
        } while (true);
        assert.equal(seen.size, 14);
        await page.getByRole("button", { name: "Закрыть выбор арены", exact: true }).click();
      }
      assert.deepEqual(errors, []);
    } finally {
      if (browser) await browser.close();
      await app.close();
    }
  }
  fs.writeFileSync(
    path.join(output, `${process.argv[2] || "all"}-report.json`),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ passed: true, layouts: report.length }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
