"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  playwright = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { xpForLevel } = require("../../src/server/progression/experience-progression");
const engine = process.env.ENGINE || "chromium",
  out = path.resolve(__dirname, "../artifacts/player-chat");
fs.mkdirSync(out, { recursive: true });
const profiles = new ProfileStore(),
  clans = new ClanService(profiles);
function user(name) {
  const u = profiles.open(),
    p = profiles.find(u.token);
  p.name = name;
  p.level = 12;
  p.progress.xp = xpForLevel(12);
  p.wallet.coins = 10000;
  p.account = require("../../src/server/accounts/account-benefits").fresh();
  return u;
}
const act = (u, action, extra = {}) =>
  clans.mutate(u.token, { action, requestId: randomUUID(), ...extra });
const a = user("Лунный рыцарь"),
  b = user("Звёздный страж");
profiles.find(a.token).account.vipUntil = Date.now() + 3600000;
profiles.find(a.token).account.premiumUntil = Date.now() + 3600000;
profiles.find(b.token).account.vipUntil = Date.now() + 3600000;
act(a, "create", { name: "Хранители чата", prefix: "CHAT", emblem: "astral", privacy: "open" });
const clanId = profiles.find(a.token).clanId;
act(b, "apply", { clanId });
const arenaFixture = new Arena({ etherCount: 0 });
for (let i = 0; i < 14; i++) {
  const p = arenaFixture.addPlayer(0, "fixture-" + i);
  Object.assign(p, {
    name: "Страж арены " + (i + 1),
    level: 12,
    clanId: "fixture-clan-" + (i % 6),
    clanPrefix: "T0" + ((i % 6) + 1),
    clanName: [
      "Алые фениксы",
      "Лунный дозор",
      "Хранители света",
      "Морские странники",
      "Янтарные львы",
      "Небесные рыцари",
    ][i % 6],
  });
  arenaFixture.gainMass(p, 1700 - i * 65);
}
const app = createGameServer({ profiles, arena: arenaFixture, autoTick: false });
let browser, timer;
const results = [];
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    timer = setInterval(() => app.broadcast(), 50);
    browser = await playwright[engine].launch({
      headless: true,
      ...(engine === "chromium" ? { channel: "chrome" } : {}),
    });
    for (const width of [1280, 390]) {
      const contexts = [],
        pages = [],
        errors = [];
      for (const u of [a, b]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        contexts.push(context);
        await context.addCookies([
          { name: "sferorumiya_session", value: u.token, url, httpOnly: true, sameSite: "Strict" },
        ]);
        await context.addInitScript(() => {
          const nativeSend = WebSocket.prototype.send;
          window.sentPackets = [];
          WebSocket.prototype.send = function (data) {
            window.sentPackets.push(JSON.parse(data));
            return nativeSend.call(this, data);
          };
        });
        const page = await context.newPage();
        pages.push(page);
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(url);
        await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
        const menu = await page.locator("#lobby .side-nav .menu-tile").evaluateAll((buttons) =>
          buttons.map((b) => ({
            alignment: getComputedStyle(b).textAlign,
            gap:
              b.querySelector("strong").getBoundingClientRect().left -
              b.querySelector("img").getBoundingClientRect().right,
          })),
        );
        assert.equal(menu.length, 7);
        assert.ok(
          menu.every((b) => b.alignment === "left" && b.gap >= 4),
          JSON.stringify({ width, menu }),
        );
        if (u === a) await page.screenshot({ path: path.join(out, `${engine}-${width}-menu.png`) });
        await page.locator("#playButton").click();
        await page.locator("#arena").waitFor({ state: "visible" });
        if (!(await page.locator("#arenaChatBody").isVisible()))
          await page.locator(".arena-chat-toggle").click();
      }
      const [one, two] = pages;
      const arena = one.locator("#arenaChat"),
        input = arena.locator(".chat-input");
      await input.fill("Привет, арена! " + width);
      await input.press("Enter");
      await two
        .locator(".arena-chat .chat-text")
        .filter({ hasText: "Привет, арена! " + width })
        .waitFor();
      await two.locator(".arena-chat .chat-input").fill("VIP на связи " + width);
      await two.locator(".arena-chat .chat-input").press("Enter");
      await one
        .locator(".arena-chat .chat-text")
        .filter({ hasText: "VIP на связи " + width })
        .waitFor();
      assert.equal(
        await one.locator(".arena-chat .account-label-premium").first().textContent(),
        "[CHAT] Лунный рыцарь [12]",
      );
      assert.equal(
        await one.locator(".arena-chat .account-label-vip").first().textContent(),
        "[CHAT] Звёздный страж [12]",
      );
      const checkHud = async () => {
        const layout = await one.evaluate(() => {
          const rect = (selector) => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              bottom: r.bottom,
              right: r.right,
            };
          };
          const top = document.querySelector(".leaderboard");
          return {
            width: innerWidth,
            height: innerHeight,
            top: rect(".leaderboard"),
            chat: rect("#arenaChat"),
            quick: rect(".booster-quick"),
            mass: rect(".mass-panel"),
            players: document.querySelectorAll("#leaderList .leader-row").length,
            clans: document.querySelectorAll("#arenaClanList .arena-clan-row").length,
            clanMass: document.querySelectorAll("#arenaClanList strong").length,
            topOverflow: top.scrollHeight > top.clientHeight + 1,
            chatBackground: getComputedStyle(document.querySelector("#arenaChatBody"))
              .backgroundColor,
            topBackground: getComputedStyle(top).backgroundColor,
            premiumColor: getComputedStyle(
              document.querySelector(".arena-chat .account-label-premium"),
            ).color,
            vipColor: getComputedStyle(document.querySelector(".arena-chat .account-label-vip"))
              .color,
          };
        });
        const overlap = (a, b) =>
          a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
        assert.equal(layout.players, 10);
        assert.equal(layout.clans, 6);
        assert.equal(layout.clanMass, 0);
        assert.equal(layout.topOverflow, false);
        assert.ok(layout.top.height <= 325, JSON.stringify(layout));
        assert.ok(
          layout.chat.right <= layout.width && layout.chat.right >= layout.width - 25,
          JSON.stringify(layout),
        );
        assert.ok(
          layout.chat.bottom <= layout.height && layout.chat.y >= 0,
          JSON.stringify(layout),
        );
        assert.equal(overlap(layout.chat, layout.top), false, JSON.stringify(layout));
        assert.equal(overlap(layout.chat, layout.quick), false, JSON.stringify(layout));
        assert.equal(overlap(layout.chat, layout.mass), false, JSON.stringify(layout));
        assert.equal(layout.chatBackground, layout.topBackground);
        assert.equal(layout.premiumColor, "rgb(162, 12, 206)");
        assert.equal(layout.vipColor, "rgb(189, 89, 0)");
        return layout;
      };
      results.push(await checkHud());
      if (width === 1280) {
        for (const theme of ["gold", "platinum", "champions"]) {
          await one.evaluate((id) => KillexUITheme.apply(id), theme);
          await checkHud();
        }
        await one.evaluate(() => KillexUITheme.apply("default"));
      }
      if (width === 390) {
        await one.setViewportSize({ width: 390, height: 667 });
        results.push(await checkHud());
        await one.screenshot({ path: path.join(out, `${engine}-short-portrait-arena.png`) });
        await one.setViewportSize({ width: 844, height: 390 });
        results.push(await checkHud());
        await one.screenshot({ path: path.join(out, `${engine}-landscape-arena.png`) });
        await one.setViewportSize({ width, height: 900 });
      }
      await input.fill("");
      const actionsBefore = await one.evaluate(
        () =>
          sentPackets.filter((m) => ["split", "feed", "useBooster", "setTurbo"].includes(m.type))
            .length,
      );
      await input.press("KeyW");
      await input.press("Space");
      await input.press("KeyT");
      await input.press("KeyA");
      assert.equal(
        await one.evaluate(
          () =>
            sentPackets.filter((m) => ["split", "feed", "useBooster", "setTurbo"].includes(m.type))
              .length,
        ),
        actionsBefore,
      );
      const literal = '<img src=x onerror="window.chatXss=true"> Привет! ' + width;
      await input.fill(literal);
      await input.press("Enter");
      await two.locator(".arena-chat .chat-text").filter({ hasText: literal }).waitFor();
      assert.equal(await two.evaluate(() => window.chatXss), undefined);
      assert.equal(await two.locator(".chat-message img").count(), 0);
      const box = await arena.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
      await one.screenshot({ path: path.join(out, `${engine}-${width}-arena.png`) });
      await input.press("Escape");
      assert.equal(await one.locator("#arenaChatBody").isVisible(), false);
      assert.equal(await one.locator("#leaveConfirmDialog").isVisible(), false);
      for (const page of pages) {
        await page.locator("#leaveButton").click();
        await page.locator("#leaveYes").click();
        await page.locator("#lifeLobby").click();
        await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
        await page.locator("#clanSection").click();
        await page
          .locator("#clanDialog .clan-nav")
          .getByRole("button", { name: "Чат", exact: true })
          .click();
        await page.locator(".clan-chat .chat-input").waitFor();
      }
      const clanInput = one.locator(".clan-chat .chat-input");
      const clanText = "Только для нашего клана " + width;
      await clanInput.fill(clanText);
      // Сервер принял POST, но ответ потерян. Повтор должен сохранить тот же requestId.
      let dropped = false;
      await one.route("**/api/clans/chat", async (route) => {
        if (route.request().method() === "POST" && !dropped) {
          dropped = true;
          await route.fetch();
          return route.abort("failed");
        }
        return route.continue();
      });
      await clanInput.press("Enter");
      await one.waitForFunction(() => !document.querySelector(".clan-chat .chat-input").readOnly);
      assert.equal(await clanInput.inputValue(), clanText);
      await two.locator(".clan-chat .chat-text").filter({ hasText: clanText }).waitFor();
      assert.equal(
        await two.locator(".clan-chat .account-label-premium").first().textContent(),
        "[CHAT] Лунный рыцарь [12]",
      );
      await clanInput.press("Enter");
      await one.waitForFunction(
        () => document.querySelector(".clan-chat .chat-input").value === "",
      );
      assert.equal(
        await one.locator(".clan-chat .chat-text").filter({ hasText: clanText }).count(),
        1,
      );
      assert.equal(
        await two.locator(".clan-chat .chat-text").filter({ hasText: clanText }).count(),
        1,
      );
      // Новые сообщения не забирают фокус и не стирают черновик собеседника.
      await two.locator(".clan-chat .chat-input").fill("Мой черновик");
      await clanInput.fill("Проверка обновления " + width);
      await clanInput.press("Enter");
      await two
        .locator(".clan-chat .chat-text")
        .filter({ hasText: "Проверка обновления " + width })
        .waitFor();
      assert.equal(await two.locator(".clan-chat .chat-input").inputValue(), "Мой черновик");
      assert.equal(await two.evaluate(() => document.activeElement.className), "chat-input");
      const layout = await one.locator("#clanDialog").evaluate((d) => ({
        width: d.getBoundingClientRect().width,
        overflow: d.scrollWidth > d.clientWidth + 1,
      }));
      assert.ok(layout.width <= width);
      assert.equal(layout.overflow, false);
      await one.screenshot({ path: path.join(out, `${engine}-${width}-clan.png`) });
      if (width === 390) {
        await one.setViewportSize({ width: 844, height: 390 });
        const sendBox = await one.locator(".clan-chat .chat-send").boundingBox();
        // На низком экране окно может прокручиваться, поле остаётся достижимым.
        await one.locator(".clan-chat .chat-send").scrollIntoViewIfNeeded();
        assert.ok(sendBox.width > 50);
        await one.screenshot({ path: path.join(out, `${engine}-landscape-clan.png`) });
      }
      await one.locator("#clanDialog .booster-close").click();
      let polls = 0;
      one.on("request", (request) => {
        if (request.url().includes("/api/clans/chat?")) polls++;
      });
      await one.waitForTimeout(3300);
      assert.equal(polls, 0);
      if (width === 390) {
        act(b, "leave", { clanId });
        await two.waitForFunction(() => document.querySelector(".clan-chat .chat-input").disabled);
        assert.equal(await two.locator(".clan-chat .chat-message").count(), 0);
      }
      assert.deepEqual(errors, []);
      results.push({
        engine,
        width,
        arenaDelivery: true,
        clanDelivery: true,
        safeText: true,
        noDuplicate: true,
        noPollingWhenClosed: true,
      });
      for (const context of contexts) await context.close();
    }
    fs.writeFileSync(
      path.join(out, `${engine}-verification.json`),
      JSON.stringify(results, null, 2),
    );
    console.log("PASS", engine, results.length, "chat viewport cases");
  } finally {
    clearInterval(timer);
    if (browser) await browser.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
