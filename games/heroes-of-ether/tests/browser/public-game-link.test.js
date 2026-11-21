/* Браузерный сценарий: public game link. */
"use strict";
const { setNickname } = require("./helpers/profile-controls");
// Проверка уже запущенного тестового туннеля. Один отдельный браузерный профиль.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../.."),
  directory = path.join(root, "data/tunnel");
const url = fs.readFileSync(path.join(directory, "url.txt"), "utf8").trim();
if (!/^https:\/\/[a-z0-9-]+\.(trycloudflare\.com|loca\.lt|lhr\.life)$/.test(url))
  throw Error("Unexpected tunnel URL");
const session = path.join(directory, "test-browser-session.json");
let browser;
(async () => {
  try {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      ...(fs.existsSync(session) ? { storageState: session } : {}),
    });
    const page = await context.newPage(),
      errors = [],
      frames = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.log("Page error:", error.message);
    });
    page.on("requestfailed", (request) =>
      console.log(
        "Failed resource:",
        new URL(request.url()).pathname,
        request.failure()?.errorText,
      ),
    );
    page.on("response", (response) => {
      if (response.status() >= 400)
        console.log("HTTP error:", response.status(), new URL(response.url()).pathname);
    });
    page.on("console", (message) => {
      if (message.type() === "error") console.log("Browser:", message.text().slice(0, 240));
    });
    page.on("websocket", (socket) =>
      socket.on("framereceived", (event) => {
        try {
          frames.push(JSON.parse(event.payload).type);
        } catch (_) {}
      }),
    );
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    assert.ok([200, 511].includes(response.status()), "Public HTTP " + response.status());
    if (response.status() === 511) {
      await page
        .getByRole("textbox")
        .fill(fs.readFileSync(path.join(directory, "visitor-password.txt"), "utf8").trim());
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    }
    await page.waitForFunction(
      () => {
        const button = document.getElementById("playButton");
        return (
          button &&
          !button.disabled &&
          document.querySelector("#lobbyLoadout img, #lobbyLoadout .loadout-slot")
        );
      },
      {},
      { timeout: 60000 },
    );
    console.log("Lobby ready");
    await context.storageState({ path: session });
    await setNickname(page, "Тест связи");
    await page.screenshot({ path: path.join(root, "tests/artifacts/public-lobby.png") });
    await page.locator("#playButton").click();
    await page.locator("#arena").waitFor({ state: "visible", timeout: 60000 });
    await page.waitForTimeout(1500);
    assert.ok(frames.includes("welcome"));
    assert.ok(frames.length > 2);
    await page.screenshot({ path: path.join(root, "tests/artifacts/public-arena.png") });
    await page.locator("#leaveButton").click();
    await page.locator("#leaveYes").click();
    await page.locator("#lifeResultDialog").waitFor({ state: "visible" });
    await page.locator("#lifeLobby").click();
    await page.locator("#lobby").waitFor({ state: "visible" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: public HTTPS lobby, profile, saved nickname, WebSocket welcome and live frames, arena entry and return to lobby.",
    );
  } finally {
    if (browser) await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
