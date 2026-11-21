"use strict";
const fs = require("node:fs"), path = require("node:path");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { prepareBronzePopulation } = require("../../src/server/testing/bronze-population");
const dir = path.resolve(__dirname, "../../data"), apply = process.argv.includes("--apply");
const lock = path.join(dir, "server.lock"), sessionsFile = path.join(dir, "test-bot-sessions.json");
(async () => {
  if (apply && fs.existsSync(lock)) throw Error("Требуется штатная остановка сервера.");
  const at = Date.now(), store = new ProfileStore({ filePath: path.join(dir, "profiles.json"), journal: apply, now: () => at });
  try {
    const prepared = prepareBronzePopulation(store.data, at);
    if (apply && prepared.sessions.length) {
      if (fs.existsSync(lock)) throw Error("Сервер запущен во время подготовки.");
      const previous = fs.existsSync(sessionsFile) ? JSON.parse(fs.readFileSync(sessionsFile, "utf8")) : [];
      // Save credentials before publishing their profiles: an interrupted setup
      // may leave unused tokens, never live bots without their local credentials.
      fs.writeFileSync(sessionsFile + ".tmp", JSON.stringify([...previous, ...prepared.sessions]), { mode: 0o600 });
      fs.renameSync(sessionsFile + ".tmp", sessionsFile);
      store.save(prepared.data, at);
    }
    console.log(JSON.stringify({ applied: apply, ...prepared.summary }));
  } finally { await store.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
