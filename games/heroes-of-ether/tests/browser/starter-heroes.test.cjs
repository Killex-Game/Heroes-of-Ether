"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createGameServer } = require("../../src/server/game-server");
const benefits = require("../../src/server/accounts/account-benefits");
const pw = require("playwright");
const fixture = require("../helpers/black-friday-fixture")();
const profile = fixture.p();
profile.name = "Проверяющий";
profile.personal = { nameSet: true, introPending: false, gender: "male", vkUrl: "" };
profile.loginReward = { date: benefits.loginRewardDay(fixture.now()), day: 1 };
profile.account = { ...benefits.fresh(), vipUntil: fixture.now() + 86400000 };
const app = createGameServer({ profiles: fixture.store, events: fixture.manager, autoTick: false,
  testBots: { enabled: false }, wallNow: fixture.now });
const engine = process.argv[2] || "chromium";
const out = process.env.KILLEX_TEST_ARTIFACTS;
(async () => {
  let browser;
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await pw[engine].launch({ headless: true, ...(engine === "chromium" ? { channel: "chrome" } : {}) });
    for (const [width, height] of [[1366, 900], [844, 390], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 900 });
      await context.addCookies([{ name: "sferorumiya_session", value: fixture.user.token, url }]);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      async function openWardrobe() {
        await page.evaluate(id => {
          localStorage.setItem(KillexPlatform.storageKey(".releaseNotes.v1." + id), KillexRelease.id);
          document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
          document.getElementById("wardrobeSection").click();
        }, profile.id);
        await page.waitForSelector("#skinList + nav:not([hidden])");
      }
      await openWardrobe();
      const cards = page.locator("#skinList button");
      const vip = page.locator('.avatar-set-showcase[data-set-id="vip"] button').first();
      assert.equal(await cards.count(), 10);
      assert.equal(await cards.filter({ visible: true }).count(), 5);
      const bounds = locator => locator.evaluate(el => [el,el.querySelector("img")].map(node => {
        const r=node.getBoundingClientRect(); return [r.width,r.height];
      }));
      const a = await bounds(cards.first()), b = await bounds(vip);
      assert.ok(a.flat().every((v,i) => Math.abs(v-b.flat()[i]) < 1), JSON.stringify({width,a,b}));
      const picked = page.locator('#skinList button[data-skin-id="sky-weaver"]');
      await page.locator("#skinList + nav button").last().click();
      await picked.waitFor({ state: "visible" });
      await (width < 900 ? picked.tap() : picked.click());
      assert.equal(await picked.getAttribute("aria-pressed"), "true");
      await page.waitForFunction(() => document.getElementById("lobbySkin").dataset.skinId === "sky-weaver");
      if (out) await page.locator("#skinsDialog").screenshot({ path: path.join(out, engine + "-wardrobe-" + width + ".png") });
      await page.locator("#skinList + nav button").first().click();
      await cards.first().waitFor({ state: "visible" });
      assert.equal(await cards.filter({visible:true}).count(), 5);
      await page.reload();
      await page.waitForFunction(() => document.getElementById("lobbySkin").dataset.skinId === "sky-weaver");
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ engine,width,height,free:a,set:b }));
      await context.close();
    }
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch(e => { console.error(e); process.exitCode=1; });
