"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { once } = require("node:events");
const root = path.resolve(__dirname, "../..");
const output = path.resolve(process.env.HUD_OUTPUT || path.join(root, "../../artifacts/arena-hud-dom-stability"));
fs.mkdirSync(output, { recursive: true });
const req = require("node:module").createRequire(root + "/package.json");
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve(root, "../../.cache/browsers");
const pw = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const files = ["ui/boosters/shop-and-inventory-dialog.js", "ui/pets/pet-dialog.js", "ui/cosmetics/accessory-ability-ui.js", "game-client.js"];
const results = [];
async function run(engine, variant, repetition) {
  const f = req("./tests/helpers/black-friday-fixture")();
  f.command("stop", { runId: f.run.id });
  const start = Date.now(); let at = 0;
  f.time(start);
  const p = f.p();
  p.name = "HUD fixture";
  p.personal = { nameSet: true, introPending: false, gender: "male", vkUrl: "" };
  p.loginReward = { date: req("./src/server/accounts/account-benefits").loginRewardDay(start), day: 1 };
  p.alchemy = { version: 1, equipped: "strength", ingredients: {}, learned: ["strength"], natural: 0 };
  p.inventory.alchemy_strength = 5;
  const app = req("./src/server/game-server").createGameServer({ profiles: f.store, events: f.manager,
    arena: new (req("./src/server/arena/arena-simulation").Arena)({ etherCount: 0 }),
    now: () => at, wallNow: f.now, autoTick: false, testBots: { enabled: false } });
  let browser, tick;
  try {
    app.httpServer.listen(0, "127.0.0.1"); await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    tick = setInterval(() => { at += 50; f.time(start + at); app.tick(); }, 50);
    browser = await pw[engine].launch({ headless: true, ...(engine === "chromium" ? { channel: "chrome" } : {}) });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addCookies([{ name: "sferorumiya_session", value: f.user.token, url, httpOnly: true }]);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    if (variant === "before") for (const file of files) await page.route("**/" + file + "*", route =>
      route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(process.env.HUD_BASELINE, "public", file)) }));
    await page.addInitScript(() => {
      for (const [name, field] of [["KillexBoosterUI", "hud"], ["KillexPetsUI", "pets"], ["KillexAccessoryAbilityUI", "accessory"]]) {
        Object.defineProperty(window, name, { configurable: true, set(Base) {
          Object.defineProperty(window, name, { configurable: true, writable: true, value: class extends Base {
            constructor(...args) { super(...args); (window.__uis ||= {})[field] = this; }
          } });
        } });
      }
    });
    await page.goto(url); await page.waitForFunction(() => !window.KillexBoot?.active && window.__uis?.accessory);
    for (let i = 0; i < 8; i++) { await page.evaluate(() => { for (const d of document.querySelectorAll("dialog[open]")) d.close(); }); await page.waitForTimeout(100); }
    // Exercise real DOM components through transitions, without the game simulation
    // changing the synthetic state while the assertions inspect it.
    const transitions = await page.evaluate(async () => {
      const { hud, pets, accessory } = __uis, saved = { profile: hud.profile, game: hud.game, petOwner: pets.owner, accessoryOwner: accessory.owner };
      let me = { id: "hud-test", spawnSerial: 1 }, arena = true, blocked = false;
      const owner = { getMe: () => me, isArena: () => arena, inputBlocked: () => blocked };
      const check = (ok, message) => { if (!ok) throw Error(message); };
      const out = [];
      const observe = async (name, fn, nodes) => {
        fn(); await Promise.resolve();
        let records = 0;
        const observer = new MutationObserver(batch => records += batch.length);
        for (const node of nodes) observer.observe(node, { subtree: true, attributes: true, childList: true, characterData: true });
        for (let i = 0; i < 12; i++) { fn(); await Promise.resolve(); }
        observer.disconnect(); out.push({ name, stableMutations: records });
      };
      try {
        hud.game = owner; pets.owner = owner; accessory.owner = owner;
        hud.profile = { alchemy: { equipped: "strength" }, inventory: { alchemy_strength: 5 } };
        await observe("potion-ready", () => hud.updatePotion(me), [hud.potionButton]);
        check(!hud.potionButton.hidden && !hud.potionButton.disabled, "ready potion");
        blocked = true; hud.updatePotion(me); check(hud.potionButton.disabled, "blocked input"); blocked = false;
        hud.activations.set("alchemy_strength", {}); hud.updatePotion(me); check(hud.potionButton.disabled, "pending potion"); hud.activations.clear();
        me.potion = { id: "strength" }; hud.profile.inventory.alchemy_strength = 0;
        await observe("potion-active-last-item", () => hud.updatePotion(me), [hud.potionButton]);
        check(!hud.potionButton.hidden && hud.potionButton.disabled && hud.potionButton.textContent.includes("✓"), "active final potion remains visible");
        me = { id: "hud-test", spawnSerial: 2 };
        await observe("potion-empty-new-life", () => hud.updatePotion(me), [hud.potionButton]); check(hud.potionButton.hidden, "empty new life");
        hud.profile.inventory.alchemy_strength = 2; hud.updatePotion(me);
        check(!hud.potionButton.hidden && !hud.potionButton.disabled && hud.potionButton.textContent.includes("2"), "restocked new life");
        await observe("pets-absent", () => pets.updateArena(), [pets.hud, pets.fire, pets.secondary]);
        check(pets.hud.hidden && pets.fire.hidden && pets.secondary.hidden, "absent pet");
        for (const id of ["manya", "drakosha", "leva", "zaya"]) {
          me.pet = { id, level: 1, vitality: 100, active: true, nextGiftMs: 1000, thornMeals: 2, sequence: 0,
            stock: { fire: 2, claw: 2, glove: 2, carrot: 2 }, cooldowns: {} };
          await observe("pet-" + id, () => pets.updateArena(), [pets.hud, pets.fire, pets.secondary]);
          check(!pets.hud.hidden && !pets.secondary.hidden, "visible " + id);
          check(pets.fire.hidden === !["manya", "drakosha"].includes(id), "fire " + id);
          check(pets.thornCounter.hidden === !["leva", "zaya"].includes(id), "thorn " + id);
        }
        me.pet.cooldowns = { fire: 250, carrot: 250 }; pets.lastArenaPet = null;
        pets.updateArena(); check(pets.secondary.dataset.cooldown === "true", "pet cooldown starts");
        await new Promise(r => setTimeout(r, 300)); pets.updateArena();
        check(pets.secondary.cooldownOverlay.hidden && pets.secondary.dataset.cooldown === "false", "pet cooldown ends");
        me.dead = true; pets.updateArena(); check(pets.hud.hidden && pets.secondary.hidden, "dead pet HUD");
        delete me.dead; me.spawnSerial++; pets.updateArena(); check(!pets.hud.hidden, "new life pet HUD");
        await observe("accessory-absent", () => accessory.updateArena(), [accessory.button]); check(accessory.button.hidden, "absent accessory");
        const def = KillexAccessories.items.find(i => i.ability);
        check(def, "accessory fixture definition");
        me.accessoryAbilities = [{ accessoryId: def.id, count: 2 }];
        await observe("accessory-ready", () => accessory.updateArena(), [accessory.button]);
        check(!accessory.button.hidden && !accessory.button.disabled, "ready accessory");
        accessory.pending = {}; accessory.updateArena(); check(accessory.button.disabled, "pending accessory");
        accessory.pending = null; me.accessoryAbilities[0].count = 0; accessory.updateArena(); check(accessory.button.disabled, "empty accessory");
        me.dead = true; accessory.updateArena(); check(accessory.button.hidden, "dead accessory");
        delete me.dead; me.spawnSerial++; me.accessoryAbilities[0].count = 1; accessory.updateArena();
        check(!accessory.button.hidden && !accessory.button.disabled, "new life accessory");
        arena = false; pets.updateArena(); accessory.updateArena(); check(pets.hud.hidden && accessory.button.hidden, "lobby hides HUD");
      } finally {
        hud.profile = saved.profile; hud.game = saved.game; pets.owner = saved.petOwner; accessory.owner = saved.accessoryOwner;
        hud.updateQuick(); pets.updateArena(); accessory.updateArena();
      }
      return out;
    });
    if (variant === "after") for (const row of transitions) assert.equal(row.stableMutations, 0, engine + " " + row.name);
    await page.locator("#playButton").click();
    await page.waitForFunction(() => document.body.dataset.screen === "arena" && __uis.hud.game.getMe());
    await page.waitForTimeout(1000);
    const client = engine === "chromium" ? await context.newCDPSession(page) : null;
    if (client) await client.send("Performance.enable");
    const metrics = async () => client ? Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value])) : {};
    const samples = [];
    for (const potionVisible of [false, true]) {
    f.store.transact(f.user.token, require("node:crypto").randomUUID(), "hud-fixture-equip", draft => {
      draft.alchemy = { ...draft.alchemy, equipped: potionVisible ? "strength" : null };
    });
    await page.evaluate(visible => { __uis.hud.profile.alchemy.equipped = visible ? "strength" : null; __uis.hud.updateQuick(); }, potionVisible);
    await page.waitForTimeout(1000);
    const before = await metrics();
    const sample = await page.evaluate(async () => {
      let hiddenMutations = 0, syncs = 0, updates = 0;
      const counts = {}, hud = __uis.hud, original = hud.updateQuick;
      const stop = KillexActivity.every(() => {}, 1e9, () => { syncs++; return false; });
      const observer = new MutationObserver(batch => { for (const r of batch) {
        hiddenMutations++; const key = r.target.id || r.target.className; counts[key] = (counts[key] || 0) + 1;
      } });
      observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
      hud.updateQuick = function(...args) { updates++; return original.apply(this, args); };
      const begin = performance.now();
      let frames = 0;
      while (performance.now() - begin < 3000) { await new Promise(requestAnimationFrame); frames++; }
      const elapsedMs = performance.now() - begin;
      observer.disconnect(); stop(); hud.updateQuick = original;
      const scopeMutations = Object.entries(counts).filter(([key]) => /potionSlotZ|pet-arena-hud|pet-ability|accessory-ability|legacyNote/.test(key)).reduce((sum, [, count]) => sum + count, 0);
      return { frames, elapsedMs, hiddenMutations, scopeMutations, syncs, updates, counts };
    });
    const after = await metrics();
    const timings = Object.fromEntries(["RecalcStyleCount", "RecalcStyleDuration", "LayoutCount", "LayoutDuration", "TaskDuration", "ScriptDuration"].map(k => [k, client ? after[k] - before[k] : null]));
    if (variant === "after") assert.equal(sample.scopeMutations, 0, JSON.stringify(sample));
    samples.push({ potionVisible, sample, timings });
    }
    const inventory = f.p().inventory.alchemy_strength;
    await page.keyboard.press("z");
    await page.waitForFunction(() => __uis.hud.game.getMe()?.potion?.id === "strength");
    assert.equal(f.p().inventory.alchemy_strength, inventory - 1);
    assert.equal(await page.locator("#potionSlotZ").isDisabled(), true);
    await page.keyboard.press("z"); await page.waitForTimeout(200);
    assert.equal(f.p().inventory.alchemy_strength, inventory - 1, "duplicate Z must not consume again");
    assert.deepEqual(errors, []);
    const result = { engine, variant, repetition, transitions, samples, realZ: "consumed once", errors };
    results.push(result); fs.writeFileSync(path.join(output, "browser-progress.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ engine, variant, repetition, samples, realZ: result.realZ }));
  } finally { clearInterval(tick); if (browser) await browser.close(); await app.close(); }
}
(async () => {
  const engines = process.env.HUD_BROWSER ? [process.env.HUD_BROWSER] : ["chromium", "firefox", "webkit"];
  for (const engine of engines) {
    const pairs = Number(process.env.HUD_PAIRS || 1);
    for (let n = 0; n < pairs; n++) for (const variant of process.env.HUD_BASELINE ? (n % 2 ? ["after", "before"] : ["before", "after"]) : ["after"]) await run(engine, variant, n + 1);
  }
  fs.writeFileSync(path.join(output, "browser-results.json"), JSON.stringify(results, null, 2));
})().catch(e => { fs.writeFileSync(path.join(output, "failure-" + Date.now() + ".txt"), e.stack); console.error(e); process.exitCode = 1; });
