"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { chromium } = require("playwright"),
  { setup } = require("../fixtures/season-trophies"),
  { createGameServer } = require("../../src/server/game-server");
const f = setup({ count: 10, start: "2026-10-19T04:59:00Z" }),
  head = f.heads[0],
  clanId = f.c(head).id;
const members = [head];
for (let i = 0; i < 10; i++) {
  const u = f.user();
  f.act(u, "apply", { clanId });
  members.push(u);
}
f.time("2026-10-19T05:01:00Z");
f.profiles.refreshCompetition();
const day = f.profiles.data.competition.day,
  pair = day.pairs.find((p) => p.a === clanId || p.b === clanId),
  enemyId = pair.a === clanId ? pair.b : pair.a;
day.scores[clanId] = {
  kills: 55,
  members: Object.fromEntries(
    members
      .slice(0, 10)
      .map((u, i) => [
        f.p(u).id,
        { joinedAt: f.c(head).competition.joined[f.p(u).id] || 0, kills: 10 - i },
      ]),
  ),
};
day.scores[enemyId] = { kills: 60, members: {} };
const artifacts = path.resolve(__dirname, "../artifacts/clan-reward-row-colors");
fs.mkdirSync(artifacts, { recursive: true });
const app = createGameServer({
  profiles: f.profiles,
  clans: f.clans,
  autoTick: false,
  wallNow: f.now,
});
let browser;
(async () => {
  try {
    await new Promise((r) => app.httpServer.listen(0, "127.0.0.1", r));
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await context.addCookies([{ name: "sferorumiya_session", value: members[9].token, url }]);
    await context.addInitScript((at) => {
      Date.now = () => at;
    }, f.now());
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
    await page.locator("#clanSection").click();
    await page.locator(".clan-member").first().waitFor();
    const getRows = () =>
      page.locator(".clan-battle-member-list .clan-member").evaluateAll((ns) =>
        ns.map((n) => ({
          tier: n.dataset.reward || null,
          background: getComputedStyle(n).backgroundColor,
          image: getComputedStyle(n).backgroundImage,
        })),
      );
    for (const [state, enemy, expected] of [
      ["losing", 60, Array(10).fill("fixed")],
      ["draw", 55, Array(10).fill("fixed")],
      [
        "leading",
        54,
        ["high", "high", "high", "medium", "medium", "medium", "low", "low", "low", "fixed"],
      ],
      ["losing-again", 70, Array(10).fill("fixed")],
    ]) {
      f.profiles.data.competition.day.scores[enemyId].kills = enemy;
      await page.reload();
      await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
      await page.locator("#clanSection").click();
      await page
        .waitForFunction(
          ({ enemy }) =>
            [...document.querySelectorAll(".clan-battle-score")].at(-1)?.textContent.trim() ===
            String(enemy),
          { enemy },
        )
        .catch(async () => {
          // The member tiers below are the invariant; reload waits for the actual API response as well.
          throw Error("Battle score failed to update: " + state);
        });
      const rows = await getRows();
      assert.deepEqual(
        rows.map((r) => r.tier),
        [...expected, null],
        state,
      );
      const personal = await page.locator(".clan-personal-reward").getAttribute("data-reward");
      assert.equal(personal, expected[9], state);
      const amounts = page.locator(".clan-personal-reward-currencies");
      assert.equal(await amounts.locator('[aria-label="100 монет"]').count(), 1);
      assert.equal(await amounts.locator('[aria-label="10 кристаллов"]').count(), 1);
      assert.equal(
        await amounts.locator('[aria-label="1 величие"]').count(),
        state === "leading" ? 1 : 0,
      );
      if (expected[0] === "fixed") {
        assert.ok(
          rows
            .slice(0, 10)
            .every((r) => r.image === rows[0].image && r.background === rows[0].background),
        );
        assert.match(
          await page.locator(".clan-personal-reward").innerText(),
          /Фиксированная награда/,
        );
      }
      if (state === "losing" || state === "leading")
        await page.screenshot({ path: path.join(artifacts, state + ".png") });
    }
    const settled = await page.evaluate(() => {
      const render = window.KillexClanBattleUI.prototype.personalReward;
      return [0, 1, null].map(greatness => {
        const battleReward = {clanId: "test", endedAt: 100, tier: "fixed", status: "credited", chestId: null, expiresAt: null};
        if (greatness !== null) battleReward.fixedReward = {coins: 100, crystals: 10, greatness};
        const owner = {data: {profile: {id: "p", clanChests: {items: [], battleReward}}}};
        const card = render.call({owner}, {lastBattle: {endedAt: 100, won: greatness === 1}}, {id: "test"});
        return {text: card.textContent, hint: card.dataset.boosterHint, greatness: card.querySelectorAll('[aria-label="1 величие"]').length};
      });
    });
    assert.deepEqual(settled.map(r => r.greatness), [0, 1, 1]);
    for (const r of settled) assert.match(r.text, /Уже начислено на баланс/);
    assert.doesNotMatch(settled[0].hint, /Величие/);
    assert.match(settled[1].hint, /Величие: 1/);
    const edge = await page.evaluate(() => {
      const fn = window.KillexClanBattleUI.previewTier,
        s = {
          battle: { start: 100, end: 200, own: 10, enemy: 0 },
          personal: { p: { kills: 1, reward: "high" }, idle: { kills: 0, reward: null } },
        };
      return [
        fn(null, "p", 150),
        fn(s, "p", 99),
        fn(s, "p", 100),
        fn(s, "p", 200),
        fn(s, "idle", 150),
      ];
    });
    assert.deepEqual(edge, [null, null, "high", null, null]);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: losing, draw, leading, lead lost, zero kills, inactive battle; row colors match personal preview.",
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
