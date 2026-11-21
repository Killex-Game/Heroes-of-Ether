/* Браузерный сценарий: clan rules. */
"use strict";
const { setNickname } = require("./helpers/profile-controls");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { chromium } = require("playwright");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation"),
  { xpForLevel } = require("../../src/server/progression/experience-progression");
const directory = path.resolve(__dirname, ".."),
  scratch = fs.mkdtempSync(path.join(directory, ".tmp-clan-rules-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
const artifacts = path.join(directory, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const app = createGameServer({
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => 5000,
    rateNow: () => performance.now(),
  }),
  errors = [];
let browser, timer;
async function until(fn, label) {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Timeout: " + label);
}
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    async function user(name, level = 12) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
        page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.status() >= 400) errors.push(r.status() + " " + r.url());
      });
      await page.goto(url);
      await page.waitForFunction(() => !document.getElementById("playButton").disabled);
      const id = (await (await context.request.get(url + "/api/profile")).json()).profile.id,
        p = app.profiles.byId(id);
      p.level = level;
      p.progress.xp = xpForLevel(level);
      p.wallet.coins = 3000;
      p.wallet.bucks = 100;
      await setNickname(page, name);
      return { page, context, id, p: () => app.profiles.byId(id) };
    }
    const head = await user("Глава"),
      manager = await user("Управляющий"),
      officer = await user("Офицер"),
      member = await user("Участник");
    await head.page.locator("#clanSection").click();
    await head.page.getByRole("button", { name: "Создать клан", exact: true }).click();
    await head.page.locator("#clan-name").fill("Звёздный союз");
    await head.page.locator("#clan-prefix").fill("ЗВ");
    await head.page.locator("#clan-description").fill("Исследуем арену вместе");
    await head.page.locator("#clan-privacy").selectOption("closed");
    await head.page.getByRole("button", { name: "Создать за 1500 монет", exact: true }).click();
    await until(() => !!head.p().clanId, "создание");
    const clanId = head.p().clanId;
    const refresh = async (u) => {
      if (await u.page.locator("#topsDialog").isVisible()) {
        await u.page.keyboard.press("Escape");
        await u.page.locator("#clanSection").click();
        return;
      }
      await u.page.getByRole("button", { name: "Обновить", exact: true }).click();
      await u.page.waitForFunction(
        () => !document.querySelector("#clanDialog .clan-status").textContent.includes("Сохраняем"),
      );
    };
    const top = async (u) => {
      await u.page.locator("#clanSection").click();
      await u.page.locator("#topsDialog").waitFor({ state: "visible" });
      await u.page.locator(`[data-clan-id="${clanId}"]`).waitFor();
    };
    const apply = async (u) => {
      await top(u);
      await u.page.getByRole("button", { name: "Подать заявку · 50 монет", exact: true }).click();
      await until(() => app.profiles.data.clans[clanId].applications.includes(u.id), "заявка");
    };
    const accept = async (actor, target) => {
      await refresh(actor);
      await actor.page
        .locator(`[data-applicant="${target.id}"]`)
        .getByRole("button", { name: "Принять", exact: true })
        .click();
      await until(() => target.p().clanId === clanId, "принятие");
    };
    const gear = async (actor, target) => {
      await actor.page.locator(`[data-member-id="${target.id}"] .clan-member-gear`).click();
      await actor.page.locator(".clan-member-dialog").waitFor({ state: "visible" });
    };
    const role = async (actor, target, value) => {
      await gear(actor, target);
      const label = {
        officer: "Назначить офицером",
        manager: "Назначить управляющим",
        member: "Разжаловать",
      }[value];
      await actor.page.getByRole("button", { name: label, exact: true }).click();
      await actor.page.locator(".clan-member-dialog").waitFor({ state: "hidden" });
      assert.equal(app.profiles.data.clans[clanId].roles[target.id], value);
    };
    await apply(manager);
    assert.equal(manager.p().wallet.coins, 2950);
    await manager.page.getByRole("button", { name: "Отозвать заявку", exact: true }).click();
    await until(() => manager.p().wallet.coins === 3000, "возврат");
    await manager.page
      .getByRole("button", { name: "Подать заявку · 50 монет", exact: true })
      .click();
    await until(
      () => app.profiles.data.clans[clanId].applications.includes(manager.id),
      "повторная заявка",
    );
    await accept(head, manager);
    await role(head, manager, "manager");
    await refresh(manager);
    await manager.page.getByRole("button", { name: "Мой клан", exact: true }).click();
    await manager.page.getByRole("button", { name: "Настройки клана", exact: true }).click();
    assert.equal(await manager.page.locator("#clan-name").getAttribute("readonly"), "");
    assert.equal(await manager.page.locator(".clan-emblems").evaluate((e) => e.disabled), true);
    await manager.page.locator("#clan-description").fill("Описание управляющего");
    await manager.page.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
    await manager.page
      .locator(".clan-banner p")
      .filter({ hasText: "Описание управляющего" })
      .waitFor();
    await apply(officer);
    await accept(manager, officer);
    await role(manager, officer, "officer");
    await role(manager, officer, "member");
    await role(manager, officer, "officer");
    await refresh(officer);
    await officer.page.getByRole("button", { name: "Мой клан", exact: true }).click();
    assert.equal(
      await officer.page.getByRole("button", { name: "Настройки клана", exact: true }).count(),
      0,
    );
    await apply(member);
    await accept(officer, member);
    await gear(head, manager);
    await head.page.screenshot({ path: path.join(artifacts, "clan-member-roles.png") });
    await head.page
      .getByRole("button", { name: "Закрыть управление участником", exact: true })
      .click();
    await refresh(head);
    app.profiles.data.clans[clanId].xp = 29990;
    app.profiles.startLife(head.id, "xp-life");
    app.profiles.applyArenaProgress(
      "clan-xp",
      [
        { type: "survivalMinute", profileId: head.id, mass: 3000, minutes: 1 },
        {
          type: "lifeEnded",
          profileId: head.id,
          lifeId: "xp-life",
          durationSeconds: 60,
          reason: "left",
        },
      ],
      1000000,
    );
    await refresh(head);
    await head.page.locator(".clan-level").filter({ hasText: "Уровень клана · 2" }).waitFor();
    assert.match(await head.page.locator(".clan-level").textContent(), /10 \/ 30\s?000/);
    await head.page.screenshot({ path: path.join(artifacts, "clan-level-home.png") });
    await gear(officer, member);
    assert.equal(
      await officer.page.getByRole("button", { name: "Передать главу", exact: true }).count(),
      0,
    );
    assert.equal(await officer.page.getByRole("combobox", { name: "Роль участника" }).count(), 0);
    await officer.page.getByRole("button", { name: "Исключить", exact: true }).click();
    await officer.page
      .locator(".clan-member-dialog")
      .getByRole("button", { name: "Подтвердить", exact: true })
      .click();
    await until(() => !member.p().clanId, "исключение офицером");
    await manager.page.getByRole("button", { name: "Настройки клана", exact: true }).click();
    await manager.page.locator("#clan-privacy").selectOption("open");
    await manager.page.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
    await until(() => app.profiles.data.clans[clanId].privacy === "open", "открытый клан");
    await refresh(member);
    await member.page.locator("#topsDialog").waitFor({ state: "visible" });
    await member.page.getByRole("button", { name: "Вступить · 50 монет", exact: true }).click();
    await until(() => member.p().clanId === clanId, "мгновенное вступление");
    assert.equal(member.p().wallet.coins, 2900);
    await refresh(head);
    await gear(head, manager);
    await head.page.getByRole("button", { name: "Передать главу", exact: true }).click();
    await head.page
      .locator(".clan-member-dialog")
      .getByRole("button", { name: "Подтвердить", exact: true })
      .click();
    await until(() => app.profiles.data.clans[clanId].ownerId === manager.id, "передача главы");
    await refresh(manager);
    await manager.page.setViewportSize({ width: 390, height: 844 });
    await gear(manager, head);
    await manager.page.screenshot({ path: path.join(artifacts, "clan-member-mobile.png") });
    assert.equal(
      await manager.page.evaluate(
        () =>
          document.querySelector(".clan-member-dialog").scrollWidth <=
          document.querySelector(".clan-member-dialog").clientWidth + 1,
      ),
      true,
    );
    await manager.page
      .getByRole("button", { name: "Закрыть управление участником", exact: true })
      .click();
    await manager.page.screenshot({ path: path.join(artifacts, "clan-home-mobile-v7.png") });
    const low = await user("Новичок", 11);
    await top(low);
    assert.equal(
      await low.page.getByRole("button", { name: "Вступить · 50 монет", exact: true }).isDisabled(),
      true,
    );
    await low.page.getByRole("button", { name: "Создать клан", exact: true }).click();
    assert.equal(
      await low.page
        .getByRole("button", { name: "Создать за 1500 монет", exact: true })
        .isDisabled(),
      true,
    );
    await head.page.getByRole("button", { name: "Закрыть кланы", exact: true }).click();
    await head.page.locator("#playButton").click();
    await head.page.locator("#arena").waitFor({ state: "visible" });
    const player = [...app.arena.players.values()].find((p) => p.profileId === head.id);
    Object.assign(player, { mass: 700, x: 1100, y: 800, radius: radiusForMass(700) });
    for (let i = 0; i < 14; i++) {
      const p = app.arena.addPlayer(0, "fixture" + i),
        mass = 100 + i * 10;
      Object.assign(p, {
        name: "Игрок " + i,
        mass,
        radius: radiusForMass(mass),
        x: 800 + i * 50,
        y: 700,
        clanId: i === 0 ? clanId : "clan" + (i % 7),
        clanPrefix: i === 0 ? "ЗВ" : "К" + (i % 7),
        clanName: i === 0 ? "Звёздный союз" : "Союз " + (i % 7),
      });
    }
    app.broadcast();
    timer = setInterval(() => app.broadcast(), 100);
    await until(
      () =>
        head.page
          .locator("#leaderList .leader-row")
          .count()
          .then((n) => n === 10),
      "10 игроков",
    );
    await until(
      () =>
        head.page
          .locator("#arenaClanList .arena-clan-row")
          .count()
          .then((n) => n === 6),
      "6 кланов",
    );
    assert.match(
      await head.page.locator("#arenaClanList .arena-clan-row").first().textContent(),
      /Звёздный союз.*800/,
    );
    await head.page.screenshot({ path: path.join(artifacts, "arena-clan-top-desktop.png") });
    await head.page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await head.page
        .locator("#leaderList .leader-row")
        .evaluateAll((rows) => rows.every((r) => getComputedStyle(r).display !== "none")),
      true,
    );
    await head.page.screenshot({ path: path.join(artifacts, "arena-clan-top-mobile.png") });
    assert.deepEqual(errors, []);
    console.log(
      "Clan browser OK: fee refunds, instant joining, permissions, gear/transfer, XP level, mobile, 10 players / 6 clans.",
    );
  } finally {
    clearInterval(timer);
    await browser?.close();
    await app.close();
    if (
      path.dirname(path.resolve(scratch)) !== directory ||
      !path.basename(scratch).startsWith(".tmp-")
    )
      throw Error("Unsafe temp path");
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
