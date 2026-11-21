/* Обрыв, ошибка и зависание арены: системное окно без автоматического выхода в лобби. */
"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  playwright = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { Arena } = require("../../src/server/arena/arena-simulation");
const out = path.resolve(__dirname, "../artifacts/connection-lost");
fs.mkdirSync(out, { recursive: true });
const app = createGameServer({
  profiles: new ProfileStore(),
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
});
let browser,
  timer,
  broadcasting = true;
const results = [];
async function until(check, label) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw Error("Timeout: " + label);
}
(async () => {
  try {
    await new Promise((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    timer = setInterval(() => {
      if (broadcasting) app.broadcast();
    }, 50);
    for (const engine of process.env.ENGINE
      ? [process.env.ENGINE]
      : ["chromium", "firefox", "webkit"]) {
      browser = await playwright[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      for (const width of [1280, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const auth = app.profiles.open(), prepared = app.profiles.find(auth.token);
        prepared.name = "Странник";
        prepared.personal = { nameSet: true, introPending: false, gender: "male", vkUrl: "" };
        prepared.loginReward = { date: require("../../src/server/accounts/account-benefits").loginRewardDay(app.profiles.now()), day: 1 };
        await context.addCookies([{ name: "sferorumiya_session", value: auth.token, url }]);
        await context.addInitScript(() => {
          const NativeWebSocket = window.WebSocket;
          window.testSockets = [];
          window.testSent = [];
          window.WebSocket = class extends NativeWebSocket {
            constructor(...args) {
              super(...args);
              const decoder = new window.KillexArenaWire.Decoder();
              window.testSockets.push(this);
              this.addEventListener("message", (event) => {
                const data = JSON.parse(event.data);
                if (data.type === "state") window.testLastState = decoder.decode(data);
              });
            }
            send(data) {
              window.testSent.push(JSON.parse(data));
              return super.send(data);
            }
          };
        });
        const page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        let initialFailure = width === 1280;
        if (initialFailure) {
          const offline = (route) =>
            initialFailure
              ? route.fulfill({
                  status: 503,
                  contentType: "application/json",
                  body: JSON.stringify({ ready: false }),
                })
              : route.continue();
          await page.route("**/api/profile", offline);
          await page.route("**/api/arena/availability", offline);
        }
        await page.goto(url);
        if (initialFailure) {
          await page.waitForFunction(() =>
            document.querySelector("#playButton").classList.contains("connection-pending"),
          );
          assert.equal(await page.locator("#playButton").isDisabled(), true);
          assert.equal(app.arena.players.size, 0);
          initialFailure = false;
          await page.evaluate(() => dispatchEvent(new Event("online")));
        }
        await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
        await page.unroute("**/api/profile");
        await page.unroute("**/api/arena/availability");
        await page.locator("#releaseNotesDialog").waitFor({ state: "visible" });
        await page.locator("#releaseNotesDialog").getByRole("button", { name: "Понятно", exact: true }).click();
        const { profile } = await (await context.request.get(url + "/api/profile")).json();
        const saved = () => app.profiles.byId(profile.id);
        const enter = async () => {
          await page.waitForFunction(() => !window.KillexBoot.active);
          await page.evaluate(() => document.querySelector("#releaseNotesDialog[open]")?.close());
          await page.locator("#playButton").click();
          await page.locator("#arena").waitFor({ state: "visible" });
          await page.waitForFunction(() => window.testLastState?.players.length);
          return [...app.arena.players.values()].find((p) => p.profileId === profile.id);
        };
        const drop = (player) =>
          [...app.wss.clients].find((s) => s.playerId === player.id).terminate();
        const lost = page.locator("#connectionLostDialog");
        const checkLost = async () => {
          await lost.waitFor({ state: "visible" });
          await page.waitForTimeout(310);
          assert.equal(await page.locator("#connectionLostTitle").textContent(), "Связь потеряна");
          assert.equal(await page.locator("#lobby").isVisible(), false);
          assert.equal(await page.locator("#arena").isVisible(), true);
          assert.equal(await page.locator("#lifeResultDialog").isVisible(), false);
          assert.equal(await page.locator("#leaveConfirmDialog").isVisible(), false);
          assert.equal(await page.evaluate(() => document.activeElement.id), "connectionLostTitle");
          const layout = await lost.evaluate((d) => {
            const b = d.getBoundingClientRect(),
              s = getComputedStyle(d);
            return {
              fits:
                b.left >= 0 &&
                b.right <= innerWidth + 1 &&
                b.top >= 0 &&
                b.bottom <= innerHeight + 1,
              scrolls: d.scrollWidth > d.clientWidth + 1,
              animation: s.animationName,
              border: s.borderImageSource,
            };
          });
          assert.deepEqual(layout, {
            fits: true,
            scrolls: false,
            animation: "connection-lost-enter",
            border: "none",
          });
          await page.keyboard.press("Escape");
          await page.mouse.click(2, 2);
          assert.equal(await lost.isVisible(), true);
        };
        const lobby = async () => {
          await page.locator("#connectionLostLobby").click();
          await page.locator("#lobby").waitFor({ state: "visible" });
          await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
          assert.equal(await lost.isVisible(), false);
          await until(
            () => ![...app.arena.players.values()].some((p) => p.profileId === profile.id),
            "old sphere removed",
          );
        };
        const player = await enter();
        const initialXp = saved().progress.xp;
        app.profiles.applyArenaProgress(
          randomUUID(),
          [{ type: "survivalMinute", profileId: profile.id, mass: 1500, minutes: 1 }],
          Date.now(),
        );
        await page.locator("#leaveButton").click();
        await page.locator("#leaveConfirmDialog").waitFor({ state: "visible" });
        drop(player);
        await checkLost();
        const frozen = await page.locator("#game").evaluate((canvas) => canvas.toDataURL());
        const sent = await page.evaluate(() => window.testSent.length);
        await page.keyboard.press("Space");
        await page.keyboard.press("KeyW");
        await page.keyboard.press("KeyT");
        await page.evaluate(() => {
          const old = window.testSockets.at(-1);
          old.dispatchEvent(new Event("error"));
          old.dispatchEvent(new CloseEvent("close"));
          old.dispatchEvent(
            new MessageEvent("message", { data: JSON.stringify(window.testLastState) }),
          );
          dispatchEvent(new Event("online"));
        });
        await page.waitForTimeout(150);
        assert.equal(await page.evaluate(() => window.testSent.length), sent);
        assert.equal(await page.locator("#game").evaluate((canvas) => canvas.toDataURL()), frozen);
        assert.equal(await lost.isVisible(), true);
        await page.screenshot({ path: path.join(out, `${engine}-${width}.png`) });
        if (width === 390) {
          await page.setViewportSize({ width: 844, height: 390 });
          assert.equal(
            await page.locator("#game").evaluate((canvas) => canvas.toDataURL()),
            frozen,
          );
          const box = await lost.boundingBox();
          assert.ok(box.y >= 0 && box.y + box.height <= 390);
          await page.screenshot({ path: path.join(out, `${engine}-landscape.png`) });
          await page.setViewportSize({ width, height: 900 });
        }
        await lobby();
        assert.equal(saved().progress.xp, initialXp + 3);
        assert.equal(saved().progress.lastLife.earnedXp, 3);

        // Доступный HTTP-сервер ещё не означает готовность арены. Во время сбоя
        // не разрешены ни клик, ни submit с клавиатуры, ни автоматический вход.
        let availabilityMode = "unavailable",
          probes = 0;
        await page.route("**/api/arena/availability", async (route) => {
          probes++;
          if (availabilityMode === "healthy") return route.continue();
          return route.fulfill({
            status: availabilityMode === "unavailable" ? 503 : 200,
            contentType: "application/json",
            body: availabilityMode === "invalid" ? "not json" : JSON.stringify({ ready: false }),
          });
        });
        const lostPlayer = await enter();
        drop(lostPlayer);
        await checkLost();
        await page.locator("#connectionLostLobby").click();
        await page.locator("#lobby").waitFor({ state: "visible" });
        const play = page.locator("#playButton");
        await until(() => probes > 0, "readiness requested");
        const buttonSize = await play.boundingBox();
        const buttonScroll = await page.evaluate(() => scrollY);
        assert.equal(await play.isDisabled(), true);
        assert.equal(await play.getAttribute("aria-busy"), "true");
        assert.match(await play.getAttribute("aria-label"), /восстановления/);
        assert.equal(await play.evaluate((n) => getComputedStyle(n).textShadow), "none");
        assert.equal(
          await play.evaluate((n) => {
            const style = getComputedStyle(n);
            return (
              style.getPropertyValue("--sf-art").trim() ===
              style.getPropertyValue("--sf-default").trim()
            );
          }),
          true,
          "golden button artwork is preserved",
        );
        const spinner = await play.evaluate((button) => {
          const style = getComputedStyle(button, "::after");
          return { animation: style.animationName, width: style.width, height: style.height };
        });
        assert.deepEqual(spinner, {
          animation: "arena-connection-loading",
          width: "22px",
          height: "22px",
        });
        const socketCount = await page.evaluate(() => window.testSockets.length);
        await play.click({ force: true });
        await page.evaluate(() => document.querySelector("#joinForm").requestSubmit());
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.testSockets.length), socketCount);
        await page.screenshot({ path: path.join(out, `${engine}-${width}-recovery.png`) });
        for (const mode of ["not-ready", "invalid"]) {
          availabilityMode = mode;
          const before = probes;
          await page.evaluate(() => dispatchEvent(new Event("online")));
          await until(() => probes > before, mode + " probe");
          await page.waitForTimeout(100);
          assert.equal(await play.isDisabled(), true);
        }
        await page.emulateMedia({ reducedMotion: "reduce" });
        assert.equal(
          await play.evaluate((n) => getComputedStyle(n, "::after").animationName),
          "none",
        );
        await page.emulateMedia({ reducedMotion: "no-preference" });
        availabilityMode = "healthy";
        // Без online-события: обычный повторный запрос сам замечает восстановление.
        await page.waitForFunction(() => !document.querySelector("#playButton").disabled, null, {
          timeout: 20000,
        });
        assert.equal(await play.getAttribute("aria-busy"), "false");
        assert.equal(await play.textContent(), "Играть");
        const recoveredSize = await play.boundingBox();
        const recoveredScroll = await page.evaluate(() => scrollY);
        // Forced clicks can scroll the mobile page; compare document coordinates.
        assert.deepEqual({ ...recoveredSize, y: 0 }, { ...buttonSize, y: 0 });
        assert.ok(Math.abs(recoveredSize.y + recoveredScroll - buttonSize.y - buttonScroll) < 0.01);
        assert.equal(await page.evaluate(() => window.testSockets.length), socketCount);
        const probesAfterRecovery = probes;
        await page.waitForTimeout(150);
        assert.equal(probes, probesAfterRecovery);
        await page.unroute("**/api/arena/availability");

        // An OS connectivity hint alone must not kill a functioning socket.
        const offlinePlayer = await enter();
        await page.locator("#settingsButton").click();
        await page.evaluate(() => dispatchEvent(new Event("offline")));
        await page.waitForTimeout(300);
        assert.equal(await lost.isVisible(), false);
        await context.setOffline(true);
        drop(offlinePlayer);
        await checkLost();
        assert.match(await page.locator("#connectionLostMessage").textContent(), /Соединение/);
        assert.equal(await page.locator("#settingsMenu").isVisible(), false);
        await page.locator("#connectionLostLobby").click();
        await page.locator("#lobby").waitFor({ state: "visible" });
        assert.equal(await play.isDisabled(), true);
        await context.setOffline(false);
        await page.evaluate(() => dispatchEvent(new Event("online")));
        await page.waitForFunction(() => !document.querySelector("#playButton").disabled);

        if (width === 1280) {
          await enter();
          await page.evaluate(() => window.testSockets.at(-1).dispatchEvent(new Event("error")));
          await checkLost();
          await lobby();

          // Соединение остаётся открытым, но сервер больше не присылает снимки арены.
          await enter();
          broadcasting = false;
          await lost.waitFor({ state: "visible", timeout: 15000 });
          await checkLost();
          assert.match(
            await page.locator("#connectionLostMessage").textContent(),
            /перестал обновлять/,
          );
          broadcasting = true;
          await lobby();

          // Обычный выход сохраняет прежнее окно результата; последующий сбой не выдаёт XP повторно.
          const next = await enter();
          await page.locator("#leaveButton").click();
          await page.locator("#leaveYes").click();
          await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
          assert.equal(await page.locator("#lifeResultTitle").textContent(), "Выход с арены");
          assert.equal(await lost.isVisible(), false);
          const earned = saved().progress.xp;
          drop(next);
          await checkLost();
          await page.emulateMedia({ reducedMotion: "reduce" });
          assert.equal(await lost.evaluate((n) => getComputedStyle(n).animationName), "none");
          await lobby();
          assert.equal(saved().progress.xp, earned);
        }
        assert.deepEqual(errors, []);
        results.push({
          engine,
          width,
          frozenArena: true,
          explicitExit: true,
          noDuplicateXp: true,
          recoveryButton: true,
          readinessNotJustHttp: true,
          offlineRecovery: true,
          stall: width === 1280,
        });
        await context.close();
      }
      await browser.close();
      browser = null;
    }
    fs.writeFileSync(
      path.join(out, `${process.env.ENGINE || "all"}-verification.json`),
      JSON.stringify(results, null, 2),
    );
    console.log(
      "PASS",
      results.length,
      "viewport/browser cases: close/error/offline/stall, duplicate events, frozen scene, manual exit, reconnect, XP, reduced motion.",
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
