/* Реальные серверные слияние/мина/смерть и воспроизведение WAV в трёх движках. */
"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { once } = require("node:events"),
  playwright = require("playwright");
const { createGameServer } = require("../../src/server/game-server");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
const artifacts = path.resolve(__dirname, "../../../../artifacts/audio-integration-20261022");
fs.mkdirSync(artifacts, { recursive: true });
const reports = [];
(async () => {
  for (const engine of process.argv[2] ? [process.argv[2]] : ["chromium", "firefox", "webkit"]) {
    let clock = 5000,
      browser;
    const app = createGameServer({
      arena: new Arena({ etherCount: 0 }),
      autoTick: false,
      testBots: { enabled: false },
      now: () => clock,
      rateNow: () => performance.now(),
    });
    try {
      app.httpServer.listen(0, "127.0.0.1");
      await once(app.httpServer, "listening");
      const url = `http://127.0.0.1:${app.httpServer.address().port}`;
      browser = await playwright[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
        page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        window.__sounds = [];
        window.__attempts = [];
        window.__audio = [];
        window.__lastTick = -1;
        const NativeAudio = window.Audio;
        window.Audio = function (...args) {
          const audio = new NativeAudio(...args);
          if (!args[0]?.endsWith(".wav")) return audio;
          window.__audio.push(audio);
          const play = audio.play.bind(audio);
          audio.play = () => {
            const attempt = { src: args[0], muted: audio.muted, at: performance.now() };
            if (!audio.muted) window.__sounds.push(audio.src.split("/").pop());
            window.__attempts.push(attempt);
            return play().then(
              () => {
                attempt.resolved = performance.now();
              },
              (e) => {
                attempt.error = e.message;
                throw e;
              },
            );
          };
          audio.addEventListener("playing", () => {});
          return audio;
        };
        const NativeSocket = window.WebSocket;
        window.WebSocket = class extends NativeSocket {
          constructor(...args) {
            super(...args);
            this.addEventListener("message", (e) => {
              const m = JSON.parse(e.data);
              if (m.type === "state") window.__lastTick = m.tick;
            });
          }
        };
      });
      const fixture=require('../helpers/browser-established-profile');
      const auth=app.profiles.open();fixture.prepareProfile(app.profiles,auth);
      await context.addCookies([{name:'sferorumiya_session',value:auth.token,url,httpOnly:true}]);
      await fixture.prepareContext(context);
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await fixture.clearInitialDialogs(page);
      for (const file of ["defeat-v1.wav", "merge-v1.wav", "mine-v1.wav"]) {
        const response = await context.request.get(url + "/assets/audio/" + file);
        assert.equal(response.status(), 200);
        assert.match(response.headers()["content-type"], /audio\/wav/);
        assert.equal((await response.body()).subarray(0, 4).toString(), "RIFF");
      }
      await page.locator("#playButton").click();
      await page.locator("#arena").waitFor({ state: "visible" });
      await page.waitForFunction(
        () =>
          window.__audio.length ===
            Object.values(KillexAudio.TRACKS).reduce((n, t) => n + t.voices, 0) &&
          window.__audio.every((a) => a.readyState >= 2),
      );
      const me = [...app.arena.players.values()][0];
      const tick = async (ms = 50) => {
        clock += ms;
        app.tick();
        await page.waitForFunction((t) => window.__lastTick === t, app.arena.tick);
      };
      const heard = () => page.evaluate(() => window.__sounds.slice());
      const waitSound = async (file, count = 1) =>
        page.waitForFunction(
          ({ file, count }) => window.__sounds.filter((s) => s === file).length === count,
          { file, count },
        );
      const twoParts = () => {
        const a = {
          id: me.mainPartId,
          x: 1500,
          y: 1000,
          mass: 40,
          radius: radiusForMass(40),
          mergeVersion: me.mergeVersion || 0,
          vx: 0,
          vy: 0,
        };
        me.parts = [a, { ...a, id: "test-part", mergeVersion: 0 }];
        Object.assign(me, {
          x: 1500,
          y: 1000,
          targetX: 1500,
          targetY: 1000,
          mass: 80,
          radius: radiusForMass(80),
          stopped: true,
          protectedUntil: 0,
          mergeAt: clock + 10000,
        });
        app.arena.syncParts(me);
      };
      twoParts();
      await tick();
      for (const p of me.parts) {
        p.x = 1500;
        p.y = 1000;
      }
      me.mergeAt = clock;
      await tick();
      try {
        await waitSound("merge-v1.wav");
      } catch (e) {
        console.log(
          await page.evaluate(() => ({
            sounds: __sounds,
            attempts: __attempts,
            audios: __audio.map((a) => ({
              src: a.src,
              paused: a.paused,
              muted: a.muted,
              ready: a.readyState,
              time: a.currentTime,
            })),
            hidden: document.hidden,
          })),
        );
        throw e;
      }
      await tick();
      assert.deepEqual(await heard(), ["merge-v1.wav"]);
      // A part disappearing through absorption is not a merge.
      twoParts();
      await tick();
      me.parts.splice(1, 1);
      app.arena.syncParts(me);
      await tick();
      assert.deepEqual(await heard(), ["merge-v1.wav"]);
      const owner = app.arena.addPlayer(clock, "audio-opponent");
      const mine = async (shield = false) => {
        me.effects = shield ? { colorful_shield: clock + 10000 } : {};
        Object.assign(me, {
          parts: null,
          x: 1500,
          y: 1000,
          targetX: 1500,
          targetY: 1000,
          mass: 80,
          radius: radiusForMass(80),
          stopped: true,
          protectedUntil: 0,
        });
        Object.assign(owner, {
          x: 1360,
          y: 1000,
          targetX: 1360,
          targetY: 1000,
          stopped: true,
          protectedUntil: 0,
        });
        // A stationary player's mine launches opposite the aim direction.
        app.arena.combat.prepare(owner, BOOSTERS.get("mine"), { aimX: 1260, aimY: 1000 }, clock)();
        await tick(1000);
      };
      await mine();
      await waitSound("mine-v1.wav");
      assert.equal(me.parts.length, 8);
      await tick();
      assert.equal((await heard()).filter((s) => s === "mine-v1.wav").length, 1);
      await mine(true);
      await waitSound("shield-selected-v1.wav");
      assert.equal(app.arena.bodies(me).length, 1);
      await page.waitForFunction(() =>
        window.__audio.some(
          (a) => a.src.endsWith("shield-selected-v1.wav") && a.currentTime > 0.04 && !a.paused,
        ),
      );
      await tick();
      assert.equal((await heard()).filter((s) => s === "shield-selected-v1.wav").length, 1);
      // Preference must stop currently playing sounds immediately and suppress new events.
      await page.locator("#soundVolume").evaluate(el => { el.value = "0"; el.dispatchEvent(new Event("input",{bubbles:true})); el.dispatchEvent(new Event("change",{bubbles:true})); });
      assert.ok(await page.evaluate(() => window.__audio.every((a) => a.paused)));
      await mine();
      assert.equal((await heard()).filter((s) => s === "mine-v1.wav").length, 1);
      await page.locator("#soundVolume").evaluate(el => { el.value = "100"; el.dispatchEvent(new Event("input",{bubbles:true})); el.dispatchEvent(new Event("change",{bubbles:true})); });
      // Same sound only on a confirmed life result; no sound for voluntarily leaving next life.
      Object.assign(me, {
        parts: null,
        mass: 20,
        radius: radiusForMass(20),
        protectedUntil: 0,
        x: 1500,
        y: 1000,
      });
      Object.assign(owner, {
        mass: 400,
        radius: radiusForMass(400),
        x: 1500,
        y: 1000,
        protectedUntil: 0,
      });
      await tick();
      await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
      await waitSound("defeat-v1.wav");
      assert.equal(await page.locator("#lifeResultTitle").textContent(), "Вас съели");
      // Native media clock advances: verified playback, not just a play() invocation.
      await page.waitForFunction(() =>
        window.__audio.some(
          (a) => a.src.endsWith("defeat-v1.wav") && !a.paused && a.currentTime > 0.04,
        ),
      );
      await page.screenshot({ path: path.join(artifacts, engine + "-defeat.png") });
      await page.locator("#lifeLobby").click();
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.locator("#playButton").click();
      await page.locator("#arena").waitFor({ state: "visible" });
      await page.locator("#leaveButton").click();
      await page.locator("#leaveYes").click();
      await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
      assert.equal((await heard()).filter((s) => s === "defeat-v1.wav").length, 1);
      assert.deepEqual(errors, []);
      reports.push({
        engine,
        merge: true,
        partLossSilent: true,
        mine: true,
        mute: true,
        defeat: true,
        voluntaryExitSilent: true,
        errors,
      });
      console.log(engine + ": real merge, mine and defeat audio; mute and voluntary exit verified");
    } finally {
      if (browser) await browser.close();
      await app.close();
    }
  }
  fs.writeFileSync(path.join(artifacts, "browser-checks.json"), JSON.stringify(reports, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
