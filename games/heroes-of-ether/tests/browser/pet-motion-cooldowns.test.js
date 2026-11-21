"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  engines = require("playwright");
const { createGameServer } = require("../../src/server/game-server");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { Arena } = require("../../src/server/arena/arena-simulation");
const output = path.resolve(__dirname, "../../../../artifacts/pet-simple-idle-20261023/browser");
fs.mkdirSync(output, { recursive: true });
const app = createGameServer({
  profiles: new ProfileStore(),
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
});
const report = [];
let browser;
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    for (const engine of ["chromium", "firefox", "webkit"]) {
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        Object.defineProperty(window, "KillexPetsUI", {
          configurable: true,
          set(Base) {
            Object.defineProperty(window, "KillexPetsUI", {
              value: class extends Base {
                constructor(...args) {
                  super(...args);
                  window.petUnderTest = this;
                }
              },
            });
          },
        });
      });
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      const auth = (await page.context().cookies()).find((c) => c.name === "sferorumiya_session");
      const profile = app.profiles.find(auth.value);
      profile.level = 12;
      profile.progress.xp =
        require("../../src/server/progression/experience-progression").xpForLevel(12);
      await page.reload();
      await page.waitForFunction(() => !document.getElementById("petsSection").disabled);
      await page.locator("#petsSection").click();
      await page.waitForFunction(() => document.querySelector("img.pet-portrait"));
      await page.evaluate(() => document.fonts.ready);
      for (const width of [1366, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const pet of ["zaya", "leva", "drakosha", "manya"]) {
          await page.locator(`.pet-choice[data-pet="${pet}"]`).click();
          await page.locator(".pet-stage").scrollIntoViewIfNeeded();
          await page.waitForTimeout(150);
          const geometry = await page.locator(".pet-portrait").evaluate((svg) => {
            const r = svg.getBoundingClientRect();
            return {
              width: r.width,
              height: r.height,
              right: r.right,
              left: r.left,
              scroll: document.getElementById("petsDialog").scrollWidth,
              viewport: innerWidth,
            };
          });
          assert.ok(geometry.width > 100 && geometry.height > 100, JSON.stringify(geometry));
          assert.ok(geometry.scroll <= width + 1, JSON.stringify(geometry));
          const motion = await page.locator(".pet-portrait").evaluate((portrait) => {
            const animations = portrait.getAnimations();
            const animation = animations[0];
            animation.pause();
            animation.currentTime = 0;
            const before = getComputedStyle(portrait).transform;
            animation.currentTime = 2500;
            return {
              before,
              after: getComputedStyle(portrait).transform,
              count: animations.length,
              tag: portrait.tagName,
              name: getComputedStyle(portrait).animationName,
            };
          });
          assert.equal(motion.tag, "IMG");
          assert.equal(motion.count, 1);
          assert.equal(motion.name, "pet-float");
          assert.notEqual(motion.before, motion.after);
          await page.screenshot({ path: path.join(output, `${engine}-${width}-${pet}.png`) });
          report.push({ engine, width, pet, geometry, motion });
        }
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector(".pet-portrait")).animationName === "none",
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.waitForFunction(() => !matchMedia("(prefers-reduced-motion: reduce)").matches);
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      assert.equal(
        await page.locator(".pet-portrait").evaluate((p) => getComputedStyle(p).animationPlayState),
        "paused",
      );
      await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      assert.equal(
        await page.locator(".pet-portrait").evaluate((p) => getComputedStyle(p).animationPlayState),
        "running",
      );
      await page.evaluate(() => petUnderTest.dialog.close());
      assert.equal(
        await page.locator(".pet-portrait").evaluate((p) => getComputedStyle(p).animationPlayState),
        "paused",
      );
      const hud = await page.evaluate(() => {
        const ui = petUnderTest,
          sent = [];
        let me = {
          id: "synthetic",
          spawnSerial: 1,
          pet: {
            id: "manya",
            stock: { fire: 2, claw: 2, glove: 2, carrot: 0 },
            sequence: 0,
            vitality: 100,
            cooldowns: { fire: 300 },
            nextGiftMs: 1000,
            active: true,
          },
        };
        ui.owner = {
          getMe: () => me,
          isArena: () => true,
          inputBlocked: () => false,
          getAim: () => ({ x: 200, y: 200 }),
          send: (message) => {
            sent.push(message);
            return true;
          },
          notice: () => {},
        };
        ui.updateArena();
        const q = ui.fire.dataset.cooldown,
          r = ui.secondary.dataset.cooldown;
        ui.use("fire");
        ui.use("secondary");
        const first = sent[0];
        ui.receive({ requestId: first.requestId, ok: true });
        me = {
          ...me,
          pet: {
            ...me.pet,
            id: "leva",
            stock: { fire: 0, claw: 0, glove: 2, carrot: 0 },
            cooldowns: { glove: 300 },
          },
        };
        ui.updateArena();
        const sixth = ui.sixthItem();
        ui.use("sixth", { x: 200, y: 200 });
        return {
          q,
          r,
          count: sent.length,
          first: first.ability,
          sixthCooldown: sixth.cooldownMs,
          duration: KillexPets.ABILITY_COOLDOWN_MS,
        };
      });
      assert.equal(hud.q, "true");
      assert.equal(hud.r, "false");
      assert.equal(hud.count, 1);
      assert.equal(hud.first, "secondary");
      assert.ok(hud.sixthCooldown > 0 && hud.sixthCooldown <= 300);
      assert.equal(hud.duration, 300);
      assert.deepEqual(errors, []);
      console.log(
        engine + ": 4 pets, wide/narrow, reduced motion, visibility, Q/R/H cooldowns passed",
      );
      await browser.close();
      browser = null;
    }
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
