/* Кнопки клана и уведомления: одинаковые размеры и отсутствие сдвигов при сообщениях. */
"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  { chromium, firefox, webkit } = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { xpForLevel } = require("../../src/server/progression/experience-progression");
const profiles = new ProfileStore(),
  clans = new ClanService(profiles),
  head = profiles.open(),
  member = profiles.open();
for (const user of [head, member]) {
  const p = profiles.find(user.token);
  p.level = 25;
  p.progress.xp = xpForLevel(25);
  p.wallet.coins = 10000;
}
clans.mutate(head.token, {
  action: "create",
  requestId: randomUUID(),
  name: "Аметистовые драконы",
  prefix: "AM",
  emblem: "astral",
  privacy: "open",
});
const clanId = profiles.find(head.token).clanId;
clans.mutate(member.token, { action: "apply", requestId: randomUUID(), clanId });
clans.mutate(head.token, {
  action: "role",
  requestId: randomUUID(),
  clanId,
  memberId: profiles.find(member.token).id,
  role: "manager",
});
const app = createGameServer({ profiles, arena: new Arena({ etherCount: 0 }), autoTick: false }),
  artifacts = path.resolve(__dirname, "../artifacts/clan-actions-and-notifications");
fs.mkdirSync(artifacts, { recursive: true });
const rects = (page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll(
        "#clanDialog .clan-banner, #clanDialog .clan-home-grid > .clan-panel",
      ),
    ].map((node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
(async () => {
  const report = [];
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    for (const [name, engine, options] of [
      ["chrome", chromium, { channel: "chrome" }],
      ["edge", chromium, { channel: "msedge" }],
      ["firefox", firefox, {}],
      ["webkit", webkit, {}],
    ]) {
      if (process.env.SF_BROWSER_ENGINE && process.env.SF_BROWSER_ENGINE !== name) continue;
      const browser = await engine.launch({ headless: true, ...options });
      try {
        const context = await browser.newContext();
        await context.addCookies([{ name: "sferorumiya_session", value: member.token, url }]);
        const page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(url);
        await page.waitForFunction(() => !document.getElementById("playButton").disabled);
        await page.locator("#clanSection").click();
        await page.locator("#clanDialog .clan-banner").waitFor();
        for (const [width, height] of [
          [1920, 1080],
          [1366, 768],
          [1024, 768],
          [390, 844],
          [320, 568],
        ]) {
          await page.setViewportSize({ width, height });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForFunction(() =>
            [...document.querySelectorAll("#clanDialog img")].every(
              (image) => image.complete && image.naturalWidth > 0,
            ),
          );
          await page.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          const buttons = await page
            .locator("#clanDialog .clan-banner-actions > button")
            .evaluateAll((nodes) =>
              nodes.map((node) => {
                const { x, y, width, height } = node.getBoundingClientRect();
                return { x, y, width, height, text: node.textContent };
              }),
            );
          assert.equal(buttons.length, 3);
          assert.equal(buttons[0].text, "Выйти из клана");
          assert(
            buttons.every(
              (b) =>
                Math.abs(b.width - buttons[0].width) < 1 &&
                Math.abs(b.height - buttons[0].height) < 1,
            ),
            JSON.stringify(buttons),
          );
          assert(
            buttons[0].x < buttons[1].x && buttons.every((b) => b.x >= 0 && b.x + b.width <= width),
            JSON.stringify(buttons),
          );
          const before = await rects(page);
          await page.evaluate(() => {
            const source = document.querySelector("#clanDialog .clan-status");
            source.textContent =
              "Клан обновлён. Изменения сохранены — уведомление не должно двигать участников, битву и таблицу лиги.";
          });
          await page.locator(".system-message-toast.is-visible").waitFor();
          assert.deepEqual(await rects(page), before, `${name} ${width}: success message`);
          assert.equal(await page.locator("#clanDialog .clan-status").isVisible(), false);
          assert.equal(
            await page
              .locator(".system-message-toast")
              .evaluate((node) => getComputedStyle(node).position),
            "fixed",
          );
          await page.evaluate(() => {
            const source = document.querySelector("#clanDialog .clan-status");
            source.textContent = "Нет связи с сервером. Попробуй ещё раз.";
            source.dataset.error = "true";
          });
          await page.waitForFunction(
            () => document.querySelector(".system-message-toast").dataset.error === "true",
          );
          assert.deepEqual(await rects(page), before, `${name} ${width}: error message`);
          await page.evaluate(() => {
            document.querySelector("#clanDialog .clan-status").textContent = "";
          });
          await page.locator(".system-message-toast").waitFor({ state: "hidden" });
          assert.deepEqual(await rects(page), before, `${name} ${width}: cleared message`);
          // Screenshot capture can trigger a separate WebKit layout pass after resizing.
          // Keep it outside the before/after measurements of message changes.
          await page
            .locator("#clanDialog")
            .screenshot({ path: path.join(artifacts, `${name}-${width}.png`) });
          report.push({ browser: name, width, height, passed: true });
        }
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.locator(".clan-leave-button").click();
        await page.locator("#clanDialog .clan-confirm:not([hidden])").waitFor();
        await page
          .locator("#clanDialog .clan-confirm")
          .getByRole("button", { name: "Отмена", exact: true })
          .click();
        assert.equal(profiles.find(member.token).clanId, clanId);
        for (const selector of [
          "#boosterDialog .booster-message",
          "#accountDialog .account-message",
          ".wardrobe-status",
          ".personal-status",
          ".chest-modal-message",
          ".donation-bonus-status",
        ]) {
          const result = await page.evaluate(async (selector) => {
            const source = document.querySelector(selector),
              dialog = source.closest("dialog");
            KillexWindows.open(dialog);
            const rect = () => {
              const { x, y, width, height } = dialog.getBoundingClientRect();
              return { x, y, width, height };
            };
            const before = rect();
            source.textContent = "Проверка системной подсказки без сдвига окна";
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const after = rect(),
              visible = document
                .querySelector(".system-message-toast")
                .classList.contains("is-visible");
            source.textContent = "";
            dialog.close();
            return { before, after, visible };
          }, selector);
          assert.deepEqual(result.before, result.after, selector);
          assert(result.visible, selector);
        }
        // Dynamic member windows and browsers without the Popover API use the same fixed notice.
        await page.evaluate(() => {
          const dialog = document.createElement("dialog");
          dialog.id = "notificationFixture";
          dialog.innerHTML =
            '<div style="width:240px;height:100px">Управление участником</div><p class="clan-status"></p>';
          document.body.append(dialog);
          KillexWindows.open(dialog);
        });
        await page.waitForFunction(() =>
          document
            .querySelector("#notificationFixture .clan-status")
            .classList.contains("system-message-source"),
        );
        const dynamicBefore = await page.locator("#notificationFixture").boundingBox();
        await page.evaluate(() => {
          const toast = document.querySelector(".system-message-toast");
          toast.showPopover = undefined;
          toast.hidePopover = undefined;
          document.querySelector("#notificationFixture .clan-status").textContent =
            "Роль участника сохранена";
        });
        await page.locator(".system-message-toast.is-visible").waitFor();
        assert.deepEqual(await page.locator("#notificationFixture").boundingBox(), dynamicBefore);
        assert.equal(await page.locator("#notificationFixture .system-message-toast").count(), 1);
        await page.locator(".system-message-toast").waitFor({ state: "hidden", timeout: 7000 });
        assert.deepEqual(errors, []);
      } finally {
        await browser.close();
      }
    }
    fs.writeFileSync(path.join(artifacts, "verification.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, cases: report.length }));
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
