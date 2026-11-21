/* Локальная подготовка тестовых данных: grant-coins. */
"use strict";
// Локальная команда для владельца проекта. HTTP-метода выдачи валюты нет.
const fs = require("node:fs"),
  path = require("node:path"),
  net = require("node:net");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { acquireServerLock } = require("../../src/server/runtime/process-lock");
function grantCoins(store, profileId, value) {
  const amount = Number(value),
    next = JSON.parse(JSON.stringify(store.data));
  const profile = store.byId(profileId, next);
  if (!profile) throw Error("Профиль с этим ID не найден. Посмотри список командой list.");
  if (
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    amount > 1000000 ||
    !Number.isSafeInteger(profile.wallet.coins + amount)
  )
    throw Error("Укажи целое число монет от 1 до 1000000.");
  profile.wallet.coins += amount;
  profile.revision++;
  store.save(next);
  return store.view(profile);
}
async function portBusy(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(Error("Не удалось проверить, остановлен ли сервер."));
    });
    socket.once("error", (error) => {
      if (error.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
  });
}
async function main() {
  const [action, id, amount] = process.argv.slice(2);
  if (!["list", "grant"].includes(action))
    throw Error("Команды: npm.cmd run dev:coins -- list | npm.cmd run dev:coins -- grant ID 1500");
  const file = path.join(__dirname, "../../data/profiles.json");
  if (!fs.existsSync(file))
    throw Error(
      "Сначала запусти игру и открой лобби, чтобы создать профиль. Затем останови сервер Ctrl+C.",
    );
  if (await portBusy(Number(process.env.PORT || 3000)))
    throw Error("Сначала останови игровой сервер через Ctrl+C. Затем повтори команду.");
  const release = acquireServerLock(path.join(__dirname, "../../data/server.lock"));
  try {
    const store = new ProfileStore({ filePath: file });
    if (action === "list")
      for (const p of Object.values(store.data.profiles))
        console.log(`${p.id}  ${p.name}  ${p.wallet.coins} монет`);
    else {
      const p = grantCoins(store, id, amount);
      console.log(
        `Тестовые монеты выданы: ${p.name}, баланс ${p.wallet.coins}. Теперь запусти npm.cmd start.`,
      );
    }
  } finally {
    release();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { grantCoins, portBusy };
