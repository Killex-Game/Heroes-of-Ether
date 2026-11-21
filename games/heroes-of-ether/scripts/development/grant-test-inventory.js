/* Локальная подготовка тестовых данных: grant-test-inventory. */
"use strict";
// Разовая локальная выдача для теста. Через HTTP запустить её нельзя.
const fs = require("node:fs"),
  path = require("node:path");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { acquireServerLock } = require("../../src/server/runtime/process-lock");
const { portBusy } = require("./grant-coins");
const GRANT_ID = "2026-10-18-arena-test";
const AMOUNTS = Object.freeze({ coins: 20000, crystals: 2000, bucks: 1000 });
function grantAll(store) {
  const grants = store.data.testGrants || {};
  if (typeof grants !== "object" || Array.isArray(grants))
    throw Error("Повреждён журнал тестовых выдач.");
  if (Object.hasOwn(grants, GRANT_ID)) return { replay: true, count: grants[GRANT_ID].count };
  const next = structuredClone(store.data),
    profiles = Object.values(next.profiles);
  for (const profile of profiles) {
    for (const [currency, amount] of Object.entries(AMOUNTS)) {
      const balance = profile.wallet[currency];
      if (!Number.isSafeInteger(balance) || balance < 0 || !Number.isSafeInteger(balance + amount))
        throw Error("Недопустимый баланс. Выдача целиком отменена.");
      profile.wallet[currency] += amount;
    }
    if (!Number.isSafeInteger(profile.revision + 1))
      throw Error("Недопустимая версия профиля. Выдача целиком отменена.");
    profile.revision++;
  }
  next.testGrants = {
    ...grants,
    [GRANT_ID]: {
      count: profiles.length,
      amounts: { ...AMOUNTS },
      issuedAt: new Date().toISOString(),
    },
  };
  store.save(next);
  return { replay: false, count: profiles.length };
}
async function main() {
  if (process.argv.length > 2) throw Error("Команда без параметров: npm.cmd run dev:grant-all");
  const file = path.join(__dirname, "../../data/profiles.json");
  if (!fs.existsSync(file)) throw Error("Сохранение профилей ещё не создано.");
  if (await portBusy(Number(process.env.PORT || 3000)))
    throw Error("Сначала останови игровой сервер через Ctrl+C.");
  const release = acquireServerLock(path.join(__dirname, "../../data/server.lock"));
  try {
    const store = new ProfileStore({ filePath: file });
    if (!Object.hasOwn(store.data.testGrants || {}, GRANT_ID)) {
      const backup = path.join(__dirname, "../../data/backups", `profiles-before-${GRANT_ID}.json`);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      if (!fs.existsSync(backup)) fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    }
    const result = grantAll(store);
    console.log(
      result.replay
        ? `Выдача уже выполнена для ${result.count} профилей; повторного начисления нет.`
        : `Выдано ${result.count} профилям: +20000 монет, +2000 кристаллов, +1000 баксов каждому. Исходное сохранение - data/backups.`,
    );
  } finally {
    release();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { grantAll, GRANT_ID, AMOUNTS };
