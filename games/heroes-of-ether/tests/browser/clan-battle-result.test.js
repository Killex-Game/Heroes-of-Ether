/* Итог битвы: гербы, счёт, двухчасовая подготовка и адаптивная кнопка награды. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { chromium, firefox, webkit } = require("playwright");
const publicRoot = path.resolve(__dirname, "../../public"),
  artifacts =
    process.env.SFER_ARTIFACT_DIR || path.resolve(__dirname, "../artifacts/clan-battle-result");
fs.mkdirSync(artifacts, { recursive: true });
const styles = fs
  .readFileSync(path.join(publicRoot, "index.html"), "utf8")
  .match(/<link rel="stylesheet"[^>]+>/g)
  .join("\n");
const scripts = [
  "shared/interface-theme.js",
  "shared/clan-competition-rules.js",
  "shared/progression-asset-paths.js",
  "shared/clan-crest-art-data.js",
  "shared/clan-crest-variants.js",
  "shared/clan-crest-rules.js",
  "ui/clans/clan-crest-renderer.js",
  "ui/clans/clan-battle-and-treasury.js",
  "ui/boosters/booster-tooltip.js",
];
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">${styles}</head>
  <body><dialog id="clanDialog" class="clan-dialog" style="width:min(760px,calc(100vw - 24px));height:min(720px,calc(100dvh - 24px));max-width:none;max-height:none;padding:12px;border:0;box-sizing:border-box"></dialog>
  ${scripts.map((src) => `<script src="/${src}"></script>`).join("")}</body></html>`;
async function fixture(page) {
  await page.route("**/*", async (route) => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname).replace(
      /^\/+/,
      "",
    );
    if (!relative) return route.fulfill({ contentType: "text/html", body: html });
    const file = path.resolve(publicRoot, relative);
    if (!file.startsWith(publicRoot + path.sep)) return route.abort();
    try {
      await route.fulfill({ path: file });
    } catch {
      await route.abort();
    }
  });
  await page.goto("http://clan-result.test/");
  await page.evaluate(() => {
    window.fixtureNow = Date.parse("2026-10-21T23:00:00Z");
    Date.now = () => fixtureNow;
    const dialog = document.getElementById("clanDialog"),
      kit = KillexClanCrests;
    window.fixtureClan = {
      id: "own",
      name: "Аметистовые драконы",
      prefix: "AM",
      crest: kit.DEFAULT,
    };
    window.fixtureState = {
      wins: 1,
      group: {},
      personal: {},
      battle: null,
      nextBattleAt: fixtureNow + 6 * 60 * 60 * 1000,
      lastBattle: {
        own: 289,
        enemy: 23,
        won: true,
        draw: false,
        opponent: {
          id: "enemy",
          name: "Золотые львы",
          prefix: "GL",
          crest: { ...kit.DEFAULT, color: kit.colors[3].id, symbol: kit.symbols[4].id },
        },
      },
    };
    const owner = {
      dialog,
      data: {
        profile: {
          id: "player",
          clanChests: {
            items: [
              {
                id: "reward",
                tier: "high",
                stored: false,
                sourceClanId: "own",
                earnedAt: fixtureNow - 1000,
                expiresAt: fixtureNow + 86400000,
              },
            ],
          },
        },
      },
      claimBattleChest: (id) => {
        window.claimedChest = id;
      },
    };
    window.fixtureUI = new KillexClanBattleUI(owner);
    window.renderFixture = () => {
      const panel = fixtureUI.battle(fixtureState, fixtureClan);
      panel.style.height = "100%";
      panel.style.margin = "0";
      dialog.replaceChildren(panel);
    };
    renderFixture();
    dialog.showModal();
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#clanDialog img")].every(
      (image) => image.complete && image.naturalWidth > 0 && !image.dataset.artError,
    ),
  );
}
async function geometry(page) {
  return page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const result = rect(".clan-battle-result"),
      score = rect(".clan-result-summary"),
      left = rect(".clan-result-team:first-child"),
      right = rect(".clan-result-team:last-child"),
      card = rect(".clan-personal-reward"),
      button = rect(".clan-personal-reward-claim"),
      row = rect(".clan-personal-reward-row"),
      dialog = document.getElementById("clanDialog");
    return {
      centerOffset: Math.abs(score.x + score.width / 2 - result.x - result.width / 2),
      scoreBetweenCrests: score.x >= left.right && score.right <= right.x,
      fontSize: parseFloat(getComputedStyle(document.querySelector(".clan-result-score")).fontSize),
      claimBelowDate: button.top >= rect(".clan-personal-reward-note").bottom,
      cardCentered: Math.abs(card.x + card.width / 2 - row.x - row.width / 2) < 1,
      cardWidth: card.width,
      cardHeight: card.height,
      buttonInside:
        button.left >= card.left &&
        button.right <= card.right &&
        button.bottom <= card.bottom &&
        button.bottom <= dialog.getBoundingClientRect().bottom,
      overflow:
        dialog.scrollWidth > dialog.clientWidth + 1 ||
        dialog.scrollHeight > dialog.clientHeight + 1,
    };
  });
}
async function chestHints(page, allAccounts) {
  const tip = page.locator("#boosterTooltip"),
    high = page.locator('.clan-battle-prize[data-reward="high"]');
  for (const [vip, premium, multiplier, bonus] of allAccounts
    ? [
        [false, false, 1, 0],
        [true, false, 2, 10],
        [false, true, 3, 20],
        [true, true, 3, 30],
      ]
    : [[true, true, 3, 30]]) {
    await page.evaluate(
      ({ vip, premium }) => {
        fixtureUI.owner.data.profile.account = {
          vipUntil: vip ? fixtureNow + 86400000 : fixtureNow - 1,
          premiumUntil: premium ? fixtureNow + 86400000 : fixtureNow - 1,
        };
        renderFixture();
      },
      { vip, premium },
    );
    const before = await high.boundingBox();
    await high.hover();
    assert(await tip.isVisible());
    const text = (await tip.innerText()).replace(/[\u00a0\u202f]/g, " ");
    assert(
      text.includes(
        `Монеты: ${300 * multiplier}–${(500 * multiplier).toLocaleString("en-US").replace(/,/g, " ")}`,
      ),
      text,
    );
    assert(text.includes(`Бустеры: ${200 * multiplier}`), text);
    assert(text.includes(`Клановые: ${120 * multiplier} (60%)`), text);
    assert(text.includes(`Величие: ${10 + bonus}`), text);
    assert.deepEqual(await high.boundingBox(), before, "Tooltip must not move its card");
    const box = await tip.boundingBox(),
      viewport = page.viewportSize();
    assert(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width &&
        box.y + box.height <= viewport.height,
    );
    await page.keyboard.press("Escape");
    assert(!(await tip.isVisible()));
    assert(await page.locator("#clanDialog").evaluate((node) => node.open));
  }
  for (const [tier, boosters, greatness] of [
    ["medium", 450, 37],
    ["low", 300, 35],
  ]) {
    await page.locator(`.clan-battle-prize[data-reward="${tier}"]`).hover();
    assert((await tip.innerText()).includes(`Бустеры: ${boosters}`));
    assert((await tip.innerText()).includes(`Величие: ${greatness}`));
  }
  await page.locator('.clan-battle-prize[data-reward="fixed"]').hover();
  assert.equal(await tip.locator("p").innerText(), "Монеты: 100\nКристаллы: 10\nЭфир: 1");
  // Не оставляем курсор над прежней карточкой при замене DOM перед проверкой фокуса.
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    fixtureUI.owner.data.profile.clanChests.items[0].reward = {
      multiplier: 2,
      greatnessBonus: 10,
      coins: 700,
      crystals: 80,
      greatness: 20,
      items: { rare: 80, advanced: 80, clan: 240 },
    };
    renderFixture();
  });
  await page.locator(".clan-personal-reward").focus();
  assert(
    (await tip.innerText()).includes("Монеты: 700\nКристаллы: 80\nБустеры: 400"),
    JSON.stringify(
      await page.evaluate(() => ({
        tip: document.getElementById("boosterTooltip").innerText,
        hint: document.querySelector(".clan-personal-reward")?.dataset.boosterHint,
        active: document.activeElement?.className,
      })),
    ),
  );
  assert((await tip.innerText()).includes("Величие: 20"));
  await page.evaluate(() => {
    const profile = fixtureUI.owner.data.profile;
    profile.clanChests.notices = [];
    profile.clanChests.stored = 0;
    profile.clanChests.capacity = 10;
    profile.clanChests.items[0].art = "master";
    const inventory = new KillexClanChestInventory({ profile, purchasesBlocked: () => false });
    inventory.render();
    if (inventory.root.querySelector(".clan-owned-chest"))
      throw Error("Unclaimed clan chest in Treasury");
    profile.clanChests.items[0].stored = true;
    profile.clanChests.stored = 1;
    inventory.render();
    fixtureUI.owner.dialog.replaceChildren(inventory.root);
  });
  await page.locator(".clan-owned-chest").hover();
  assert((await tip.innerText()).includes("Монеты: 700\nКристаллы: 80\nБустеры: 400"));
  await page.evaluate(() => {
    fixtureUI.owner.data.profile.clanChests.items[0].stored = false;
    fixtureUI.owner.data.profile.clanChests.stored = 0;
    delete fixtureUI.owner.data.profile.clanChests.items[0].reward;
    renderFixture();
  });
  assert(!(await tip.isVisible()), "Removed cards must close their tooltip");
  await page.mouse.move(0, 0);
}
(async () => {
  const results = [];
  for (const [name, engine, options] of [
    ["chrome", chromium, { channel: "chrome" }],
    ["edge", chromium, { channel: "msedge" }],
    ["firefox", firefox, {}],
    ["webkit", webkit, {}],
  ]) {
    const browser = await engine.launch({ headless: true, ...options });
    try {
      for (const [width, height] of [
        [1366, 768],
        [1024, 768],
        [390, 844],
        [320, 568],
      ]) {
        const page = await browser.newPage({ viewport: { width, height } }),
          errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        console.log(`Checking ${name} ${width}x${height}`);
        await fixture(page);
        await chestHints(page, width === 1366);
        assert(
          await page.locator(".clan-battle-countdown").evaluate((node) => {
            const label = document.createRange();
            label.selectNodeContents(node.firstChild);
            const text = label.getBoundingClientRect(),
              digits = node.querySelector("b").getBoundingClientRect();
            return (
              digits.top >= text.bottom &&
              Math.abs(digits.x + digits.width / 2 - text.x - text.width / 2) < 1
            );
          }),
          "Countdown digits must be centered on the second line",
        );
        for (const outcome of ["win", "loss", "draw"]) {
          await page.evaluate((outcome) => {
            fixtureState.lastBattle.won = outcome === "win";
            fixtureState.lastBattle.draw = outcome === "draw";
            fixtureState.lastBattle.own = outcome === "win" ? 289 : 23;
            fixtureState.lastBattle.enemy = outcome === "loss" ? 289 : 23;
            renderFixture();
          }, outcome);
          assert.equal(
            await page.locator(".clan-battle-result").getAttribute("data-outcome"),
            outcome,
          );
          assert.deepEqual(
            await page
              .locator(".clan-result-team")
              .evaluateAll((nodes) => nodes.map((n) => n.dataset.outcome)),
            [outcome, outcome === "draw" ? "draw" : outcome === "win" ? "loss" : "win"],
          );
          const layout = await geometry(page);
          assert(
            layout.centerOffset < 1 && layout.scoreBetweenCrests && layout.fontSize >= 24,
            JSON.stringify(layout),
          );
          assert(
            layout.claimBelowDate &&
              layout.cardCentered &&
              layout.cardWidth <= 361 &&
              layout.cardHeight <= 125 &&
              layout.buttonInside &&
              !layout.overflow,
            JSON.stringify(layout),
          );
          assert.equal(await page.locator(".clan-last-result").count(), 0);
          if (outcome === "win")
            await page
              .locator("#clanDialog")
              .screenshot({ path: path.join(artifacts, `${name}-${width}.png`) });
        }
        await page.locator(".clan-personal-reward-claim").click();
        assert.equal(await page.evaluate(() => claimedChest), "reward");
        await page.emulateMedia({ reducedMotion: "reduce" });
        assert.equal(
          await page
            .locator(".clan-result-crest")
            .first()
            .evaluate((n) => getComputedStyle(n).animationName),
          "none",
        );
        await page.evaluate(() => {
          fixtureNow = fixtureState.nextBattleAt - 2 * 60 * 60 * 1000 - 1000;
          fixtureUI.updateCountdown();
        });
        assert.equal(await page.locator(".clan-battle-result").count(), 1);
        await page.evaluate(() => {
          fixtureNow += 1000;
          fixtureUI.updateCountdown();
        });
        assert.equal(await page.locator(".clan-battle-result").count(), 0);
        assert.equal(await page.locator(".clan-battle-stage").innerText(), "Битва готовится");
        await page.evaluate(() => renderFixture());
        assert.equal(await page.locator(".clan-battle-stage").innerText(), "Битва готовится");
        await page.evaluate(() => {
          fixtureState.battle = {
            start: fixtureNow - 1000,
            end: fixtureNow + 100000,
            own: 12,
            enemy: 8,
            opponent: fixtureState.lastBattle.opponent,
          };
          renderFixture();
        });
        assert.equal(await page.locator(".clan-battle-bar").count(), 1);
        assert.equal(await page.locator(".clan-battle-play").count(), 1);
        assert.equal(await page.locator(".clan-battle-result").count(), 0);
        assert.deepEqual(errors, []);
        results.push({ browser: name, width, height, passed: true });
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
  fs.writeFileSync(path.join(artifacts, "verification.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: true, cases: results.length }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
