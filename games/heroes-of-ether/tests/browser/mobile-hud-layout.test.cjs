"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const pw = require("playwright");
const fixture = require("../helpers/black-friday-fixture")();
fixture.command("stop", { runId: fixture.run.id });
const profile = fixture.store.find(fixture.user.token);
profile.name = "Арден";
profile.personal = { nameSet: true, introPending: false, gender: "male", vkUrl: "" };
profile.level = 30;
profile.progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(30);
profile.wallet.coins = 100000;
profile.inventory.candy = 10;
profile.inventory.freeze = 10;
profile.quickSlots = ["candy", "freeze"];
profile.loginReward = {
  date: require("../../src/server/accounts/account-benefits").loginRewardDay(fixture.now()), day: 1,
};
const engine = process.argv[2] || "chromium";
const artifacts = process.env.KILLEX_TEST_ARTIFACTS || path.join(__dirname, "../artifacts/mobile-hud");
fs.mkdirSync(artifacts, { recursive: true });
const report = { engine, errors: [], missing: [], checks: [] };
const app = require("../../src/server/game-server").createGameServer({
  profiles: fixture.store, events: fixture.manager, autoTick: false,
  testBots: { enabled: false }, wallNow: fixture.now,
});
let browser;
let heartbeat;
const wait = async predicate => {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail("Authoritative arena action timed out");
};
const closeDialogs = page => page.evaluate(() => {
  for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
});
async function boot(page, url) {
  page.on("pageerror", error => report.errors.push(error.message));
  page.on("response", response => {
    if (response.status() === 404) report.missing.push(response.url());
  });
  await page.addInitScript(() => {
    document.addEventListener("killex:profile", event => window.__testProfile = event.detail);
  });
  await page.goto(url);
  await page.waitForFunction(() => !document.getElementById("playButton").disabled);
  for (let i = 0; i < 12; i++) {
    if (await page.locator("#releaseNotesDialog[open]").count()) {
      const state = await page.evaluate(() => ({ boot: window.KillexBoot.active, screen: document.body.dataset.screen,
        required: !!document.querySelector('dialog[data-required="true"]') }));
      assert.deepEqual(state, { boot: false, screen: "lobby", required: false });
      report.releaseFirstOpen = true;
    }
    await page.evaluate(() => {
      for (const dialog of document.querySelectorAll("dialog[open]")) {
        const button = [...dialog.querySelectorAll("button")].find(b => b.textContent.trim() === "Отлично");
        if (button) button.click(); else dialog.close();
      }
    });
    await page.waitForTimeout(60);
  }
}
async function objectives(page, progress = 3, expired = false) {
  await page.evaluate(({ progress, expired }) => {
    const now = Date.now();
    const expiresAt = now + (expired ? -1 : 600000);
    document.dispatchEvent(new CustomEvent("killex:arena-profile", { detail: {
      ...window.__testProfile,
      arenaObjectives: {
        serverTime: now,
        daily: { description: "Соберите еду на арене", progress, target: 10, metric: "food", reward: "small", expiresAt },
        event: { description: "Продержитесь на арене", progress: progress * 5, target: 120, metric: "survival",
          reward: 10, icon: "assets/events/black-friday/order-timer.webp", name: "Заказ", expiresAt },
      },
    } }));
  }, { progress, expired });
}
async function checkHud(page, label) {
  await page.waitForFunction(() => document.querySelector(".leaderboard").dataset.mobilePanel === "true");
  // Fill every visible place to check the full HUD, even in this one-player room.
  await page.evaluate(() => {
    const list = document.getElementById("leaderList");
    while (list.children.length < 10 && list.firstElementChild) list.append(list.firstElementChild.cloneNode(true));
    const clans = document.getElementById("arenaClanList");
    clans.replaceChildren(...Array.from({ length: 5 }, (_, i) => {
      const row = document.createElement("div");
      row.className = "arena-clan-row";
      const rank = document.createElement("span"), name = document.createElement("span");
      name.className = "leader-name";
      rank.textContent = i + 1; name.textContent = "Стражи рассвета";
      row.append(rank, name);
      return row;
    }));
  });
  const top = page.locator(".leaderboard .arena-panel-toggle");
  const quests = page.locator("#arenaObjectives .arena-panel-toggle");
  await objectives(page);
  assert.equal(await top.getAttribute("aria-expanded"), "false");
  assert.equal(await quests.getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator("#leaderList").isVisible(), false);
  assert.equal(await page.locator("#arenaDailyObjective").isVisible(), false);
  const topBounds = await top.boundingBox();
  const questBounds = await quests.boundingBox();
  assert(topBounds.height >= 44 && questBounds.height >= 44, "Touch targets");
  assert(questBounds.y >= topBounds.y + topBounds.height, "Collapsed controls do not overlap");
  await page.screenshot({ path: path.join(artifacts, engine + "-" + label + "-collapsed.png") });
  await quests.click();
  // Entry may finish a real profile refresh after the first snapshot. Reapply the
  // deterministic objective fixture after the disclosure click before inspecting it.
  await objectives(page);
  assert.equal(await page.locator("#arenaDailyObjective").isVisible(), true);
  assert.equal(await page.locator("#arenaEventObjective").isVisible(), true);
  assert.equal(await top.getAttribute("aria-expanded"), "false", "Independent panels");
  await quests.click();
  await objectives(page, 9);
  await quests.click();
  assert.equal(await page.locator("#arenaDailyObjective b").textContent(), "9 / 10");
  assert.equal(await page.locator("#arenaEventObjective b").textContent(), "0:45 / 2:00");
  await top.click();
  assert.equal(await page.locator("#leaderList").isVisible(), true);
  assert.equal(await page.locator("#arenaClanList").isVisible(), true);
  await page.screenshot({ path: path.join(artifacts, engine + "-" + label + "-expanded.png") });
  const all = await page.locator(".leaderboard, #arenaObjectives").evaluateAll(nodes =>
    nodes.map(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }));
  for (const bounds of all) assert(bounds.left >= 0 && bounds.right <= page.viewportSize().width + 1, "HUD inside screen");
  await top.focus();
  const partsBefore = [...app.rooms.values()].flatMap(r => [...r.arena.players.values()])
    .find(p => p.profileId === profile.id)?.parts?.length;
  await page.keyboard.press("Space");
  assert.equal(await top.getAttribute("aria-expanded"), "false", "Keyboard disclosure");
  assert.equal([...app.rooms.values()].flatMap(r => [...r.arena.players.values()])
    .find(p => p.profileId === profile.id)?.parts?.length, partsBefore, "Space did not split player");
  await quests.click();
  await objectives(page, 9, true);
  assert.equal(await page.locator("#arenaObjectives").isVisible(), false, "No empty objectives button");
  await objectives(page, 10);
  await quests.click();
  assert.equal(await page.locator("#arenaDailyObjective b").textContent(), "Готово");
  await quests.click();
  report.checks.push({ case: label + " HUD", topBounds, questBounds, expanded: all });
}
async function checkActions(page) {
  const received = [];
  for (const ws of app.wss.clients) ws.on("message", raw => {
    try { const m = JSON.parse(raw); if (["split", "feed", "useBooster", "stop"].includes(m.type)) received.push(m); } catch (_) {}
  });
  await page.evaluate(() => {
    window.__touchTrace = [];
    for (const type of ["pointerdown", "pointerup", "pointercancel", "lostpointercapture", "click"])
      document.addEventListener(type, e => window.__touchTrace.push({ type, id: e.pointerId, pointer: e.pointerType,
        primary: e.isPrimary, target: e.target.id || e.target.className, x: e.clientX, y: e.clientY }), true);
  });
  const room = [...app.rooms.values()].find(r => [...r.arena.players.values()].some(p => p.profileId === profile.id && !p.dead));
  const arena = room.arena;
  const player = [...arena.players.values()].find(p => p.profileId === profile.id && !p.dead);
  Object.assign(player, { mass: 200, radius: require("../../src/server/arena/arena-simulation").radiusForMass(200),
    x: 1200, y: 800, targetX: 1200, targetY: 800, protectedUntil: 0 });
  app.broadcast();
  heartbeat = setInterval(() => { arena.moveFeed(performance.now()); app.broadcast(); }, 50);
  await page.waitForFunction(() => !document.getElementById("arenaSplitButton").disabled);
  await page.locator("#arenaSplitButton").tap();
  await wait(() => player.parts?.length === 2);
  await page.waitForTimeout(250);
  assert.equal(player.parts.length, 2, "One tap splits exactly once");
  player.parts.forEach((part, i) => { part.x = 1200; part.y = 700 + 200 * i; part.vx = part.vy = 0; });
  arena.syncParts(player);
  app.broadcast();
  const foodBefore = arena.ether.length;
  await page.locator("#arenaFeedButton").tap();
  await wait(() => arena.ether.length === foodBefore + 2);
  await page.waitForTimeout(250);
  assert.equal(arena.ether.length, foodBefore + 2, "One feed tap fires once from each part");

  const center = async selector => {
    const r = await page.locator(selector).boundingBox();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const points = new Map();
  const cdp = engine === "chromium" ? await page.context().newCDPSession(page) : null;
  const down = async (selector, id, point) => {
    points.set(id, { id, ...point, selector });
    if (cdp) await cdp.send("Input.dispatchTouchEvent", { type: "touchStart",
      touchPoints: [...points.values()].map(({ id, x, y }) => ({ id, x, y })) });
    else await page.locator(selector).dispatchEvent("pointerdown", {
      pointerType: "touch", pointerId: id, isPrimary: id === 1, button: 0, buttons: 1,
      clientX: point.x, clientY: point.y,
    });
  };
  const up = async (id, cancel = false) => {
    const point = points.get(id);
    points.delete(id);
    if (cdp) await cdp.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: cancel ? [] : [{ id, x: point.x, y: point.y }] });
    else await page.locator(point.selector).dispatchEvent(cancel ? "pointercancel" : "pointerup", {
      pointerType: "touch", pointerId: id, isPrimary: id === 1, button: 0, buttons: 0,
      clientX: point.x, clientY: point.y,
    });
  };
  const stick = await center("#joystick");
  stick.x -= 26;
  await down("#joystick", 1, stick);
  await wait(() => player.targetX < player.x);
  const candy = '.booster-quick [data-slot="1"]', freeze = '.booster-quick [data-slot="2"]';
  await page.waitForFunction(() => !document.querySelector('.booster-quick [data-slot="1"]').disabled);
  const inventory = () => fixture.store.byId(profile.id).inventory;
  const oldCandy = inventory().candy;
  await down(candy, 2, await center(candy));
  await up(2);
  try { await wait(() => inventory().candy === oldCandy - 1); } catch (error) {
    report.boosterFailure = { oldCandy, current: inventory().candy, received,
      dom: await page.evaluate(() => ({ events: window.__touchTrace, slot: document.querySelector('.booster-quick [data-slot="1"]').outerHTML,
        message: document.querySelector(".booster-arena-message").textContent })) };
    throw error;
  }
  await page.waitForTimeout(250);
  assert.equal(inventory().candy, oldCandy - 1, "Second finger uses booster exactly once");
  assert(player.targetX < player.x, "Steering survives booster");
  const oldFreeze = inventory().freeze;
  await down(freeze, 3, await center(freeze));
  await up(3);
  await wait(() => inventory().freeze === oldFreeze - 1);
  assert.equal(await page.locator(".booster-cancel").isVisible(), false, "Joystick supplies projectile direction");
  assert(player.targetX < player.x, "Steering survives directional booster");
  const startFeed = arena.ether.length;
  await down("#arenaFeedButton", 4, await center("#arenaFeedButton"));
  await page.waitForTimeout(650);
  assert(arena.ether.length >= startFeed + 6, "Held feeding with steering");
  assert(arena.ether.slice(startFeed).every(food => food.vx < 0), "Food follows joystick left");
  await up(1);
  const afterSteering = arena.ether.length;
  await wait(() => arena.ether.length >= afterSteering + 4);
  assert(arena.ether.length >= afterSteering + 4, "Releasing steering does not release held food");
  await up(4);
  await page.waitForTimeout(60);
  const released = arena.ether.length;
  await page.waitForTimeout(300);
  assert.equal(arena.ether.length, released, "Release stops repeat");
  await down("#arenaFeedButton", 5, await center("#arenaFeedButton"));
  await page.waitForTimeout(100);
  await up(5, true);
  await page.waitForTimeout(60);
  const cancelled = arena.ether.length;
  await page.waitForTimeout(300);
  assert.equal(arena.ether.length, cancelled, "Pointer cancellation stops repeat");
  await down("#arenaFeedButton", 6, await center("#arenaFeedButton"));
  await page.waitForTimeout(100);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(60);
  const blurred = arena.ether.length;
  await page.waitForTimeout(300);
  assert.equal(arena.ether.length, blurred, "Blur stops repeat");
  await up(6);

  // Existing desktop bindings remain single actions too.
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.waitForFunction(() => document.getElementById("arenaTouchControls").hidden);
  await page.locator("#game").focus();
  const oldParts = player.parts.length;
  await page.keyboard.press("Space");
  await wait(() => player.parts.length === oldParts * 2);
  const keyboardFood = arena.ether.length;
  await page.keyboard.press("KeyW");
  await wait(() => arena.ether.length === keyboardFood + player.parts.length);
  report.checks.push({ case: "touch actions, concurrent steering, single debit, desktop keys", nativeMultitouch: !!cdp,
    splitParts: player.parts.length, candyUsed: oldCandy - inventory().candy, freezeUsed: oldFreeze - inventory().freeze });
  await cdp?.detach();
  clearInterval(heartbeat); heartbeat = null;
}
(async () => {
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const url = "http://127.0.0.1:" + app.httpServer.address().port;
  browser = await pw[engine].launch({ headless: true,
    ...(engine === "chromium" ? { channel: process.env.KILLEX_BROWSER_CHANNEL || "chrome" } : {}),
    ...(process.env.KILLEX_BROWSER_EXECUTABLE ? { executablePath: process.env.KILLEX_BROWSER_EXECUTABLE } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addCookies([{ name: "sferorumiya_session", value: fixture.user.token, url }]);
  const page = await context.newPage();
  await boot(page, url);
  assert.equal(report.releaseFirstOpen, true, "New release announced after boot");
  for (const size of [{ width: 1366, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 667 },
    { width: 844, height: 390 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(size);
    await page.locator("#newsSection").click();
    await page.locator('.news-tabs [data-category="release"]').click();
    await page.locator("#releaseNotesDialog[open]").waitFor();
    const notice = await page.locator("#releaseNotesDialog").evaluate(d => {
      const rect = d.getBoundingClientRect(), version = d.querySelector(".release-notes-version").getBoundingClientRect();
      return { scroll: d.scrollHeight - d.clientHeight, top: rect.top, bottom: rect.bottom,
        version: d.querySelector(".release-notes-version").textContent, last: version.bottom <= rect.bottom };
    });
    assert.equal(notice.version, await page.evaluate(() => window.KillexRelease.version));
    assert.match(notice.version, /^Alfa-test \d+\.\d+\.\d+$/);
    assert(notice.scroll <= 1 && notice.top >= 0 && notice.bottom <= size.height && notice.last,
      "Release notice fits: " + JSON.stringify({ size, notice }));
    await page.locator("#releaseNotesDialog").screenshot({ path: path.join(artifacts, engine + "-release-" + size.width + ".png") });
    await page.locator("#releaseNotesDialog").getByRole("button", { name: "Понятно", exact: true }).click();
  }
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("playButton").disabled && !window.KillexBoot.active);
  await page.waitForTimeout(150);
  assert.equal(await page.locator("#releaseNotesDialog[open]").count(), 0, "Seen release not repeated after reload");
  assert.equal(await page.locator(".lobby-foot").textContent(),
    "Герои Эфира · " + await page.evaluate(() => window.KillexRelease.version));
  report.checks.push({ case: "release notice once, settings replay, five viewports" });
  const titles = [["novice", "Новичок"], ["experienced", "Опытный"], ["expert", "Знаток"], ["sage", "Мудрец"],
    ["master", "Мастер"], ["pro", "Профи"], ["prince", "Принц"], ["king", "Король"], ["emperor", "Император"], ["boss", "Герой"]];
  for (const size of [{ width: 1366, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    for (const [id, name] of titles) {
      await page.evaluate(({ id, name }) => {
        const dialog = document.getElementById("titleEarnedDialog");
        dialog.dataset.titleId = id;
        dialog.querySelector(".title-earned-name").textContent = name;
        window.KillexWindows.open(dialog);
      }, { id, name });
      await page.locator("#titleEarnedDialog").getByRole("button", { name: "Поделиться", exact: true }).click();
      await page.waitForFunction(() => {
        const img = document.querySelector(".title-share-picture img");
        return img?.complete && img.naturalWidth === 768;
      });
      const card = await page.locator(".title-share-dialog").evaluate(dialog => {
        const img = dialog.querySelector("img"), r = img.getBoundingClientRect(), d = dialog.getBoundingClientRect();
        return { source: img.getAttribute("src"), w: r.width, h: r.height, objectFit: getComputedStyle(img).objectFit,
          scroll: dialog.scrollHeight - dialog.clientHeight, bottom: d.bottom, top: d.top };
      });
      assert.equal(card.source, "assets/title-share/v1/" + id + ".png");
      assert(Math.abs(card.w - card.h) < 1, "Square artwork preserved");
      assert.equal(card.objectFit, "contain");
      if (!(card.scroll <= 1 && card.bottom <= size.height && card.top >= 0)) {
        report.badCard = { id, size, card, html: await page.locator(".title-share-dialog").evaluate(e => e.outerHTML) };
        await page.screenshot({ path: path.join(artifacts, engine + "-bad-share.png") });
      }
      assert(card.scroll <= 1 && card.bottom <= size.height && card.top >= 0, "Share fits without internal scrolling");
      if (id === "novice" || id === "boss")
        await page.locator(".title-share-dialog").screenshot({ path: path.join(artifacts, engine + "-vk-" + id + "-" + size.width + ".png") });
      await page.locator(".title-share-dialog").getByRole("button", { name: "Закрыть", exact: true }).click();
      await closeDialogs(page);
    }
    report.checks.push({ case: "ten supplied VK cards", size });
  }

  // Exercise the real rankings renderer with deterministic API fixture rows.
  let member = true;
  await page.route("**/api/clans?*", async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.clans = Array.from({ length: 10 }, (_, i) => ({
      id: "layout-clan-" + i, rank: i + 1, prefix: "ЛЕС", name: "Стражи изумрудной рощи",
      emblem: "lion", progress: { level: i + 1 }, greatness: 2502156 - i, treasury: 5000,
      privacy: i % 2 ? "open" : "closed", count: 5, capacity: 15,
    }));
    data.page = 1; data.pages = 3; data.applications = [];
    data.mine = member ? { id: "layout-member" } : null;
    await route.fulfill({ response, json: data });
  });
  for (const width of [1366, 974, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (member of [true, false]) {
      await closeDialogs(page);
      await page.locator("#rankingsButton").click();
      await page.locator("#topsDialog").getByRole("button", { name: "Топ кланов", exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll(".ranking-clans-table .clan-ranking-row").length === 10);
      const order = page.locator("#topsDialog .tops-sort").getByRole("button", { name: member ? "Уровень" : "Величие", exact: true });
      await order.click();
      await page.waitForFunction(expected => document.querySelectorAll(".ranking-clans-table .clan-join").length === expected, member ? 0 : 10);
      const geometry = await page.locator("#topsDialog").evaluate(dialog => {
        const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
        const rows = [...dialog.querySelectorAll(".clan-ranking-row")];
        const table = dialog.querySelector(".ranking-clans-table");
        return { outer: rect(dialog), table: rect(table), scroll: [table.clientHeight, table.scrollHeight],
          gaps: rows.map(row => rect(row).right - rect(row.lastElementChild).right), last: rect(rows.at(-1)) };
      });
      for (const gap of geometry.gaps) assert(gap <= 12 && gap >= 0, "No reserved empty column: " + gap);
      assert(geometry.last.bottom <= geometry.table.bottom + 1, "Ten clans fit");
      assert(geometry.scroll[1] <= geometry.scroll[0] + 1, "No clan list scrolling");
      if (process.env.KILLEX_UI_BEFORE) {
        const old = await page.addStyleTag({ content: fs.readFileSync(path.join(process.env.KILLEX_UI_BEFORE, "public/styles/components/clan-and-ranking-details.css"), "utf8") });
        const oldBounds = await page.locator("#topsDialog").boundingBox();
        for (const key of ["x", "y", "width", "height"]) assert(Math.abs(oldBounds[key] - geometry.outer[key]) < 1, "Outer window unchanged: " + key);
        await old.evaluate(e => e.remove());
      }
      await page.locator("#topsDialog").screenshot({ path: path.join(artifacts, engine + "-clans-" + width + "-" + (member ? "member" : "join") + ".png") });
      report.checks.push({ case: "clans", width, member, geometry });
    }
  }
  await closeDialogs(page);
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.KillexAppearance.open("profileBackground"));
    await page.locator("#appearanceDialog[open]").waitFor();
    const backgrounds = await page.locator("#appearanceDialog .appearance-preview.has-league-background").evaluateAll(nodes => nodes.map(n => ({
      theme: n.dataset.leagueBackground, size: getComputedStyle(n).backgroundSize, scene: n.classList.contains("has-scene-background"),
    })));
    for (const b of backgrounds) assert.equal(b.size, b.scene ? "cover" : "100% 100%", b.theme);
    assert.equal(backgrounds.filter(b => b.scene).length, 4);
    await page.locator("#appearanceDialog").screenshot({ path: path.join(artifacts, engine + "-backgrounds-" + width + ".png") });
    await closeDialogs(page);
    const icons = await page.locator("#petsSection .menu-icon, #clanSection .menu-icon").evaluateAll(nodes => nodes.map(n => ({
      pet: !!n.closest("#petsSection"), width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height,
    })));
    const pet = icons.find(i => i.pet), clan = icons.find(i => !i.pet);
    assert(Math.abs(pet.width * (156 / 256) - clan.width * (106 / 128)) < 3, "Visible paw matches adjacent icon");
    await page.locator(".side-nav").screenshot({ path: path.join(artifacts, engine + "-menu-" + width + ".png") });
    report.checks.push({ case: "backgrounds and icons", width, backgrounds, icons });
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.locator("#playButton").click();
  await page.waitForFunction(() => document.body.dataset.screen === "arena");
  await objectives(page);
  assert.equal(await page.locator(".leaderboard .arena-panel-toggle").isVisible(), false);
  assert.equal(await page.locator("#arenaDailyObjective").isVisible(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await checkHud(page, "portrait");
  await page.setViewportSize({ width: 390, height: 667 });
  await checkHud(page, "short-portrait");
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.waitForFunction(() => document.querySelector(".leaderboard").dataset.mobilePanel === "false");
  assert.equal(await page.locator(".leaderboard .arena-panel-toggle").isVisible(), false);
  assert.equal(await page.locator("#arenaDailyObjective").isVisible(), true);
  assert.equal(await page.locator("#leaderList").isVisible(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector(".leaderboard").dataset.mobilePanel === "true");
  assert.equal(await page.locator(".leaderboard .arena-panel-toggle").getAttribute("aria-expanded"), "false");
  await page.locator("#leaveButton").click();
  await page.locator("#leaveYes").click();
  await page.locator("#lifeLobby").click();
  await page.waitForFunction(() => document.body.dataset.screen === "lobby");
  await context.close();

  const touch = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
  await touch.addCookies([{ name: "sferorumiya_session", value: fixture.user.token, url }]);
  const landscape = await touch.newPage();
  await boot(landscape, url);
  await landscape.locator("#playButton").click();
  await landscape.waitForFunction(() => document.body.dataset.screen === "arena");
  await checkHud(landscape, "touch-landscape");
  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 667 }, { width: 667, height: 375 }, { width: 844, height: 390 }]) {
    await landscape.setViewportSize(size);
    await landscape.waitForTimeout(100);
    const layout = await landscape.locator("#arenaSplitButton, #arenaFeedButton, #joystick, #massPanel, .booster-quick").evaluateAll(nodes => nodes.map(n => {
      const r = n.getBoundingClientRect(); return { id: n.id || n.className, x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    }));
    const actions = layout.filter(r => ["arenaSplitButton", "arenaFeedButton"].includes(r.id));
    report.latestTouchLayout = { size, layout };
    await landscape.screenshot({ path: path.join(artifacts, engine + "-touch-buttons-" + size.width + ".png") });
    for (const a of actions) {
      assert(a.height >= 44 && a.width >= 44, "Action touch target");
      assert(a.x >= 0 && a.right <= size.width && a.bottom <= size.height, "Action on screen");
      for (const b of layout.filter(r => !actions.includes(r)))
        assert(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y, "Action overlaps " + b.id + " at " + size.width);
    }
    await landscape.screenshot({ path: path.join(artifacts, engine + "-touch-buttons-" + size.width + ".png") });
    report.checks.push({ case: "touch button layout", size, layout });
  }
  await checkActions(landscape);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.missing, []);
  report.passed = true;
})().catch(error => {
  report.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  fs.writeFileSync(path.join(artifacts, engine + "-mobile-layout.json"), JSON.stringify(report, null, 2));
  clearInterval(heartbeat);
  await browser?.close();
  await app.close();
  console.log(JSON.stringify({ engine, passed: !!report.passed, checks: report.checks.length }));
});
