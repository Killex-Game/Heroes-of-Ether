"use strict";
const fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict"),
  { once } = require("events"),
  pw = require("playwright");
const f = require("../helpers/black-friday-fixture")(),
  benefits = require("../../src/server/accounts/account-benefits");
const p = f.p();
p.name = "Проверяющий";
p.personal = { nameSet: true, introPending: false, gender: "male", vkUrl: "" };
p.loginReward = { date: benefits.loginRewardDay(f.now()), day: 1 };
p.account = { ...benefits.fresh(), vipUntil: f.now() + 86400000, premiumUntil: f.now() + 86400000 };
const other = f.store.open();
let target = f.store.find(other.token);
target.name = "Профиль для проверки";
const engine = process.argv[2] || "chromium",
  out =
    process.env.KILLEX_TEST_ARTIFACTS || path.resolve(__dirname, "../artifacts/sphere-profile-ui");
fs.mkdirSync(out, { recursive: true });
const report = { engine, errors: [], checks: [], geometry: [] };
let browser;
const app = require("../../src/server/game-server").createGameServer({
  profiles: f.store,
  events: f.manager,
  autoTick: false,
  testBots: { enabled: false },
  wallNow: f.now,
});
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await pw[engine].launch({
      headless: true,
      ...(engine === "chromium" ? { channel: "chrome" } : {}),
    });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await context.addCookies([{ name: "sferorumiya_session", value: f.user.token, url }]);
    await context.addInitScript((epoch) => {
      Date.now = () => epoch + performance.now();
    }, f.now());
    const page = await context.newPage();
    page.on("pageerror", (e) => report.errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page.evaluate(() => {
      for (const d of document.querySelectorAll("dialog[open]")) d.close();
    });
    await page.evaluate(
      (id) =>
        localStorage.setItem(KillexPlatform.storageKey(".releaseNotes.v1." + id), KillexRelease.id),
      p.id,
    );
    await page.evaluate(() => document.querySelector("#releaseNotesDialog[open]")?.close());
    // Daily bonuses remain actionable only next to their respective currencies.
    assert.equal(await page.locator("#accountButton .menu-notification-dot").count(), 0);
    for (const currency of ["coins", "crystals", "bucks"])
      assert(
        (await page
          .locator('#walletStatus [data-currency="' + currency + '"] .currency-bonus-dot')
          .count()) > 0,
      );
    await page.locator('#walletStatus [data-currency="coins"]').click();
    for (const kind of ["vip", "premium"]) {
      const card = page.locator('.donation-bonus-card[data-account-kind="' + kind + '"]');
      await card.locator("button").click();
      await page.waitForFunction(
        (kind) =>
          document.querySelector('.donation-bonus-card[data-account-kind="' + kind + '"]')?.dataset
            .available === "false",
        kind,
      );
    }
    await page.evaluate(() => {
      for (const d of document.querySelectorAll("dialog[open]")) d.close();
    });
    assert.equal(await page.locator("#accountButton .menu-notification-dot").count(), 0);
    assert.equal(
      await page.locator('#walletStatus [data-currency="coins"] .currency-bonus-dot').count(),
      0,
    );
    for (const currency of ["crystals", "bucks"])
      assert(
        (await page
          .locator('#walletStatus [data-currency="' + currency + '"] .currency-bonus-dot')
          .count()) > 0,
      );
    report.checks.push(
      "Only currency buttons show available daily bonuses; claiming coins clears only that indicator",
    );
    target = f.store.find(other.token);
    target.moderation = {
      ban: { at: f.now(), until: null, by: "fixture-owner", reason: "not public" },
    };
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((id) => KillexPlayerProfile.open(id), target.id);
      await page.waitForSelector(".public-player-ban");
      const bounds = await page.locator(".public-player-ban").evaluate((e) => {
        const a = e.parentElement.querySelector(".public-player-avatar").getBoundingClientRect(),
          b = e.getBoundingClientRect(),
          s = getComputedStyle(e);
        return {
          avatar: a.toJSON(),
          badge: b.toJSON(),
          text: e.textContent,
          color: s.color,
          background: s.backgroundColor,
        };
      });
      assert.equal(bounds.text, "Забанен");
      assert.equal(bounds.color, "rgb(255, 255, 255)");
      assert.equal(bounds.background, "rgb(189, 35, 57)");
      assert(bounds.badge.y >= bounds.avatar.bottom + 4);
      assert(bounds.badge.x >= 0 && bounds.badge.right <= width);
      await page
        .locator("#playerProfileDialog")
        .screenshot({ path: path.join(out, engine + "-banned-" + width + ".png") });
      await page.evaluate(() => document.getElementById("playerProfileDialog").close());
    }
    target.moderation.ban.until = f.now() - 1;
    await page.evaluate((id) => KillexPlayerProfile.open(id), target.id);
    await page.waitForSelector(".public-player-avatar");
    assert.equal(await page.locator(".public-player-ban").count(), 0);
    target.moderation.ban.until = await page.evaluate(() => Date.now() + 1800);
    await page.evaluate((id) => KillexPlayerProfile.open(id), target.id);
    await page.waitForSelector(".public-player-ban");
    await page.waitForSelector(".public-player-ban", { state: "detached", timeout: 6000 });
    target.moderation.ban = null;
    await page.evaluate((id) => KillexPlayerProfile.open(id), target.id);
    await page.waitForSelector(".public-player-avatar");
    assert.equal(await page.locator(".public-player-ban").count(), 0);
    report.checks.push(
      "Permanent, expired, timed and removed bans; badge below portrait on desktop and mobile",
    );
    await page.locator(".public-gift-button").click();
    await page.getByRole("heading", { name: "Негативные подарки", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("heading", { name: "Ослабления на час", exact: true }).count(),
      0,
    );
    report.checks.push("Gift section renamed");
    await page.evaluate(() => {
      for (const d of document.querySelectorAll("dialog[open]")) d.close();
    });
    await page.setViewportSize({ width: 1366, height: 900 });
    report.geometry = await page.evaluate(async () => {
      const shields = new KillexShields.Renderer();
      await Promise.all([...shields.images.values()].map(image => image.decode()));
      const img = new Image();
      img.src = "assets/shields/sphere-static-v2.webp";
      await img.decode();
      await new Promise((r) => setTimeout(r, 100));
      const rows = [];
      for (const radius of [32, 100, 240])
        for (const framed of [false, true]) {
          const r = framed ? KillexArenaArt.frameOuterRadius(radius, 1) : radius,
            size = Math.ceil(r * 2.5 + 20),
            c = document.createElement("canvas");
          c.width = c.height = size;
          const center = size / 2,
            ctx = c.getContext("2d", { willReadFrequently: true });
          const paint = (t) => {
            ctx.clearRect(0, 0, size, size);
            KillexShields.drawSphere(ctx, { x: center, y: center, radius }, t);
            return c.toDataURL();
          };
          const first = paint(0),
            last = paint(5000),
            pixels = ctx.getImageData(0, 0, size, size).data;
          const alpha = (x, y) => pixels[(Math.floor(y) * size + Math.floor(x)) * 4 + 3] || 0;
          const samples = [];
          for (let j = 0; j < 72; j++) {
            const t = (j * Math.PI) / 36,
              hits = [];
            for (let d = r * 0.8; d < r * 1.2; d += 0.25)
              if (alpha(center + Math.cos(t) * d, center + Math.sin(t) * d) >= 128) hits.push(d);
            samples.push({ t, inner: hits[0], outer: hits.at(-1) });
          }
          const sorted = samples.map((v) => (v.inner + v.outer) / 2 - radius).sort((a, b) => a - b),
            shiftX =
              (2 * samples.reduce((n, v) => n + ((v.inner + v.outer) / 2) * Math.cos(v.t), 0)) / 72,
            shiftY =
              (2 * samples.reduce((n, v) => n + ((v.inner + v.outer) / 2) * Math.sin(v.t), 0)) / 72;
          const crossSection = (pixels, theta) => {
            const distances = [];
            for (let d = radius * .6; d < r * 1.4; d += .5) {
              const x = Math.floor(center + Math.cos(theta) * d);
              const y = Math.floor(center + Math.sin(theta) * d);
              if (pixels[(y * size + x) * 4 + 3] >= 128) distances.push(d);
            }
            return distances;
          };
          const references = [];
          for (const id of shields.images.keys()) {
            ctx.clearRect(0, 0, size, size);
            shields.draw(ctx, { effects: [{ id, remainingMs: 5000 }] }, { x: center, y: center, radius: r });
            const reference = ctx.getImageData(0, 0, size, size).data;
            const overlap = samples.filter(v => crossSection(reference, v.t).some(d => d >= v.inner - 1 && d <= v.outer + 1));
            references.push({ id, overlap: overlap.length / samples.length });
          }
          if (framed) {
            ctx.clearRect(0, 0, size, size);
            KillexArenaArt.selectedFrame(ctx, "premium", { premium: true }, center, center, radius, 1, 0);
            const frame = ctx.getImageData(0, 0, size, size).data;
            const covered = samples.filter(v => crossSection(frame, v.t).some(d => d >= v.inner - 1 && d <= v.outer + 1));
            references.push({ id: "premium", overlap: covered.length / samples.length });
          }
          rows.push({
            radius: r,
            references,
            framed,
            same: first === last,
            minGap: sorted[0],
            medianGap: sorted[36],
            maxGap: sorted.at(-1),
            shift: Math.hypot(shiftX, shiftY),
            complete: samples.every((v) => Number.isFinite(v.inner) && Number.isFinite(v.outer)),
          });
        }
      // A large portrait makes the previously visible asymmetric gap reviewable.
      const c = document.createElement("canvas");
      c.width = 1200;
      c.height = 620;
      c.id = "sphereFitPreview";
      document.body.append(c);
      c.style.cssText = "position:fixed;inset:0;z-index:99999;background:#263c47";
      const ctx = c.getContext("2d"),
        skin = new Image();
      skin.src = "assets/skins/negative-sets-v3/1024/infection-zombie.webp";
      await skin.decode();
      for (const [i, label] of ["Без ободка", "С ободком Premium"].entries()) {
        const x = 300 + i * 600,
          y = 300,
          r = 240;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = "#476532";
        ctx.fill();
        ctx.drawImage(skin, x - r, y - r, r * 2, r * 2);
        ctx.restore();
        if (i) {
          KillexArenaArt.selectedFrame(ctx, "premium", { premium: true }, x, y, r, 1, 0);
        }
        KillexShields.drawSphere(ctx, { x, y, radius: r });
        ctx.fillStyle = "#fff";
        ctx.font = "24px Arial";
        ctx.textAlign = "center";
        ctx.fillText(label, x, 600);
      }
      return rows;
    });
    for (const row of report.geometry) {
      assert(row.complete && row.same, JSON.stringify(row));
      for (const reference of row.references) {
        assert(reference.overlap >= (reference.id === "premium" ? .97 : .70), JSON.stringify(row));
      }
      assert(Math.abs(row.medianGap) < row.radius * 0.008 + 1, JSON.stringify(row));
      assert(
        row.minGap > -row.radius * 0.022 - 1 && row.maxGap < row.radius * 0.022 + 1,
        JSON.stringify(row),
      );
      assert(row.shift < row.radius * 0.006 + 1, JSON.stringify(row));
    }
    await page
      .locator("#sphereFitPreview")
      .screenshot({ path: path.join(out, engine + "-sphere-fit.png") });
    report.checks.push(
      "Static Sphere is centred and hugs the border at six radii/frame combinations",
    );
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } finally {
    fs.writeFileSync(
      path.join(out, engine + "-sphere-profile-ui.json"),
      JSON.stringify(report, null, 2),
    );
    await browser?.close();
    await app.close();
  }
  console.log(JSON.stringify({ engine, passed: report.passed, geometry: report.geometry }));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
