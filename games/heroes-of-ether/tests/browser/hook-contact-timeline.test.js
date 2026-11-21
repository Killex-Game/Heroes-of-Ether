"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { once } = require("node:events"),
  engines = require("playwright");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { createGameServer } = require("../../src/server/game-server");
const output = path.resolve(__dirname, "../../../../artifacts/arena-feedback-20261025/contact");
fs.mkdirSync(output, { recursive: true });
(async () => {
  for (const engine of ["chromium", "firefox", "webkit"]) {
    let time = 5000,
      timer,
      browser;
    const arena = new Arena({ etherCount: 0 }),
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
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${app.httpServer.address().port}`);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      const token = (await page.context().cookies()).find(
        (c) => c.name === "sferorumiya_session",
      ).value;
      const profile = app.profiles.find(token);
      profile.level = 25;
      profile.progress =
        require("../../src/server/progression/experience-progression").freshProgress(25);
      await page.reload();
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.locator("#shopSection").click();
      for (const [label, count, amount] of [
        ["Улучшенные", 7, 10],
        ["Редкие", 8, 20],
      ]) {
        await page.getByRole("button", { name: label, exact: true }).click();
        const cards = await page.locator(".booster-card").evaluateAll((nodes) =>
          nodes.map((n) => ({
            pack: n.querySelector(".booster-pack").textContent,
            price: n.querySelector(".booster-action").getAttribute("aria-label"),
          })),
        );
        assert.equal(cards.length, count);
        for (const card of cards) {
          assert.equal(card.pack, "10 шт.");
          assert.ok(card.price.endsWith(`10 шт. за ${amount} кристаллов`), card.price);
        }
      }
      await page.screenshot({ path: path.join(output, `rare-shop-${engine}.png`) });
      await page.getByRole("button", { name: "Закрыть бустеры" }).click();
      await page.locator("#playButton").click();
      await page.locator("#arena").waitFor({ state: "visible" });
      const owner = [...arena.players.values()][0],
        target = arena.addPlayer(time, "target");
      Object.assign(owner, {
        x: 1800,
        y: 1200,
        targetX: 1800,
        targetY: 1200,
        stopped: true,
        mass: 1000,
        radius: radiusForMass(1000),
        protectedUntil: 0,
        nextMassDecayAt: Infinity,
        spawnSerial: owner.spawnSerial + 1,
      });
      Object.assign(target, {
        x: 2100,
        y: 1200,
        stopped: true,
        protectedUntil: 0,
        nextMassDecayAt: Infinity,
        effects: { stone: time + 20000 },
      });
      target.parts = [
        { id: target.mainPartId, x: 2100, y: 1200 },
        { id: "remaining", x: 2300, y: 1500 },
      ].map((p) => ({
        ...p,
        mass: 20,
        radius: radiusForMass(20),
        vx: 0,
        vy: 0,
        mergeAt: time + 20000,
      }));
      arena.syncParts(target);
      await page.evaluate(() => {
        window.hookFrames = [];
        const proto = KillexArenaMotion.Motion.prototype,
          visible = proto.visible;
        proto.visible = function () {
          const r = visible.call(this);
          hookFrames.push({
            cursor: this.cursor,
            bodies: r.map((b) => ({
              key: b.key,
              x: b.position.x,
              y: b.position.y,
              mass: b.part.mass,
              radius: b.part.radius,
              booster: b.part.boosterId,
              opacity: b.opacity,
              retiring: b.retiring,
            })),
          });
          return r;
        };
      });
      // До выстрела нужны подтверждённые снимки неподвижных участников.
      timer = setInterval(() => {
        time += 50;
        app.tick();
      }, 50);
      await page.waitForTimeout(650);
      arena.prepareBooster(
        owner.id,
        { boosterId: "hook", spawnSerial: owner.spawnSerial, aimX: 2100, aimY: 1200 },
        time,
      )();
      const shotId = arena.combat.shots.at(-1).id;
      app.broadcast();
      let contact, absorption;
      const snapshot = arena.snapshot.bind(arena);
      arena.snapshot = (...args) => {
        const s = snapshot(...args);
        contact ||= s.visualEvents?.find((e) => e.shot?.id === shotId);
        absorption ||= s.events?.find((e) => e.type === "absorbed" && e.victimId === target.id);
        return s;
      };
      await page.waitForTimeout(2700);
      assert.ok(contact, "сервер подтвердил контакт крюка");
      assert.ok(absorption, "сервер подтвердил частичное поглощение");
      assert.equal(target.dead, false);
      assert.equal(arena.bodies(target).length, 1);
      const frames = await page.evaluate(() => hookFrames),
        victimKey = target.id + ":" + absorption.victimPartId;
      const contactAt = contact.tick * 50,
        absorbedAt = absorption.tick * 50;
      const beforeHit = frames.filter((f) => f.cursor < contactAt && f.cursor > contactAt - 200);
      for (const f of beforeHit)
        assert.equal(
          f.bodies.find((b) => b.key === victimKey).x,
          2100,
          "цель не притягивается до касания",
        );
      const lastHook = frames
        .filter((f) => f.bodies.some((b) => b.key === "projectile:" + shotId))
        .at(-1);
      const shownHook = lastHook.bodies.find((b) => b.key === "projectile:" + shotId);
      assert.ok(Math.abs(shownHook.x - contact.shot.x) < 5, "видимый крюк долетел до границы цели");
      const victimFrames = frames.filter((f) =>
        f.bodies.some((b) => b.key === victimKey && !b.retiring),
      );
      const lastVictim = victimFrames.at(-1);
      assert.ok(lastVictim.cursor < absorbedAt);
      for (const f of frames.filter((f) => f.cursor >= contactAt)) {
        const victim = f.bodies.find((b) => b.key === victimKey);
        if (f.cursor < absorbedAt) assert.equal(victim.opacity, 1, "поглощение без затухания");
        else assert.equal(victim, undefined, "после поглощения нет прозрачного остатка");
      }
      // Обычное деление и слияние не меняют прозрачность новых частей.
      const split = arena.addPlayer(time, "split");
      Object.assign(split, {
        x: 2800,
        y: 1800,
        stopped: true,
        mass: 100,
        radius: radiusForMass(100),
        protectedUntil: 0,
        nextMassDecayAt: Infinity,
      });
      app.broadcast();
      await page.waitForTimeout(500);
      arena.splitPlayer(split, { spawnSerial: split.spawnSerial, sequence: 1 }, time);
      const splitKey = split.id + ":" + split.parts[1].id;
      app.broadcast();
      await page.waitForTimeout(450);
      const splitFrames = (await page.evaluate(() => hookFrames)).flatMap((f) =>
        f.bodies.filter((b) => b.key === splitKey),
      );
      assert.ok(splitFrames.length > 0);
      assert.ok(splitFrames.every((b) => b.opacity === 1 && !b.retiring));
      arena.boosterEffects.startSponge(split, time);
      await page.waitForTimeout(1500);
      assert.equal(split.parts, null, "губка соединила части");
      const mergeFrames = (await page.evaluate(() => hookFrames)).flatMap((f) =>
        f.bodies.filter((b) => b.key.startsWith(split.id + ":")),
      );
      assert.ok(
        mergeFrames.every((b) => !b.retiring),
        "слияние без затухающих частей",
      );
      arena.removePlayer(split.id);
      // Появление новой жизни и уничтожение Огнём остаются плавными.
      for (const reason of ["fire"]) {
        await page.evaluate(() => {
          hookFrames.length = 0;
        });
        const ghost = arena.addPlayer(time, "fade-" + reason);
        Object.assign(ghost, { x: 2500, y: 1800, protectedUntil: 0, stopped: true });
        const key = ghost.id + ":" + ghost.mainPartId;
        app.broadcast();
        await page.waitForFunction(
          (key) => hookFrames.at(-1)?.bodies.some((b) => b.key === key && b.opacity === 1),
          key,
        );
        arena.boosterEffects.burn(ghost, ghost, time);
        app.broadcast();
        await page.waitForFunction(
          (key) => !hookFrames.at(-1)?.bodies.some((b) => b.key === key),
          key,
        );
        const fadeFrames = await page.evaluate(() => hookFrames);
        assert.ok(
          fadeFrames.some((f) =>
            f.bodies.some((b) => b.key === key && !b.retiring && b.opacity > 0 && b.opacity < 1),
          ),
          reason + " появление",
        );
        assert.ok(
          fadeFrames.some((f) =>
            f.bodies.some((b) => b.key === key && b.retiring && b.opacity > 0 && b.opacity < 1),
          ),
          reason + " затухание",
        );
        assert.ok(!fadeFrames.at(-1).bodies.some((b) => b.key === key));
      }
      // При выходе остаётся прежняя модель, затем её реальный рисунок затухает.
      await page.evaluate(() => {
        window.departureAlphas = [];
        const draw = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
          if (String(text).includes("__leaving__")) departureAlphas.push(this.globalAlpha);
          return draw.call(this, text, ...args);
        };
      });
      const leaving = arena.addPlayer(time, "leave");
      Object.assign(leaving, {
        name: "__leaving__",
        x: 2000,
        y: 1450,
        stopped: true,
        protectedUntil: Infinity,
        nextMassDecayAt: Infinity,
      });
      app.broadcast();
      await page.waitForFunction(() => departureAlphas.at(-1) === 1);
      await page.evaluate(() => {
        departureAlphas.length = 0;
      });
      const remnant = arena.leaveRemnant(leaving, time);
      arena.removePlayer(leaving.id);
      app.broadcast();
      await page.waitForTimeout(450);
      const lingerAlphas = await page.evaluate(() => departureAlphas);
      assert.ok(lingerAlphas.length > 0, "модель вышедшего игрока видна");
      assert.ok(
        lingerAlphas.every((a) => a === 1),
        "замена на оставшуюся модель без вспышки",
      );
      // Переводим тестовые часы к последней секунде ожидания выхода.
      remnant.removeAt = time + 1000;
      app.broadcast();
      await page.waitForTimeout(1400);
      const departureAlphas = await page.evaluate(() => window.departureAlphas);
      assert.ok(
        departureAlphas.some((a) => a > 0 && a < 0.9),
        "при выходе рисунок затухает",
      );
      assert.ok(!arena.players.has(remnant.id));
      await page.waitForFunction(
        (id) => !hookFrames.at(-1).bodies.some((b) => b.key.startsWith(id + ":")),
        remnant.id,
        { timeout: 3000 },
      );
      clearInterval(timer);
      // Размеры кнопок не меняются; насыщенные состояния наследуются от текущей темы.
      for (const theme of [
        "default",
        "bronze",
        "silver",
        "gold",
        "platinum",
        "diamond",
        "champions",
      ]) {
        await page.evaluate((theme) => {
          KillexUITheme.apply(theme);
        }, theme);
        if (theme !== "default") {
          const styles = await page.locator(".arena-chat .sf-button").evaluateAll((nodes) =>
            nodes.map((n) => {
              const s = getComputedStyle(n);
              return {
                image: s.getPropertyValue("--sf-default").trim(),
                expected: s
                  .getPropertyValue("--ui-art-controls-button_secondary_default-svg")
                  .trim(),
              };
            }),
          );
          for (const s of styles) {
            assert.ok(s.expected, theme);
            assert.equal(s.image, s.expected, theme);
          }
        }
      }
      Object.assign(owner, {
        skinId: "vip-4",
        appearance: { arenaFrame: "premium" },
        mass: 3913,
        radius: radiusForMass(3913),
        effects: { golden_shield: time + 20000 },
      });
      arena.removePlayer(target.id);
      app.broadcast();
      await page.waitForTimeout(1000);
      for (const width of [1366, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(400);
        await page.screenshot({
          path: path.join(output, `golden-shield-chat-${engine}-${width}.png`),
        });
      }
      assert.deepEqual(errors, []);
      fs.writeFileSync(
        path.join(output, `contact-${engine}.json`),
        JSON.stringify(
          { contact, absorption, lastHook, lastVictim, frames: frames.length },
          null,
          2,
        ),
      );
      console.log(
        `${engine}: вход/выход/Огонь плавные; деление, слияние и поглощение без затухания; контакт крюка OK`,
      );
    } finally {
      clearInterval(timer);
      if (browser) await browser.close();
      await app.close();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
