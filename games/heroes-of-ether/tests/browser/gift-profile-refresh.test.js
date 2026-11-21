"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { once } = require("node:events");
const engines = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store"), { createGameServer } = require("../../src/server/game-server");
const { gifts } = require("../../src/server/profiles/player-social"), established = require("../helpers/browser-established-profile");
const output = path.resolve(__dirname, "../../../../artifacts/gift-profile-refresh-20261116");
fs.mkdirSync(output, { recursive: true });
const results = [];
async function until(check, label) {
  for (let i = 0; i < 160; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 25)); }
  assert.fail(label);
}
(async () => {
  for (const engine of process.env.GIFT_ENGINE ? [process.env.GIFT_ENGINE] : ["chromium", "firefox", "webkit"]) {
    const store = new ProfileStore(), sender = store.open(), recipient = store.open(), other = store.open();
    for (const [auth, name] of [[sender, "Даритель"], [recipient, "Получатель"], [other, "Другой игрок"]]) {
      const p = established.prepareProfile(store, auth); p.name = name; p.wallet = { coins: 100000, crystals: 100000, bucks: 100000 };
    }
    const app = createGameServer({ profiles: store, autoTick: false, testBots: { enabled: false } });
    let browser;
    try {
      app.httpServer.listen(0, "127.0.0.1"); await once(app.httpServer, "listening");
      const url = "http://127.0.0.1:" + app.httpServer.address().port;
      browser = await engines[engine].launch({ headless: true, ...(engine === "chromium" ? { channel: "chrome" } : {}) });
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce" });
      await established.prepareContext(context);
      await context.addCookies([{ name: "sferorumiya_session", value: sender.token, url }]);
      const page = await context.newPage(), errors = [], reads = [], writes = [];
      page.on("pageerror", e => errors.push(e.message));
      page.on("request", r => { if (r.url().includes("/api/players/")) reads.push(r.url()); if (r.url().endsWith("/api/social/action")) writes.push(r.postDataJSON()); });
      if (process.env.GIFT_BASELINE) for (const file of ["player-social.js", "public-player-dialog.js"])
        await page.route("**/ui/profile/" + file + "*", route => route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(output, "before", file)) }));
      await page.goto(url); await page.waitForFunction(() => !window.KillexBoot?.active && !document.getElementById("playButton").disabled);
      await established.clearInitialDialogs(page);
      await page.evaluate(id => window.KillexPlayerProfile.open(id), recipient.profile.id);
      await page.locator("#playerProfileDialog .public-player-shelf").waitFor();
      const decorative = gifts.find(g => !g.stat), buff = gifts.find(g => g.stat && g.percent > 0);
      assert(decorative && buff);
      const count = () => page.locator("#playerProfileDialog .public-gift").count();
      async function choose(gift, anonymous = false) {
        await page.locator("#playerProfileDialog .public-gift-button").click();
        await page.locator(".social-gift-card").filter({ has: page.getByText(gift.name, { exact: true }) }).locator("button").click();
        if (anonymous) await page.locator(".social-gift-anonymous input").check();
      }
      async function send() { await page.locator(".social-gift-confirm").getByRole("button", { name: "Подарить", exact: true }).click(); }
      async function done() {
        // This scenario also earns gift achievements. Dismiss their real notice
        // before the gift confirmation underneath; never force a covered click.
        const achievement = page.locator("#achievementNotice[open]");
        if (await achievement.count()) await achievement.getByRole("button", { name: "Отлично", exact: true }).click();
        await page.locator(".gift-sent-dialog").getByRole("button", { name: "Отлично", exact: true }).click();
      }
      for (const [index, gift, anonymous] of [[1, decorative, false], [2, decorative, true], [3, buff, false]]) {
        const before = reads.length, balance = store.find(sender.token).wallet[gift.currency];
        await choose(gift, anonymous); await send(); await page.locator(".gift-sent-dialog").waitFor();
        await until(async () => await count() === index, "The gift must appear in the still-open recipient profile");
        assert.equal(reads.length, before + 1, "Exactly one recipient refresh, no polling");
        assert.equal(store.find(sender.token).wallet[gift.currency], balance - gift.price);
        assert.equal(await page.locator("#playerProfileDialog").evaluate(n => n.open), true);
        await done();
      }
      assert.match(await page.locator(".public-gift-effects").innerText(), new RegExp(buff.name));
      assert((await page.locator(".public-gift").evaluateAll(nodes => nodes.map(n => n.getAttribute("aria-label")))).some(s => s.includes("Анонимно")));
      await page.screenshot({ path: path.join(output, engine + "-updated.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      await choose(decorative); await send(); await page.locator(".gift-sent-dialog").waitFor();
      await until(async () => await count() === 4, "Mobile recipient refresh"); await done();
      await page.screenshot({ path: path.join(output, engine + "-mobile.png") });

      // A rejected send must not fetch or invent a gift in the recipient UI.
      await choose(decorative); const beforeFailure = reads.length;
      const senderRecord = store.find(sender.token), savedBalance = senderRecord.wallet[decorative.currency]; senderRecord.wallet[decorative.currency] = 0;
      await send(); await until(async () => (await page.locator(".social-dialog .social-status").innerText()).includes("Недостаточно"), "Rejected gift");
      assert.equal(reads.length, beforeFailure); assert.equal(await count(), 4);
      store.find(sender.token).wallet[decorative.currency] = savedBalance;
      await page.locator(".social-dialog .personal-close").click();

      // A failed follow-up read does not turn a committed send into a retry.
      const targetPattern = "**/api/players/" + recipient.profile.id;
      await page.route(targetPattern, route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"read unavailable"}' }));
      await choose(decorative); const beforeWrites = writes.length; await send(); await page.locator(".gift-sent-dialog").waitFor();
      assert.equal(writes.length, beforeWrites + 1); await done();
      await page.unroute(targetPattern);
      await page.evaluate(id => window.KillexPlayerProfile.refresh(id), recipient.profile.id);
      await until(async () => await count() === 5, "Read recovery without repeating the send"); assert.equal(writes.length, beforeWrites + 1);

      // Late responses cannot replace a different profile or reopen a closed one.
      for (const mode of ["switch", "close"]) {
        let release, arrived = false; const wait = new Promise(resolve => { release = resolve; });
        await page.route(targetPattern, async route => { const response = await route.fetch(); arrived = true; await wait; await route.fulfill({ response }).catch(() => {}); });
        await choose(decorative); await send(); await page.locator(".gift-sent-dialog").waitFor(); await until(() => arrived, "Delayed refresh request"); await done();
        if (mode === "switch") {
          await page.evaluate(id => window.KillexPlayerProfile.open(id), other.profile.id);
          await until(async () => (await page.locator(".public-player-name").innerText()) === "Другой игрок", "Open different player");
        } else await page.evaluate(() => document.getElementById("playerProfileDialog").close());
        release(); await page.waitForTimeout(120); await page.unroute(targetPattern);
        if (mode === "switch") { assert.equal(await page.locator(".public-player-name").innerText(), "Другой игрок"); assert.equal(await count(), 0); }
        else assert.equal(await page.locator("#playerProfileDialog").evaluate(n => n.open), false);
        await page.evaluate(id => window.KillexPlayerProfile.open(id), recipient.profile.id);
        await page.locator("#playerProfileDialog .public-player-shelf").waitFor();
      }
      assert.equal(await count(), 7); assert.deepEqual(errors, []);
      results.push({ engine, named: true, anonymous: true, effects: true, mobile: true, rejectedSend: true, failedRead: true, lateSwitch: true, lateClose: true, errors });
      console.log(JSON.stringify(results.at(-1)));
    } finally { await browser?.close(); await app.close(); }
  }
  fs.writeFileSync(path.join(output, "browser-results.json"), JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
