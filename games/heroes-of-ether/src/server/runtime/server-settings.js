"use strict";
// Read and validate startup settings before opening data files or PostgreSQL.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), net = require("node:net");
const { STATE_WORKER_LIMITS } = require("../arena/state-worker-policy");
const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARENA_FIELDS = Object.freeze({
  arenaCapacity: "players", minimumArenas: "rooms", expansionBatch: "rooms",
  spareSeatsBeforeExpansion: "players", maximumArenas: "rooms", maximumArenaPlayers: "players",
  lobbyReserve: "players", reservationTtlMs: "ms", workerHeartbeatTtlMs: "ms", lobbyPresenceTtlMs: "ms",
});
function invalid(field, reason) {
  throw Object.assign(new Error(field + ": " + reason), { code: "SERVER_CONFIG" });
}
function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field, "ожидается объект");
}
function keys(value, allowed, file) {
  object(value, file);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(file, "неизвестное поле " + key);
}
function integer(value, field, min, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid(field, `нужно целое число ${min}–${max}`);
}
function boolean(value, field) { if (typeof value !== "boolean") invalid(field, "нужно true или false"); }
function readConfig(root, name) {
  const file = "config/" + name + ".json";
  // Preserve Node's JSON-module behavior for configs saved by Windows editors.
  try { return JSON.parse(fs.readFileSync(path.join(root, file), "utf8").replace(/^\uFEFF/, "")); }
  catch { invalid(file, "файл отсутствует или содержит некорректный JSON"); }
}
function loadServerSettings(root, env = process.env, parallelism = os.availableParallelism()) {
  root = path.resolve(root);
  const port = env.PORT === undefined ? 3000 : Number(env.PORT), host = env.HOST || "0.0.0.0";
  integer(port, "PORT", 1, 65535);
  if (!net.isIP(host)) invalid("HOST", "нужен IP-адрес");
  if (env.TRUST_LOOPBACK_PROXY !== undefined && !["0", "1"].includes(env.TRUST_LOOPBACK_PROXY))
    invalid("TRUST_LOOPBACK_PROXY", "нужно 0 или 1");
  const arena = readConfig(root, "arena-rooms");
  keys(arena, ["enabled", ...Object.keys(ARENA_FIELDS)], "arena-rooms"); boolean(arena.enabled, "arena-rooms.enabled");
  for (const key of Object.keys(ARENA_FIELDS)) integer(arena[key], "arena-rooms." + key, key === "spareSeatsBeforeExpansion" ? 0 : 1);
  if (arena.minimumArenas > arena.maximumArenas || arena.spareSeatsBeforeExpansion >= arena.minimumArenas * arena.arenaCapacity ||
      arena.maximumArenaPlayers > arena.maximumArenas * arena.arenaCapacity)
    invalid("arena-rooms", "несогласованные пределы комнат, мест и игроков");
  const stateWorkers = readConfig(root, "arena-state-workers");
  keys(stateWorkers, ["enabled", "maxWorkers", "maxRooms"], "arena-state-workers");
  boolean(stateWorkers.enabled, "arena-state-workers.enabled");
  integer(stateWorkers.maxWorkers, "arena-state-workers.maxWorkers", 0, STATE_WORKER_LIMITS.MAX_WORKERS);
  integer(stateWorkers.maxRooms, "arena-state-workers.maxRooms", 1);
  if (stateWorkers.enabled && !stateWorkers.maxWorkers) invalid("arena-state-workers.maxWorkers", "для включённых потоков нужно хотя бы 1");
  const appearance = readConfig(root, "appearance-testing");
  keys(appearance, ["unlockLeagueBackgrounds", "unlockLeagueFrames", "unlockClanCrests", "allPersonalAppearanceProfileIds", "allAppearanceProfileIds"], "appearance-testing");
  for (const field of ["unlockLeagueBackgrounds", "unlockLeagueFrames", "unlockClanCrests"]) boolean(appearance[field], "appearance-testing." + field);
  for (const field of ["allPersonalAppearanceProfileIds", "allAppearanceProfileIds"]) {
    if (appearance[field] !== undefined && (!Array.isArray(appearance[field]) || appearance[field].some(id => typeof id !== "string" || !PROFILE_ID.test(id))))
      invalid("appearance-testing." + field, "нужен список ID профилей");
  }
  const owner = readConfig(root, "owner-admin");
  keys(owner, ["ownerId", "publicOrigin"], "owner-admin");
  if (owner.ownerId != null && (typeof owner.ownerId !== "string" || !PROFILE_ID.test(owner.ownerId))) invalid("owner-admin.ownerId", "нужен ID профиля или null");
  if (owner.publicOrigin) {
    try { if (new URL(owner.publicOrigin).origin !== owner.publicOrigin || !owner.publicOrigin.startsWith("https://")) throw Error(); }
    catch { invalid("owner-admin.publicOrigin", "нужен HTTPS origin без пути"); }
  }
  const petEvents = readConfig(root, "pet-events"), roulette = readConfig(root, "roulette-events"), promotions = readConfig(root, "promotions");
  for (const [name, validate] of [
    ["pet-events", () => require("../pets/pet-service").validateEvents(petEvents)],
    ["roulette-events", () => require("../roulette/roulette-service").configuration(roulette)],
    ["promotions", () => require("../shop/promotion-offers").configuration(promotions)],
  ]) { try { validate(); } catch { invalid("config/" + name + ".json", "настройки не прошли проверку правил"); } }
  const stateWorkerCount = stateWorkers.enabled ? Math.min(stateWorkers.maxWorkers, Math.max(1, parallelism - 2)) : 0;
  return { root, dataDir: path.join(root, "data"), publicDir: path.join(root, "public"),
    port, host, trustLoopbackProxy: env.TRUST_LOOPBACK_PROXY === "1", arena, stateWorkers, stateWorkerCount,
    appearance, owner, petEvents, roulette, promotions };
}
module.exports = { loadServerSettings, ARENA_FIELDS };
