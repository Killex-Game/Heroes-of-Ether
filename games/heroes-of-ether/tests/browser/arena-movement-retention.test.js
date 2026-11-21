"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { once } = require("node:events"),
  engines = require("playwright"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation"),
  { createGameServer } = require("../../src/server/game-server");
const artifacts = path.resolve(__dirname, "../artifacts");
fs.mkdirSync(artifacts, { recursive: true });
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.fail("Ожидаемое серверное состояние не наступило");
}
(async () => {
  for (const engine of ["chromium", "firefox", "webkit"]) {
    let time = 5000,
      browser;
    const arena = new Arena({ etherCount: 0, random: () => 0.5 }),
      app = createGameServer({
        arena,
        autoTick: false,
        now: () => time,
        testBots: { enabled: false },
      });
    try {
      app.httpServer.listen(0, "127.0.0.1");
      await once(app.httpServer, "listening");
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } }),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        const Socket = window.WebSocket;
        window.WebSocket = class extends Socket {
          constructor(...args) {
            super(...args);
            this.addEventListener("message", ({ data }) => {
              const message = JSON.parse(data);
              if (message.type === "state") window.movementState = message;
            });
          }
        };
      });
      await page.goto(`http://127.0.0.1:${app.httpServer.address().port}`);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.locator("#playButton").click();
      await page.locator("#arena").waitFor({ state: "visible" });
      const player = [...arena.players.values()][0];
      Object.assign(player, { x: 1800, y: 1200, targetX: 1800, targetY: 1200, protectedUntil: 0 });
      app.broadcast();
      await page.waitForFunction(() => movementState?.players.some((p) => p.x === 1800));
      await page.waitForTimeout(300);
      await page.mouse.move(1050, 450);
      await until(() => player.targetX > player.x);
      // Настоящий клик по элементу за пределами дерева арены не меняет курс.
      await page.evaluate(() => {
        const outside = document.createElement("button");
        outside.id = "testOutsideArena";
        outside.textContent = "Вне арены";
        outside.style.cssText = "position:fixed;left:0;top:0;z-index:99999";
        document.body.append(outside);
      });
      const previousTarget = { x: player.targetX, y: player.targetY };
      await page.locator("#testOutsideArena").click();
      assert.equal(player.stopped, false);
      assert.ok(player.targetX > player.x);
      assert.ok(Math.abs(player.targetY - previousTarget.y) < 10);
      await page.keyboard.down("KeyW");
      await until(() => arena.ether.length > 0);
      // blur и visibilitychange приходят подряд при переключении из окна браузера.
      await page.evaluate(() => {
        window.dispatchEvent(new Event("blur"));
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await until(() => player.moveDirection !== null);
      await page.waitForTimeout(100);
      const releasedFood = arena.ether.length;
      await page.waitForTimeout(350);
      assert.equal(
        arena.ether.length,
        releasedFood,
        "удерживаемое W отпускается при потере фокуса",
      );
      await page.keyboard.up("KeyW");
      const direction = { ...player.moveDirection },
        before = { x: player.x, y: player.y };
      time += 2500;
      for (let i = 0; i < 80; i++) {
        time += 50;
        app.tick();
      }
      assert.ok(player.x > before.x + 100);
      assert.deepEqual(player.moveDirection, direction);
      assert.ok(
        Math.abs((player.x - before.x) * direction.y - (player.y - before.y) * direction.x) < 1e-5,
      );
      await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event("visibilitychange"));
        document.getElementById("testOutsideArena").remove();
      });
      await page.mouse.move(300, 450);
      await until(() => player.moveDirection === null && player.targetX < player.x);
      player.parts = [-300, 300].map((dx, i) => ({
        id: i ? "second" : player.mainPartId,
        x: 1800 + dx,
        y: 1200,
        mass: 100,
        radius: radiusForMass(100),
        vx: 0,
        vy: 0,
        mergeAt: time + 30000,
      }));
      player.mergeAt = time + 30000;
      arena.syncParts(player);
      app.broadcast();
      await page.waitForFunction(() => movementState?.players[0].parts.length === 2);
      await page.keyboard.press("Escape");
      await page.locator("#leaveConfirmDialog").waitFor({ state: "visible" });
      await until(() => player.stopped && player.moveDirection === null);
      for (let i = 0; i < 180; i++) {
        time += 50;
        app.tick();
      }
      assert.equal(player.parts.length, 2);
      assert.ok(player.parts[1].x - player.parts[0].x < 100);
      assert.equal(arena.mainBody(player).x, 1500, "главный шар остаётся центром сборки");
      await page.locator("#leaveNo").click();
      await page.locator("#leaveConfirmDialog").waitFor({ state: "hidden" });
      // Штатный рендер всех трёх щитов, проверка больших и малых экранов.
      if (engine === "chromium") {
        player.parts = null;
        Object.assign(player, {
          skinId: "vip-4",
          appearance: { arenaFrame: "premium" },
          mass: 3913,
          radius: radiusForMass(3913),
          x: 1800,
          y: 1200,
        });
        for (const id of ["colorful_shield", "golden_shield", "clan_shield"]) {
          player.effects = { [id]: time + 10000 };
          app.broadcast();
          await page.waitForFunction(
            (shield) => movementState?.players[0].effects.some((e) => e.id === shield),
            id,
          );
          await page.waitForTimeout(1500);
          await page.screenshot({ path: path.join(artifacts, `shield-closer-${id}.png`) });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        player.effects = { colorful_shield: time + 10000 };
        app.broadcast();
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(artifacts, "shield-closer-mobile.png") });
        await page.setViewportSize({ width: 1366, height: 900 });
      }
      await page.mouse.move(1000, 400);
      await until(() => !player.stopped);
      await page.locator("#leaveButton").click();
      await page.locator("#leaveConfirmDialog").waitFor({ state: "visible" });
      await until(() => player.stopped && player.moveDirection === null);
      await page.locator("#leaveYes").click();
      await until(() => [...arena.players.values()].some((p) => p.isRemnant));
      const model = [...arena.players.values()].find((p) => p.isRemnant);
      assert.equal(model.moveDirection, null);
      assert.equal(model.removeAt, time + 16000);
      assert.deepEqual(errors, []);
      console.log(
        `${engine}: outside click, blur/hidden, retained direction, Escape/leave centering OK`,
      );
    } finally {
      if (browser) await browser.close();
      await app.close();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
