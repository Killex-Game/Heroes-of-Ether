/* Браузерный сценарий: leaderboards and profile. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { chromium } = require("playwright"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { xpForLevel } = require("../../src/server/progression/experience-progression");
const directory = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(directory, ".tmp-tops-")),
  artifacts = path.join(directory, "artifacts");
process.env.TEMP = scratch;
process.env.TMP = scratch;
fs.mkdirSync(artifacts, { recursive: true });
const profiles = new ProfileStore(),
  clans = new ClanService(profiles);
const app = createGameServer({
  profiles,
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  rateNow: () => performance.now(),
});
let browser;
const errors = [];
const eligible = (p) => {
  p.level = 12;
  p.progress.xp = xpForLevel(12);
  p.wallet.coins = 4000;
  p.wallet.bucks = 500;
};
const mutate = (auth, action, fields) =>
  clans.mutate(auth.token, { action, ...fields, requestId: randomUUID() });
async function until(check, label) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Timeout: " + label);
}
(async () => {
  try {
    const head = profiles.open(),
      other = profiles.open();
    for (const auth of [head, other]) eligible(profiles.find(auth.token));
    mutate(head, "create", {
      name: "Лунный союз",
      prefix: "ЛУНА",
      emblem: "astral",
      privacy: "closed",
    });
    mutate(other, "create", {
      name: "Лесные хранители",
      prefix: "ЛЕС",
      emblem: "grove",
      privacy: "open",
    });
    const closedId = profiles.find(head.token).clanId,
      openId = profiles.find(other.token).clanId;
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    const id = (await (await page.request.get(url + "/api/profile")).json()).profile.id,
      p = () => profiles.byId(id);
    eligible(p());
    p().revision++;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);

    await page.locator("#editProfile").click();
    assert.equal(await page.locator("#profileGender select").count(), 0);
    for (const gender of ["male", "female"]) {
      await page.locator('[data-gender="' + gender + '"]').click();
      assert.equal(await page.locator('#profileGender [aria-pressed="true"]').count(), 1);
      await page
        .locator("#personalDialog")
        .getByRole("button", { name: "Сохранить", exact: true })
        .click();
      await until(() => p().personal?.gender === gender, "gender saved");
      await until(
        () =>
          page
            .locator("#personalDialog .personal-status")
            .textContent()
            .then((t) => t === "Личные данные сохранены."),
        "gender status",
      );
    }
    await page.screenshot({ path: path.join(artifacts, "personal-gender-icons.png") });
    await page.keyboard.press("Escape");
    await page.locator("#editProfile").click();
    assert.equal(await page.locator('[data-gender="female"]').getAttribute("aria-pressed"), "true");
    await page.keyboard.press("Escape");

    await page.locator("#clanSection").click();
    await page.locator("#topsDialog").waitFor({ state: "visible" });
    assert.equal(
      await page
        .getByRole("button", { name: "Топ кланов", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await page.locator("#clanDialog").isVisible(), false);
    const closed = page.locator('[data-clan-id="' + closedId + '"]'),
      open = page.locator('[data-clan-id="' + openId + '"]');
    await closed.getByRole("button", { name: "Подать заявку · 50 монет", exact: true }).click();
    await until(() => profiles.data.clans[closedId].applications.includes(id), "apply");
    await closed.getByRole("button", { name: "Отозвать заявку", exact: true }).click();
    await until(() => !profiles.data.clans[closedId].applications.includes(id), "cancel");
    assert.equal(p().wallet.coins, 4000);
    assert.equal(
      (await (await page.request.get(url + "/api/clans?selected=" + closedId)).json()).selected,
      null,
    );
    for (const label of ["Казна", "Уровень", "Величие"]) {
      await page
        .locator("#topsDialog .tops-sort")
        .getByRole("button", { name: label, exact: true })
        .click();
      await until(
        () =>
          page
            .locator("#topsDialog .tops-sort")
            .getByRole("button", { name: label, exact: true })
            .getAttribute("aria-pressed")
            .then((value) => value === "true"),
        "clan sort",
      );
    }
    await closed.locator(".clan-rank-name").click();
    assert.equal(await page.locator(".clan-details").count(), 0);
    await page.screenshot({ path: path.join(artifacts, "tops-clans-applications.png") });
    await open.getByRole("button", { name: "Вступить · 50 монет", exact: true }).click();
    await until(() => p().clanId === openId, "open clan entry");
    assert.equal(p().wallet.coins, 3950);
    await page.keyboard.press("Escape");
    await page.locator("#clanSection").click();
    await page.locator("#clanDialog").waitFor({ state: "visible" });
    assert.equal(
      await page
        .locator("#clanDialog")
        .getByRole("button", { name: "Топ кланов", exact: true })
        .count(),
      0,
    );
    assert.equal(await page.locator(".clan-deposit input").count(), 0);
    for (const amount of [1, 5, 10, 50, 100]) {
      const wallet = p().wallet.bucks,
        treasury = profiles.data.clans[openId].treasury;
      await page.locator('[data-deposit="' + amount + '"]').click();
      await until(() => p().wallet.bucks === wallet - amount, "deposit " + amount);
      await until(
        () => page.locator('[data-deposit="' + amount + '"]').isEnabled(),
        "deposit finished",
      );
      assert.equal(profiles.data.clans[openId].treasury, treasury + amount);
      assert.equal(await page.locator("#clanDialog .clan-confirm").isVisible(), false);
    }
    await page.locator(".clan-deposit").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, "clan-quick-deposits.png") });
    // Server balance changes while the open window still shows the old value.
    p().wallet.bucks = 0;
    p().revision++;
    const treasury = profiles.data.clans[openId].treasury;
    await page.locator('[data-deposit="100"]').click();
    const toast = page.locator(".clan-deposit-toast");
    await toast.waitFor({ state: "visible" });
    assert.equal(await toast.textContent(), "Недостаточно эфира");
    const box = await toast.boundingBox();
    assert.ok(Math.abs(box.x + box.width / 2 - 683) < 1);
    assert.ok(Math.abs(box.y + box.height / 2 - 384) < 10);
    assert.equal(await page.locator("dialog[open]").count(), 1);
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(artifacts, "clan-insufficient-bucks.png") });
    await toast.waitFor({ state: "hidden", timeout: 4000 });
    assert.equal(profiles.data.clans[openId].treasury, treasury);
    assert.equal(p().wallet.bucks, 0);
    await page.keyboard.press("Escape");
    await page.locator("#rankingsButton").click();
    await page.locator("#topsDialog").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Киллы за день", exact: true }).click();
    await page.screenshot({ path: path.join(artifacts, "tops-players.png") });
    await page.keyboard.press("Escape");

    await page.locator("#accountButton").click();
    for (const tier of ["vip", "premium"]) {
      await page.locator(".account-plan." + tier + " button").click();
      await page
        .locator("#mockPaymentDialog")
        .getByRole("button", { name: "Подтвердить", exact: true })
        .click();
      await page
        .locator("#mockPaymentDialog")
        .getByRole("button", { name: "Готово", exact: true })
        .click();
      await page.locator("#accountMarks .profile-account." + tier).waitFor();
    }
    await page.keyboard.press("Escape");
    // Measure actual rendered image geometry and opacity at every angle just inside the frame.
    const skins = await page.evaluate(() => KillexIdentity.allSkins.map((s) => s.id));
    for (const skin of skins) {
      await page.evaluate(
        (id) => document.dispatchEvent(new CustomEvent("killex:choose-skin", { detail: id })),
        skin,
      );
      const result = await page.locator("#lobbySkin").evaluate(async (img) => {
        await img.decode();
        const disc = img.parentElement,
          r = disc.getBoundingClientRect(),
          b = img.getBoundingClientRect();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 400;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(
          img,
          ((b.x - r.x) / r.width) * 400,
          ((b.y - r.y) / r.height) * 400,
          (b.width / r.width) * 400,
          (b.height / r.height) * 400,
        );
        const pixels = ctx.getImageData(0, 0, 400, 400).data;
        const alpha = Array.from({ length: 72 }, (_, i) => {
          const a = (i * Math.PI) / 36;
          return pixels[
            (Math.round(200 + 198 * Math.sin(a)) * 400 + Math.round(200 + 198 * Math.cos(a))) * 4 +
              3
          ];
        });
        return {
          clip: getComputedStyle(disc).overflow,
          scale: b.width / r.width,
          alpha: Math.min(...alpha),
        };
      });
      assert.equal(result.clip, "hidden", skin);
      assert.ok(result.scale > 1.12, skin);
      assert.ok(result.alpha >= 240, skin + " has transparent gap: " + JSON.stringify(result));
    }
    await page.evaluate(() =>
      document.dispatchEvent(new CustomEvent("killex:choose-skin", { detail: "vip-4" })),
    );
    const before = await page.locator(".skin-stage").evaluate((node) =>
      [...node.querySelectorAll(":scope > button")].map((b) => {
        const r = b.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      }),
    );
    await page.locator("#wardrobeSection").click();
    await page.getByRole("button", { name: "Шапки", exact: true }).click();
    await page.getByRole("button", { name: "Надеть Шапка новичка", exact: true }).click();
    await page.getByRole("button", { name: "Снять Шапка новичка", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    const after = await page.locator(".skin-stage").evaluate((node) =>
      [...node.querySelectorAll(":scope > button")].map((b) => {
        const r = b.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      }),
    );
    assert.deepEqual(after, before);
    await page.screenshot({ path: path.join(artifacts, "avatar-filled-to-frame.png") });
    assert.deepEqual(errors, []);
    console.log(
      "Gender buttons, separate rankings, applications, all five immediate deposits, server insufficient-funds toast and all 14 avatar boundaries passed.",
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== directory ||
      !path.basename(scratch).startsWith(".tmp-tops-")
    )
      throw Error("Unsafe cleanup");
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
