/* Браузерный сценарий: interface layout and styling. */
"use strict";
// Isolated world, fake Moscow clock. Never reads or writes the live profiles.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const playwright = require("playwright"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  { xpForLevel } = require("../../src/server/progression/experience-progression"),
  kit = require("../../public/shared/clan-crest-rules"),
  chests = require("../../src/server/clans/clan-chest-rewards");
const artifacts = path.resolve(__dirname, "../artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let at = Date.parse("2026-10-19T04:59:00Z");
const store = new ProfileStore({ now: () => at }),
  clans = new ClanService(store),
  heads = [];
const act = (u, action, extra = {}) =>
  clans.mutate(u.token, {
    action,
    clanId: store.find(u.token).clanId,
    requestId: randomUUID(),
    ...extra,
  });
function user(name) {
  const u = store.open(),
    p = store.find(u.token);
  p.level = 12;
  p.progress.xp = xpForLevel(12);
  p.wallet.coins = 10000;
  p.wallet.crystals = 1000; // Fixture funds the current paid clan appearance edits.
  p.name = name;
  return u;
}
for (let i = 0; i < 16; i++) {
  const u = user("Глава " + i);
  act(u, "create", {
    name:
      ["Аметистовые драконы", "Золотые львы", "Стражи рассвета", "Звёздный союз"][i % 4] + " " + i,
    prefix: "C" + i,
    emblem: "astral",
    crest: {
      ...kit.DEFAULT,
      frame:
        kit.requiredLevel(kit.frames[i % 10].id) > 1 ? kit.DEFAULT.frame : kit.frames[i % 10].id,
      color: kit.colors[i].id,
      symbol: kit.symbols[i].id,
    },
    privacy: "open",
  });
  if (kit.requiredLevel(kit.frames[i % 10].id) > 1) {
    const clan = store.data.clans[store.find(u.token).clanId];
    const { clanProgress } = require("../../src/server/clans/clan-level-progress");
    while (clanProgress(clan.xp).level < 10) clan.xp += clanProgress(clan.xp).nextLevelXp;
    act(u, "edit", { crest: { ...clan.crest, frame: kit.frames[i % 10].id } });
  }
  heads.push(u);
}
const clanId = store.find(heads[0].token).clanId;
const members = [heads[0]];
for (let i = 0; i < 9; i++) {
  const u = user("Воин " + i);
  act(u, "apply", { clanId });
  members.push(u);
}
act(heads[0], "role", { memberId: store.find(members[1].token).id, role: "manager" });
act(heads[0], "role", { memberId: store.find(members[2].token).id, role: "officer" });
at = Date.parse("2026-10-19T05:01:00Z");
store.refreshCompetition(at);
for (let i = 0; i < members.length; i++) {
  const p = store.find(members[i].token),
    lifeId = randomUUID();
  store.startLife(p.id, lifeId);
  for (let n = 0; n < 10 - i; n++)
    store.applyArenaProgress(
      randomUUID(),
      [{ type: "absorbed", profileId: p.id, victimProfileId: randomUUID(), gain: 1 }],
      at,
    );
  store.applyArenaProgress(
    randomUUID(),
    [{ type: "lifeEnded", profileId: p.id, lifeId, durationSeconds: 60, reason: "quit" }],
    at,
  );
}
const recruit = user("Новобранец");
act(recruit, "apply", { clanId });
const app = createGameServer({
  profiles: store,
  arena: new Arena({ etherCount: 0 }),
  autoTick: false,
  wallNow: () => at,
  rateNow: () => performance.now(),
});
let browser;
const errors = [];
async function loaded(page) {
  await page.waitForFunction(() => !document.getElementById("playButton").disabled);
}
async function clanOpen(page) {
  await page.locator("#clanSection").click();
  await page.waitForSelector("#clanDialog[open] .clan-banner");
}
async function images(page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll("dialog[open] img")].every(
      (x) => x.complete && x.naturalWidth > 0,
    ),
  );
}
async function fit(page, selector) {
  const box = await page.locator(selector).boundingBox(),
    v = page.viewportSize();
  assert.ok(
    box.x >= -1 &&
      box.y >= -1 &&
      box.x + box.width <= v.width + 1 &&
      box.y + box.height <= v.height + 1,
    selector + " outside viewport: " + JSON.stringify(box),
  );
  assert.equal(
    await page.locator(selector).evaluate((x) => x.scrollWidth > x.clientWidth + 2),
    false,
    "horizontal overflow " + selector,
  );
}
async function settled(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
async function noOuterScroll(page, selector) {
  await settled(page);
  await fit(page, selector);
  const overflow = await page
    .locator(selector)
    .evaluate((dialog) =>
      [dialog, ...dialog.querySelectorAll(".interface-content:not(.showcase-scroll)")]
        .filter((x) => x.scrollHeight > x.clientHeight + 3)
        .map((x) => ({ class: x.className, scroll: x.scrollHeight, height: x.clientHeight })),
    );
  if (overflow.length) {
    await page.screenshot({ path: path.join(artifacts, "window-overflow-debug.png") });
    console.log(
      await page.locator(selector).evaluate((d) =>
        [
          ...d.querySelectorAll(
            ".interface-content,.interface-page,.clan-content,.clan-home-grid,.clan-banner,.clan-battle-panel,.clan-home-actions",
          ),
        ].map((x) => ({
          cls: x.className,
          h: x.clientHeight,
          sh: x.scrollHeight,
          r: x.getBoundingClientRect().toJSON(),
          zoom: getComputedStyle(x).zoom,
        })),
      ),
    );
  }
  assert.deepEqual(overflow, [], "Outer overflow " + selector);
  const scrollers = await page
    .locator(selector)
    .evaluate((d) =>
      [d, ...d.querySelectorAll("*")]
        .filter(
          (x) =>
            x.getBoundingClientRect().height > 0 &&
            /auto|scroll/.test(getComputedStyle(x).overflowY) &&
            x.scrollHeight > x.clientHeight + 2 &&
            !x.matches(
              ".ranking-table,.clan-league-table,.clan-battle-member-list,.showcase-scroll,.career-milestones",
            ),
        )
        .map((x) => x.className),
    );
  assert.deepEqual(scrollers, [], "Unexpected scroll areas");
  const horizontal = await page
    .locator(selector)
    .evaluate((d) =>
      [...d.querySelectorAll(".interface-content")]
        .filter((x) => x.scrollWidth > x.clientWidth + 3)
        .map((x) => ({ class: x.className, width: x.clientWidth, scroll: x.scrollWidth })),
    );
  assert.deepEqual(horizontal, [], "Content is not clipped horizontally");
}
async function wheelShowcase(page, dialog) {
  const content = page.locator(dialog + " .showcase-scroll"),
    header = page.locator(dialog + " .interface-header");
  await content.evaluate((x) => {
    x.scrollTop = 0;
  });
  const before = await header.boundingBox();
  assert.equal(await content.evaluate((x) => getComputedStyle(x).scrollbarWidth), "none");
  await content.hover();
  await page.mouse.wheel(0, 550);
  await page.waitForFunction(
    (selector) => document.querySelector(selector).scrollTop > 50,
    dialog + " .showcase-scroll",
  );
  assert.deepEqual(await header.boundingBox(), before, "Header stays fixed during wheel scrolling");
  await page.mouse.wheel(0, -3000);
  await page.waitForFunction(
    (selector) => document.querySelector(selector).scrollTop === 0,
    dialog + " .showcase-scroll",
  );
}
async function boosterTooltip(page, card) {
  assert.equal(await card.locator(".booster-effect").count(), 0);
  await card.hover();
  const tip = page.locator("#boosterTooltip");
  await tip.waitFor({ state: "visible" });
  assert.ok((await tip.locator("p").textContent()).length > 10);
  await fit(page, "#boosterTooltip");
  await page.mouse.move(2, 2);
  await tip.waitFor({ state: "hidden" });
  await card.focus();
  await tip.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await tip.waitFor({ state: "hidden" });
}
(async () => {
  try {
    const hero = store.find(heads[0].token);
    hero.account = require("../../src/server/accounts/account-benefits").fresh();
    hero.account.vipUntil = hero.account.premiumUntil = at + 30 * 86400000;
    hero.greatness = 2400;
    hero.wallet.bucks = 500;
    hero.progress.bestAbsorptions = 12;
    hero.personal = { nameSet: true, gender: "male", vkUrl: "https://vk.com/test_player" };
    const established=require('../helpers/browser-established-profile');
    established.prepareProfile(store,heads[0]);
    hero.outfit = { hat: "novice_hat", bow: "novice_bow" };
    store.data.clans[clanId].treasury = 1000;
    store.data.clans[clanId].competition.medals = { bronze: 2, silver: 1 };
    const vip = store.find(members[1].token);
    vip.account = require("../../src/server/accounts/account-benefits").fresh();
    vip.account.vipUntil = at + 86400000;
    for (const item of require("../../src/server/boosters/booster-catalog").BOOSTERS.values())
      hero.inventory[item.id] = 50;
    for (let i = 0; i < 8; i++) chests.grant(hero, ["high", "medium", "low"][i % 3], at);
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    const engine=process.argv[2] || 'chromium';
    assert(['chromium','firefox','webkit'].includes(engine));
    browser = await playwright[engine].launch({ ...(engine==='chromium'?{channel:'chrome'}:{}),headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addCookies([{ name: "sferorumiya_session", value: heads[0].token, url }]);
    await established.prepareContext(context);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.stack));
    page.on("response", (r) => {
      if (r.url().includes("/assets/") && !r.ok()) errors.push(r.status() + " " + r.url());
    });
    await page.goto(url);
    await loaded(page);
    await established.clearInitialDialogs(page);
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#lobby img")]
        .filter((i) => i.getBoundingClientRect().width > 0)
        .every((i) => i.complete && i.naturalWidth),
    );
    assert.equal(await page.locator(".side-nav #rankingsButton").count(), 1);
    assert.equal(await page.locator("#accountButton").innerText(), "Статусы");
    const originalName = await page.locator("#previewName").innerText();
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1024, height: 768 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(100);
      const before = await page.locator("#walletStatus").boundingBox();
      for (const name of ["Я", "ШирокоеИмяИгрока"]) {
        await page
          .locator("#previewName")
          .evaluate((node, value) => (node.textContent = value), name);
        await page.waitForTimeout(60);
        const after = await page.locator("#walletStatus").boundingBox();
        assert.ok(
          Math.abs(after.x - before.x) < 1 && Math.abs(after.width - before.width) < 1,
          "Wallet remains fixed when nickname changes",
        );
      }
      await page
        .locator("#previewName")
        .evaluate((node, value) => (node.textContent = value), originalName);
      const menu = await page.locator(".side-nav").evaluate((n) => ({
        box: n.getBoundingClientRect().toJSON(),
        buttons: [...n.children].map((b) => b.getBoundingClientRect().toJSON()),
      }));
      assert.equal(menu.buttons.length, 12);
      assert.ok(
        menu.buttons.every(
          (b, i) =>
            b.bottom <= menu.box.bottom + 1 &&
            Math.abs(b.height - menu.buttons[0].height) < 1 &&
            menu.buttons.slice(0, i).every(previous =>
              b.left >= previous.right - 1 || previous.left >= b.right - 1 ||
              b.top >= previous.bottom - 1 || previous.top >= b.bottom - 1),
        ),
        "All twelve aligned menu buttons fit: " + JSON.stringify({ size, menu }),
      );
      if (size.width > 960 && size.height > 650) assert.ok(
        menu.box.top >= 0 && menu.box.bottom <= size.height + 1,
        "Side menu stays inside viewport: " + JSON.stringify({ size, menu }),
      );
      else {
        // Short/narrow lobbies intentionally scroll instead of squeezing the
        // touch targets. Every button must remain reachable by ordinary scroll.
        await page.locator('.side-nav > button').last().scrollIntoViewIfNeeded();
        const last=await page.locator('.side-nav > button').last().boundingBox();
        assert.ok(last.y>=-1 && last.y+last.height<=size.height+1,'Last menu action remains reachable');
        await page.evaluate(()=>window.scrollTo(0,0));
      }
      const cleanPreview = await page.addStyleTag({
        content: ".clan-reward-toast,.achievement-notice{visibility:hidden!important}",
      });
      await page.screenshot({
        path: path.join(artifacts, "lobby-menu-fixed-profile-" + size.width + ".png"),
      });
      await cleanPreview.evaluate((node) => node.remove());
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    assert.equal(
      await page.locator("body").evaluate((x) => x.classList.contains("account-premium")),
      true,
    );
    assert.equal(
      await page.locator("#profileMedal").evaluate((x) => x.getBoundingClientRect().width),
      52,
    );
    const animation = await page.locator("#xpFill").evaluate((x) => {
      const s = getComputedStyle(x, "::after");
      return {
        iterations: s.animationIterationCount,
        timing: s.animationTimingFunction,
        name: s.animationName,
      };
    });
    assert.deepEqual(animation, {
      iterations: "infinite",
      timing: "linear",
      name: "xp-spark-drift",
    });
    assert.equal(
      await page.locator("#xpFill").evaluate((x) => getComputedStyle(x, "::before").content),
      "none",
    );
    const accessoryLayers = await page.locator("#skinPreview").evaluate((x) => ({
      shine: Number(getComputedStyle(x, "::after").zIndex),
      accessories: [...x.querySelectorAll(".outfit-accessory")].map((a) =>
        Number(getComputedStyle(a).zIndex),
      ),
    }));
    assert.ok(accessoryLayers.accessories.every((z) => z > accessoryLayers.shine));
    await page.screenshot({ path: path.join(artifacts, "updated-lobby.png") });
    await page
      .locator(".profile-card")
      .screenshot({ path: path.join(artifacts, "vivid-account-profile.png") });
    await page.locator("#accountButton").click();
    await images(page);
    await page.screenshot({ path: path.join(artifacts, "vivid-account-plans.png") });
    await page.keyboard.press("Escape");
    await page.locator("#editProfile").click();
    await noOuterScroll(page, "#personalDialog");
    assert.equal(await page.locator("#profileVk").inputValue(), "https://vk.com/test_player");
    await page.getByRole("button", { name: "Женский", exact: true }).click();
    assert.equal(await page.locator('[data-gender="female"]').getAttribute("aria-pressed"), "true");
    await page.screenshot({ path: path.join(artifacts, "updated-personal.png") });
    await page.getByRole("button", { name: "Закрыть личные данные", exact: true }).click();
    await page.locator("#settingsButton").click();
    await page.locator("#musicVolume").press("Home");
    await page.locator("#soundVolume").press("Home");
    assert.equal(await page.locator("#musicVolume").inputValue(), "0");
    await page.screenshot({ path: path.join(artifacts, "updated-settings.png") });
    await page.reload();
    await loaded(page);
    await page.locator("#settingsButton").click();
    assert.equal(await page.locator("#soundVolume").inputValue(), "0");
    await page.locator("#closeSettings").click();
    await page.locator("#rankingsButton").click();
    await page.waitForSelector(".clan-ranking-player");
    await noOuterScroll(page, "#topsDialog");
    assert.equal(await page.locator(".clan-ranking-player .title-medal").count(), 0);
    const mine = page.locator('.clan-ranking-player[data-player-id="' + hero.id + '"]');
    assert.equal(await mine.locator('[data-account="premium"] .player-account-badge').count(), 1);
    await mine.click();
    await page.waitForSelector(".public-player-stats");
    await noOuterScroll(page, "#playerProfileDialog");
    assert.equal(await page.locator(".public-player-shelf .title-medal").count(), 1);
    // Public social controls now show marriage actions; the editable VK URL
    // was verified above in the private personal-data form.
    assert.equal(await page.locator('.public-player-social .public-player-name').textContent(),hero.name);
    await page.screenshot({ path: path.join(artifacts, "updated-public-profile.png") });
    await page.getByRole("button", { name: "Закрыть профиль игрока", exact: true }).click();
    await page.getByRole("button", { name: "Закрыть топы", exact: true }).click();
    await clanOpen(page);
    await images(page);
    await noOuterScroll(page, "#clanDialog");
    assert.equal(await page.locator("#clanTitle").textContent(), "Мой клан");
    const leagueMedals=page.locator('.clan-medal-shelf:not(.clan-trophy-shelf) .clan-league-medal');
    assert.equal(await leagueMedals.count(),6);
    assert.equal(await page.locator('.clan-trophy-shelf .clan-season-trophy').count(),6);
    const medalWidth=await leagueMedals.first().locator('img').evaluate(x=>x.clientWidth);
    assert(medalWidth>=30 && medalWidth<=64,'Responsive medal fits the two award shelves');
    assert.equal(
      await page
        .locator("#clanDialog .clan-heading")
        .evaluate((x) => getComputedStyle(x).borderTopColor),
      "rgb(193, 138, 37)",
    );
    assert.equal(await page.locator('.clan-medal-shelf:not(.clan-trophy-shelf) .clan-league-medal[data-earned="false"]').count(),4);
    assert.equal(await page.locator('[data-league="bronze"] .clan-medal-count').textContent(), "2");
    assert.equal(await page.locator(".clan-member-avatar .clan-role-icon").count(), 3);
    assert.equal(
      await page
        .locator('.clan-member-avatar[data-account="premium"] .player-account-badge')
        .count(),
      1,
    );
    assert.equal(
      await page.locator('.clan-member-avatar[data-account="vip"] .player-account-badge').count(),
      1,
    );
    assert.equal(
      await page
        .locator('.clan-member-avatar[data-account="vip"] .player-account-badge')
        .evaluate((x) => getComputedStyle(x).scale),
      "0.88",
    );
    for (const row of await page.locator(".clan-member:has(.clan-role-icon)").all()) {
      const avatar = await row.locator(".player-avatar").boundingBox(),
        role = await row.locator(".clan-role-icon").boundingBox();
      assert.ok(role.x < avatar.x && role.y < avatar.y, "Role is above-left of avatar");
    }
    assert.equal(await page.locator("#clanDialog .clan-deposit").count(), 0);
    await page.screenshot({ path: path.join(artifacts, "updated-clan-fullscreen.png") });
    assert.equal(
      await page.locator(".clan-battle-panel").evaluate((x) => x.scrollHeight > x.clientHeight + 2),
      false,
      "Battle contents fit their panel",
    );
    await page.screenshot({ path: path.join(artifacts, "updated-clan-fullscreen.png") });
    await page.getByRole("button", { name: "Казна и склад", exact: true }).click();
    await noOuterScroll(page, "#clanDialog");
    assert.equal(await page.locator(".clan-deposit button").count(), 5);
    assert.equal(await page.locator(".clan-battle-layout").count(), 0);
    const before = store.find(heads[0].token).wallet.bucks;
    const deposited=page.waitForResponse(r=>r.url().endsWith('/api/clans/action') && r.request().method()==='POST');
    await page.locator('[data-deposit="1"]').click();
    assert.equal((await deposited).status(),200);
    await page.waitForFunction(expected=>document.querySelector('#clanDialog .clan-deposit-balance')?.textContent
      .includes(expected.toLocaleString('ru-RU')),before-1);
    assert.equal(store.find(heads[0].token).wallet.bucks, before - 1);
    await page.screenshot({ path: path.join(artifacts, "updated-clan-armory.png") });
    assert.equal(await page.locator(".clan-shop-item").count(), 7);
    await boosterTooltip(page, page.locator(".clan-shop-item").first());
    await wheelShowcase(page, "#clanDialog");
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1024, height: 768 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(size);
      await noOuterScroll(page, "#clanDialog");
      await page.getByRole("button", { name: "Мой клан", exact: true }).click();
      await noOuterScroll(page, "#clanDialog");
      await page.screenshot({ path: path.join(artifacts, "updated-clan-" + size.width + ".png") });
      const panel = await page.locator(".clan-battle-panel").evaluate((x) => ({
        height: x.clientHeight,
        scroll: x.scrollHeight,
        children: [...x.children].map((c) => ({
          cls: c.className,
          h: c.getBoundingClientRect().height,
        })),
      }));
      assert.ok(
        panel.scroll <= panel.height + 2,
        "Battle panel at " + size.width + ": " + JSON.stringify(panel),
      );
      await page.getByRole("button", { name: "Казна и склад", exact: true }).click();
      await page.screenshot({
        path: path.join(artifacts, "updated-clan-armory-" + size.width + ".png"),
      });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.getByRole("button", { name: "Закрыть кланы", exact: true }).click();
    for (const [trigger, dialog] of [
      ["shopSection", "boosterDialog"],
      ["inventorySection", "boosterDialog"],
      ["wardrobeSection", "skinsDialog"],
      ["achievementsButton", "achievementsDialog"],
      ["accountButton", "accountDialog"],
    ]) {
      await page.locator("#" + trigger).click();
      await noOuterScroll(page, "#" + dialog);
      await page.screenshot({
        path: path.join(artifacts, "updated-" + dialog + "-" + trigger + ".png"),
      });
      if (trigger === "shopSection") {
        await boosterTooltip(page, page.locator(".booster-card").first());
        assert.equal(await page.locator('#boosterDialog .shop-categories').isVisible(),true);
        assert.equal(await page.locator(".booster-card:visible").count(), 22);
        assert.equal(await page.locator('.booster-card [data-tier="clan"]').count(), 0);
        assert.equal(await page.locator('#boosterDialog').getByRole('button',{name:'Клановые',exact:true}).count(),0);
        await wheelShowcase(page, "#boosterDialog");
      }
      if (trigger === "inventorySection") {
        await boosterTooltip(page, page.locator(".booster-card").first());
        assert.equal(await page.locator('.booster-card [data-tier="clan"]').count(), 7);
        await wheelShowcase(page, "#boosterDialog");
        await page.getByRole("button", { name: "Сундуки", exact: true }).click();
        await wheelShowcase(page, "#boosterDialog");
        await page.getByRole("button", { name: "Сокровищница", exact: true }).click();
        await wheelShowcase(page, "#boosterDialog");
      }
      if (trigger === "achievementsButton") {
        assert.equal(await page.locator(".achievement-card").count(), 28);
        assert.ok((await page.locator("#achievementsDialog").boundingBox()).width > 1300);
        const grid = await page.locator(".achievement-grid").boundingBox();
        for (const card of await page.locator(".achievement-card").all()) {
          await card.hover();
          await settled(page);
          const current = await page.locator(".achievement-grid").boundingBox();
          assert.ok(
            Math.abs(current.y - grid.y) < 2 && Math.abs(current.height - grid.height) < 2,
            "Achievement grid stays in place when choosing a card",
          );
        }
        await page.screenshot({
          path: path.join(artifacts, "updated-achievementsDialog-achievementsButton.png"),
        });
        await page.setViewportSize({ width: 1920, height: 1080 });
        await noOuterScroll(page, "#achievementsDialog");
        await page.screenshot({ path: path.join(artifacts, "updated-achievements-1920.png") });
        await page.setViewportSize({ width: 1366, height: 768 });
      }
      await page.setViewportSize({ width: 844, height: 390 });
      await noOuterScroll(page, "#" + dialog);
      await page.setViewportSize({ width: 1366, height: 768 });
      // A hovered item tooltip may legitimately consume the first Escape.
      await page.locator('#'+dialog).getByRole('button',{name:/^Закрыть/}).first().click();
      await page.locator('#'+dialog).waitFor({state:'hidden'});
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS: mouse-wheel scrolling without rails in all four showcases, clan medals and role/account badges, clan boosters only in inventory/armory, enlarged achievements, 1366/1024/844 layouts, audio/VK, continuous XP.",
    );
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
