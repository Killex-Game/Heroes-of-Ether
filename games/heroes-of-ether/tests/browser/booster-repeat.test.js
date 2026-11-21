"use strict";
const assert = require("node:assert/strict"),
  { once } = require("node:events"),
  engines = require("playwright"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation");
const app = createGameServer({ arena: new Arena({ etherCount: 0 }), testBots: { enabled: false } });
let browser;
const until = async (fn) => {
  for (let i = 0; i < 160; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error("Timed out waiting for booster");
};
(async () => {
  try {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "http://127.0.0.1:" + app.httpServer.address().port;
    for (const engine of ["chromium", "firefox", "webkit"]) {
      browser = await engines[engine].launch({
        headless: true,
        ...(engine === "chromium" ? { channel: "chrome" } : {}),
      });
      const a = app.profiles.open(),
        p = app.profiles.find(a.token);
      p.level = 600; p.progress = require("../../src/server/progression/experience-progression").freshProgress(600);
      p.inventory.clan_shield = 3;
      p.inventory.meat = 4;
      p.quickSlots = ["clan_shield", "meat"];
      const c = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await c.addCookies([{ name: "sferorumiya_session", value: a.token, url }]);
      const page = await c.newPage();
      await page.goto(url);
      await page.waitForFunction(() => !document.querySelector("#playButton").disabled);
      await page.locator("#playButton").click();
      await page.locator("#arena").waitFor({ state: "visible" });
      const player = [...app.arena.players.values()].find((x) => x.profileId === p.id);
      player.protectedUntil = 0;
      await page.waitForFunction(
        () => !document.querySelector('.booster-quick [data-slot="1"]').disabled,
      );
      const socket = [...app.wss.clients][0],
        send = socket.send.bind(socket);
      let delayed = false,
        ackSent = false;
      socket.send = (data, ...args) => {
        if (!delayed && typeof data === "string" && JSON.parse(data).type === "boosterResult") {
          delayed = true;
          setTimeout(() => {
            ackSent = true;
            send(data, ...args);
          }, 700);
          return;
        }
        return send(data, ...args);
      };
      await page.keyboard.press("KeyA");
      await until(() => app.profiles.byId(p.id).inventory.clan_shield === 2);
      await page.keyboard.down("KeyS");
      await until(() => app.profiles.byId(p.id).inventory.meat === 3);
      assert.equal(ackSent, false, "another slot must work before delayed shield ACK");
      await until(() => app.profiles.byId(p.id).inventory.meat === 0);
      await page.keyboard.up("KeyS");
      const uses = player.boosterUses.meat;
      assert.equal(uses, 4);
      await new Promise((r) => setTimeout(r, 800));
      assert.equal(player.boosterUses.meat, uses);
      assert.equal(app.profiles.byId(p.id).inventory.meat, 0);
      assert.equal(app.profiles.byId(p.id).inventory.clan_shield, 2);
      await c.close();
      await browser.close();
      browser = null;
      await until(() => app.wss.clients.size === 0);
      console.log(
        engine + ": delayed ACK does not block other slot; held Meat exhausts exactly 4 and stops",
      );
    }
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
