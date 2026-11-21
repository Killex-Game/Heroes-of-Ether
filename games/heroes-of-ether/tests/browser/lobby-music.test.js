"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { once } = require("node:events"),
  engines = require("playwright"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation");
const artifacts = path.resolve(__dirname, "../../../../artifacts/lobby-music-20261024");
fs.mkdirSync(artifacts, { recursive: true });
const reports = [];
(async () => {
  const app = createGameServer({
    arena: new Arena({ etherCount: 0 }),
    testBots: { enabled: false },
  });
  let browser;
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = `http://127.0.0.1:${app.httpServer.address().port}`;
    for (const engine of process.argv[2] ? [process.argv[2]] : ["chromium", "firefox", "webkit"]) {
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const context = await browser.newContext(),
        page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        const NativeAudio = window.Audio;
        window.musicElements = [];
        window.Audio = function (...args) {
          const audio = new NativeAudio(...args);
          if (args[0]?.endsWith("tavern-circle-v1.mp3")) {
            musicElements.push(audio);
            audio.testEvents = [];
            for (const event of ["playing", "pause", "ended", "seeking", "seeked", "error"])
              audio.addEventListener(event, () =>
                audio.testEvents.push({ event, time: audio.currentTime, hidden: document.hidden }),
              );
            const play = audio.play.bind(audio);
            audio.play = () =>
              play().catch((error) => {
                audio.testEvents.push({ event: "playRejected", error: error.message });
                throw error;
              });
          }
          return audio;
        };
      });
      const fixture=require('../helpers/browser-established-profile');
      const auth=app.profiles.open();fixture.prepareProfile(app.profiles,auth);
      await context.addCookies([{name:'sferorumiya_session',value:auth.token,url,httpOnly:true}]);
      await fixture.prepareContext(context);
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await fixture.clearInitialDialogs(page);
      const response = await context.request.get(`${url}/assets/audio/tavern-circle-v1.mp3`);
      assert.equal(response.status(), 200);
      assert.match(response.headers()["content-type"], /^audio\/mpeg/);
      assert.equal((await response.body()).length, 2745005);
      assert.equal(
        await page.evaluate(() => musicElements.length === 1 && musicElements[0].paused),
        true,
      );
      await page.locator("#settingsButton").click();
      await page.waitForFunction(
        () => !musicElements[0].paused && musicElements[0].currentTime > 0.1,
      );
      const duration = await page.evaluate(() => musicElements[0].duration);
      assert.ok(Number.isFinite(duration) && duration > 10);
      assert.equal(await page.evaluate(() => musicElements[0].loop), true);
      await page.locator("#soundVolume").press("Home");
      assert.equal(
        await page.evaluate(() => musicElements[0].paused),
        false,
        "звук эффектов не выключает музыку",
      );
      await page.locator("#musicVolume").press("Home");
      assert.equal(await page.evaluate(() => musicElements[0].paused), true);
      await page.reload();
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.locator("#settingsButton").click();
      assert.equal(await page.locator("#musicVolume").inputValue(), "0");
      assert.equal(
        await page.evaluate(() => musicElements[0].paused),
        true,
        "выключение сохранено после перезагрузки",
      );
      await page.locator("#musicVolume").press("End");
      await page.waitForFunction(
        () => !musicElements[0].paused && musicElements[0].currentTime > 0.1,
      );
      await page.locator("#closeSettings").click();
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      assert.equal(await page.evaluate(() => musicElements[0].paused), true);
      await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForFunction(() => !musicElements[0].paused);
      await page.evaluate(() => {
        musicElements[0].currentTime = musicElements[0].duration - 0.3;
      });
      await page
        .waitForFunction(() => musicElements[0].currentTime < 2 && !musicElements[0].paused)
        .catch(async (error) => {
          console.log(
            await page.evaluate(() => {
              const a = musicElements[0];
              return {
                events: a.testEvents,
                hidden: document.hidden,
                paused: a.paused,
                time: a.currentTime,
                duration: a.duration,
                seeking: a.seeking,
                ended: a.ended,
                ready: a.readyState,
                error: a.error?.message,
                seekable: Array.from({ length: a.seekable.length }, (_, i) => [
                  a.seekable.start(i),
                  a.seekable.end(i),
                ]),
                buffered: Array.from({ length: a.buffered.length }, (_, i) => [
                  a.buffered.start(i),
                  a.buffered.end(i),
                ]),
              };
            }),
          );
          throw error;
        });
      await page.locator("#playButton").click();
      await page.locator("#arena").waitFor({ state: "visible" });
      assert.equal(
        await page.evaluate(() => musicElements[0].paused),
        true,
        "на арене трек выключен",
      );
      await page.locator("#leaveButton").click();
      await page.locator("#leaveYes").click();
      await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
      assert.equal(await page.evaluate(() => musicElements[0].paused), true);
      await page.locator("#lifeLobby").click();
      await page.locator("#lobby").waitFor({ state: "visible" });
      await page.waitForFunction(
        () => !musicElements[0].paused && musicElements[0].currentTime > 0.05,
      );
      assert.equal(
        await page.evaluate(() => musicElements.length),
        1,
        "при возвращении нет второго проигрывателя",
      );
      assert.deepEqual(errors, []);
      reports.push({
        engine,
        duration,
        mime: response.headers()["content-type"],
        bytes: 2745005,
        playback: true,
        loop: true,
        settings: true,
        arenaPause: true,
        lobbyResume: true,
        errors,
      });
      console.log(
        `${engine}: MP3 playback, looping, saved preference, hidden tab and arena/lobby transitions OK (${duration.toFixed(2)} sec)`,
      );
      await browser.close();
      browser = null;
    }
    fs.writeFileSync(path.join(artifacts, "browser-report.json"), JSON.stringify(reports, null, 2));
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
