/* HTTP API, WebSocket, игровой цикл и корректное завершение сервера. */
"use strict";
const http = require("node:http");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { randomUUID } = require("node:crypto");
const WebSocket = require("ws");
const { Arena, RULES, massLimitForLevel, cleanName } = require("./arena/arena-simulation");
const { ArenaStateWorkers } = require("./arena/state-workers");
const easterHunt = require("./events/easter-hunt");
const arenaVisibility = require("./arena/visibility");
const { ProfileStore } = require("./profiles/profile-store");
const { ArenaBoosterQueue } = require("./profiles/arena-booster-queue");
const petService = require("./pets/pet-service");
const rouletteService = require("./roulette/roulette-service");
const arenaPets = require("./pets/arena-pets");
const accessoryAbilities = require("./arena/accessory-abilities");
const { BOOSTERS, BoosterError, publicCatalog } = require("./boosters/booster-catalog");
const { ClanService } = require("./clans/clan-service");
const { TestBots } = require("./testing/arena-test-bots");
const { RequestLimits, HTTP_LIMITS } = require("./http/request-rate-limits");
const { serveStatic } = require("./http/static-file-server");
const { clientAddress, secureRequest } = require("./http/trusted-proxy");
const { ChatService } = require("./chat/chat-service");
const { OwnerAccess } = require("./admin/owner-access");
const { OwnerService } = require("./admin/owner-service");
const { Maintenance } = require("./runtime/maintenance");
const { ArenaTestingGate } = require("./runtime/arena-testing-gate");
const { EventManager } = require("./events/event-manager");
const { activeBan, requirePlayable, publicBan } = require("./admin/moderation");
const loadout = require("../../public/shared/quick-slot-rules"),
  accounts = require("./accounts/account-benefits");

const { sessionCookie } = require("../../public/shared/platform-contract");
function sessionToken(req) {
  return (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(sessionCookie + "="))
    ?.slice(sessionCookie.length + 1);
}
function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try {
    const url = new URL(req.headers.origin);
    return ["http:", "https:"].includes(url.protocol) && url.host === req.headers.host;
  } catch (_) {
    return false;
  }
}
async function jsonBody(req, limit = 4096) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new BoosterError("Слишком большой запрос.", 413);
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Error();
    return data;
  } catch (_) {
    throw new BoosterError("Некорректный запрос.");
  }
}

function createGameServer({
  arena = null,
  arenaPolicy = null,
  publicDir = path.join(__dirname, "../../public"),
  now = () => performance.now(),
  wallNow = () => Date.now(),
  rateNow = now,
  autoTick = true,
  maxPlayers = 32,
  profiles = new ProfileStore(),
  httpLimits = HTTP_LIMITS,
  trustLoopbackProxy = false,
  shutdownGraceMs = 2000,
  stateWorkerCount = 0,
  stateWorkerRoomLimit = 3,
  stateWorkerPackedFood = false,
  stateWorkerPackedParts = true,
  arenaProgressGroupSize = 4,
  experimentalStepPool = null,
  arenaBoosterFairRetries = false,
  arenaBoosterBatchSize = 32,
  externalBoosterQueue = null,
  testBots = {},
  chat = new ChatService({ now: wallNow }),
  ownerAccess = new OwnerAccess(),
  events = new EventManager({ now: wallNow }),
  maintenance = new Maintenance(),
  arenaTesting = new ArenaTestingGate(),
  monitorDirectory = null,
  mongoMonitor = () => null,
  mongoMetrics = () => {},
} = {}) {
  // Construct the first grouped room at its actual size before food is spawned.
  // Explicit Arena instances remain a fixture/embedding override.
  arena ||= new Arena({ world: arenaPolicy && arenaPolicy.levelGroups !== false
    ? require("./arena/arena-names").groups[0].world : undefined });
  if (!Number.isFinite(shutdownGraceMs) || shutdownGraceMs < 0)
    throw new RangeError("Invalid shutdown grace period");
  if (!Number.isInteger(arenaProgressGroupSize) || arenaProgressGroupSize < 1 || arenaProgressGroupSize > 16)
    throw new RangeError("Invalid progress group size");
  const root = path.resolve(publicDir);
  const newsMedia = new (require('./admin/news-media').NewsMedia)(profiles.filePath ? path.join(path.dirname(profiles.filePath),'news-media') : null);
  const feedback = ownerAccess.sendFeedback ? null : new (require('./admin/feedback-store').FeedbackStore)({
    file:profiles.filePath?path.join(path.dirname(profiles.filePath),'standalone-feedback','feedback.wal'):null,now:wallNow});
  profiles.ownerId = ownerAccess.ownerId;
  profiles.events = events;
  const requestLimits = new RequestLimits({ now: rateNow, limits: httpLimits });
  const profileConnections = new Map();
  const stateWorkers = new ArenaStateWorkers({
    maxWorkers: stateWorkerCount,
    maxRooms: stateWorkerRoomLimit,
    packedFood: stateWorkerPackedFood,
    packedParts: stateWorkerPackedParts,
    now: rateNow,
  });
  if (externalBoosterQueue && externalBoosterQueue.profiles !== profiles)
    throw new Error("External action queue belongs to another profile store");
  const boosterQueue = externalBoosterQueue || new ArenaBoosterQueue(profiles, { fairRetries: arenaBoosterFairRetries, maxBatchSize: arenaBoosterBatchSize });
  const presence = new (require("./runtime/player-presence").PlayerPresence)({
    now: wallNow,
  });
  profiles.isOnline = (id) => profileConnections.has(id) || presence.isOnline(id);
  // Reads and unrelated lobby changes must not settle the day ahead of queued
  // arena progress. The ordinary flush/timer retries after durable publication.
  const clanQuestBoundary = require("./arena/clan-quest-boundary");
  profiles.clanQuestSettlementReady = at => !arenaBatches.some(b=>b.at<=at) &&
    !(pendingProgress && pendingProgress.at<=at) &&
    !clanQuestBoundary.pending(profiles, rooms, lastArenaProgressAt, at);
  chat.profileFor = (id) => profiles.byId(id);
  chat.clanFor = (profile) => profiles.data.clans[profile.clanId] || null;
  chat.onAccepted = (id, count) => {
    const profile = profiles.byId(id);
    if (!profile || count <= (profile.activity.chatAccepted || 0)) return;
    if (!profiles.journal) return profiles.chatAccepted(id, count);
    // The chat WAL already owns this absolute count. Apply its achievement in
    // the normal asynchronous profile queue; retry/restart cannot double it.
    return new Promise((resolve, reject) => boosterQueue.use({
      owner: id,
      prepare(batch) { profiles.chatAccepted(id, count, batch); return { finish: resolve }; },
      fail: reject,
    }));
  };
  chat.moderation = new (require("./chat/chat-moderation").ChatModeration)({
    profiles, now: wallNow, onBan: disconnectBanned, actionQueue: boosterQueue,
  });
  const { InputIntegrity, inspect: inspectArenaInput } = require("./arena/input-integrity");
  const inputIntegrity = new InputIntegrity({
    profiles, actionQueue: boosterQueue, now: wallNow, onBan: disconnectBanned,
  });
  const kill = new (require('./arena/kill-detector').KillDetector)({profiles,actionQueue:boosterQueue,now:wallNow,
    onError:error=>console.error('Не удалось сохранить подозрение Kill:',error.message)});
  chat.syncProgress();
  const clans = new ClanService(profiles);
  let lobbyBots;
  const botAvailable = (id) =>
    !profileConnections.has(id) &&
    !lobbyBots?.busy.has(id) &&
    ![...arenaRooms.rooms.values()].some((r) =>
      [...r.arena.players.values()].some((p) => p.profileId === id),
    );
  const bots = new TestBots({ arena, profiles, ...testBots, isProfileAvailable: botAvailable });
  const { ArenaRooms } = require("./arena/arena-rooms");
  const arenaRooms = new ArenaRooms({
    levelGroups: !!arenaPolicy && arenaPolicy.levelGroups !== false,
    profileFor: (id) => profiles.byId(id),
    policy: arenaPolicy
      ? Object.fromEntries(Object.entries(arenaPolicy).filter(([key]) => key !== "levelGroups"))
      : {
          arenaCapacity: maxPlayers,
          maximumArenaPlayers: maxPlayers,
          minimumArenas: 1,
          maximumArenas: 1,
          spareSeatsBeforeExpansion: Math.max(0, maxPlayers - 1),
        },
    now: wallNow,
    gameNow: now,
    connections: profileConnections,
    holdRemnants: !!arenaPolicy,
    createRoom: (id, group) => {
      const { groups, groupForLevel } = require("./arena/arena-names");
      const band = groups.find((g) => g.id === group);
      const eligible = (profile) =>
        !group || groupForLevel(profile.level).id === group;
      if (id === "arena-1") {
        bots.isLevelEligible = eligible;
        bots.roomBotLimit = band?.maxBots ?? 30;
        arena.maxParts = band?.maxParts ?? 16;
        return { id, arena, bots };
      }
      const simulation = new Arena({ world: band?.world });
      simulation.maxParts = band?.maxParts ?? 16;
      return {
        id,
        arena: simulation,
        bots: new TestBots({
          arena: simulation,
          profiles,
          ...testBots,
          isProfileAvailable: botAvailable,
          isLevelEligible: eligible,
          roomBotLimit: band?.maxBots ?? 30,
        }),
      };
    },
  });
  const rooms = arenaRooms.rooms;
  let tickSequence = 0;
  const performanceMonitor = new (require("./runtime/performance-monitor").PerformanceMonitor)({ observeLoop: autoTick });
  function performanceStatus() {
    let activePlayers = 0, parts = 0;
    for (const room of rooms.values()) for (const p of room.arena.players.values())
      if (!p.dead && !p.isRemnant) { activePlayers++; parts += p.parts?.length || 1; }
    const memory = process.memoryUsage();
    const constrained = process.constrainedMemory?.() || 0;
    const memoryLimit = constrained > 0 ? Math.min(constrained, require("node:os").totalmem()) : null;
    return { ...performanceMonitor.snapshot(), capturedAt: wallNow(), uptimeSeconds: Math.floor(process.uptime()), targetTickMs: RULES.TICK_MS,
      arena: { rooms: rooms.size, activePlayers, parts, connections: wss.clients.size },
      online: presence.counts(profileConnections.keys(), id => { const p=profiles.byId(id); return !!p && !p.testBot; }),
      memoryMiB: { resident: Math.round(memory.rss / 1048576), heapUsed: Math.round(memory.heapUsed / 1048576), limit: memoryLimit ? Math.floor(memoryLimit / 1048576) : null },
      persistence: { arenaBatches: arenaBatches.length, queuedActions: boosterQueue.waiting.length,
        paused: arenaProgressPaused(), staging: !!boosterQueue.staging,
        walRevision: profiles.journal?.revision ?? null, pendingWalBytes: profiles.journal?.pendingBytes ?? 0, maxWalBytes: profiles.journal?.maxPendingBytes ?? null },
      stateWorkers: { ...stateWorkers.stats } };
  }
  // A blocked server turn can deliver several seconds of legitimate input in
  // one read. Only arena controls may spend this bounded catch-up allowance.
  let lastArenaTurn = rateNow(),
    stalledAt = -Infinity,
    stalledControls = 0;
  function observeArenaTurn(at) {
    const gap = at - lastArenaTurn;
    if (gap > 250) {
      stalledAt = at;
      stalledControls = Math.min(320, Math.ceil(gap * 0.04));
    }
    lastArenaTurn = at;
  }
  const owner = new OwnerService({
    profiles,
    access: ownerAccess,
    now: wallNow,
    inArena: (id) => profileConnections.has(id),
  });
  const runId = randomUUID();
  const gameGrants = new (require('./admin/game-grants').GameGrants)({ profiles, access: ownerAccess,
    inArena: id => !!profiles.byId(id)?.progress?.session, now: wallNow });
  let pendingProgress = null,
    progressErrorReported = false;
  const arenaBatches = [];
  let lastArenaProgressAt = wallNow();
  let arenaWrite = null;
  let arenaProgressThrough = null;
  // Staging excludes new progress jobs, but an already running calculation
  // still owns its upcoming WAL commit. Wait for that job before staging casts.
  if (!externalBoosterQueue) boosterQueue.onProgressIdle = () => arenaWrite;
  if (!externalBoosterQueue) boosterQueue.onProgressTurn = async () => {
    // Let progress already waiting at this boundary catch up before another
    // cast locks staging. Future ticks must not postpone casts indefinitely.
    const through = arenaBatches.at(-1);
    arenaProgressThrough = through;
    try {
      while (through && !closing && !progressErrorReported && arenaBatches.includes(through)) {
        writeArenaBatches();
        if (arenaWrite) await arenaWrite;
      }
    } finally {
      arenaProgressThrough = null;
      // Give the waiting cast its staging turn before continuing newer ticks.
      // If no cast remains, this also resumes the normal background writer.
      if (!closing && !progressErrorReported) setImmediate(writeArenaBatches);
    }
  };
  // A failed arena write must be retried before freezing event standings.
  profiles.eventRankingReady = () => !pendingProgress && !arenaBatches.length;
  let closing = false,
    closePromise;
  let maintenanceFreezeAt=null,maintenanceDrain=null,maintenanceRetry=null,maintenanceClosure=false;
  let arenaTestingFreezeAt=null,arenaTestingFreezeWallAt=null,arenaTestingDrain=null,arenaTestingRetry=null,arenaTestingClosure=false;
  const arenaClosedError=()=>Object.assign(new BoosterError(arenaTesting.status().message,503),{code:'ARENA_TEMPORARILY_CLOSED'});
  let serviceObserver=null;
  function observation(){
    const mongo=mongoMonitor(),faults=[];
    if(profiles.journal?.fault)faults.push('LOCAL_JOURNAL_FAILED');
    if(profiles.journal?.lastError)faults.push('CHECKPOINT_FAILED');
    if(progressErrorReported)faults.push('ARENA_SAVE_FAILED');
    if(mongo?.enabled&&!['ok','starting'].includes(mongo.health?.state))faults.push('MONGODB_'+(mongo.health?.state==='stale'?'STALE':'FAILED'));
    return {mongo,faults,windows:profiles.data.serviceAvailability?.windows||[],deployment:maintenance.manual};
  }
  function requireRunning() {
    if (closing) throw new BoosterError("Сервер перезапускается. Попробуй чуть позже.", 503);
  }
  function arenaBackground(simulation) {
    return easterHunt.runAt(profiles.events, wallNow()) ? "easter-meadow" : simulation.backgroundId;
  }
  function arenaSnapshot(simulation, ...args) {
    const snapshot = simulation.snapshot(...args);
    snapshot.backgroundId = arenaBackground(simulation) || snapshot.backgroundId;
    return snapshot;
  }
  function limitRequest(req, name) {
    const result = requestLimits.take(clientAddress(req, trustLoopbackProxy), name);
    if (!result.allowed)
      throw Object.assign(new BoosterError("Слишком много запросов. Подожди немного.", 429), {
        retryAfter: result.retryAfter,
      });
  }
  function requireLobby(token, { allowEndedRead = false } = {}) {
    requireRunning();
    const profile = profiles.find(token);
    if (!profile) throw new BoosterError("Сначала открой лобби.", 401);
    requirePlayable(profile, wallNow());
    const connection = profileConnections.get(profile.id), player = connection?.arena.players.get(connection.playerId);
    const endedRead = allowEndedRead && connection?.lastLifeResult &&
      (!player || ((player.dead || player.isRemnant) && connection.lastLifeResult.id === player.lifeId));
    if (connection && !endedRead)
      throw Object.assign(
        new BoosterError("Это действие доступно только в лобби. Профиль уже на арене.", 409),
        { code: "ARENA_ACTIVE" },
      );
    return profile;
  }
  function durableLobbyAction(token, action) {
    const profile = requireLobby(token);
    const check = () => {
      if (maintenance.active)
        throw Object.assign(new BoosterError("Идёт обновление игры. Попробуй позже.", 503), {
          code: "MAINTENANCE",
        });
      const current = requireLobby(token);
      if (current.id !== profile.id)
        throw new BoosterError("Сессия изменилась. Открой лобби снова.", 409);
    };
    return new Promise((resolve, reject) =>
      boosterQueue.use({
        owner: "profile:" + profile.id,
        prepare(batch) {
          check();
          const result = action(batch);
          return {
            // An arena join, ban or shutdown during fsync invalidates this draft.
            // The queue rebuilds it and returns the original permission error.
            valid() {
              try {
                check();
                return true;
              } catch (_) {
                return false;
              }
            },
            finish() {
              resolve({ ...result, profile: profiles.view(profiles.find(token)) });
            },
          };
        },
        fail: reject,
      }),
    );
  }
  async function playableBody(req, limit) {
    const body = await jsonBody(req, limit);
    if (arenaBatches.length && !(await waitForArenaWrites()))
      throw new BoosterError("Не удалось сохранить прогресс арены. Повтори позже.", 503);
    requireRunning();
    if(maintenance.active&&!new URL(req.url,'http://localhost').pathname.startsWith('/api/admin/'))
      throw Object.assign(new BoosterError(maintenance.status().message,503),{code:'MAINTENANCE'});
    requirePlayable(profiles.find(sessionToken(req)), wallNow());
    return body;
  }
  function disconnectBanned(id) {
    const ws = profileConnections.get(id),
      ban = activeBan(profiles.byId(id), wallNow());
    if (ws && ban) {
      safeSend(
        ws,
        JSON.stringify({
          type: "accountBanned",
          reason: ban.reason,
          until: ban.until,
        }),
      );
      ws.removeFromArena?.();
      ws.close(4003, "Account blocked");
    }
  }
  function syncIdentities() {
    for (const [id, ws] of profileConnections) {
      const profile = profiles.byId(id),
        player = ws.arena.players.get(ws.playerId);
      if (profile && player) {
        Object.assign(player, profiles.identity(profile));
        safeSend(ws, JSON.stringify({ type: "profile", profile: profiles.view(profile) }));
      }
    }
    broadcast();
  }
  const httpServer = http.createServer(async (req, res) => {
    res.once("finish", () => {
      if (closing) httpServer.closeIdleConnections();
    });
    if (ownerAccess.relay && (req.url.startsWith('/api/admin/') || req.url === '/admin.html' || req.url === '/admin.htm') && !req.headers['x-killex-control'])
      return ownerAccess.relay(req, res);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store"); // обновления прототипа не застревают в кэше
    let pathname;
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
      // Static serving decodes and normalizes paths. Apply the same protection
      // to encoded aliases, e.g. /%61dmin.html, as to the canonical admin URL.
      const securityPath = path.posix.normalize(decodeURIComponent(pathname));
      if (/^\/(admin\.html|blocked\.html|api\/admin(?:\/|$))/.test(securityPath)) {
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        );
      }
    } catch (_) {
      res.writeHead(400);
      return res.end("Bad request");
    }
    if (pathname === "/api/service-status" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify(maintenance.status(closing)));
    }
    if(pathname.startsWith('/news-media/'))return newsMedia.serve(req,res,pathname);
    if (
      (maintenance.active || closing) &&
      pathname.startsWith("/api/") &&
      !pathname.startsWith("/api/admin/")
    ) {
      res.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Retry-After": "3" });
      return res.end(JSON.stringify({ code: "MAINTENANCE", ...maintenance.status(closing) }));
    }
    if ((maintenance.active || closing) && ["/", "/index.html"].includes(pathname)) {
      req.url = "/maintenance.html";
      res.statusCode = 503;
      res.setHeader("Retry-After", "3");
      return serveStatic(req, res, root);
    }
    if (closing) {
      res.writeHead(503, { Connection: "close" });
      return res.end("Server restarting");
    }
    if ((req.url || "").startsWith("/api/")) {
      const reply = (status, value) => {
        res.writeHead(status, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify(value));
      };
      try {
        if (!sameOrigin(req))
          throw new BoosterError("Запрос разрешён только со страницы игры.", 403);
        limitRequest(req, "api");
        if (req.method === "POST") limitRequest(req, "mutation");
        const visitor = profiles.find(sessionToken(req));
        const adminUrl = new URL(req.url, "http://localhost");
        if (adminUrl.pathname.startsWith("/api/admin/")) {
          if (adminUrl.pathname === "/api/admin/recover-profile") {
            ownerAccess.guardRecovery(req);
            if (req.method === "GET") return reply(200, { available: true });
            if (req.method !== "POST") return reply(405, { error: "Метод недоступен." });
            const body = await jsonBody(req);
            ownerAccess.verifyBody?.(req, body);
            await ownerAccess.verifyRecoveryPassword(body.password, req, body.code);
            if (arenaBatches.length && !(await waitForArenaWrites()))
              throw new BoosterError("Сохраняем прогресс. Попробуй чуть позже.", 503);
            requireRunning();
            if (
              profileConnections.has(ownerAccess.ownerId) ||
              (visitor && profileConnections.has(visitor.id))
            )
              throw new BoosterError("Сначала выйди из арены в лобби.", 409);
            if (!commitProgress())
              throw new BoosterError("Сохраняем прогресс. Попробуй чуть позже.", 503);
            const token = profiles.rotateOwnerSession();
            // Only the game session is restored. Admin still requires its own login.
            ownerAccess.session = null;
            res.setHeader(
              "Set-Cookie",
              `${sessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
            );
            return reply(200, { ok: true, name: profiles.byId(ownerAccess.ownerId).name });
          }
          const security = ownerAccess.security;
          if (adminUrl.pathname.startsWith('/api/admin/auth/')) {
            ownerAccess.guardTransport(req);
            if (req.method === 'GET' && adminUrl.pathname === '/api/admin/auth/status')
              return reply(200, { ...ownerAccess.status(req), ownerName: profiles.byId(ownerAccess.ownerId)?.name || 'Владелец' });
            if (req.method !== 'POST') return reply(405, { error: 'Метод недоступен.' });
            const body = await jsonBody(req); requireRunning();
            if (adminUrl.pathname === '/api/admin/auth/login') return reply(200, await security.login(body, req, res));
            if (adminUrl.pathname === '/api/admin/auth/verify') return reply(200, await security.verify(body, req, res));
            return reply(404, { error: 'Неизвестная операция входа.' });
          }
          if (!ownerAccess.principal(req)) ownerAccess.guard(req, visitor);
          const secure = ownerAccess.guardTransport(req);
          if (adminUrl.pathname === "/api/admin/status" && req.method === "GET")
            return reply(200, {
              ...ownerAccess.status(req),
              ownerName: profiles.byId(ownerAccess.ownerId)?.name || "Владелец",
            });
          if (
            ["/api/admin/login", "/api/admin/setup"].includes(adminUrl.pathname) &&
            req.method === "POST"
          ) {
            // Owner authentication must remain usable while a failed game WAL
            // is waiting for recovery. This operation does not mutate a profile.
            const body = await jsonBody(req);
            requireRunning();
            ownerAccess.guard(req,profiles.find(sessionToken(req)));
            requirePlayable(profiles.find(sessionToken(req)),wallNow());
            return reply(
              200,
              await ownerAccess.login(
                body,
                req,
                res,
                profiles.find(sessionToken(req)),
                adminUrl.pathname.endsWith("setup"),
              ),
            );
          }
          ownerAccess.authorize(req);
          ownerAccess.allowRoute(req, adminUrl.pathname);
          const actorProfile = () => { ownerAccess.authorize(req); const actor = ownerAccess.allowRoute(req, adminUrl.pathname); return actor.role === 'owner' ? profiles.byId(ownerAccess.ownerId) : actor; };
          const adminBody = async (request, limit) => {
            const body = await jsonBody(request, limit);
            ownerAccess.verifyBody?.(request, body);
            if (arenaBatches.length && !(await waitForArenaWrites())) throw new BoosterError('Прогресс ещё сохраняется.', 503);
            await ownerAccess.refresh?.(request);
            requireRunning(); actorProfile(); return body;
          };
          if (adminUrl.pathname.startsWith('/api/admin/control/')) {
            if (!ownerAccess.proof?.(req)?.editor || !ownerAccess.isOwner(actorProfile())) throw new BoosterError('Закрытый канал редакции.',403);
            const content = require('./admin/control-content'), sources = require('./admin/news-sources').sources(events,wallNow());
            if (adminUrl.pathname === '/api/admin/control/snapshot' && req.method === 'GET') return reply(200,content.snapshot(profiles,sources));
            if (adminUrl.pathname === '/api/admin/control/apply' && req.method === 'POST') {
              const body = await jsonBody(req,4*1024*1024); ownerAccess.verifyBody(req,body);
              requireRunning();
              if (!commitProgress()) throw new BoosterError('Прогресс ещё сохраняется.',503);
              return reply(200,content.applyBundle(profiles,ownerAccess,actorProfile(),body,sources));
            }
            return reply(404,{error:'Нет такого канала редакции.'});
          }
          if (adminUrl.pathname === '/api/admin/security' && req.method === 'GET') return reply(200, security.view(req));
          if (adminUrl.pathname.startsWith('/api/admin/security/') && req.method === 'POST') {
            const body = await jsonBody(req); requireRunning(); actorProfile();
            if (adminUrl.pathname === '/api/admin/security/profile') return reply(200, await security.editSelf(body, req, res));
            return reply(200, await security.ownerOperation(adminUrl.pathname.slice('/api/admin/security/'.length), body, req, res));
          }
          if (adminUrl.pathname === '/api/admin/moderators') {
            if (req.method === 'GET') return reply(200, { moderators: security.list() });
            if (req.method === 'POST') { const body = await jsonBody(req); requireRunning(); actorProfile(); return reply(200, await security.manage(body, req)); }
            return reply(405, { error: 'Метод недоступен.' });
          }
          if(adminUrl.pathname==='/api/admin/clan-seasons'){
            const service=require('./clans/daily-quests/admin');
            if(req.method==='GET')return reply(200,service.view(profiles));
            if(req.method==='POST'){
              const body=await adminBody(req);
              if(!commitProgress())throw new BoosterError('Прогресс ещё сохраняется.',503);
              return reply(200,service.apply(profiles,ownerAccess,actorProfile(),body));
            }
            return reply(405,{error:'Метод недоступен.'});
          }
          if(adminUrl.pathname==='/api/admin/maintenance'){
            const service=require('./admin/service-availability');
            if(req.method==='GET')return reply(200,service.view(profiles,maintenance));
            if(req.method==='POST'){
              const body=await adminBody(req);
              ownerAccess.authorize(req);
              if(!commitProgress())throw new BoosterError('Прогресс ещё сохраняется. Повтори позже.',503);
              const result=service.apply(profiles,ownerAccess,actorProfile(),body);
              maintenance.refreshState();
              serviceObserver?.observe();
              return reply(200,{...result,...service.view(profiles,maintenance)});
            }
            return reply(405,{error:'Метод недоступен.'});
          }
          if(adminUrl.pathname==='/api/admin/news/banner'&&req.method==='POST'){
            const body=await adminBody(req,1450000);
            ownerAccess.authorize(req);
            return reply(200,await newsMedia.upload(body.image));
          }
          if (adminUrl.pathname === "/api/admin/trash") {
            const trash = require("./admin/content-trash");
            if (req.method === "GET") return reply(200,trash.view(profiles,Object.fromEntries(adminUrl.searchParams)));
            if (req.method === "POST") {
              const body = await adminBody(req);
              ownerAccess.authorize(req);
              if (!commitProgress()) throw new BoosterError("Прогресс арены ещё сохраняется. Повтори позже.",503);
              const result = trash.restore(profiles,ownerAccess,actorProfile(),body);
              return reply(200,{...result,...trash.view(profiles)});
            }
          }
          const contentDomain = { "/api/admin/promo-codes": "promoCodes", "/api/admin/news": "gameNews" }[adminUrl.pathname];
          if (contentDomain) {
            const service = require(contentDomain === "promoCodes" ? "./profiles/promo-codes" : "./profiles/game-news");
            const contentView=()=>({...service.view(profiles,true),...(contentDomain==='gameNews'?{sources:require('./admin/news-sources').sources(events,wallNow())}:{})});
            if (req.method === "GET") return reply(200, contentView());
            if (req.method === "POST") {
              const body = await adminBody(req, contentDomain==='gameNews'?40000:4096);
              ownerAccess.authorize(req);
              if(contentDomain==='gameNews'&&body.image?.startsWith('/news-media/')&&!(await newsMedia.exists(body.image)))throw new BoosterError('Сначала загрузи баннер.',400);
              ownerAccess.authorize(req);
              if (!commitProgress()) throw new BoosterError("Прогресс арены ещё сохраняется. Повтори позже.", 503);
              if (contentDomain === 'gameNews' && body.action === 'delete-many') {
                const result = require('./admin/news-bulk-delete').remove(profiles, ownerAccess, actorProfile(), body,
                  require('./admin/news-sources').sources(events, wallNow()));
                return reply(200, { ...result, ...contentView() });
              }
              const source = contentDomain === 'gameNews' && body.action === 'delete'
                ? require('./admin/news-sources').sources(events,wallNow()).find(n=>n.id===body.id) : null;
              const result = require("./admin/content-actions").apply(profiles, ownerAccess,
                actorProfile(), contentDomain, body, service.normalize, null, source);
              return reply(200, { ...result, ...contentView() });
            }
          }
          if (adminUrl.pathname === "/api/admin/performance" && req.method === "GET")
            return reply(200, performanceStatus());
          if (adminUrl.pathname === '/api/admin/overview-calendar' && req.method === 'GET') {
            const state=events.view(), entry=run=>run?{startsAt:run.startsAt,endsAt:run.endsAt,manifest:{title:run.manifest.title,description:run.manifest.description}}:null;
            return reply(200,{serverNow:state.serverNow,active:entry(state.active),scheduled:entry(state.scheduled)});
          }
          if(adminUrl.pathname==='/api/admin/monitoring'&&req.method==='GET'){
            if(adminUrl.searchParams.get('graphs')==='1')serviceObserver?.requestMetrics();
            return reply(200,{...(serviceObserver?.snapshot()||{at:null,series:[],active:{},stale:true,logError:'MONITOR_NOT_CONFIGURED'}),availability:require('./admin/service-availability').view(profiles,maintenance)});
          }
          if(adminUrl.pathname==='/api/admin/service-journal'&&req.method==='GET'){
            const cursor=adminUrl.searchParams.get('cursor');
            return reply(200,serviceObserver?await serviceObserver.journal(adminUrl.searchParams.get('source'),cursor===null?null:Number(cursor)):{entries:[],cursor:null});
          }
          if (adminUrl.pathname === "/api/admin/events" && req.method === "GET")
            return reply(200, events.view());
          if (
            [
              "/api/admin/events/upload",
              "/api/admin/events/start",
              "/api/admin/events/stop",
              "/api/admin/events/duration",
              "/api/admin/events/reschedule",
            ].includes(adminUrl.pathname) &&
            req.method === "POST"
          ) {
            const body = await adminBody(req),
              action = adminUrl.pathname.split("/").at(-1);
            ownerAccess.authorize(req);
            if (!["upload", "duration"].includes(action)) {
              await ownerAccess.confirmPassword(
                body.password,
                req,
                actorProfile(),
              );
              delete body.password;
              requireRunning();
              ownerAccess.authorize(req);
            }
            return reply(200, events.apply(actorProfile().id, action, body));
          }
          if (adminUrl.pathname === '/api/admin/game-grants' && req.method === 'GET')
            return reply(200, gameGrants.view(actorProfile(), adminUrl.searchParams.get('page')));
          if (['/api/admin/game-grants/preview', '/api/admin/game-grants/send', '/api/admin/game-grants/retry'].includes(adminUrl.pathname) && req.method === 'POST') {
            const body = await adminBody(req, 16000);
            ownerAccess.authorize(req);
            if (!commitProgress()) throw new BoosterError('Прогресс арены ещё сохраняется. Повтори позже.', 503);
            return reply(200, adminUrl.pathname.endsWith('/preview') ? gameGrants.preview(actorProfile(), body) : adminUrl.pathname.endsWith('/retry') ? gameGrants.retry(actorProfile(), body) : gameGrants.create(actorProfile(), body));
          }
          if (req.method === "GET") {
            if (adminUrl.pathname === "/api/admin/payments") {
              const result = await owner.paymentReports.read(Object.fromEntries(adminUrl.searchParams));
              ownerAccess.authorize(req);
              return reply(200, result);
            }
            if (adminUrl.pathname === "/api/admin/players")
              return reply(
                200,
                owner.players(
                  adminUrl.searchParams.get("q") || "",
                  adminUrl.searchParams.get("page"),
                  Object.fromEntries(adminUrl.searchParams),
                ),
              );
            if (adminUrl.pathname === "/api/admin/player")
              return reply(200, owner.player(adminUrl.searchParams.get("id")));
            if (adminUrl.pathname === "/api/admin/transactions") {
              const result = await owner.transactions(
                  adminUrl.searchParams.get("targetId"),
                  adminUrl.searchParams.get("page"),
                  adminUrl.searchParams.get("filter") || "all",
                );
              ownerAccess.authorize(req);
              return reply(200, result);
            }
            if (adminUrl.pathname === "/api/admin/audit")
              return reply(
                200,
                owner.audit(
                  adminUrl.searchParams.get("targetId") || "",
                  adminUrl.searchParams.get("page"),
                  adminUrl.searchParams.get("source") || "all",
                ),
              );
          }
          if (adminUrl.pathname === "/api/admin/logout" && req.method === "POST") {
            ownerAccess.logout(res, secure, req);
            return reply(200, { ok: true });
          }
          if (adminUrl.pathname === '/api/admin/feedback' && feedback) {
            if(req.method==='GET')return reply(200,adminUrl.searchParams.has('number')?feedback.detail(adminUrl.searchParams.get('number')):feedback.list(Object.fromEntries(adminUrl.searchParams)));
            if(req.method==='POST'){const body=await adminBody(req);return reply(200,await feedback.update(ownerAccess.principal(req),body,()=>ownerAccess.authorize(req)));}
          }
          if (adminUrl.pathname === "/api/admin/action" && req.method === "POST") {
            const body = await adminBody(req);
            ownerAccess.authorize(req); // Сессия могла истечь, пока поступало тело запроса.
            if (!commitProgress())
              throw new BoosterError(
                "Сначала необходимо сохранить прогресс арены. Повтори позже.",
                503,
              );
            const result = owner.apply(actorProfile(), body);
            if (body.action === 'killReview' && !result.duplicate) kill.retrain();
            disconnectBanned(result.player.id);
            return reply(200, result);
          }
          return reply(404, { error: "Такой операции владельца нет." });
        }
        if (req.url === "/api/access" && req.method === "GET") {
          const ban = publicBan(visitor, profiles.data, ownerAccess.ownerId, wallNow());
          return reply(200, {
            blocked: !!ban,
            ...ban,
            serverNow: wallNow(),
          });
        }
        if (pathname === '/api/feedback' && req.method === 'POST') {
          const body = require('./admin/feedback-store').normalize(await jsonBody(req,6000));
          requireRunning();const current=profiles.find(sessionToken(req));
          if(!current)throw new BoosterError('Войди в игру, чтобы отправить отзыв.',401);
          return reply(200,ownerAccess.sendFeedback?await ownerAccess.sendFeedback(current,body):await feedback.submit(current,body));
        }
        requirePlayable(visitor, wallNow());
        // Лёгкая проверка восстановления: без создания жизни, записи профиля
        // и повторной обработки ожидающего сохранения по запросу клиента.
        if (req.url === "/api/arena/availability" && req.method === "GET") {
          const ready = !arenaTesting.active && !pendingProgress && !progressErrorReported && arenaBatches.length < 64;
          if (!ready) res.setHeader("Retry-After", "3");
          return reply(ready ? 200 : 503, arenaTesting.active ? { ready, ...arenaTesting.status() } : { ready });
        }
        if (visitor) {
          arenaRooms.enterLobby(visitor.id);
          presence.touch(visitor.id);
          registrationCleanup.touch(visitor.id);
        }
        if (req.url === "/api/arenas" && req.method === "GET") {
          if (!visitor) throw new BoosterError("Сначала открой лобби.", 401);
          if (arenaTesting.active) throw arenaClosedError();
          return reply(200, {
            group: require("./arena/arena-names").groupForLevel(visitor.level),
            arenas: arenaRooms.list(visitor.id).map((room) => ({
              ...room,
              joinable:
                room.joinable &&
                !pendingProgress &&
                !progressErrorReported &&
                arenaBatches.length < 64,
            })),
          });
        }
        if (
          ["/api/arena-reservations", "/api/arena-reservations/cancel"].includes(req.url) &&
          req.method === "POST"
        ) {
          if (!(req.headers["content-type"] || "").startsWith("application/json"))
            throw new BoosterError("Нужен JSON-запрос.", 415);
          const body = await playableBody(req);
          const profile = profiles.find(sessionToken(req));
          if (!profile) throw new BoosterError("Сначала открой лобби.", 401);
          if (req.url.endsWith("/cancel"))
            return reply(200, arenaRooms.cancel(profile.id, body.requestId));
          if (arenaTesting.active) throw arenaClosedError();
          if (!commitProgress())
            throw new BoosterError("Сохраняем прогресс. Попробуй чуть позже.", 503);
          return reply(200, arenaRooms.reserve(profile.id, body));
        }
        if (req.url === "/api/presence" && req.method === "GET") {
          if (!visitor) throw new BoosterError("Сначала войди в игру.", 401);
          return reply(200, {
            online: true,
            eventVersion: events.stamp(),
            newsRevision: profiles.data.gameNews?.revision || 0,
            promotionVersion: require("./shop/weekend-promotions").version(profiles.promotionConfig.weekend, profiles.now()),
            profileRevision: visitor.revision,
            profileId: visitor.id,
            menuNotifications: profiles.menuNotifications(visitor),
          });
        }
        if (req.url === "/api/test-mode" && req.method === "GET")
          return reply(200, {
            ...bots.status(),
            humanPlayers: [...rooms.values()].reduce((n, room) => n + room.bots.livingHumans(), 0),
            arenas: arenaRooms.list(),
          });
        if (req.url === "/api/profile" && req.method === "GET") {
          if (!visitor && req.headers["x-killex-profile"])
            throw new BoosterError("Не удалось восстановить сеанс. Разреши cookie для игры и обнови страницу.", 401);
          if (!profiles.find(sessionToken(req))) limitRequest(req, "registration");
          if (!arenaRooms.hasLobbySpace(visitor?.id))
            throw new BoosterError("Сервер заполнен, попробуйте позже", 503);
          const opened = profiles.open(sessionToken(req));
          arenaRooms.enterLobby(opened.profile.id);
          presence.touch(opened.profile.id);
          registrationCleanup.touch(opened.profile.id);
          opened.profile.online = true;
          if (opened.created)
            res.setHeader(
              "Set-Cookie",
              `${sessionCookie}=${opened.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secureRequest(req, trustLoopbackProxy) ? "; Secure" : ""}`,
            );
          return reply(200, {
            profile: opened.profile,
            serverNow: wallNow(),
            catalog: publicCatalog(),
            inArena: profileConnections.has(opened.profile.id),
          });
        }
        const apiUrl = new URL(req.url, "http://localhost");
        if (apiUrl.pathname === "/api/hall-of-fame" && req.method === "GET") {
          requireLobby(sessionToken(req));
          return reply(
            200,
            require("./rankings/hall-of-fame").view(profiles, apiUrl.searchParams.get("page") || 1),
          );
        }
        if (apiUrl.pathname === "/api/clans/chat" && ["GET", "POST"].includes(req.method)) {
          const input = req.method === "POST" ? await playableBody(req) : null;
          requireRunning();
          // Проверяем членство после чтения тела, чтобы выход/исключение из клана
          // во время запроса не позволяли отправить сообщение в прежний чат.
          const profile = profiles.find(sessionToken(req));
          const clan = chat.member(
            profiles,
            profile,
            input?.clanId || apiUrl.searchParams.get("clanId"),
          );
          return reply(
            200,
            req.method === "GET"
              ? {
                  clanId: clan.id,
                  chatModeration: chat.moderation.status(profile),
                  ...chat.history(clan.id, apiUrl.searchParams.get("after") || "", "arena-1",
                    require("./clans/battle-history").messages(clan, profiles.data.competition?.lastBattle?.[clan.id], profiles.now())),
                  memberHistory: require("./clans/member-history").page(clan, {
                    after: apiUrl.searchParams.get("historyAfter") || "",
                    before: apiUrl.searchParams.get("historyBefore") || "",
                    genderOf: (id) => profiles.byId(id)?.personal?.gender,
                  }),
                }
              : {
                  clanId: clan.id,
                  ...await chat.send(profile, clan, clan.id, input, "arena-1", () => {
                    requireRunning();
                    const current = profiles.find(sessionToken(req));
                    return { profile: current, clan: chat.member(profiles, current, clan.id) };
                  }),
                },
          );
        }
        if (apiUrl.pathname === "/api/social" && req.method === "GET") {
          const token = sessionToken(req);
          requireLobby(token);
          return reply(200, profiles.socialState(token));
        }
        if (apiUrl.pathname === "/api/social/gifts" && req.method === "GET") {
          requireLobby(sessionToken(req), { allowEndedRead: true });
          const player = profiles.byId(apiUrl.searchParams.get("playerId"));
          if (!player) throw new BoosterError("Игрок не найден.", 404);
          return reply(200, require("./profiles/gift-history").page(player,
            apiUrl.searchParams.get("giftId"), apiUrl.searchParams.get("before"), profiles.now()));
        }
        if (apiUrl.pathname === "/api/news" && req.method === "GET") {
          requireLobby(sessionToken(req));
          return reply(200, require("./profiles/game-news").view(profiles));
        }
        if (apiUrl.pathname.startsWith("/api/players/") && req.method === "GET") {
          requireLobby(sessionToken(req), { allowEndedRead: true });
          return reply(200, {
            player: profiles.publicPlayer(apiUrl.pathname.slice("/api/players/".length)),
          });
        }
        if (apiUrl.pathname === "/api/clans/view" && req.method === "GET") {
          const token = sessionToken(req);
          requireLobby(token);
          return reply(200, clans.preview(token, apiUrl.searchParams.get("clanId")));
        }
        if (apiUrl.pathname === "/api/clans" && req.method === "GET") {
          const token = sessionToken(req);
          requireLobby(token);
          const q = apiUrl.searchParams;
          return reply(
            200,
            clans.state(
              token,
              q.get("search") || "",
              q.get("page") || 1,
              q.get("selected") || "",
              q.get("players") || "greatness",
              q.get("playerPage") || 1,
              q.get("clans") || "greatness",
              ["clan", "rankings"].includes(q.get("scope")) ? q.get("scope") : "all",
            ),
          );
        }
        if (apiUrl.pathname === "/api/clans/updates" && req.method === "GET") {
          const token = sessionToken(req);
          requireLobby(token);
          const q = apiUrl.searchParams;
          let known = {};
          try {
            known = JSON.parse(q.get("known") || "{}");
          } catch (_) {
            throw new BoosterError("Некорректная версия данных клана.");
          }
          return reply(200, clans.updates(token, (q.get("parts") || "").split(","), known));
        }
        if (
          [
            "/api/quests/action",
            "/api/easter/action",
            "/api/alchemy/action",
            "/api/events/album/claim",
            "/api/black-friday/action",
            "/api/pets/action",
            "/api/roulette/action",
            "/api/social/action",
            "/api/promo-code/redeem",
            "/api/profile/loadout",
            "/api/profile/personal",
            "/api/profile/accessory",
            "/api/profile/skin-collection",
            "/api/profile/appearance",
            "/api/profile/account",
            "/api/profile/account-bonus",
            "/api/profile/login-reward",
            "/api/profile/daily-ranking-rewards/dismiss",
            "/api/profile/promotions/seen",
            "/api/profile/title-notice",
            "/api/profile/admin-notices/read",
            "/api/profile/game-gifts/read",
            "/api/mock-payments/confirm",
            "/api/clans/action",
            "/api/chests/open",
            "/api/chests/prepare",
            "/api/clan-chests/action",
          ].includes(req.url) &&
          req.method === "POST"
        ) {
          if (!(req.headers["content-type"] || "").startsWith("application/json"))
            throw new BoosterError("Нужен JSON-запрос.", 415);
          const body = await playableBody(req),
            token = sessionToken(req);
          requireLobby(token);
          if (req.url === '/api/profile/game-gifts/read') return reply(200, require('./admin/game-grants').acknowledge(profiles,token,body));
          if (req.url === '/api/profile/admin-notices/read') return reply(200, require('./admin/adjustment-notices').acknowledge(profiles,token,body));
          if (req.url === "/api/promo-code/redeem") {
            if (!commitProgress()) throw new BoosterError("Прогресс арены ещё сохраняется. Повтори позже.", 503);
            return reply(200, require("./profiles/promo-codes").redeem(profiles, token, body));
          }
          // Опыт, заработанный до смены членства, должен сохраниться в прежний клан.
          if (req.url === "/api/clans/action" && !commitProgress())
            throw new BoosterError(
              "Не удалось сохранить опыт арены. Повтори действие клана чуть позже.",
              503,
            );
          if (req.url === "/api/profile/accessory" && !commitProgress())
            throw new BoosterError(
              "Не удалось сохранить опыт арены. Повтори смену аксессуара чуть позже.",
              503,
            );
          if (
            ["/api/profile/account", "/api/mock-payments/confirm"].includes(req.url) &&
            !commitProgress()
          )
            throw new BoosterError(
              "Не удалось сохранить опыт арены. Повтори активацию чуть позже.",
              503,
            );
          if (req.url === "/api/profile/login-reward")
            return reply(200, profiles.claimLoginReward(token, body));
          if (req.url === "/api/profile/daily-ranking-rewards/dismiss")
            return reply(200, profiles.dismissDailyRankingRewards(token, body));
          if (req.url === "/api/profile/promotions/seen")
            return reply(200, profiles.acknowledgePromotions(token, body));
          if (req.url === "/api/profile/title-notice")
            return reply(200, profiles.acknowledgeTitle(token, body));
          if (req.url === "/api/quests/action")
            return reply(200, profiles.questAction(token, body));
          if (req.url === "/api/easter/action") {
            if (!commitProgress())
              throw new BoosterError("Не удалось сохранить сбор яиц. Повтори действие позже.", 503);
            return reply(200, require("./events/easter-hunt").mutate(profiles, token, body));
          }
          if (req.url === "/api/alchemy/action")
            return reply(200, await durableLobbyAction(token, batch =>
              require("./events/ether-alchemy").mutate(profiles, token, body, batch)));
          if (req.url === "/api/events/album/claim")
            return reply(200, require("./events/event-album").claim(profiles, token, body));
          if (req.url === "/api/black-friday/action") {
            if (!commitProgress())
              throw new BoosterError("Не удалось сохранить заказы. Повтори действие позже.", 503);
            return reply(200, require("./events/black-friday").mutate(profiles, token, body));
          }
          if (req.url === "/api/profile/skin-collection")
            return reply(
              200,
              await durableLobbyAction(token, (batch) =>
                profiles.buySkinCollection(token, body, batch),
              ),
            );
          const result =
            req.url === "/api/roulette/action"
              ? rouletteService.mutate(profiles, token, body)
              : req.url === "/api/pets/action"
                ? petService.mutate(profiles, token, body)
                : req.url === "/api/social/action"
                  ? profiles.socialAction(token, body)
                  : req.url === "/api/profile/appearance"
                    ? profiles.setAppearance(token, body)
                    : req.url === "/api/profile/account-bonus"
                      ? await durableLobbyAction(token, (batch) =>
                          profiles.claimAccountCurrencyBonus(token, body, batch),
                        )
                      : req.url === "/api/mock-payments/confirm"
                        ? profiles.confirmMockPurchase(token, body)
                        : req.url === "/api/clan-chests/action"
                          ? profiles.clanChestAction(token, body)
                          : req.url === "/api/profile/loadout"
                            ? await durableLobbyAction(token, (batch) =>
                                profiles.setLoadout(token, body, batch),
                              )
                            : req.url === "/api/profile/personal"
                              ? profiles.setPersonal(token, body)
                              : req.url === "/api/profile/account"
                                ? profiles.activateAccount(token, body)
                                : req.url === "/api/profile/accessory"
                                  ? profiles.setAccessory(token, body)
                                  : req.url === "/api/chests/prepare"
                                    ? profiles.prepareChest(token, body.chestId, body.requestId)
                                    : req.url === "/api/chests/open"
                                      ? profiles.openChest(token, body.chestId, body.requestId)
                                      : clans.mutate(token, body);
          if (req.url === "/api/clans/action") syncIdentities();
          return reply(200, result);
        }
        if (req.url === "/api/shop/buy" && req.method === "POST") {
          if (!(req.headers["content-type"] || "").startsWith("application/json"))
            throw new BoosterError("Нужен JSON-запрос.", 415);
          const body = await playableBody(req);
          requireRunning();
          const token = sessionToken(req);
          // Recheck lobby access both before preparation and after durable staging.
          const result = await durableLobbyAction(token, (batch) =>
            profiles.buy(token, body.boosterId, body.requestId, batch),
          );
          return reply(200, result);
        }
        return reply(404, { error: "Такой операции нет." });
      } catch (error) {
        if (res.destroyed) return;
        if (error.retryAfter) res.setHeader("Retry-After", error.retryAfter);
        if (!(error instanceof BoosterError))
          console.error("Ошибка сохранения профиля:", error.message);
        return reply(error.status || 500, {
          error:
            error instanceof BoosterError
              ? error.message
              : "Не удалось сохранить профиль. Операция не выполнена.",
          code: [
            "ARENA_ACTIVE",
            "ARENA_TEMPORARILY_CLOSED",
            "ACCOUNT_BANNED",
            "CHAT_MUTED",
            "CHAT_REJECTED",
            "ARENAS_FULL",
            "ONLINE_LIMIT",
            "INVALID_ARENA",
            "RESERVATION_EXPIRED",
            "REQUEST_CONFLICT",
          ].includes(error.code)
            ? error.code
            : undefined,
          chatModeration: error.chatModeration,
        });
      }
    }
    return serveStatic(req, res, root);
  });
  const wss = new WebSocket.Server({
    noServer: true,
    maxPayload: 2048,
    perMessageDeflate: false,
  });
  httpServer.on("upgrade", async (req, socket, head) => {
    if (closing || maintenance.active || arenaTesting.active) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      return;
    }
    if (!sameOrigin(req)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const budget = requestLimits.take(clientAddress(req, trustLoopbackProxy), "upgrade");
    if (!budget.allowed) {
      socket.end(
        `HTTP/1.1 429 Too Many Requests\r\nRetry-After: ${budget.retryAfter}\r\nConnection: close\r\n\r\n`,
      );
      return;
    }
    if (
      (arenaBatches.length && !(await waitForArenaWrites())) ||
      (pendingProgress && !commitProgress()) ||
      closing ||
      maintenance.active || arenaTesting.active
    ) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      return;
    }
    if (socket.destroyed) return;
    const match = /^\/ws\/(arena-[1-9][0-9]*)$/.exec(req.url || "");
    const roomId = match?.[1] || (req.url === "/" && !arenaPolicy ? "arena-1" : null);
    if (!rooms.has(roomId) || wss.clients.size >= arenaRooms.directory.policy.maximumArenaPlayers) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      return;
    }
    const profile = profiles.find(sessionToken(req));
    if (activeBan(profile, wallNow())) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    if (profile && profileConnections.has(profile.id)) {
      socket.end("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n");
      return;
    }
    if (match) {
      const ticket = (req.headers["sec-websocket-protocol"] || "")
        .split(",")
        .map((value) => value.trim())
        .find((value) => value.startsWith("ticket."))
        ?.slice(7);
      if (!profile || !arenaRooms.claim(profile.id, roomId, ticket)) {
        socket.end("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n");
        return;
      }
    }
    req.arenaRoomId = roomId;
    try {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } catch (error) {
      if (match && profile) arenaRooms.release(profile.id);
      socket.destroy();
    }
  });
  function safeSend(ws, data) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 1024 * 1024) {
      ws.terminate();
      return;
    }
    ws.send(data, { binary: false }, (error) => {
      if (error) ws.terminate();
    });
  }
  wss.on("connection", (ws, req) => {
    if (closing || maintenance.active || arenaTesting.active) {
      const profile=profiles.find(sessionToken(req));
      if(profile)arenaRooms.release(profile.id);
      if (maintenance.active) safeSend(ws,JSON.stringify({type:'maintenance',...maintenance.status()}));
      else if (arenaTesting.active) safeSend(ws,JSON.stringify({type:'arenaClosed',...arenaTesting.status()}));
      ws.close(arenaTesting.active ? 1013 : 1012,'Arena temporarily closed');return;
    }
    require("./arena/socket-frames").coalesceServerFrames(ws);
    const room = rooms.get(req.arenaRoomId);
    const { arena, bots } = room;
    ws.arena = arena;
    ws.arenaId = room.id;
    const token = sessionToken(req);
    const profile = profiles.find(token);
    const p = arena.addPlayer(
      now(),
      undefined,
      profile ? accounts.publicAccount(profile, profiles.now()) : undefined,
    );
    if (profile) {
      try {
        profiles.startLife(profile.id, p.lifeId);
      } catch (error) {
        console.error("Не удалось начать жизнь:", error.message);
        arena.removePlayer(p.id);
        arenaRooms.release(profile.id);
        ws.close(1011, "Cannot save life");
        return;
      }
      p.giftModifiers = require("./profiles/gift-effects").modifiers(
        profiles.byId(profile.id),
        profiles.now(),
      );
      if (p.massAccrual) p.massAccrual.giftXp = p.giftModifiers.xp;
      arenaPets.start(p, profiles.byId(profile.id), now(), profiles.now());
      p.profileId = profile.id;
      profileConnections.set(profile.id, ws);
      Object.assign(p, profiles.identity(profile));
      accessoryAbilities.start(p, profiles.byId(profile.id));
      p.quickSlots = [...(profile.quickSlots || [])];
    }
    ws.playerId = p.id;
    ws.alive = true;
    ws.stateStream = stateWorkers.createStream(room.id, ws, safeSend);
    let tokens = 80,
      tokenAt = rateNow(),
      seenStall = stalledAt,
      catchUpControls = 0;
    safeSend(
      ws,
      JSON.stringify({
        type: "welcome",
        id: p.id,
        arenaId: room.id,
        arenaName:
          arenaRooms.directory.rooms.get(room.id)?.name ||
          require("./arena/arena-names").arenaName(room.id),
        world: arena.world,
        backgroundId: arenaBackground(arena),
        serverVersion: "0.6.0",
      }),
    );
    ws.stateStream.publish(arenaSnapshot(arena, now()));
    if (profile)
      safeSend(
        ws,
        JSON.stringify({
          type: "chatHistory",
          chatModeration: chat.moderation.status(profile),
          ...chat.history(null, "", room.id),
        }),
      );
    if (profile)
      safeSend(
        ws,
        JSON.stringify({
          type: "profile",
          profile: profiles.view(profiles.find(token)),
        }),
      );
    ws.on("pong", () => {
      ws.alive = true;
    });
    let continuingLife = null;
    const killSession = kill.session();
    ws.on("message", async (raw, isBinary) => {
      if (closing || maintenance.active || arenaTesting.active) return;
      if (profile && activeBan(profiles.byId(profile.id), wallNow())) {
        disconnectBanned(profile.id);
        return;
      }
      let t = now();
      const receivedAt = rateNow();
      observeArenaTurn(receivedAt);
      if (seenStall !== stalledAt) {
        seenStall = stalledAt;
        catchUpControls = stalledControls;
      }
      tokens = Math.min(80, tokens + Math.max(0, receivedAt - tokenAt) * 0.04);
      tokenAt = Math.max(tokenAt, receivedAt);
      if (isBinary) {
        ws.terminate();
        return;
      }
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (_) {
        if (--tokens < 0) ws.terminate();
        return;
      }
      if (profile) {
        if (inputIntegrity.pending.has(profile.id)) return;
        if (inspectArenaInput(message)) {
          inputIntegrity.report(profile.id, message).catch(error => {
            console.error("Не удалось сохранить проверку целостности:", error.message);
            ws.terminate();
          });
          return;
        }
      }
      // A valid acknowledgement is server-paced. It must not consume the
      // movement/booster budget; forged or repeated acknowledgements still do.
      if (message?.type === "stateAck" && ws.stateStream.acknowledge(message.sequence)) return;
      const control = message?.type;
      if (
        catchUpControls > 0 &&
        receivedAt - stalledAt < 1000 &&
        (control === "move" ||
          control === "stop" ||
          control === "viewport" ||
          control === "split" ||
          control === "feed")
      ) {
        catchUpControls--;
      } else if (--tokens < 0) {
        ws.terminate();
        return;
      }
      if (message?.type === "stateAck") return;
      if (profile && !p.dead) kill.observe(killSession,profile.id,message,receivedAt,{stalled:receivedAt-stalledAt<2000});
      if (message?.type === "viewport") {
        const view = arenaVisibility.viewport(message, arena.world);
        if (view) ws.stateStream.viewport = view;
        return;
      }
      if (message?.type === "chatSend") {
        try {
          if ((arenaBatches.length && !(await waitForArenaWrites())) || (pendingProgress && !commitProgress()))
            throw new BoosterError("Не удалось сохранить прогресс. Повтори отправку позже.", 503);
          if (closing || removed || maintenance.active || arenaTesting.active) return;
          const author = profile && profiles.byId(profile.id);
          const clan = author && profiles.data.clans[author.clanId];
          const result = await chat.send(author, clan, null, message, room.id, () => {
            if (closing || removed || maintenance.active || arenaTesting.active)
              throw new BoosterError("Сеанс арены завершён. Сообщение не отправлено.", 409);
            const current = profiles.byId(profile.id);
            if (!current) throw new BoosterError("Сначала войди в игру.", 401);
            return { profile: current, clan: profiles.data.clans[current.clanId] || null };
          });
          if (!result.duplicate) {
            const packet = JSON.stringify({
              type: "chatMessage",
              message: result.message,
            });
            for (const peer of wss.clients)
              if (peer.arenaId === room.id && arena.players.get(peer.playerId)?.profileId)
                safeSend(peer, packet);
          }
          safeSend(
            ws,
            JSON.stringify({
              type: "chatResult",
              requestId: message.requestId,
              ok: true,
              message: result.message,
            }),
          );
        } catch (error) {
          safeSend(
            ws,
            JSON.stringify({
              type: "chatResult",
              requestId: message.requestId,
              ok: false,
              code: error.code,
              chatModeration: error.chatModeration,
              error:
                error instanceof BoosterError ? error.message : "Не удалось отправить сообщение.",
            }),
          );
        }
        return;
      }
      if (message?.type === "leaveLife") {
        try {
          if (arenaBatches.length && !(await waitForArenaWrites()))
            throw new BoosterError("Не удалось сохранить результат. Повтори позже.", 503);
          if (closing || removed) return;
          t = now();
          if (!Number.isInteger(message.spawnSerial) || message.spawnSerial !== p.spawnSerial)
            throw new BoosterError("Эта жизнь уже завершена или продолжена.", 409);
          if (pendingProgress && !commitProgress())
            throw new BoosterError(
              "Не удалось сохранить прогресс. Повтори подтверждение выхода.",
              503,
            );
          if (p.dead) {
            // Поглощение могло произойти раньше подтверждения. Возвращаем настоящий итог.
            const fresh = profiles.find(token),
              result = fresh?.progress.lastLife || ws.lastLifeResult;
            if (!result || result.id !== p.lifeId)
              throw new BoosterError("Итог ещё сохраняется. Повтори запрос.", 503);
            safeSend(
              ws,
              JSON.stringify({
                type: "lifeEnded",
                result,
                profile: fresh ? profiles.view(fresh) : undefined,
              }),
            );
          } else {
            const progress = departureProgress(t);
            arena.leaveRemnant(p, t);
            p.dead = true;
            p.endedAt = t;
            progress.push(...bots.clearIfIdle(t));
            const departure = {
              id: `${runId}:leaveLife:${p.lifeId}`,
              manualLeave: true,
              at: wallNow(),
              progress,
              events: [
                {
                  type: "left",
                  arenaId: room.id,
                  playerId: p.id,
                  lifeId: p.lifeId,
                  durationSeconds: Math.max(0, Math.floor((t - p.lifeStartedAt) / 1000)),
                },
              ],
            };
            if (profiles.journal) arenaBatches.push(departure);
            else pendingProgress = departure;
            if (profiles.journal ? !(await waitForArenaWrites()) : !commitProgress())
              throw new BoosterError("Результат сохраняется. Повтори подтверждение выхода.", 503);
          }
        } catch (error) {
          safeSend(
            ws,
            JSON.stringify({
              type: "leaveResult",
              ok: false,
              spawnSerial: message.spawnSerial,
              message:
                error instanceof BoosterError
                  ? error.message
                  : "Не удалось завершить жизнь. Повтори подтверждение выхода.",
            }),
          );
        }
        return;
      }
      if (message?.type === "continueLife") {
        // Retransmission while fsync is pending shares the original response.
        // A second life must never be queued for the same dead spawn.
        if (continuingLife) return;
        continuingLife = message.lifeId || true;
        try {
          if (
            ws.lastLifeResult?.id !== message.lifeId &&
            arenaBatches.length &&
            !(await waitForArenaWrites())
          )
            throw new BoosterError("Не удалось сохранить результат. Повтори позже.", 503);
          if (closing || removed) return;
          t = now();
          if (!p.dead && ws.lastContinuedLifeId === message.lifeId) {
            safeSend(
              ws,
              JSON.stringify({
                type: "continueResult",
                ok: true,
                lifeId: message.lifeId,
              }),
            );
            ws.stateStream.publish(arenaSnapshot(arena, t));
            return;
          }
          if (!p.dead || p.lifeId !== message.lifeId)
            throw new BoosterError("Эта жизнь уже завершена или продолжена.", 409);
          if (
            (pendingProgress && !commitProgress()) ||
            (profile &&
              profiles.journal &&
              profiles.byId(profile.id)?.progress.lastLife?.id !== message.lifeId)
          )
            throw new BoosterError(
              "Не удалось сохранить результат. Попробуй продолжить позже.",
              503,
            );
          if (
            arenaRooms.directory.levelGroups &&
            profile &&
            arenaRooms.directory.rooms.get(ws.arenaId)?.group !== arenaRooms.group(profile.id)
          )
            throw new BoosterError(
              "Ты перешёл в новую группу. Выйди в лобби и выбери комнату своего уровня.",
              409,
            );
          const lifeId = randomUUID();
          await new Promise((resolve, reject) =>
            boosterQueue.use({
              owner: p.id,
              prepare(batch) {
                const valid = () =>
                  !closing &&
                  !maintenance.active &&
                  !arenaTesting.active &&
                  !removed &&
                  ws.readyState === WebSocket.OPEN &&
                  arena.players.get(p.id) === p &&
                  p.dead &&
                  p.lifeId === message.lifeId &&
                  (!arenaRooms.directory.levelGroups ||
                    !profile ||
                    arenaRooms.directory.rooms.get(ws.arenaId)?.group ===
                      arenaRooms.group(profile.id)) &&
                  (!profile || !activeBan(profiles.byId(profile.id), wallNow()));
                if (!valid())
                  throw new BoosterError("Эта жизнь уже завершена или недоступна.", 409);
                if (profile) profiles.startLife(profile.id, lifeId, false, batch);
                return {
                  valid,
                  finish() {
                    // Publishing the durable session and resetting the arena
                    // player are synchronous: disconnect cannot split the pair.
                    const fresh = profiles.find(token),
                      startedAt = now();
                    if (fresh) Object.assign(p, profiles.identity(fresh));
                    arena.resetPlayer(p, startedAt, lifeId);
                    if (fresh) {
                      arenaPets.start(p, fresh, startedAt, profiles.now());
                      accessoryAbilities.start(p, fresh);
                    }
                    ws.lastContinuedLifeId = message.lifeId;
                    safeSend(
                      ws,
                      JSON.stringify({
                        type: "continueResult",
                        ok: true,
                        lifeId: message.lifeId,
                        profile: fresh ? profiles.view(fresh) : undefined,
                      }),
                    );
                    ws.stateStream.publish(arenaSnapshot(arena, startedAt));
                    resolve();
                  },
                };
              },
              fail: reject,
            }),
          );
        } catch (error) {
          safeSend(
            ws,
            JSON.stringify({
              type: "continueResult",
              ok: false,
              lifeId: message.lifeId,
              message:
                error instanceof BoosterError
                  ? error.message
                  : "Не удалось начать новую жизнь. Попробуй позже.",
            }),
          );
        } finally {
          continuingLife = null;
        }
        return;
      }
      if (message?.type === "useAccessoryBooster") {
        try {
          if (!profile) throw new BoosterError("Нужен профиль.", 401);
          if (arenaProgressPaused() || (pendingProgress && !commitProgress()))
            throw new BoosterError("Сервер сохраняет прогресс. Повтори позже.", 503);
          const { event, ...result } = accessoryAbilities.use(arena, p, message, t);
          safeSend(
            ws,
            JSON.stringify({
              type: "accessoryBoosterResult",
              requestId: message.requestId,
              ok: true,
              ...result,
            }),
          );
          if (event) pendingInputEvents.push({ ...event, arenaId: ws.arenaId });
        } catch (error) {
          safeSend(
            ws,
            JSON.stringify({
              type: "accessoryBoosterResult",
              requestId: message.requestId,
              ok: false,
              message:
                error instanceof BoosterError
                  ? error.message
                  : "Не удалось применить бустер аксессуара.",
            }),
          );
        }
        return;
      }
      if (message?.type === "usePetBooster") {
        try {
          if (arenaProgressPaused() || (pendingProgress && !commitProgress()))
            throw new BoosterError("Сервер сохраняет прогресс. Повтори позже.", 503);
          if (!profile) throw new BoosterError("Нужен профиль.", 401);
          const result = arenaPets.use(arena, p, message, t);
          safeSend(
            ws,
            JSON.stringify({
              type: "petBoosterResult",
              requestId: message.requestId,
              ok: true,
              ...result,
            }),
          );
        } catch (error) {
          safeSend(
            ws,
            JSON.stringify({
              type: "petBoosterResult",
              requestId: message.requestId,
              ok: false,
              message:
                error instanceof BoosterError
                  ? error.message
                  : "Не удалось применить бустер питомца.",
            }),
          );
        }
        return;
      }
      if (message?.type === "useBooster") {
        const signature = JSON.stringify([
          "use",
          p.id,
          message.spawnSerial,
          message.boosterId,
          message.targetId,
          message.targetSpawnSerial,
          message.aimX,
          message.aimY,
        ]);
        boosterQueue.use({
          owner: p.id,
          target: BOOSTERS.get(message.boosterId)?.target === "opponent" ? message.targetId : null,
          prepare(batch) {
            let apply, recordedPeak;
            const validate = () => {
              if (
                closing ||
                maintenance.active ||
                arenaTesting.active ||
                pendingProgress ||
                arenaProgressPaused() ||
                ws.readyState !== WebSocket.OPEN ||
                arena.players.get(p.id) !== p
              )
                throw new BoosterError("Арена сейчас недоступна. Предмет сохранён.", 409);
              const profile = profiles.find(token);
              requirePlayable(profile, wallNow());
              const benefits = accounts.benefits(profile, profiles.now());
              if (
                !(BOOSTERS.get(message.boosterId)?.kind === "potion" &&
                  (p.potionQueue || [p.potionEquipped]).includes(require("./events/ether-alchemy").rules.get(message.boosterId)?.id)) &&
                !p.quickSlots?.some(
                  (id, index) =>
                    id === message.boosterId && loadout.unlocked(index, benefits, profile.level),
                )
              )
                throw new BoosterError(
                  "Этот бустер не выбран в доступных слотах перед входом на арену.",
                );
              apply = arena.prepareBooster(p.id, message, now());
              const booster = BOOSTERS.get(message.boosterId);
              const gain =
                booster.kind === "mass"
                  ? Math.max(
                      0,
                      Math.min(
                        Math.floor(
                          require("./arena/alchemy-effects").prepare(p, booster, now()).booster.amount *
                            arenaPets.positiveFactor(p) *
                            require("./profiles/gift-effects").arena(p, "outgoing"),
                        ),
                        massLimitForLevel(p.level) - arena.mainBody(p).mass,
                      ),
                    )
                  : 0;
              return { mass: p.mass + gain, lifeId: p.lifeId };
            };
            const result = profiles.consume(
              token,
              message.boosterId,
              message.requestId,
              signature,
              () => {
                const predicted = validate();
                recordedPeak = Math.max(profiles.find(token).progress.maxMass, predicted.mass);
                return predicted;
              },
              ws.stateStream.entityDeltas,
              batch,
            );
            return {
              valid:
                !result.replay &&
                (() => {
                  try {
                    const predicted = validate();
                    // For a projectile/effect the staged peak is an already
                    // observed mass, not a prediction. Feeding, natural loss or
                    // absorption during fsync cannot invalidate that history.
                    // Instant food still has to match its future post-cast peak.
                    return (
                      BOOSTERS.get(message.boosterId)?.kind !== "mass" ||
                      Math.max(profiles.find(token).progress.maxMass, predicted.mass) ===
                        recordedPeak
                    );
                  } catch {
                    return false;
                  }
                }),
              finish() {
                const current = profiles.find(token);
                result.profile ??= ws.stateStream.entityDeltas
                  ? profiles.arenaView(current)
                  : profiles.view(current);
                Object.assign(p, profiles.identity(current));
                p.quickSlots = [...(result.profile.quickSlots || [])];
                if (!result.replay) {
                  const event = apply();
                  if (event) pendingInputEvents.push({ ...event, arenaId: ws.arenaId });
                }
                safeSend(
                  ws,
                  JSON.stringify({
                    type: "boosterResult",
                    requestId: message.requestId,
                    ok: true,
                    ...(BOOSTERS.get(message.boosterId)?.kind === "mass" && {
                      repeatAfterMs: Math.max(
                        0,
                        Math.ceil((p.boosterItemReadyAt[message.boosterId] || 0) - now()),
                      ),
                    }),
                    ...(ws.stateStream.entityDeltas
                      ? { profilePatch: result.profile, replay: result.replay }
                      : result),
                  }),
                );
              },
            };
          },
          fail(error) {
            if (!(error instanceof BoosterError))
              console.error("Ошибка применения бустера:", error.message);
            safeSend(
              ws,
              JSON.stringify({
                type: "boosterResult",
                requestId: message.requestId,
                ok: false,
                message:
                  error instanceof BoosterError
                    ? error.message
                    : "Не удалось сохранить расход предмета. Попробуй позже.",
              }),
            );
          },
        });
        return;
      }
      if (message?.type === "setTurbo") {
        const result = require("./arena/turbo-ability").set(p, message, t);
        if (result) {
          safeSend(
            ws,
            JSON.stringify({
              type: "turboResult",
              spawnSerial: p.spawnSerial,
              ...result,
            }),
          );
        }
        return;
      }
      if (message?.type === "split" || message?.type === "feed") {
        if (arenaProgressPaused() || (pendingProgress && !commitProgress())) return;
        // Inputs mutate the authoritative arena immediately. Publish their
        // result on the next 50 ms simulation tick, not once per key press to
        // every player. Even unsuccessful Space presses used to flood states.
        arena.handleInput(p.id, message, t);
        return;
      }
      if (message?.type === "rename") {
        if (typeof message.name !== "string") return;
        try {
          require("./admin/reserved-name").requireAllowedName(
            profile?.id,
            message.name,
            ownerAccess.ownerId,
          );
          require("./profiles/nickname-rules").requireAvailable(
            Object.values(profiles.data.profiles),
            cleanName(message.name),
            profile?.id,
          );
        } catch (_) {
          return;
        }
      }
      if (!profile || message?.type === "move" || message?.type === "stop")
        arena.handleInput(p.id, message, t);
    });
    function departureProgress(at) {
      if (!profile) return [];
      const progress = require("./arena/quest-actions").takePending(arena, p.id)
        .map(event => ({ ...event, profileId: profile.id }));
      if (p.dead) return progress;
      arena.decayMass(p, at);
      progress.push({ type: "massPeak", profileId: profile.id, mass: p.mass });
      const bonus = require("./arena/mass-accrual").sample(p, at, true);
      if (bonus) progress.push({ ...bonus, profileId: profile.id });
      progress.push({
        type: "lifeEnded",
        profileId: profile.id,
        lifeId: p.lifeId,
        durationSeconds: Math.max(0, Math.floor((at - p.lifeStartedAt) / 1000)),
        durationMs: Math.max(0, Math.floor(at - p.lifeStartedAt)),
        food: p.questFoodCount,
        clanFood: p.clanFoodCount,
        reason: "left",
      });
      return progress;
    }
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      ws.stateStream.dispose?.();
      // Закрытие между тиками сохраняет накопление за последний активный интервал.
      const departedAt=Math.min(maintenanceFreezeAt??Infinity,arenaTestingFreezeAt??Infinity,now());
      const departureWallAt=arenaTestingFreezeWallAt??wallNow();
      const progress = departureProgress(departedAt);
      if (!closing && !maintenance.active && !arenaTesting.active && !activeBan(profile && profiles.byId(profile.id), wallNow()))
        arena.leaveRemnant(p, now());
      arena.removePlayer(p.id);
      progress.push(...bots.clearIfIdle(departedAt));
      if (profileConnections.get(profile?.id) === ws) profileConnections.delete(profile.id);
      if (progress.length) {
        if (profiles.journal && !closing && !pendingProgress) {
          arenaBatches.push({ id: `${runId}:leave:${p.id}`, at: departureWallAt, progress, events: [] });
          writeArenaBatches();
          return;
        }
        if (pendingProgress) pendingProgress.progress.push(...progress);
        else
          pendingProgress = {
            id: `${runId}:leave:${p.id}`,
            at: departureWallAt,
            progress,
            events: [],
          };
        commitProgress();
      }
    };
    ws.removeFromArena = remove;
    ws.on("close", remove);
    ws.on("error", () => {
      remove();
      ws.terminate();
    });
  });
  let lastRankingsAt = -Infinity;
  const pendingInputEvents = [];
  function broadcast(events = []) {
    if (pendingInputEvents.length) events = pendingInputEvents.splice(0).concat(events);
    const at = now(),
      includeRankings = at - lastRankingsAt >= 1000;
    if (includeRankings) lastRankingsAt = at;
    const snapshots = new Map();
    for (const ws of wss.clients) {
      if (!ws.arena || !ws.stateStream) continue;
      if (!snapshots.has(ws.arenaId))
        snapshots.set(
          ws.arenaId,
          arenaSnapshot(
            ws.arena,
            at,
            events.filter((event) => (event.arenaId || "arena-1") === ws.arenaId),
            includeRankings,
          ),
        );
      ws.stateStream.publish(snapshots.get(ws.arenaId));
    }
    stateWorkers.flush();
  }
  const dirtyArenaProfiles = new Set();
  let lastArenaProfilePublishAt = -Infinity;
  function publishArenaProfiles() {
    const at = now();
    if (at - lastArenaProfilePublishAt < 1000) return;
    lastArenaProfilePublishAt = at;
    for (const id of dirtyArenaProfiles) {
      const ws = profileConnections.get(id),
        profile = profiles.byId(id);
      if (ws && profile) {
        const active = ws.arena?.players.get(ws.playerId);
        const patch = ws.stateStream.entityDeltas && active && !active.dead;
        safeSend(
          ws,
          JSON.stringify({
            type: "profile",
            ...(patch
              ? { profilePatch: profiles.arenaView(profile) }
              : { profile: profiles.view(profile) }),
          }),
        );
      }
    }
    dirtyArenaProfiles.clear();
  }
  function notifyProgress(batch, changed) {
    const findBot = require("./arena/profile-player-lookup").createBotLookup(rooms);
    for (const id of changed) {
      const ws = profileConnections.get(id),
        p = profiles.byId(id),
        player =
          ws?.arena.players.get(ws.playerId) ||
          findBot(id);
      if (player) Object.assign(player, profiles.identity(p));
      // Persist first; coalesce only the heavy UI projection. Purchases,
      // booster receipts and lifeEnded retain their immediate reliable replies.
      if (ws) dirtyArenaProfiles.add(id);
    }
    const events = batch.events;
    for (const event of events)
      if (
        (event.type === "absorbed" && event.victimDefeated !== false) ||
        event.type === "left" ||
        event.type === "burned"
      ) {
        const playerId = event.type === "left" ? event.playerId : event.victimId;
        const victim = rooms.get(event.arenaId || "arena-1")?.arena.players.get(playerId);
        const ws = [...wss.clients].find((client) => client.playerId === playerId);
        const profile = victim?.profileId ? profiles.byId(victim.profileId) : null;
        const result = profile?.progress.lastLife || {
          id: event.lifeId,
          earnedXp: 0,
          durationSeconds: event.durationSeconds,
          killer: event.killer || null,
          reason: event.type,
        };
        if (ws) {
          ws.lastLifeResult = result;
          safeSend(
            ws,
            JSON.stringify({
              type: "lifeEnded",
              result,
              profile: profile ? profiles.view(profile) : undefined,
            }),
          );
        }
      }
    publishArenaProfiles();
  }
  function progressFailed(error) {
    if (!progressErrorReported)
      console.error("Не удалось сохранить прогресс; повторим запись:", error.message);
    progressErrorReported = true;
    for (const batch of arenaBatches) {
      for (const done of batch.waiters || []) done(false);
      delete batch.waiters;
    }
  }
  function arenaProgressPaused() {
    return arenaBatches.length >= 64 || (progressErrorReported && arenaBatches.length > 0);
  }
  function finishArenaBatch(batch, changed) {
    arenaBatches.shift();
    progressErrorReported = false;
    try {
      notifyProgress(batch, changed);
      // Manual departures happen between ticks. Replace any stale buffered state.
      if (batch.manualLeave) broadcast(batch.events);
    } catch (error) {
      // A closed socket must never cause a committed group to be applied again.
      console.error("Не удалось передать сохранённый результат арены:", error.message);
    }
    for (const done of batch.waiters || []) done(true);
  }
  function waitForArenaWrites() {
    // Wait through the last tick already queued by this request. New ticks
    // from other rooms must not indefinitely postpone a lobby action.
    const last = arenaBatches.at(-1);
    if (!last) return true;
    return new Promise((done) => {
      (last.waiters ||= []).push(done);
      writeArenaBatches();
    });
  }
  // Strict FIFO preserves the original event times, life IDs and receipts.
  // A competing wallet transaction invalidates only an unpublished draft.
  function writeArenaBatches() {
    while (!arenaWrite && !boosterQueue.staging && arenaBatches.length) {
      const available = arenaProgressThrough
        ? arenaBatches.indexOf(arenaProgressThrough) + 1
        : arenaBatches.length;
      if (!available) return;
      const batch = arenaBatches[0];
      const group = available > 1 ? arenaBatches.slice(0, Math.min(arenaProgressGroupSize, available)) : null;
      const finish = (changed) => {
        if (!changed || arenaBatches[0] !== batch) return;
        if (group) changed.forEach((ids, index) => finishArenaBatch(group[index], ids));
        else finishArenaBatch(batch, changed);
      };
      try {
        const result = group
          ? profiles.applyArenaGroup(group)
          : profiles.applyArenaProgress(batch.id, batch.progress, batch.at, true);
        if (Array.isArray(result)) {
          finish(result);
          continue;
        }
        arenaWrite = result
          .then(finish)
          .catch(progressFailed)
          .finally(() => {
            arenaWrite = null;
            if (!progressErrorReported && !closing) writeArenaBatches();
          });
      } catch (error) {
        progressFailed(error);
        return;
      }
    }
  }
  function commitProgress() {
    try {
      // Ordered barrier for explicit life transitions and lobby transactions.
      while (arenaBatches.length) {
        const batch = arenaBatches[0];
        finishArenaBatch(batch, profiles.applyArenaProgress(batch.id, batch.progress, batch.at));
      }
      if (pendingProgress) {
        const batch = pendingProgress;
        const changed = profiles.applyArenaProgress(batch.id, batch.progress, batch.at);
        notifyProgress(batch, changed);
        pendingProgress = null;
        progressErrorReported = false;
        broadcast(batch.events);
      }
      return true;
    } catch (error) {
      progressFailed(error);
      return false;
    }
  }
  function stepRoom(room, at, wallAt) {
    return require("./arena/room-step").stepRoom(
      room,
      at,
      wallAt,
      profiles,
      arenaRooms.directory.policy.arenaCapacity,
    );
  }
  function tick() {
    const startedAt = performance.now(), before = tickSequence;
    try { return tickOnce(); }
    finally { performanceMonitor.record(startedAt, performance.now() - startedAt, tickSequence !== before); }
  }
  function tickOnce() {
    if (closing) return [];
    maintenance.refreshState();
    arenaTesting.refreshState();
    if(maintenance.active || arenaTesting.active){
      if(pendingProgress)commitProgress();
      else writeArenaBatches();
      return [];
    }
    observeArenaTurn(rateNow());
    stateWorkers.drainMixed();
    // Единая очередь сохранения: отказ записи останавливает шаги всех комнат,
    // следующий тик повторяет тот же пакет без повторной выдачи наград.
    if (pendingProgress) {
      commitProgress();
      return [];
    }
    // Continue motion while the disk is merely slow. On a real write error,
    // or after 64 unconfirmed ticks, stop advancing until the FIFO drains.
    if (arenaProgressPaused()) {
      writeArenaBatches();
      return [];
    }
    arenaRooms.refresh();
    const at = now(),
      wallAt = wallNow(),
      progress = [],
      events = [];
    const closingSamples = clanQuestBoundary.samples(profiles, rooms, lastArenaProgressAt, wallAt);
    if (closingSamples.length) {
      // UTC's 20:00 boundary need not align with the monotonic one-second
      // sample clock. Flush the clipped passive interval in this same tick.
      for (const room of rooms.values()) room.progressSecond = undefined;
      const closingBatch = { id: `${runId}:clan-boundary:${lastArenaProgressAt}`,
        at: lastArenaProgressAt, progress: closingSamples, events: [] };
      if (profiles.journal) arenaBatches.push(closingBatch);
      else {
        pendingProgress = closingBatch;
        if (!commitProgress()) return [];
      }
    }
    const activeRooms = [...rooms.values()];
    const prepared = experimentalStepPool && activeRooms.map(room =>
      require("./arena/room-step").prepareRoomStep(room, at, wallAt, profiles,
        arenaRooms.directory.policy.arenaCapacity));
    const stepped = experimentalStepPool?.step(activeRooms.map(room => room.arena), at);
    for (const [i, room] of activeRooms.entries()) {
      const result = stepped
        ? require("./arena/room-step").finishRoomStep(room, at, profiles, prepared[i], stepped[i])
        : stepRoom(room, at, wallAt);
      progress.push(...result.progress);
      events.push(...result.events);
    }
    const batch = {
      id: `${runId}:tick:${++tickSequence}`,
      at: wallAt,
      progress,
      events,
    };
    lastArenaProgressAt = wallAt;
    if (profiles.journal) {
      arenaBatches.push(batch);
      // Motion and contacts belong to this simulation tick. Only reliable
      // rewards, profile updates and life summaries wait for durable storage.
      broadcast(events);
      writeArenaBatches();
    } else {
      pendingProgress = batch;
      commitProgress();
    }
    return events;
  }
  const stopTicks = autoTick
    ? require("./arena/tick-clock").startTickClock(tick, RULES.TICK_MS)
    : null;
  const registrationCleanup = new (require("./runtime/registration-cleanup").RegistrationCleanup)({
    profiles, now: wallNow,
    protectedPlayer: id => id === ownerAccess.ownerId || profileConnections.has(id) ||
      profiles.residentRecoveryProfiles?.has(id) || !!ownerAccess.security?.account?.(id) ||
      [...gameGrants.previews.values()].some(p => p.expiresAt > wallNow() && p.targets.includes(id)),
    paused: () => closing || maintenance.active,
    busy: () => !!pendingProgress || !!arenaBatches.length ||
      !!arenaWrite || !!boosterQueue.pending || !!profiles.journal?.arenaFlush,
  });
  const registrationTimer = setInterval(() => {
    try { registrationCleanup.run(); }
    catch (error) { console.error("Очистка пустых регистраций: " + error.message); }
  }, 5000);
  registrationTimer.unref();
  const competitionTimer = setInterval(() => {
    if (closing) return;
    const occupiedChatRooms = new Set();
    for (const ws of wss.clients)
      if (ws.readyState === WebSocket.OPEN && ws.arenaId) occupiedChatRooms.add(ws.arenaId);
    chat.pruneEmptyArenas(occupiedChatRooms, wallNow());
    try {
      chat.syncProgress();
    } catch (error) {
      console.error("Не удалось сохранить достижения чата:", error.code || error.message);
    }
    try {
      if (!arenaBatches.length && commitProgress()) {
        if (profiles.refreshCompetition()) syncIdentities();
        if (!maintenance.active && !closing) gameGrants.deliver();
      }
    } catch (error) {
      console.error("Клановые соревнования: " + error.message);
    }
  }, 5000);
  lobbyBots = new (require("./testing/lobby-bots").LobbyBots)({
    profiles,
    configPath: testBots.configPath,
    sessionsPath: testBots.sessionsPath,
    baseUrl: () => "http://127.0.0.1:" + httpServer.address().port,
    occupied: (id) => !botAvailable(id),
    enabled: () =>
      !closing && !maintenance.active && !!httpServer.address() && !arenaProgressPaused() &&
      presence.counts(profileConnections.keys(), id => { const p=profiles.byId(id); return !!p && !p.testBot; }).total>0,
  });
  lobbyBots.start();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }
  }, 10000);
  maintenance.onChange = (status) => {
    serviceObserver?.observe();
    if (!status.maintenance) {maintenanceClosure=false;maintenanceFreezeAt=null;return;}
    for (const ws of wss.clients) safeSend(ws, JSON.stringify({ type: "maintenance", ...status }));
    if(!closing&&!maintenanceClosure){
      maintenanceClosure=true;maintenanceFreezeAt=now();maintenance.hold();drainMaintenance();
    }
  };
  function drainMaintenance(){
    if(maintenanceDrain||closing)return maintenanceDrain;
    clearTimeout(maintenanceRetry);
    maintenanceDrain=(async()=>{
      await boosterQueue.running;
      await arenaWrite;
      if(!commitProgress())throw Error('Progress pending');
      for(const ws of wss.clients)ws.removeFromArena?.();
      const botProgress=[...rooms.values()].flatMap(room=>room.bots.clear(maintenanceFreezeAt??now()));
      if(botProgress.length){
        if(pendingProgress)pendingProgress.progress.push(...botProgress);
        else pendingProgress={id:`${runId}:maintenance:${wallNow()}`,at:wallNow(),progress:botProgress,events:[]};
      }
      await arenaWrite;
      if(!commitProgress())throw Error('Life results pending');
      // All accepted actions and final life results are durable before disconnect.
      for(const ws of wss.clients){
        safeSend(ws,JSON.stringify({type:'maintenance',...maintenance.status(),draining:false}));
        ws.close(1012,'Game temporarily closed');
      }
      for(const room of rooms.values())for(const p of room.arena.players.values())if(p.isRemnant)room.arena.removePlayer(p.id);
      arenaRooms.directory.players.clear();arenaRooms.directory.remnants.clear();arenaRooms.requests.clear();presence.seen.clear();
      maintenance.release();
    })().catch(error=>{
      console.error('Завершение сеансов отложено до сохранения прогресса:',error.message);
      if(!closing){maintenanceRetry=setTimeout(drainMaintenance,2000);maintenanceRetry.unref();}
    }).finally(()=>{maintenanceDrain=null;});
    return maintenanceDrain;
  }
  maintenance.bind(()=>profiles.data.serviceAvailability);
  arenaTesting.onChange=status=>{
    if(!status.closed){arenaTestingClosure=false;arenaTestingFreezeAt=null;arenaTestingFreezeWallAt=null;return;}
    if(!closing && !arenaTestingClosure){
      arenaTestingClosure=true;arenaTestingFreezeAt=now();arenaTestingFreezeWallAt=wallNow();arenaTesting.hold();drainArenaTesting();
    }
  };
  function drainArenaTesting(){
    if(arenaTestingDrain || closing)return arenaTestingDrain;
    clearTimeout(arenaTestingRetry);
    arenaTestingDrain=(async()=>{
      await boosterQueue.running;
      await arenaWrite;
      if(!commitProgress())throw Error('Progress pending');
      for(const ws of wss.clients)ws.removeFromArena?.();
      const botProgress=[...rooms.values()].flatMap(room=>room.bots.clear(arenaTestingFreezeAt??now()));
      if(botProgress.length){
        if(pendingProgress)pendingProgress.progress.push(...botProgress);
        else pendingProgress={id:`${runId}:arena-testing:${arenaTestingFreezeWallAt}`,at:arenaTestingFreezeWallAt,progress:botProgress,events:[]};
      }
      await arenaWrite;
      if(!commitProgress())throw Error('Life results pending');
      // The notice and disconnect follow the durable departure, never precede it.
      for(const ws of wss.clients){
        safeSend(ws,JSON.stringify({type:'arenaClosed',closed:true,draining:false,message:arenaTesting.status().message}));
        ws.close(1013,'Arena temporarily closed');
      }
      for(const room of rooms.values())for(const p of room.arena.players.values())if(p.isRemnant)room.arena.removePlayer(p.id);
      for(const player of arenaRooms.directory.players.values())if(player.state!=='lobby')arenaRooms.directory.toLobby(player);
      arenaRooms.directory.remnants.clear();arenaRooms.requests.clear();
      arenaTesting.release();
    })().catch(error=>{
      console.error('Завершение арены перед замером отложено до сохранения:',error.message);
      if(!closing){arenaTestingRetry=setTimeout(drainArenaTesting,2000);arenaTestingRetry.unref();}
    }).finally(()=>{arenaTestingDrain=null;});
    return arenaTestingDrain;
  }
  arenaTesting.refreshState();
  if(monitorDirectory)serviceObserver=new (require('./runtime/service-observer').ServiceObserver)({directory:monitorDirectory,source:observation,onFailure:faults=>maintenance.setFailure(faults),onMetrics:mongoMetrics,now:wallNow});
  function close() {
    if (closePromise) return closePromise;
    closing = true;
    maintenance.onChange?.(maintenance.status(true));
    maintenance.close();
    arenaTesting.close();
    clearTimeout(arenaTestingRetry);
    clearTimeout(maintenanceRetry);
    stopTicks?.();
    performanceMonitor.close();
    clearInterval(heartbeat);
    clearInterval(competitionTimer);
    clearInterval(registrationTimer);
    closePromise = (async () => {
      await feedback?.close();
      await lobbyBots.close();
      // Rendering is finished; stop workers/watchdogs before draining durable
      // operations, which may legitimately take longer than a state deadline.
      const stateWorkersStopped = stateWorkers.close();
      // Сразу прекращаем приём HTTP, включая незавершённые тела запросов.
      // Оставляем небольшой срок на выдачу уже начатых ответов.
      const drained = new Promise((resolve) => httpServer.close(resolve));
      const deadline = setTimeout(() => httpServer.closeAllConnections(), shutdownGraceMs);
      deadline.unref();
      try {
        await maintenanceDrain;
        await arenaTestingDrain;
        await boosterQueue.running;
        await arenaWrite;
        commitProgress();
        const botProgress = [...rooms.values()].flatMap((room) => room.bots.clear(now()));
        if (botProgress.length) {
          if (pendingProgress) pendingProgress.progress.push(...botProgress);
          else
            pendingProgress = {
              id: `${runId}:bots:close`,
              at: wallNow(),
              progress: botProgress,
              events: [],
            };
          commitProgress();
        }
        for (const ws of wss.clients) ws.terminate();
        await new Promise((resolve) => wss.close(resolve));
        for (const room of rooms.values())
          for (const player of room.arena.players.values())
            if (player.isRemnant) room.arena.removePlayer(player.id);
        await drained;
        // Обработчики close добавляют итоги жизней; сохраняем и их.
        if (!commitProgress())
          throw new Error(
            "Сервер остановлен, но последний прогресс не удалось сохранить. Проверь доступность хранилища.",
          );
        await chat.close();
        await profiles.close();
      } finally {
        clearTimeout(deadline);
        await stateWorkersStopped;
        await serviceObserver?.close();
      }
    })();
    return closePromise;
  }
  return {
    httpServer,
    wss,
    arena,
    rooms,
    arenaRooms,
    stateWorkers,
    profiles,
    clans,
    chat,
    bots,
    owner,
    events,
    maintenance,
    arenaTesting,
    serviceObserver,
    performanceStatus,
    persistenceStatus: () => ({
      arenaBatches: arenaBatches.length,
      queuedActions: boosterQueue.waiting.length,
      paused: arenaProgressPaused(),
      staging: !!boosterQueue.staging,
      restages: { ...boosterQueue.restages },
    }),
    tick,
    broadcast,
    close,
  };
}
async function startServer() {
  const root = path.join(__dirname, "../..");
  const settings = require("./runtime/server-settings").loadServerSettings(root);
  const { port, host, dataDir } = settings;
  const control = require('./admin/control-config').read(dataDir);
  const release = require("./runtime/process-lock").acquireServerLock(path.join(dataDir, "server.lock"));
  process.on("exit", release);
  // Atlas preflight occurs before opening the server. Credentials are confined
  // to a worker; simulation/HTTP handlers retain their durable local journal.
  const mongo = await require("./persistence/mongodb-sync").MongoSync.open(root);
  let app;
  try {
    app = createGameServer({
      monitorDirectory:path.join(dataDir,'monitoring'),
      mongoMonitor:()=>mongo?.monitoring()||null,
      mongoMetrics:enabled=>mongo?.setMetrics(enabled),
      stateWorkerRoomLimit: settings.stateWorkers.maxRooms,
      stateWorkerCount: settings.stateWorkerCount,
      trustLoopbackProxy: settings.trustLoopbackProxy,
      maintenance: new Maintenance({
        filePath: path.join(dataDir, "maintenance.enabled"),
      }),
      arenaTesting: new ArenaTestingGate({filePath:path.join(dataDir,"arena-testing.json")}),
      arenaPolicy: settings.arena,
      events: new EventManager({
        filePath: path.join(dataDir, "game-events.json"),
      }),
      ownerAccess: control ? new (require("./admin/control-access").ControlAccess)({...settings.owner,...control}) : new OwnerAccess({
        ...settings.owner,
        filePath: path.join(dataDir, "owner-access.json"),
        bootstrapPath: path.join(dataDir, "owner-first-login.json"),
      }),
      chat: new ChatService({
        filePath: path.join(dataDir, "clan-chat.json"),
        journal: true,
      }),
      profiles: new ProfileStore({
        filePath: path.join(dataDir, "profiles.json"),
        journal: true,
        // Recheck changed profiles and exact reward deadlines, retaining the
        // full settlement fallback for unknown snapshots and clock boundaries.
        incrementalSettlement: true,
        clanDailyQuests: true,
        petEvents: settings.petEvents,
        rouletteConfig: settings.roulette,
        promotionConfig: settings.promotions,
        // Вернуть false в этом локальном конфиге для обычного доступа по лигам.
        unlockLeagueBackgrounds:
          settings.appearance.unlockLeagueBackgrounds === true,
        unlockLeagueFrames:
          settings.appearance.unlockLeagueFrames === true,
        unlockClanCrests: settings.appearance.unlockClanCrests === true,
      }),
      testBots: {
        configPath: path.join(__dirname, "../../config/test-bots.json"),
        sessionsPath: path.join(dataDir, "test-bot-sessions.json"),
      },
    });
  } catch (error) {
    await mongo?.close(false);
    throw error;
  }
  if (mongo) {
    const closeLocal = app.close;
    let closing;
    app.close = () => {
      if (closing) return closing;
      mongo.pause();
      closing = (async () => {
        let saved = false;
        try {
          await closeLocal();
          saved = true;
        } finally {
          await mongo.close(saved);
        }
      })();
      return closing;
    };
    mongo.attach(app.profiles, app.chat);
  }
  app.httpServer.on("error", (error) => {
    console.error(
      error.code === "EADDRINUSE"
        ? `Порт ${port} занят. Останови старый сервер через Ctrl+C.`
        : error.message,
    );
    app
      .close()
      .catch((error) => console.error(error.message))
      .finally(() => {
        process.exitCode = 1;
      });
  });
  app.httpServer.listen(port, host, () => {
    const networkUrls = require("./runtime/local-network-addresses").localNetworkUrls(port);
    console.log(
      "Для компьютеров в той же сети:\n" +
        networkUrls.join("\n") +
        (mongo
          ? "\nХранилище: MongoDB HeroEther с локальным журналом. Статус: data/mongodb-status.json."
          : "\nВсе профили и прогресс сохраняются на этом компьютере в data/profiles.json."),
    );
    console.log(
      `Герои Эфира 0.6: http://localhost:${port}\nМагазин и инвентарь: 22 личных и 7 клановых бустеров, ${[...BOOSTERS.values()].filter((item) => item.ready).length} готовы. Профили: data/profiles.json.\nПоглощение: преимущество радиуса >15%, центр внутри R−r/3. Старт: 20, минимум: 2, деление: от 4, кормление: W по 5 массы. Остановить: Ctrl+C`,
    );
  });
  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"])
    process.on(sig, () => {
      if (stopping) return;
      stopping = true;
      app.close().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
    });
}
module.exports = { createGameServer, startServer };
