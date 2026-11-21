/* Two synthetic players, 15 bots, maximum ejected food, slow Chrome and Firefox. */
"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { chromium, firefox } = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { createGameServer } = require("../../src/server/game-server");
const { Arena, RULES } = require("../../src/server/arena/arena-simulation");
const { freshProgress } = require("../../src/server/progression/experience-progression");
const accounts = require("../../src/server/accounts/account-benefits");
const pets = require("../../src/server/pets/pet-service");
const output = path.resolve(__dirname, "../artifacts/arena-state-performance");
fs.mkdirSync(output, { recursive: true });
const profiles = new ProfileStore(),
  arena = new Arena(),
  app = createGameServer({ profiles, arena, autoTick: false, testBots: { enabled: true } });
const clients = [],
  errors = [],
  sockets = new Map();
let ticking, replenishing;
function account() {
  const auth = profiles.open(),
    p = profiles.find(auth.token);
  p.wallet = { coins: 30000, crystals: 3000, bucks: 5000 };
  p.level = 49;
  p.progress = freshProgress(49);
  p.account = accounts.fresh();
  p.account.vipUntil = p.account.premiumUntil = Date.now() + 86400000;
  pets.mutate(profiles, auth.token, { action: "buy", petId: "manya", requestId: randomUUID() });
  return auth;
}
function refill() {
  const count = arena.ether.filter((orb) => orb.ejected).length;
  for (let i = count; i < RULES.FEED_MAX_PARTICLES; i++) {
    const n = Math.random();
    arena.ether.push({
      id: randomUUID(),
      ejected: true,
      value: 2,
      artValue: 5,
      radius: 6,
      color: "#8cd968",
      x: 25 + n * 3500,
      y: 25 + Math.random() * 2300,
      vx: 0,
      vy: 0,
      updatedAt: performance.now(),
      expiresAt: performance.now() + 60000,
      sourceId: "stress",
      sourcePickupAt: 0,
    });
  }
}
app.wss.on("connection", (ws) => {
  const stat = { bytes: 0, states: 0, maxBuffered: 0, closed: [] };
  sockets.set(ws.playerId, stat);
  const send = ws.send.bind(ws);
  ws.send = (data, ...args) => {
    stat.bytes += Buffer.byteLength(data);
    stat.maxBuffered = Math.max(stat.maxBuffered, ws.bufferedAmount);
    if (String(data).startsWith('{"type":"state"')) stat.states++;
    return send(data, ...args);
  };
  ws.on("close", (code, reason) => stat.closed.push({ code, reason: reason.toString() }));
});
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    ticking = setInterval(() => app.tick(), 50);
    for (const engine of ["chrome", "firefox"]) {
      const auth = account(),
        browser = await (engine === "chrome" ? chromium : firefox).launch({
          headless: true,
          ...(engine === "chrome" ? { channel: "chrome" } : {}),
        });
      const context = await browser.newContext({ viewport: { width: 1350, height: 950 } });
      const client = { engine, browser, context };
      clients.push(client);
      await context.addCookies([{ name: "sferorumiya_session", value: auth.token, url }]);
      await context.addInitScript(() => {
        window.probe = {
          closes: [],
          states: 0,
          food: new Map(),
          maxFood: 0,
          frames: [],
          socket: null,
        };
        const Native = WebSocket;
        window.WebSocket = class extends Native {
          constructor(...args) {
            super(...args);
            probe.socket = this;
            this.addEventListener("close", (e) => probe.closes.push(e.code));
            this.addEventListener("message", (event) => {
              const m = JSON.parse(event.data);
              if (m.type === "welcome") probe.id = m.id;
              if (m.type !== "state") return;
              probe.states++;
              probe.sequence = m.stateSequence;
              if (m.ether) probe.food = new Map(m.ether.map((o) => [o.id, o]));
              for (const id of m.etherDelta?.removed || []) probe.food.delete(id);
              for (const o of m.etherDelta?.upsert || []) probe.food.set(o.id, o);
              probe.maxFood = Math.max(probe.maxFood, probe.food.size);
            });
          }
        };
      });
      const page = (client.page = await context.newPage());
      page.on("pageerror", (e) => errors.push(engine + ": " + e.message));
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.locator("#playButton").click();
      await page.waitForFunction(() => document.body.dataset.screen === "arena");
      client.id = await page.evaluate(() => probe.id);
      const player = arena.players.get(client.id);
      player.protectedUntil = performance.now() + 180000;
      if (engine === "chrome") {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", {
          rate: Number(process.env.CHROME_CPU_RATE || 4),
        });
      }
      await page.evaluate(() => {
        let previous = performance.now(),
          n = 0;
        function frame(at) {
          probe.frames.push(at - previous);
          previous = at;
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
        window.moveProbe = setInterval(() => {
          document.getElementById("game").dispatchEvent(
            new PointerEvent("pointermove", {
              bubbles: true,
              pointerType: "mouse",
              clientX: innerWidth / 2 + 180 * Math.cos(n / 20),
              clientY: innerHeight / 2 + 180 * Math.sin(n++ / 20),
            }),
          );
        }, 50);
      });
    }
    refill();
    replenishing = setInterval(refill, 1000);
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 10000));
      for (const c of clients) {
        assert.equal(await c.page.locator("#connectionLostDialog").getAttribute("open"), null);
        assert.equal(sockets.get(c.id).closed.length, 0);
      }
      console.log(
        JSON.stringify({
          seconds: (i + 1) * 10,
          food: arena.ether.length,
          bots: app.bots.status().activeBots,
          clients: clients.map((c) => ({ engine: c.engine, ...sockets.get(c.id) })),
        }),
      );
    }
    clearInterval(ticking);
    clearInterval(replenishing);
    app.broadcast();
    const expected = arena
      .snapshot(performance.now())
      .ether.map((o) => ({ ...o, x: Math.round(o.x * 10) / 10, y: Math.round(o.y * 10) / 10 }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const reports = [];
    for (const c of clients) {
      const ws = [...app.wss.clients].find((w) => w.playerId === c.id);
      for (let i = 0; i < 100 && (ws.stateStream.pending || ws.stateStream.inFlight !== null); i++)
        await new Promise((r) => setTimeout(r, 50));
      const result = await c.page.evaluate(() => ({
        closes: probe.closes,
        food: [...probe.food.values()].sort((a, b) => a.id.localeCompare(b.id)),
        maxFood: probe.maxFood,
        frames: probe.frames.length,
        meanFrameMs: probe.frames.reduce((a, b) => a + b, 0) / probe.frames.length,
      }));
      assert.deepEqual(result.closes, []);
      assert.deepEqual(
        result.food,
        expected,
        "food moves, additions and removals must converge exactly",
      );
      assert.ok(result.maxFood >= 1200);
      assert.ok(sockets.get(c.id).maxBuffered < 256 * 1024);
      await c.page.screenshot({ path: path.join(output, c.engine + ".png") });
      reports.push({
        engine: c.engine,
        cpuRate: c.engine === "chrome" ? Number(process.env.CHROME_CPU_RATE || 4) : 1,
        ...result,
        food: result.food.length,
        ...sockets.get(c.id),
      });
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify({ reports, errors }, null, 2),
    );
    console.log(JSON.stringify({ reports, errors }));
  } finally {
    clearInterval(ticking);
    clearInterval(replenishing);
    for (const c of clients) await c.browser.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
