/* Real browser input loop, synthetic accounts only; never loads saved players. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { once } = require("node:events");
const { chromium } = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { createGameServer } = require("../../src/server/game-server");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { freshProgress } = require("../../src/server/progression/experience-progression");
const accounts = require("../../src/server/accounts/account-benefits");
const out = path.resolve(process.env.INPUT_EVIDENCE || "tests/artifacts/browser-input-load");
fs.mkdirSync(out, { recursive: true });
const {monitorEventLoopDelay}=require("node:perf_hooks"); const lag=monitorEventLoopDelay({resolution:10});lag.enable();
const massItems = ["meat", "candy", "donut", "ice_cream"];
const heldMass = process.env.INPUT_MASS === "1";
const frameStyle = process.env.INPUT_FRAME;
const deviceScaleFactor = Number(process.env.INPUT_DPR || 1);
if ((frameStyle && !["vip", "premium"].includes(frameStyle)) ||
    ![1, 2].includes(deviceScaleFactor)) throw Error("Invalid frame/DPR benchmark option");
const group = process.env.INPUT_CATALOG_GROUP;
let catalogSlots;
if (group !== undefined) {
  const ids = [...require("../../src/server/boosters/booster-catalog").BOOSTERS.values()].filter(b => b.ready).map(b => b.id);
  if (!/^\d+$/.test(group) || Number(group) * 6 >= ids.length || heldMass)
    throw Error("Invalid six-slot browser catalog group");
  catalogSlots = ids.slice(Number(group) * 6, Number(group) * 6 + 6);
}
const profiles = heldMass ? new ProfileStore({ filePath: path.join(out, "synthetic-profiles.json"), journal:true }) : new ProfileStore(),
  arena = new Arena();
const auth = profiles.open(),
  p = profiles.find(auth.token);
// This fixture measures arena input after the player has visited the lobby.
p.personal = {nameSet:true,gender:"male",vkUrl:"",introPending:false,firstNameSetAt:Date.now()};
p.loginReward = { date: accounts.loginRewardDay(Date.now()), day: 1 };
p.level = 600;
p.progress = freshProgress(600);
p.account = accounts.fresh();
p.account.vipUntil = p.account.premiumUntil = Date.now() + 86400000;
if (frameStyle) {
  p.appearance ||= { ...require("../../public/shared/league-appearance").selection(), grants: {}, grantVersion: 2 };
  p.appearance.arenaFrame = frameStyle;
}
p.quickSlots = ["meat", "harpoon", "clan_shield", "axe", "easter_egg", "knuckles"];
if (heldMass) p.quickSlots = [...massItems];
if (catalogSlots) p.quickSlots = [...catalogSlots];
if (heldMass && process.env.INPUT_HISTORY === "1") {
  const roulette = require("../../src/server/roulette/roulette-service");
  const { randomUUID, randomInt } = require("node:crypto");
  p.roulette = roulette.fresh(600);
  for (let n=0;n<800;n++) {
    const id = randomUUID();
    p.roulette.results[id] = {requestId:id, at:Date.now(), offer:roulette.makeOffer(Date.now(), randomInt), index:0};
  }
  p.roulette.spent = p.roulette.earned = 800;
  for (let n=0;n<9500;n++) p.receipts[randomUUID()] = JSON.stringify(["use","meat",1,"synthetic-life"]);
  roulette.validate(p);
  console.log("Synthetic profile KiB:", Math.round(Buffer.byteLength(JSON.stringify(p))/1024));
}
for (const id of p.quickSlots) p.inventory[id] = 1000;
if (p.quickSlots.includes("easter_egg")) {
  p.easter ||= { runs: {}, chests: [], batches: [], trophies: [] };
  p.easter.batches.push({ count: 1000, expiresAt: require("../../src/server/events/easter-hunt").expiresAt(Date.now()) });
}
const app = createGameServer({ profiles, arena,
  maxPlayers:35, stateWorkerCount: Number(process.env.LOAD_STATE_WORKERS || 0),
  testBots: { enabled: true, maxActive: 30, boostersEnabled: true } });
let botUses; let stepTimes=[];const rawStep=arena.step;arena.step=function(...a){const t=performance.now();try{return rawStep.apply(this,a);}finally{stepTimes.push(performance.now()-t)}};
const prepareBooster = arena.prepareBooster;
arena.prepareBooster = function (id, message, ...args) {
  const apply = prepareBooster.call(this, id, message, ...args);
  if (!this.players.get(id)?.isTestBot) return apply;
  return () => {
    const result = apply();
    if (botUses) botUses[message.boosterId] = (botUses[message.boosterId] || 0) + 1;
    return result;
  };
};
let browser;
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1912, height: 940 }, deviceScaleFactor });
    await context.addCookies([{ name: "sferorumiya_session", value: auth.token, url }]);
    await context.addInitScript(() => {
      window.probe = {
        errors: [],
        frames: [],
        gaps: [],
        long: [],
        sent: {},
        uses: [], pendingUses: {}, confirmed: {}, denied: {},
        positions: [],
        last: 0,
      };
      const Native = WebSocket;
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          this.addEventListener("open", () => { probe.protocol = this.protocol; });
          this.addEventListener("message", (e) => {
            const m = JSON.parse(e.data),
              now = performance.now();
            if (m.type === "welcome") probe.id = m.id;
            if (m.type === "boosterResult" && probe.pendingUses[m.requestId] !== undefined) {
              const request = probe.pendingUses[m.requestId];
              if (m.ok) {
                probe.uses.push(now - request.at);
                probe.confirmed[request.id] = (probe.confirmed[request.id] || 0) + 1;
              }
              else probe.denied[m.message] = (probe.denied[m.message] || 0) + 1;
              delete probe.pendingUses[m.requestId];
            }
            if (m.type === "state") {
              if (probe.last) probe.gaps.push(now - probe.last);
              probe.last = now;
              probe.positions.push(m.playersDelta?.upsert?.find((p) => p.id === probe.id)?.x);
            }
          });
        }
        send(data) {
          const m = JSON.parse(data);
          if (m.type === "useBooster") probe.pendingUses[m.requestId] = { id: m.boosterId, at: performance.now() };
          probe.sent[m.type] = (probe.sent[m.type] || 0) + 1;
          return super.send(data);
        }
      };
      new PerformanceObserver((list) =>
        probe.long.push(...list.getEntries().map((x) => x.duration)),
      ).observe({ type: "longtask", buffered: true });
      let last;
      const frame = (at) => {
        if (last) probe.frames.push(at - last);
        last = at;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const page = await context.newPage();
    const browserErrors = [];
    page.on("pageerror", (e) => { browserErrors.push(e.message); console.error(e.message); });
    if (process.env.INPUT_OLD_HUD) await page.route("**/ui/boosters/shop-and-inventory-dialog.js?*", route => route.fulfill({contentType:"application/javascript",body:fs.readFileSync(process.env.INPUT_OLD_HUD,"utf8")}));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById("playButton").disabled);
    // New synthetic accounts see release notes and offers before their first
    // arena. Dismiss through the UI, like a player, before measuring input.
    for (let attempt = 0; attempt < 8; attempt++) {
      await page.waitForTimeout(150);
      const modal = page.locator('dialog[open]').last();
      if (!(await modal.count())) break;
      const close = modal.locator('.booster-close, [aria-label^="Закрыть"]').first();
      if (!(await close.count())) throw Error('Unexpected blocking lobby dialog in benchmark');
      await close.click();
    }
    await page.locator("#playButton").click();
    await page.waitForFunction(() => document.body.dataset.screen === "arena");
    const id = await page.evaluate(() => probe.id),
      player = arena.players.get(id);
    if (frameStyle && player.appearance?.arenaFrame !== frameStyle)
      throw Error("Animated frame was not equipped in the arena fixture");
    Object.assign(player, {
      mass: heldMass ? 1500 : 20000,
      radius: radiusForMass(heldMass ? 1500 : 20000),
      protectedUntil: 0,
      nextMassDecayAt: Infinity,
    });
    player.lifeStartedAt -= 24 * 60000;
    player.parts=Array.from({length:16},(_,i)=>({id:"long-"+i,mass: 50000/16,radius:radiusForMass(50000/16),x:2600+(i%4)*110,y:1600+Math.floor(i/4)*110,vx:0,vy:0,mergeAt:Infinity}));
    arena.syncParts(player);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
    await page.mouse.move(1400, 420);
    const rows = [];
    const phases = ["large-cold", "large-warm", "shield", "egg", "after-egg", "combined"];
    for (const phase of phases) {
      botUses = {};stepTimes=[];lag.reset();
      await page.evaluate(() => {
        probe.frames = [];
        probe.gaps = [];
        probe.long = [];
        probe.sent = {};
        probe.uses = [];
        probe.confirmed = {};
        probe.denied = {};
        probe.positions = [];
      });
      if(phase==="shield") await page.keyboard.press("d");
      if(phase==="egg") await page.keyboard.press("g");
      const until = Date.now() + Number(process.env.INPUT_PHASE_MS || 60000);
      let n = 0;
      const heldKey = heldMass && ["a","s","d","f"][massItems.indexOf(phase)];
      if (catalogSlots) {
        if (phase === "sponge") {
          await page.keyboard.press("Space");
          await page.waitForTimeout(200);
        }
        await page.keyboard.press(["a","s","d","f","g","h"][catalogSlots.indexOf(phase)]);
      }
      if (heldKey) {
        // Give each tested food its own headroom without disturbing opponents
        // or removing any parts the previous phase produced.
        for (const part of arena.bodies(player)) {
          part.mass = 1500;
          part.radius = radiusForMass(part.mass);
        }
        arena.syncParts(player);
        await page.waitForTimeout(180);
        await page.keyboard.down(heldKey);
      }
      while (Date.now() < until) {
        n++;
        await page.mouse.move(1000 + Math.cos(n / 10) * 400, 470 + Math.sin(n / 10) * 250);
        if (["click", "combined"].includes(phase)) await page.mouse.click(1300, 430);
        if (["split", "combined"].includes(phase)) await page.keyboard.press("Space");
        if (["feed", "combined"].includes(phase)) await page.keyboard.press("w");
        if (["boosters", "combined"].includes(phase)) await page.keyboard.press(["a", "s", "d", "f", "g", "h"][n % 6]);
        await page.waitForTimeout(60);
      }
      if (heldKey) await page.keyboard.up(heldKey);
      const serverStep = [...stepTimes].sort((a,b)=>a-b); const server={steps:serverStep.length,p95:serverStep[Math.floor(serverStep.length*.95)]||0,max:serverStep.at(-1)||0,eventLoopP99:lag.percentile(99)/1e6,memory:process.memoryUsage()};
      const result = await page.evaluate(() => {
        const q = (a) => {
          a.sort((x, y) => x - y);
          return { n: a.length, p95: a[Math.floor(a.length * 0.95)] || 0, max: a.at(-1) || 0 };
        };
        return {
          frames: q(probe.frames),
          states: q(probe.gaps),
          long: q(probe.long),
          uses: q(probe.uses),
          confirmed: probe.confirmed,
          denied: probe.denied,
          sent: probe.sent,
        };
      });
      if(player.dead) throw Error("Fixture player died; later phases would be invalid");
      const bots = [...arena.players.values()].filter(p => p.isTestBot && !p.dead).length;
      rows.push({ phase, server, mass:player.mass, alive: !player.dead, bots, botUses, parts: arena.bodies(player).length, shots: arena.combat.shots.length, ...result });
      console.log(JSON.stringify(rows.at(-1)));
    }
    const { profile } = await cdp.send("Profiler.stop");
    fs.writeFileSync(path.join(out, "browser.cpuprofile"), JSON.stringify(profile));
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(rows, null, 2));
    await page.screenshot({ path: path.join(out, "arena.png") });
    const runtime = { protocol: await page.evaluate(() => probe.protocol),
      browserErrors, stateWorkers: { ...app.stateWorkers.stats } };
    fs.writeFileSync(path.join(out, "runtime.json"), JSON.stringify(runtime, null, 2));
    if (browserErrors.length) throw Error("Browser errors: " + browserErrors.join("; "));
    if (Number(process.env.LOAD_STATE_WORKERS) > 0 &&
        (!runtime.stateWorkers.jobs || runtime.stateWorkers.failures))
      throw Error("Worker replication did not remain healthy during browser benchmark");
    if (catalogSlots && rows.some(row => !row.confirmed[row.phase]))
      throw Error("Missing browser confirmations: " + rows.filter(row => !row.confirmed[row.phase]).map(row => row.phase).join(", "));
  } finally {
    lag.disable(); await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
