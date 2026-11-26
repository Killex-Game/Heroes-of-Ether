"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { once } = require("node:events");
const engines = require("playwright");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { createGameServer } = require("../../src/server/game-server");
const output = path.resolve(__dirname, "../../../../artifacts/arena-feedback-20261025/motion");
fs.mkdirSync(output, { recursive: true });
(async () => {
  for (const engine of ["chromium", "firefox", "webkit"]) {
    let time = 5000,
      timer,
      browser;
    const profiles = new (require("../../src/server/profiles/profile-store").ProfileStore)();
    const session = profiles.open();
    const profile = profiles.find(session.token);
    profile.name = "Проверка деления";
    profile.loginReward = {date:require("../../src/server/accounts/account-benefits").loginRewardDay(Date.now()), day:1};
    profile.personal = { nameSet: true, introPending: false, gender: "male", vkUrl: "" };
    const arena = new Arena({ etherCount: 0 }),
      app = createGameServer({
        arena, profiles,
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
      const url = `http://127.0.0.1:${app.httpServer.address().port}`;
      await page.context().addCookies([{name:"sferorumiya_session",value:session.token,url}]);
      await page.addLocatorHandler(page.locator("#releaseNotesDialog[open]"), d => d.getByRole("button",{name:"Закрыть новости"}).click());
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.locator("#playButton").click();
      await page.locator("#arena").waitFor({ state: "visible" });
      const p = [...arena.players.values()][0];
      Object.assign(p, {
        x: 2000,
        y: 2000,
        targetX: 2000,
        targetY: 2000,
        mass: 1000,
        radius: radiusForMass(1000),
        stopped: true,
        protectedUntil: 0,
        nextMassDecayAt: Infinity,
      });
      await page.evaluate(() => {
        window.motionFrames = [];
        window.foodDraws = [];
        const proto = KillexArenaMotion.Motion.prototype,
          visible = proto.visible;
        proto.visible = function () {
          const r = visible.call(this);
          motionFrames.push({
            cursor: this.cursor,
            bodies: r.map((b) => ({
              key: b.key,
              kind: b.kind,
              x: b.position.x,
              y: b.position.y,
              opacity: b.opacity,
            })),
          });
          return r;
        };
        const food = KillexArenaArt.FoodRenderer.prototype,
          draw = food.drawMoving;
        food.drawMoving = function (ctx, orbs, bounds) {
          foodDraws.push(orbs.map(item => ({ id: (item.part || item).id,
            x: (item.position || item).x, y: (item.position || item).y })));
          return draw.call(this, ctx, orbs, bounds);
        };
      });
      timer = setInterval(() => {
        time += 50;
        app.tick();
      }, 50);
      await page.waitForTimeout(650);
      await page.mouse.move(1050, 450);
      await page.keyboard.press("Space");
      await page.waitForFunction(
        () => motionFrames.filter((f) => f.bodies.filter((b) => !b.kind).length === 2).length >= 12,
      );
      assert.equal(p.parts.length, 2);
      const child = p.parts.find((b) => b.birth),
        key = p.id + ":" + child.id;
      const frames = await page.evaluate(() => motionFrames);
      const childFrames = frames.flatMap((f) =>
        f.bodies.filter((b) => b.key === key).map((b) => ({ ...b, cursor: f.cursor })),
      );
      assert.ok(childFrames.length > 5);
      assert.ok(
        childFrames.every((b) => b.opacity === 1),
        "деление без затухания",
      );
      assert.ok(
        new Set(childFrames.map((b) => b.x.toFixed(2))).size > 6,
        "часть движется между снимками",
      );
      const early = childFrames.filter((b) => b.cursor < child.birth.tick * 50 + 150);
      assert.ok(early.length > 0, "видно начало разделения");
      assert.ok(
        Math.hypot(early[0].x - child.birth.x, early[0].y - child.birth.y) < child.radius,
        "появление внутри исходной части",
      );
      // Aim across the split path so the leading cell cannot immediately eat the test pellet.
      await page.mouse.move(220, 120);
      await page.keyboard.down("w");
      let orb;
      try {
        await page.waitForFunction(() => foodDraws.some(orbs => orbs.length));
        const id = await page.evaluate(() => foodDraws.find(orbs => orbs.length)[0].id);
        orb = { id };
        await page.waitForFunction(id => new Set(foodDraws.flat().filter(o => o.id === id)
          .map(o => o.x.toFixed(2))).size > 6, id);
      } finally {
        await page.keyboard.up("w");
      }
      const draws = (await page.evaluate(() => foodDraws)).flat().filter((o) => o.id === orb.id);
      fs.writeFileSync(
        path.join(output, engine + "-debug.json"),
        JSON.stringify(
          { orb, draws, frames: await page.evaluate(() => motionFrames.slice(-12)) },
          null,
          2,
        ),
      );
      assert.ok(draws.length > 5, "еда рисуется в кадрах, не в статичном кеше");
      assert.ok(new Set(draws.map((o) => o.x.toFixed(2))).size > 6, "еда движется между снимками");
      const foodFrames = (await page.evaluate(() => motionFrames)).flatMap((f) =>
        f.bodies.filter((b) => b.key === "food:" + orb.id),
      );
      assert.ok(foodFrames.every((b) => b.opacity === 1));
      await page.screenshot({ path: path.join(output, engine + ".png") });
      fs.writeFileSync(
        path.join(output, engine + ".json"),
        JSON.stringify({ childFrames, draws }, null, 2),
      );
      assert.deepEqual(errors, []);
      console.log(engine + ": разделение из исходного шара, W между кадрами, без затухания OK");
    } finally {
      clearInterval(timer);
      if (browser) await browser.close();
      await app.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
