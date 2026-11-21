"use strict";
// Real browser, server and TCP streams. Delay only one peer's traffic; no mocked WebSocket.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const net = require("node:net"), { once } = require("node:events");
const pw = require("playwright"), WS = require("ws");
const { createGameServer } = require("../../src/server/game-server");
const { Arena } = require("../../src/server/arena/arena-simulation");
const wire = require("../../public/shared/arena-wire");
const fixture = require("../helpers/black-friday-fixture")();
fixture.command("stop", { runId: fixture.run.id });
const p = fixture.p();
p.name = "Арден";
p.personal = { nameSet: true, introPending: false, gender: "male", vkUrl: "" };
p.loginReward = { date: require("../../src/server/accounts/account-benefits").loginRewardDay(fixture.now()), day: 1 };
const engine = process.argv[2] || "chromium", baseline = process.env.KILLEX_NETWORK_BASELINE === "1";
const baselineCase = process.env.KILLEX_NETWORK_CASE || "burst";
const out = process.env.KILLEX_TEST_ARTIFACTS || path.join(__dirname, "../artifacts/mobile-connection");
fs.mkdirSync(out, { recursive: true });
const report = { engine, baseline, errors: [], checks: [], bursts: [] };
const app = createGameServer({ profiles: fixture.store, events: fixture.manager,
  arena: new Arena({ etherCount: 0 }), autoTick: false, testBots: { enabled: false }, wallNow: fixture.now });
const peers = new Set(), extra = [];
let browser, heartbeat, broadcasting = true, activePeer;
const proxy = net.createServer(client => {
  const upstream = net.connect(app.httpServer.address().port, "127.0.0.1");
  const peer = { client, upstream, hold: null, chunks: [], bytes: 0, websocket: false };
  peers.add(peer);
  client.on("data", bytes => {
    if (bytes.toString("ascii", 0, Math.min(bytes.length, 1500)).toLowerCase().includes("upgrade: websocket")) {
      peer.websocket = true; activePeer = peer;
    }
    if (peer.hold === "up") { peer.chunks.push(bytes); peer.bytes += bytes.length; }
    else upstream.write(bytes);
  });
  upstream.on("data", bytes => {
    if (peer.hold === "down") { peer.chunks.push(bytes); peer.bytes += bytes.length; }
    else client.write(bytes);
  });
  for (const [from, to] of [[client, upstream], [upstream, client]]) {
    from.on("error", () => to.destroy()); from.on("close", () => { to.destroy(); peers.delete(peer); });
  }
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return; await sleep(25); }
  throw Error("Timeout: " + label);
}
async function counters(page) { return page.evaluate(() => JSON.parse(JSON.stringify(window.networkTest))); }
async function delayTraffic(page, direction, duration, whileDelayed) {
  const peer = activePeer, before = await counters(page);
  peer.bytes = 0; peer.hold = direction;
  if (whileDelayed) { await page.waitForTimeout(1200); await whileDelayed(); }
  await page.waitForTimeout(duration - (whileDelayed ? 1200 : 0));
  const during = await counters(page);
  const count = during.sent.length - before.sent.length;
  const bytes = peer.bytes;
  peer.hold = null;
  const dest = direction === "up" ? peer.upstream : peer.client;
  if (peer.chunks.length) dest.write(Buffer.concat(peer.chunks));
  peer.chunks = [];
  await page.waitForTimeout(600);
  const after = await counters(page);
  report.bursts.push({ direction, duration, count, bytes, statesBefore: before.states,
    statesAfter: after.states, closes: after.closes, dialog: await page.locator("#connectionLostDialog").isVisible() });
  if (!baseline) {
    assert.equal(after.closes.length, 0, "Network delay must preserve original socket and life");
    assert(after.states > during.states, "Snapshots resume after delayed traffic");
    assert.equal(await page.locator("#connectionLostDialog").isVisible(), false);
    assert.equal(app.wss.clients.size, 3);
    if (duration >= 2000) assert(count < 45, "Do not queue stale control commands during a network stall");
  }
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1"); await once(app.httpServer, "listening");
    proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
    heartbeat = setInterval(() => { if (broadcasting) app.broadcast(); }, 50);
    // Two unaffected players prove that a peer network stall is independent of room load.
    for (let i = 0; i < 2; i++) {
      const auth = fixture.store.open();
      const ws = new WS("ws://127.0.0.1:" + app.httpServer.address().port, wire.PROTOCOL,
        { headers: { Cookie: "sferorumiya_session=" + auth.token } });
      ws.states = 0;
      ws.on("message", raw => { const m = JSON.parse(raw); if (m.type === "state") {
        ws.states++; ws.send(JSON.stringify({ type: "stateAck", sequence: m.stateSequence }));
      } });
      extra.push(ws); await once(ws, "open");
    }
    browser = await pw[engine].launch({ headless: true,
      ...(engine === "chromium" ? { channel: "chrome" } : {}),
      ...(process.env.KILLEX_BROWSER_EXECUTABLE ? { executablePath: process.env.KILLEX_BROWSER_EXECUTABLE } : {}) });
    const url = "http://127.0.0.1:" + proxy.address().port;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await context.addCookies([{ name: "sferorumiya_session", value: fixture.user.token, url }]);
    await context.addInitScript(() => {
      const Native = WebSocket;
      window.networkTest = { states: 0, sent: [], closes: [] };
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args); window.networkTest.socket = this;
          this.addEventListener("message", e => { const m = JSON.parse(e.data);
            if (m.type === "state") window.networkTest.states++;
          });
          this.addEventListener("close", e => window.networkTest.closes.push({ code: e.code, reason: e.reason }));
        }
        get bufferedAmount() { return window.networkTest.blockSend ? 65537 : super.bufferedAmount; }
        send(raw) { const m = JSON.parse(raw); window.networkTest.sent.push({ type: m.type, at: performance.now(), x: m.x, y: m.y }); return super.send(raw); }
      };
    });
    const page = await context.newPage();
    if (process.env.KILLEX_BASELINE_CLIENT)
      await page.route("**/game-client.js?*", route => route.fulfill({ path: process.env.KILLEX_BASELINE_CLIENT, contentType: "text/javascript" }));
    page.on("pageerror", e => report.errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled && !window.KillexBoot.active);
    await page.locator("#releaseNotesDialog").waitFor({ state: "visible" });
    await page.locator("#releaseNotesDialog").getByRole("button", { name: "Понятно", exact: true }).click();
    await page.waitForFunction(() => Object.keys(localStorage).some(k => k.includes("releaseNotes") && localStorage.getItem(k) === window.KillexRelease.id));
    assert.equal(await page.locator("#releaseNotesDialog").isVisible(), false, "One click dismisses and acknowledges the release notice");
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    await until(() => app.wss.clients.size === 3, "three players");
    await page.waitForTimeout(700);
    // Hold and move the actual mobile joystick; the input timer and real socket remain intact.
    await page.locator("#joystick").evaluate(el => {
      const b = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 10, pointerType: "touch", clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 }));
      el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 10, pointerType: "touch", clientX: b.x + b.width - 5, clientY: b.y + b.height / 2 }));
    });
    await page.waitForTimeout(400);
    if (baseline && baselineCase !== "burst") {
      if (baselineCase === "ack") {
        await page.evaluate(() => { window.networkTest.blockSend = true; });
        await page.waitForTimeout(1000);
        const blocked = await counters(page);
        await page.evaluate(() => { window.networkTest.blockSend = false; });
        await page.waitForTimeout(1200);
        const after = await counters(page);
        assert.equal(after.states, blocked.states, "Baseline drops ACK and never resumes snapshots");
        report.checks.push({ case: "Full send buffer loses ACK", blockedStates: blocked.states, afterDrainStates: after.states });
      } else if (baselineCase === "offline") {
        await page.evaluate(() => dispatchEvent(new Event("offline")));
        await page.locator("#connectionLostDialog").waitFor({ state: "visible" });
        report.checks.push("Baseline closes a working socket on OS offline notification");
      } else throw Error("Unknown baseline case");
      return;
    }
    const othersBefore = extra.map(ws => ws.states);
    await delayTraffic(page, "up", 4500);
    assert(extra.every((ws, i) => ws.readyState === WS.OPEN && ws.states > othersBefore[i] + 50));
    report.checks.push("Other two players continue receiving states during peer network delay");
    if (baseline) {
      assert(report.bursts[0].closes.some(e => e.code === 1006), "Reproduce server termination after legitimate input burst");
      return;
    }
    await delayTraffic(page, "down", 4500);
    await delayTraffic(page, "up", 2000);
    await delayTraffic(page, "up", 500);
    report.checks.push("Three-player arena survives uplink/downlink pauses; no stale input flood");
    const player = [...app.arena.players.values()].find(player => player.profileId === p.id);
    assert.equal(player.stopped, false, "Joystick actually moves the authoritative player");
    const lifeId = player.lifeId;
    await delayTraffic(page, "up", 3000, () => page.locator("#joystick").evaluate(el => {
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 10, pointerType: "touch" }));
    }));
    await until(() => player.stopped, "Released joystick stops after recovery");
    assert.equal(player.lifeId, lifeId);
    report.checks.push("Releasing joystick during a stall stops the same life after recovery");
    // Fill the browser send buffer long enough to exhaust all four in-flight states.
    // An ACK dropped here leaves the server permanently waiting without a retry.
    await page.evaluate(() => { window.networkTest.blockSend = true; });
    await page.waitForTimeout(1000);
    const blocked = await counters(page);
    await page.evaluate(() => { window.networkTest.blockSend = false; });
    await until(async () => (await counters(page)).states > blocked.states + 4, "ACK retries after send buffer drains");
    assert.equal(await page.locator("#connectionLostDialog").isVisible(), false);
    report.checks.push("Cumulative ACK retries recover from a full browser send buffer");
    const beforeOffline = await counters(page);
    await page.evaluate(() => dispatchEvent(new Event("offline")));
    await page.waitForTimeout(600);
    assert.equal(await page.locator("#connectionLostDialog").isVisible(), false);
    assert((await counters(page)).states > beforeOffline.states);
    await page.evaluate(() => dispatchEvent(new Event("online")));
    report.checks.push("OS offline notification alone does not close a working arena socket");
    // A real peer disconnect must still end input and show the loss dialog.
    activePeer.upstream.destroy();
    await page.locator("#connectionLostDialog").waitFor({ state: "visible" });
    const sentAfterClose = (await counters(page)).sent.length;
    await page.waitForTimeout(350);
    assert.equal((await counters(page)).sent.length, sentAfterClose);
    report.checks.push("Real connection loss still freezes input and shows connection lost");
    await page.locator("#connectionLostLobby").click();
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible" });
    await until(() => app.wss.clients.size === 3, "New arena life");
    await page.waitForTimeout(200);
    broadcasting = false;
    await page.locator("#connectionLostDialog").waitFor({ state: "visible", timeout: 13000 });
    assert.match(await page.locator("#connectionLostMessage").textContent(), /перестал обновлять/);
    report.checks.push("Ten-second state watchdog still detects a silent server after manual re-entry");
    assert.deepEqual(report.errors, []);
  } catch (error) { report.failure = error.stack; process.exitCode = 1; }
  finally {
    clearInterval(heartbeat);
    await browser?.close();
    for (const ws of extra) ws.terminate();
    for (const peer of peers) { peer.client.destroy(); peer.upstream.destroy(); }
    proxy.close(); await app.close();
    fs.writeFileSync(path.join(out, engine + (baseline ? "-baseline-" + baselineCase : "-verified") + ".json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
