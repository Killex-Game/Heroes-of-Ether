/* Браузерный сценарий: projectiles. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { chromium } = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
const directory = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(directory, ".tmp-flight-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
const artifacts = path.join(directory, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let now = 5000,
  browser,
  broadcastTimer;
const app = createGameServer({
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => now,
    rateNow: () => performance.now(),
  }),
  errors = [];
async function until(fn, label) {
  for (let i = 0; i < 160; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error("Timeout: " + label);
}
async function observe(page) {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(r.status() + " " + r.url());
  });
  await page.evaluate(() => {
    window.flightHistory = [];
    const bodyRenderer = window.KillexBodyArt.Renderer.prototype,
      drawBody = bodyRenderer.body;
    bodyRenderer.body = function (...args) {
      window.flightLayers?.push("body");
      return drawBody.apply(this, args);
    };
    const renderer = window.KillexProjectiles.Renderer.prototype,
      draw = renderer.draw;
    renderer.draw = function (ctx, options) {
      if (window.flightLayerTime !== options.now) {
        window.flightLayerTime = options.now;
        window.flightLayers = [];
      }
      window.flightLayers.push((options.shots || []).map((s) => s.held ? "held" : s.boosterId));
      const samples = options.shots || this.motion.values(options.now),
        paths = [],
        curves = [];
      const view = ctx.getTransform(),
        anchors = {};
      for (const sample of samples)
        if (sample.followPart)
          anchors[sample.ownerId] = options.bodyFor(sample.ownerId, sample.partId);
      const originalImage = ctx.drawImage,
        originalCurve = ctx.quadraticCurveTo;
      ctx.drawImage = (img, ...args) => {
        const url = [...this.images].find(([, asset]) => asset === img)?.[0];
        if (url)
          paths.push({
            url,
            size: args[2] * options.scale,
            transform: {
              a: ctx.getTransform().a,
              b: ctx.getTransform().b,
              e: ctx.getTransform().e,
              f: ctx.getTransform().f,
            },
          });
        return originalImage.call(ctx, img, ...args);
      };
      ctx.quadraticCurveTo = (...args) => {
        curves.push(args);
        return originalCurve.apply(ctx, args);
      };
      try {
        draw.call(this, ctx, options);
      } finally {
        ctx.drawImage = originalImage;
        ctx.quadraticCurveTo = originalCurve;
      }
      const previous = window.flightFrame?.now === options.now ? window.flightFrame : null;
      window.flightFrame = {
        now: options.now,
        anchors: { ...previous?.anchors, ...anchors },
        view: { a: view.a, b: view.b, c: view.c, d: view.d, e: view.e, f: view.f },
        samples: [...(previous?.samples || []), ...samples],
        paths: [...(previous?.paths || []), ...paths],
        curves: (previous?.curves || 0) + curves.length,
        reduced: options.reducedMotion,
        loaded: [...this.images.values()].every(
          (img) => img.complete === undefined || (img.complete && img.naturalWidth),
        ),
      };
      if (samples.length === 1) {
        window.flightHistory.push(samples[0]);
        if (window.flightHistory.length > 400) window.flightHistory.shift();
      }
    };
  });
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
      page = await context.newPage();
    await page.addInitScript(() => performance.setResourceTimingBufferSize(6000));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const profile = (await (await context.request.get(url + "/api/profile")).json()).profile;
    const stored = app.profiles.byId(profile.id);
    stored.personal = { nameSet: true, introPending: false, gender: "male", vkUrl: "" };
    stored.loginReward = {date: require("../../src/server/accounts/account-benefits").loginRewardDay(Date.now()), day: 1};
    stored.inventory.rocket = 5;
    stored.quickSlots = ["rocket", null, null, null];
    stored.revision++;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await observe(page);
    app.arena.chooseSpawn = () => ({ x: 1200, y: 800 });
    await page.getByRole("button", {name: "Закрыть новости", exact: true}).click();
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    const owner = [...app.arena.players.values()].find((p) => p.profileId === profile.id);
    Object.assign(owner, {
      x: 1200,
      y: 800,
      targetX: 1200,
      targetY: 800,
      protectedUntil: 0,
      stopped: true,
    });
    app.broadcast();
    await page.waitForTimeout(250);
    await page.mouse.move(950, 450);
    await page.waitForTimeout(150);
    await page.keyboard.press("KeyA");
    await until(() => app.arena.combat.shots.length === 1, "настоящий запуск из слота");
    const launched = app.arena.combat.shots[0],
      dx = launched.dx,
      dy = launched.dy;
    assert.ok(
      Math.abs(Math.hypot(launched.x - owner.x, launched.y - owner.y) - owner.radius - 10) < 1e-6,
      "запуск за краем сферы",
    );
    assert.ok(dx > 0.9);
    assert.equal(app.profiles.byId(profile.id).inventory.rocket, 4);
    await page.mouse.move(200, 450);
    for (let i = 0; i < 14; i++) {
      now += 50;
      app.tick();
      await page.waitForTimeout(50);
    }
    assert.equal(launched.dx, dx);
    assert.equal(launched.dy, dy);
    const single = await page.evaluate(() => window.flightFrame),
      history = await page.evaluate(() => window.flightHistory);
    assert.ok(single.paths.some((p) => p.url === BOOSTERS.get("rocket").icon));
    assert.equal(single.curves, 0);
    assert.ok(
      new Set(history.map((s) => s.x.toFixed(3))).size > 14,
      "между пакетами есть промежуточные кадры",
    );
    for (let i = 1; i < history.length; i++)
      assert.ok(
        history[i].x >= history[i - 1].x - 0.001,
        "снаряд не летит за изменившимся курсором",
      );
    const otherContext = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
      other = await otherContext.newPage();
    const guest = app.profiles.open(), guestProfile = app.profiles.find(guest.token);
    guestProfile.personal = { nameSet: true, introPending: false, gender: "male", vkUrl: "" };
    guestProfile.loginReward = {date: require("../../src/server/accounts/account-benefits").loginRewardDay(Date.now()), day: 1};
    await otherContext.addCookies([{name: "sferorumiya_session", value: guest.token, url}]);
    await other.goto(url);
    await other.waitForFunction(() => !document.getElementById("playButton").disabled);
    await observe(other);
    if (await other.locator("#releaseNotesDialog").isVisible())
      await other.getByRole("button", {name: "Закрыть новости", exact: true}).click();
    await other.locator("#playButton").click();
    await other.locator("#arena").waitFor({ state: "visible" });
    const spectator = [...app.arena.players.values()].find((p) => p.id !== owner.id);
    for (const p of [owner, spectator])
      Object.assign(p, {
        x: 1200,
        y: 800,
        targetX: 1200,
        targetY: 800,
        protectedUntil: 0,
        stopped: true,
      });
    app.arena.combat.shots = [];
    const types = [...BOOSTERS.values()].filter(
      (b) => b.target === "direction" || b.kind === "vortex",
    );
    assert.ok(types.includes(BOOSTERS.get("fire_sword")));
    for (const item of types)
      app.arena.combat.prepare(owner, item, { aimX: 2000, aimY: 500 }, now)();
    app.arena.combat.shots.forEach((s, i) => {
      s.x = 875 + (i % 7) * 105;
      s.y = 560 + Math.floor(i / 7) * 100;
    });
    const renderedCount = app.arena.combat.shots.filter(s => s.boosterId !== "vortex").length;
    assert.equal(app.arena.combat.shots.filter(s => s.boosterId === "fire_sword").length, 1);
    app.broadcast();
    broadcastTimer = setInterval(() => app.broadcast(), 50);
    await until(
      () =>
        page.evaluate(count => window.flightFrame?.loaded && window.flightFrame.paths.length === count, renderedCount),
      "Миниатюры без большой иконки Вихря",
    );
    await until(
      () =>
        other.evaluate(count => window.flightFrame?.loaded && window.flightFrame.paths.length === count, renderedCount),
      "другой игрок видит все снаряды",
    );
    const frame = await page.evaluate(() => window.flightFrame);
    // Fractional camera movement must translate the texture continuously,
    // without alternating the width of neighbouring background tiles.
    const textureMotion = await page.evaluate(async () => {
      const bg = new window.KillexArenaBackgrounds.Renderer();
      bg.select("easter-meadow");
      await bg.images.get("easter-meadow").decode();
      const canvas = document.createElement("canvas");
      canvas.width = 1200; canvas.height = 700;
      const ctx = canvas.getContext("2d"), draw = ctx.drawImage;
      const frames = [];
      for (let i = 0; i <= 12; i++) {
        const shift = i / 10, tiles = [];
        ctx.setTransform(0.73, 0, 0, 0.73, shift, 0.63);
        ctx.drawImage = function (image, ...args) {
          const [x, y, width, height] = args.slice(-4), m = this.getTransform();
          tiles.push({center: (x + width / 2) * m.a + m.e, width: width * m.a});
          return draw.call(this, image, ...args);
        };
        bg.draw(ctx, {width: 6120, height: 4080}, {left:0,top:0,right:1500,bottom:900,scale:0.73});
        frames.push({shift, ...tiles[1]});
      }
      return frames;
    });
    for (const f of textureMotion) {
      assert.ok(Math.abs(f.width - textureMotion[0].width) < 1e-6, "tile width must not jitter");
      assert.ok(Math.abs(f.center - textureMotion[0].center - f.shift) < 1e-6, "continuous camera translation");
    }
    const layers = await page.evaluate(() => window.flightLayers);
    assert.ok(layers.length > 2 && layers.slice(1, -1).every((item) => item === "body"));
    assert.ok(layers[0].includes("rocket") && !layers[0].includes("fire"));
    assert.ok(layers.at(-1).includes("fire"));
    assert.ok(layers.at(-1).every((id) => ["fire", "pet_fire", "held"].includes(id)));
    assert.equal(frame.curves, 0);
    assert.equal(new Set(frame.samples.map((s) => s.boosterId)).size, types.length);
    assert.equal(
      frame.paths.filter((p) => p.url === BOOSTERS.get("rocket").icon).length,
      BOOSTERS.get("warheads").fan + 1,
      "одна Ракета и ракеты веера",
    );
    assert.ok(
      frame.paths
        .filter((p) => p.url !== BOOSTERS.get("fire_sword").icon)
        .every((p) => p.size >= 22 && p.size <= 48),
    );
    for (const id of [
      "cake",
      "freeze",
      "web",
      "mine",
      "lock",
      "axe",
      "stone",
      "poison",
      "mega_poison",
    ]) {
      const index = frame.samples.findIndex((s) => s.boosterId === id),
        shot = frame.samples[index];
      const drawn = frame.paths.find((p) => p.url === BOOSTERS.get(id).icon);
      const actual = Math.atan2(drawn.transform.b, drawn.transform.a);
      assert.ok(
        Math.abs(Math.cos(actual - (shot.spinMs * Math.PI * 2) / 3600) - 1) < 0.001,
        "вращение " + id,
      );
    }
    for (const b of types.filter((b) => !["warheads", "vortex"].includes(b.id)))
      assert.ok(
        frame.paths.some((p) => p.url === b.icon),
        "иконка " + b.id,
      );
    const rocketIndex = frame.samples.findIndex((s) => s.boosterId === "rocket"),
      r = frame.paths.find((p) => p.url === BOOSTERS.get("rocket").icon);
    const expectedAngle = frame.samples[rocketIndex].heading + Math.PI / 4;
    assert.ok(
      Math.abs(Math.atan2(r.transform.b, r.transform.a) - expectedAngle) < 0.001,
      "ракета направлена остриём по траектории",
    );
    await page.screenshot({ path: path.join(artifacts, "projectiles-all-desktop.png") });
    owner.x += 100;
    owner.y += 70;
    app.broadcast();
    for (const client of [page, other]) {
      await until(
        () =>
          client.evaluate(
            ({ id, x, y }) => {
              const f = window.flightFrame,
                s = f.samples.find((s) => s.boosterId === "vortex"),
                a = f.anchors[id];
              return (
                s?.x === x && s?.y === y && a && Math.abs(a.x - x) < 0.5 && Math.abs(a.y - y) < 0.5
              );
            },
            { id: owner.id, x: owner.x, y: owner.y },
          ),
        "Вихрь движется вместе с владельцем у обоих игроков",
      );
      const shown = await client.evaluate(() => window.flightFrame);
      assert.ok(!shown.paths.some((p) => p.url === BOOSTERS.get("vortex").icon));
    }
    const web = app.arena.combat.shots.find((s) => s.boosterId === "web"),
      stone = app.arena.combat.shots.find((s) => s.boosterId === "stone");
    web.landed = true;
    stone.boundary = true;
    app.broadcast();
    await until(
      () =>
        page.evaluate(() =>
          window.flightFrame.samples
            .filter((s) => s.boosterId === "web" || s.boosterId === "stone")
            .every((s) => !s.wind),
        ),
      "ветер пропал после остановки",
    );
    assert.equal((await page.evaluate(() => window.flightFrame)).curves, 0);
    const rocket = app.arena.combat.shots.find((s) => s.boosterId === "rocket");
    rocket.dx = -1;
    rocket.dy = 0;
    app.broadcast();
    for (const p of [page, other])
      await until(
        () =>
          p.evaluate(
            () =>
              Math.abs(
                window.flightFrame.samples.find((s) => s.boosterId === "rocket").heading - Math.PI,
              ) < 0.001,
          ),
        "новое направление видно обоим",
      );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => window.flightFrame.reduced);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assert.ok((await page.evaluate(() => window.flightFrame.paths.length)) > 0);
    await page.screenshot({ path: path.join(artifacts, "projectiles-mobile.png") });
    app.arena.combat.shots = [];
    app.broadcast();
    for (const p of [page, other])
      await until(
        () =>
          p.evaluate(
            () =>
              window.flightFrame.samples.length === 0 &&
              window.flightFrame.paths.length === 0 &&
              window.flightFrame.curves === 0,
          ),
        "удалённые снаряды и ветер исчезли",
      );
    assert.deepEqual(errors, []);
    console.log(
      "Projectile browser OK: real slot launch/cost, fixed cursor trajectory, smooth frames, directional boosters, Vortex zone without duplicate icon, individual fan rockets, landing/boundary, reflection on two clients, mobile and reduced motion, cleanup.",
    );
  } finally {
    clearInterval(broadcastTimer);
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== directory ||
      !path.basename(scratch).startsWith(".tmp-flight-")
    )
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
