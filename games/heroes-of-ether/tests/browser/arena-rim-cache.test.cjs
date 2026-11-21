"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { chromium } = require("playwright");
const source = fs.readFileSync(
  path.resolve(__dirname, "../../public/arena/food-and-frame-renderer.js"),
  "utf8",
);
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    for (const density of [1, 2]) {
      const page = await browser.newPage({ deviceScaleFactor: density });
      await page.setContent('<canvas width="320" height="320"></canvas>');
      await page.evaluate(() => {
        window.created = 0;
        const create = document.createElement.bind(document);
        document.createElement = (...args) => {
          if (args[0] === "canvas") created++;
          return create(...args);
        };
      });
      await page.addScriptTag({ content: source });
      const result = await page.evaluate(() => {
        const canvas = document.querySelector("canvas"),
          ctx = canvas.getContext("2d");
        const draw = (time) => {
          ctx.clearRect(0, 0, 320, 320);
          KillexArenaArt.accountFrame(ctx, { premium: true }, 160, 160, 100, 1, time);
          return [...ctx.getImageData(0, 0, 320, 320).data];
        };
        const first = draw(0),
          second = draw(2250);
        const centerAlpha = ctx.getImageData(160, 160, 1, 1).data[3];
        let start;
        for (let tick = 0; tick < 90; tick++) {
          for (let i = 0; i < 120; i++) {
            const r = 25 + (i % 35) * 2.7 + Math.sin(tick / 50 + i) * 1.2;
            KillexArenaArt.accountFrame(
              ctx,
              i % 2 ? { vip: true } : { premium: true },
              160,
              160,
              r,
              1,
              tick * 17,
            );
          }
          if (tick === 29) start = created;
        }
        return {
          centerAlpha,
          animationChangesPixels: first.some((v, i) => v !== second[i]),
          created,
          afterWarmup: created - start,
        };
      });
      assert.equal(result.centerAlpha, 0, "frame must not cover the player's portrait");
      assert.equal(result.animationChangesPixels, true, "moving highlight must remain visible");
      assert.ok(
        result.created < 180,
        `unbounded intermediate images at DPR ${density}: ${result.created}`,
      );
      assert.ok(result.afterWarmup < 20, `cache thrashes while sizes drift: ${result.afterWarmup}`);
      const large = await page.evaluate(() => {
        const ctx = document.querySelector("canvas").getContext("2d");
        let start;
        for (let tick = 0; tick < 60; tick++) {
          for (let i = 0; i < 60; i++) {
            const radius = 60 + (i % 30) * 8 + Math.sin(tick / 50 + i) * 2;
            KillexArenaArt.accountFrame(
              ctx,
              i % 2 ? { vip: true } : { premium: true },
              160,
              160,
              radius,
              1,
              tick * 17,
            );
          }
          if (tick === 19) start = created;
        }
        return { afterWarmup: created - start };
      });
      assert.ok(
        large.afterWarmup < 20,
        `large rims exhaust the cache at DPR ${density}: ${large.afterWarmup}`,
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      const same = await page.evaluate(() => {
        const canvas = document.querySelector("canvas"),
          ctx = canvas.getContext("2d");
        const draw = (now) => {
          ctx.clearRect(0, 0, 320, 320);
          KillexArenaArt.accountFrame(ctx, { vip: true }, 160, 160, 100, 1, now);
          return canvas.toDataURL();
        };
        return draw(0) === draw(4500);
      });
      assert.ok(same, "reduced motion keeps a static highlight");
      console.log(JSON.stringify({ density, ...result, large, reducedMotion: same }));
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
