/* Isolated in-memory server, never opens player saves. */
"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { once } = require("node:events"),
  engines = require("playwright");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { createGameServer } = require("../../src/server/game-server");
const { Arena } = require("../../src/server/arena/arena-simulation");
const out = path.resolve(__dirname, "../../../../artifacts/theme-prices-20261030/browser");
fs.mkdirSync(out, { recursive: true });
const engine = process.argv.find((arg) => arg.startsWith("--engine="))?.split("=")[1] || "chromium";
const profiles = new ProfileStore(),
  user = profiles.open(),
  hero = profiles.find(user.token);
hero.personal = { nameSet: true, gender: "male" };
hero.level = 12;
hero.progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(12);
Object.assign(hero.wallet, { coins: 50000, crystals: 25000, bucks: 3000 });
const packs = require("../../public/shared/league-appearance").interfaceThemes;
const app = createGameServer({
  profiles,
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  testBots: { enabled: false },
});
let browser;
(async () => {
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const url = "http://127.0.0.1:" + app.httpServer.address().port;
  const report = [];
  try {
    browser = await engines[engine].launch({
      headless: true,
      ...(engine === "chromium" ? { channel: "chrome" } : {}),
    });
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 844, height: 390 },
    ]) {
      const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
      await context.addCookies([{ name: "sferorumiya_session", value: user.token, url }]);
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (response) => {
        if (response.status() >= 400)
          errors.push(response.status() + " " + new URL(response.url()).pathname);
      });
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      await page.evaluate(() =>
        document.querySelectorAll("dialog[open]").forEach((d) => d.close()),
      );
      async function openSettings() {
        await page.locator("#settingsButton").click();
        await page.locator("#lobbyAppearanceButton").click();
      }
      async function fit(selector) {
        const b = await page.locator(selector).evaluate((el) => {
          const r = el.getBoundingClientRect();
          return {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
            vw: innerWidth,
            vh: innerHeight,
            width: el.clientWidth,
            scroll: el.scrollWidth,
          };
        });
        assert(
          b.left >= -1 && b.top >= -1 && b.right <= b.vw + 1 && b.bottom <= b.vh + 1,
          JSON.stringify({ selector, b }),
        );
        assert(b.scroll <= b.width + 2, `Horizontal overflow ${selector}: ${JSON.stringify(b)}`);
      }
      await openSettings();
      await fit("#appearanceDialog");
      await page
        .locator("#appearanceDialog")
        .screenshot({ path: path.join(out, `${engine}-${viewport.width}-picker.png`) });
      for (const id of ["visual", "prism", "glass", "default"]) {
        const button = page.locator(`#appearanceDialog [data-theme-id="${id}"] button`);
        const pack = packs.find((p) => p.id === id),
          before = structuredClone(profiles.find(user.token).wallet),
          buying = pack && !profiles.find(user.token).appearance.purchasedThemes?.[id];
        if (pack) {
          const card = page.locator(`#appearanceDialog [data-theme-id="${id}"]`);
          assert.equal(await card.locator("strong").textContent(), pack.name);
          assert(
            (await card.locator(".appearance-availability").textContent()).includes(
              pack.price.toLocaleString("ru-RU"),
            ),
          );
        }
        // The server commits, but the response is lost. Reloading the profile recovers ownership.
        if (buying && id === "visual")
          await page.route(
            "**/api/profile/appearance",
            async (route) => {
              await route.fetch();
              await route.abort();
            },
            { times: 1 },
          );
        if (!(await button.isDisabled())) await button.click();
        await page.waitForFunction((id) => document.documentElement.dataset.uiTheme === id, id);
        if (pack)
          assert.equal(
            profiles.find(user.token).wallet[pack.currency],
            before[pack.currency] - (buying ? pack.price : 0),
          );
        await page.locator("#appearanceDialog .booster-close").click();
        if (id === "visual") {
          await page.waitForFunction(
            () => !!document.getElementById("lobby").style.getPropertyValue("--pack-scene-size"),
          );
          const geometry = await page.evaluate(() => {
            const lobby = document.getElementById("lobby"),
              bounds = lobby.getBoundingClientRect(),
              orb = document.getElementById("skinPreview").getBoundingClientRect();
            const css = getComputedStyle(lobby),
              width = parseFloat(css.backgroundSize),
              left = parseFloat(css.backgroundPositionX);
            return {
              stage: left + width / 2,
              avatar: orb.left + orb.width / 2 - bounds.left,
              left,
              right: left + width,
              viewWidth: bounds.width,
            };
          });
          assert(Math.abs(geometry.stage - geometry.avatar) < 1, JSON.stringify(geometry));
          assert(
            geometry.left <= 0.1 && geometry.right >= geometry.viewWidth - 0.1,
            JSON.stringify(geometry),
          );
        }
        await page.waitForFunction(() =>
          [...document.querySelectorAll("#lobby .menu-icon:not([hidden])")].every(
            (image) => image.complete && image.naturalWidth > 0,
          ),
        );
        const state = await page.evaluate(() => ({
          theme: document.documentElement.dataset.uiTheme,
          bg: getComputedStyle(document.getElementById("lobby")).backgroundImage,
          icon: document.querySelector("#wardrobeSection img").getAttribute("src"),
          srcset: document.querySelector("#wardrobeSection img").getAttribute("srcset"),
          button: getComputedStyle(document.getElementById("shopSection"), "::before")
            .backgroundImage,
          panel: getComputedStyle(document.querySelector(".player-progress")).backgroundImage,
        }));
        assert.equal(state.panel, "none", "The experience container must not add a second panel");
        if (id === "default") {
          assert(!state.icon.includes("interface-packs"));
          assert(state.srcset);
        } else {
          assert(state.bg.includes(`/interface-packs/${id}/lobby.webp`));
          assert(state.icon.includes(`/interface-packs/${id}/nav-wardrobe.webp`));
          assert.equal(state.srcset, null);
        }
        await page.screenshot({ path: path.join(out, `${engine}-${viewport.width}-${id}.png`) });
        await page
          .locator("#settingsButton")
          .screenshot({ path: path.join(out, `${engine}-${viewport.width}-${id}-gear.png`) });
        await page.locator("#petsSection").click();
        await fit("#petsDialog");
        for (const tab of ["abilities", "levels", "achievements"]) {
          const active = page.locator(`.pet-tabs [data-tab="${tab}"]`);
          await active.click();
          const surface = await active.evaluate((el) => ({
            active: el.getAttribute("aria-pressed"),
            background: getComputedStyle(el).backgroundImage,
            other: getComputedStyle(el.parentElement.querySelector('button[aria-pressed="false"]'))
              .backgroundImage,
          }));
          assert.equal(surface.active, "true");
          assert(!surface.background.includes("url("), JSON.stringify(surface));
          assert.notEqual(surface.background, surface.other);
        }
        await page.locator('.pet-tabs [data-tab="abilities"]').click();
        await page
          .locator(".pet-details")
          .screenshot({ path: path.join(out, `${engine}-${viewport.width}-${id}-pet-tabs.png`) });
        await page.locator("#petsDialog .pets-close").click();
        report.push({ viewport, ...state });
        await page.reload();
        await page.waitForFunction(
          (id) =>
            document.documentElement.dataset.uiTheme === id &&
            !document.getElementById("playButton").disabled,
          id,
        );
        if (id !== "default") {
          await page.locator("#wardrobeSection").click();
          await page
            .locator("#skinsDialog")
            .getByRole("button", { name: "Наборы", exact: true })
            .click();
          await page.locator(`.avatar-set-showcase[data-set-id="${id}"]`).waitFor();
          await page.locator(`button.account-avatar[data-skin-id="${id}-moon-dragon"]`).click();
          await fit("#skinsDialog");
          await page.waitForFunction(
            (id) => document.getElementById("lobbySkin").dataset.skinId === `${id}-moon-dragon`,
            id,
          );
          await page
            .locator("#skinsDialog")
            .screenshot({ path: path.join(out, `${engine}-${viewport.width}-${id}-avatars.png`) });
          await page
            .locator("#skinsDialog")
            .getByRole("button", { name: "Готово", exact: true })
            .click();
          await page.locator("#playButton").click();
          await page.waitForFunction(() => document.body.dataset.screen === "arena");
          const player = [...(app.arena?.players?.values?.() || [])].find(
            (p) => p.profileId === user.profile?.id,
          );
          // The server accepts and stores the avatar sent with the arena loadout.
          assert.equal(profiles.find(user.token).skinId, `${id}-moon-dragon`);
          await page.locator("#leaveButton").click();
          await page.getByRole("button", { name: "Выйти в лобби", exact: true }).click();
          await page.waitForFunction(() => document.body.dataset.screen === "lobby");
        }
        if (id !== "default") await openSettings();
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    fs.writeFileSync(path.join(out, `${engine}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ engine, checks: report.length, status: "passed" }));
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
