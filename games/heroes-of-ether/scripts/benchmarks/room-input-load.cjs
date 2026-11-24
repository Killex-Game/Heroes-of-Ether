/* Isolated 35-player room. Synthetic profiles only, no production data/config writes. */
"use strict";
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { performance, monitorEventLoopDelay, PerformanceObserver } = require("node:perf_hooks");
const resources = require('./resource-sample.cjs');
const WebSocket = require("ws");
const { fork } = require("node:child_process");
if (process.env.LOAD_CLIENT === "1") {
  require("./room-input-clients.cjs");
} else {
  const { createGameServer } = require("../../src/server/game-server");
  const { ProfileStore } = require("../../src/server/profiles/profile-store");
  let queueTiming = {};
  let profileTiming = {};
  if (process.env.LOAD_PROFILE_TIMING === "1") {
    for (const [name, file, methods] of [
      ["easter", "events/easter-hunt", ["capture"]],
      ["lucky", "events/lucky-week", ["recover"]],
      ["friday", "events/black-friday", ["recover", "captureOrders"]],
      ["social", "progression/social-calendar", ["settle"]],
      ["moderation", "admin/moderation", ["validate"]],
      ["transactions", "profiles/transaction-history", ["syncWorld"]],
      ["competition", "clans/clan-competition-service", ["capture"]],
      ["clanAppearance", "clans/clan-appearance", ["capture"]],
      ["appearance", "profiles/league-appearance", ["capture"]],
      ["daily", "rankings/daily-leaderboards", ["capture", "settle"]],
      ["eventRanking", "rankings/event-leaderboards", ["settle"]],
    ]) {
      const mod = require("../../src/server/" + file);
      for (const method of methods) {
        const original = mod[method];
        mod[method] = function (...args) {
          const start = performance.now();
          try { return original.apply(this, args); }
          finally {
            const stat = profileTiming[name + "." + method] ||= { calls: 0, totalMs: 0 };
            stat.calls++; stat.totalMs += performance.now() - start;
          }
        };
      }
    }
  }
  function recordQueueTime(name, elapsed) {
    const stat = queueTiming[name] ||= { calls: 0, totalMs: 0, maxMs: 0 };
    stat.calls++; stat.totalMs += elapsed; stat.maxMs = Math.max(stat.maxMs, elapsed);
  }
  if (process.env.LOAD_QUEUE_TIMING === "1") {
    const { ArenaBoosterQueue } = require("../../src/server/profiles/arena-booster-queue");
    const proto = ArenaBoosterQueue.prototype;
    const takeBatch = proto.takeBatch;
    proto.takeBatch = function () {
      if (process.env.LOAD_RETRY_BATCH) {
        const size=Number(process.env.LOAD_RETRY_BATCH),every=Number(process.env.LOAD_RETRY_EVERY||2);
        if(!Number.isInteger(size)||size<1||size>16||!Number.isInteger(every)||every<1||every>4)throw Error('Invalid retry benchmark');
        this.retryBatchSize=size;this.retryEvery=every;
      }
      if (process.env.LOAD_BOOSTER_BATCH_SIZE) {
        const size = Number(process.env.LOAD_BOOSTER_BATCH_SIZE);
        if (!Number.isInteger(size) || size < 1 || size > 256) throw Error("Invalid benchmark cast batch");
        this.maxBatchSize = size;
      }
      if (!this.timedProgress && this.onProgressTurn) {
        this.timedProgress = true;
        const turn = this.onProgressTurn;
        this.onProgressTurn = async (...args) => {
          const start = performance.now();
          try { return await turn(...args); }
          finally { recordQueueTime("progressTurn", performance.now() - start); }
        };
      }
      const commands = takeBatch.call(this);
      const stat = queueTiming.batches ||= { calls: 0, commands: 0, max: 0 };
      stat.calls++; stat.commands += commands.length; stat.max = Math.max(stat.max, commands.length);
      return commands;
    };
    const prepare = proto.prepare;
    proto.prepare = function (...args) {
      const start = performance.now();
      try { return prepare.apply(this, args); }
      finally { recordQueueTime("prepare", performance.now() - start); }
    };
    const wait = proto.waitForProgress;
    proto.waitForProgress = async function (...args) {
      const start = performance.now();
      try { return await wait.apply(this, args); }
      finally { recordQueueTime("waitForProgress", performance.now() - start); }
    };
  }
  const { Arena, RULES, radiusForMass, massLimitForLevel } = require("../../src/server/arena/arena-simulation");
  const { freshProgress } = require("../../src/server/progression/experience-progression");
  const { STATE_PROTOCOL } = require("../../src/server/arena/state-stream");
  const roomCount = Number(process.env.LOAD_ROOMS || 1),
    perRoom = Number(process.env.LOAD_PLAYERS || require('../../config/arena-rooms.json').arenaCapacity),
    count = perRoom * roomCount,
    duration = Number(process.env.LOAD_PHASE_MS || 8000);
  const coordinated = process.env.LOAD_CAPACITY === "1" && !!process.send;
  const perRoomDriver = coordinated || process.env.LOAD_DRIVER_PER_ROOM === "1";
  // The stock synthetic fixture has sixteen clans and one active AI per clan.
  const withBots = process.env.LOAD_AI_MIX === "1";
  if (withBots && (roomCount !== 1 || coordinated)) throw Error("Use one room for the AI/client mix");
  const clientCount = withBots ? perRoom - 16 : count;
  const lobbyCount = Number(process.env.LOAD_LOBBY || 0);
  const lobbyLimit = process.env.LOAD_LOBBY_IDLE === "1" ? 700 : 30;
  if (!Number.isInteger(lobbyCount) || lobbyCount < 0 || lobbyCount > lobbyLimit)
    throw Error("Too many synthetic lobby players for this scenario");
  if (!Number.isInteger(roomCount) || roomCount < 1 || roomCount > (coordinated ? 20 : process.env.LOAD_REALISTIC === "1" ? 12 : 3) || ![30, 35].includes(perRoom))
    throw Error("Use the capacity ladder for more than three rooms; supported room sizes are 30 and legacy 35");
  const stock = Number(process.env.LOAD_STOCK || 100);
  if (!Number.isInteger(stock) || stock < 1 || stock > 100000) throw Error("Invalid synthetic stock");
  const combat = process.env.LOAD_COMBAT === "1";
  const allBoosters = process.env.LOAD_ALL_BOOSTERS === "1";
  const catalogIds = [...require("../../src/server/boosters/booster-catalog").BOOSTERS.values()]
    .filter(item => item.ready && item.tier !== "potion").map(item => item.id);
  const loadouts = allBoosters
    ? catalogIds.map((_, index) => Array.from({length: 6}, (_, slot) => catalogIds[(index + slot) % catalogIds.length]))
    : combat
    ? [
        ["fire", "rocket", "warheads", "mine", "axe", "knuckles"],
        ["harpoon", "hook", "vortex", "web", "poison", "mega_poison"],
        ["colorful_shield", "sphere", "golden_shield", "stone", "speed", "meat"],
      ]
    : [["fire", "rocket", "poison", "stone"]];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sferorumia-input-load-"));
  const fixture = process.env.LOAD_WORLD_FIXTURE
    ? JSON.parse(fs.readFileSync(process.env.LOAD_WORLD_FIXTURE, "utf8")) : null;
  if (fixture && (fixture.summary?.profiles !== 1280 || fixture.summary?.clans !== 128 ||
      Object.keys(fixture.data.profiles).length !== 1280 || fixture.tokens?.length !== 1280 ||
      Object.values(fixture.data.profiles).some(p => p.testFixture !== "database-capacity-20261110")))
    throw Error("Invalid synthetic world");
  const dataDir = fixture ? path.join(dir, "data") : dir;
  fs.mkdirSync(dataDir, { recursive: true });
  if (fixture) fs.writeFileSync(path.join(dataDir, "profiles.json"), JSON.stringify(fixture.data));
  if (process.env.LOAD_DATABASE_CONFIG) {
    if (!fixture) throw Error("database benchmark requires a synthetic world");
    fs.mkdirSync(path.join(dir, "config"));
    fs.copyFileSync(process.env.LOAD_DATABASE_CONFIG, path.join(dir, "config/postgresql.local.json"));
  }
  let database;
  const monitorMode = process.env.LOAD_MONITORING;
  if (monitorMode && !["off", "on", "alternate"].includes(monitorMode)) throw Error("Invalid monitoring mode");
  let monitorTimer, monitorStarted = 0;
  const wantsGraphs = () => monitorMode === "on" ||
    (monitorMode === "alternate" && Math.floor((Date.now() - monitorStarted) / 300000) % 2 === 1);
  if (process.send) process.send({ type: "evidence", dir });
  const profiles = new ProfileStore({
    filePath: path.join(dataDir, "profiles.json"),
    journal: process.env.LOAD_JOURNAL !== "0",
    arenaProgressWorker: process.env.LOAD_PROFILE_WORKER === "1",
    // Match startServer by default. Explicit 0 remains available to diagnose
    // the old full-world path, but is recorded as a different configuration.
    incrementalSettlement: process.env.LOAD_INCREMENTAL_SETTLEMENT !== "0",
    clanDailyQuests: true,
  });
  const chat = new (require("../../src/server/chat/chat-service").ChatService)({
    filePath: path.join(dataDir, "clan-chat.json"), journal: true,
  });
  if (process.env.LOAD_PROFILE_SHARDS) {
    if (profiles.arenaPreparer || !profiles.journal) throw Error("Use one journaled progress backend");
    profiles.arenaPreparer = new (require("../../src/server/profiles/arena-progress-shards").ArenaProgressShards)({
      count: Number(process.env.LOAD_PROFILE_SHARDS),
    });
  }
  if (process.env.LOAD_PROFILE_PIPELINE) {
    if (profiles.arenaPreparer || !profiles.journal) throw Error("Use one journaled progress backend");
    profiles.arenaPreparer = new (require("../../src/server/profiles/arena-progress-preparer").ArenaProgressPreparer)({
      parallelism: Number(process.env.LOAD_PROFILE_PIPELINE),
      batched: process.env.LOAD_PROFILE_BATCHED === "1",
      computeBudgetMs: Number(process.env.LOAD_PROGRESS_BUDGET_MS || 50),
    });
  }
  if (process.env.LOAD_QUEUE_TIMING === "1" && profiles.journal) {
    const stage = profiles.journal.stage;
    profiles.journal.stage = async function (...args) {
      const start = performance.now();
      try { return await stage.apply(this, args); }
      finally { recordQueueTime("stage", performance.now() - start); }
    };
  }
  // Diagnostic only: compare shorter progress turns without changing the
  // production grouping policy or dropping any queued tick.
  if (coordinated && process.env.LOAD_PROGRESS_BUDGET) {
    const budget = Number(process.env.LOAD_PROGRESS_BUDGET);
    if (!Number.isFinite(budget) || budget < 1 || budget > 64) throw Error("Invalid progress budget");
    const applyGroup = profiles.applyArenaGroup;
    profiles.applyArenaGroup = function (batches) { return applyGroup.call(this, batches, budget); };
  }
  if (coordinated && process.env.LOAD_PROGRESS_GROUP) {
    const limit = Number(process.env.LOAD_PROGRESS_GROUP);
    if (!Number.isInteger(limit) || limit < 1 || limit > 4) throw Error("Invalid progress group limit");
    const applyGroup = profiles.applyArenaGroup;
    profiles.applyArenaGroup = function (batches) { return applyGroup.call(this, batches.slice(0, limit)); };
  }
  let seed = 314159;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const naturalFood = Number(process.env.LOAD_FOOD ?? RULES.ETHER_COUNT);
  const mixedMass = process.env.LOAD_MIXED_MASS !== "0";
  const masses = [20, 50, 150, 1000, 4000, 15000, 25000, 40000, 75000, 120000];
  const seededMasses = new Set();
  const arena = new Arena({ random, etherCount: naturalFood }),
    clients = [],
    rows = [];
  const drivers = Array.from({ length: perRoomDriver ? roomCount : 1 }, () =>
    fork(path.join(__dirname, "room-input-load.cjs"), [], {
      env: { ...process.env, LOAD_CLIENT: "1" },
      execArgv: [],
    }),
  );
  const lobbyDriver = lobbyCount ? fork(path.join(__dirname, "room-lobby-clients.cjs"), [], {execArgv:[]}) : null;
  const abortOnParentExit = () => process.exit(1);
  if (coordinated) process.on("disconnect", abortOnParentExit);
  let requestSequence = 0;
  const ask = (payload, driver = drivers[0]) =>
    new Promise((resolve, reject) => {
      const id = ++requestSequence;
      const receive = (m) => {
        if (m.id !== id) return;
        driver.off("message", receive);
        m.error ? reject(Error(m.error)) : resolve(m.result);
      };
      driver.on("message", receive);
      driver.send({ ...payload, id });
    });
  const askAll = (payload) => Promise.all(drivers.map((driver) => ask(payload, driver)));
  const experimentalStepPool = process.env.LOAD_STEP_WORKERS
    ? new (require("./experimental-step-workers/step-workers").ArenaStepWorkers)({
      maxWorkers: Number(process.env.LOAD_STEP_WORKERS), timeoutMs: 2000,
      delta: process.env.LOAD_STEP_DELTA === "1",
      }) : null;
  let events;
  if (process.env.LOAD_EVENT || process.env.LOAD_REALISTIC === "1") {
    const kind = process.env.LOAD_EVENT || "lucky-week";
    if (!["black-friday", "easter-hunt", "ether-alchemy", "lucky-week"].includes(kind)) throw Error("Invalid synthetic event");
    const at = Math.floor(Date.now() / 60000) * 60000;
    events = new (require("../../src/server/events/event-manager").EventManager)({ now: () => at });
    events.apply("fixture", "start", { requestId: randomUUID(), revision: events.data.revision,
      eventId: require("../../src/server/events/" + kind).manifest.id });
    events.now = () => Date.now();
  }
  const app = createGameServer({
    // Synthetic visible-lobby users have distinct simulated proxy addresses.
    // Keep the production per-IP limits; otherwise one load generator tests
    // a single NAT's abuse limit rather than hundreds of separate users.
    trustLoopbackProxy: process.env.LOAD_LOBBY_DISTINCT_IPS === "1",
    ...(monitorMode ? {monitorDirectory:path.join(dataDir,"monitoring"),
      databaseMonitor:()=>database?.sync.monitoring() || null,
      databaseMetrics:enabled=>database ? database.sync.setMetrics(enabled) : true} : {}),
    events,
    chat,
    experimentalStepPool,
    arenaBoosterBatchSize: Number(process.env.LOAD_BOOSTER_BATCH_SIZE || 32),
    arenaBoosterFairRetries: process.env.LOAD_FAIR_RETRIES === "1",
    arenaProgressGroupSize: Number(process.env.LOAD_PROGRESS_GROUP_SIZE || 4),
    stateWorkerCount: Number(process.env.LOAD_STATE_WORKERS || 0),
    stateWorkerRoomLimit: Number(process.env.LOAD_STATE_WORKER_ROOMS ?? 3),
    stateWorkerPackedFood: process.env.LOAD_PACKED_FOOD === "1",
    stateWorkerPackedParts: process.env.LOAD_PACKED_PARTS !== "0",
    profiles,
    arena,
    maxPlayers: count + lobbyCount,
    ...(roomCount > 1 || coordinated
      ? {
          arenaPolicy: {
            // Fixed advanced-room topology for the all-booster capacity run.
            // Level-bracket admission is covered separately by integration tests.
            levelGroups: false,
            arenaCapacity: perRoom,
            minimumArenas: roomCount,
            maximumArenas: roomCount,
            maximumArenaPlayers: count,
            lobbyReserve: count,
            spareSeatsBeforeExpansion: 0,
          },
        }
      : {}),
    autoTick: false,
    testBots: { enabled: withBots, maxActive: 16, boostersEnabled: withBots },
  });
  // Isolated transport experiment only. Live servers keep compression disabled.
  if (coordinated && process.env.LOAD_COMPRESSION === "1") {
    app.wss.options.perMessageDeflate = {
      clientNoContextTakeover: true, serverNoContextTakeover: true,
      concurrencyLimit: 4, threshold: 1024,
      zlibDeflateOptions: { level: 1, memLevel: 4, chunkSize: 16384 },
    };
  }
  let botUses = {};
  if (withBots) {
    const brain = app.rooms.get("arena-1").bots.brain;
    const use = brain.use;
    brain.use = function (p, choice, state, at) {
      const result = use.call(this, p, choice, state, at);
      if (result) botUses[choice.b.id] = (botUses[choice.b.id] || 0) + 1;
      return result;
    };
  }
  let stats = {},
    phase = "setup",
    timer,
    inputTimer,
    tickGaps = [],
    lastTick;
  const measure = (obj, key, label = key) => {
    // Acceptance runs must not pay for per-input diagnostic wrappers. Network
    // cadence, tick gaps, CPU/RSS, durability and booster coverage remain live.
    if (process.env.LOAD_METRICS_LIGHT === "1") return;
    const original = obj[key];
    obj[key] = function (...args) {
      const start = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        const s = (stats[label] ||= { n: 0, ms: 0, max: 0 });
        const ms = performance.now() - start;
        s.n++;
        s.ms += ms;
        s.max = Math.max(s.max, ms);
      }
    };
  };
  const arenas = [...app.rooms.values()].map((room) => room.arena);
  let acceptedInputs={split:0,feed:0},attemptedInputs={split:0,feed:0};
  if(process.env.LOAD_REALISTIC === "1")for(const a of arenas)for(const [method,key] of [["splitPlayer","split"],["feedPlayer","feed"]]) {
    const original=a[method];a[method]=function(...args){attemptedInputs[key]++;const ok=original.apply(this,args);if(ok)acceptedInputs[key]++;return ok;};
  }
  // All rooms must use the same food setting, including non-primary arenas.
  for (const simulation of arenas.slice(1)) {
    simulation.etherCount = naturalFood;
    simulation.ether = [];
    simulation.fillEther();
  }
  if (process.env.LOAD_TICK_BREAKDOWN === "1") {
    measure(app, "tick", "tickWork");
    measure(require("../../src/server/arena/state-stream").ArenaStateStream.prototype,
      "flush", "encodeAndSend");
  }
  for (const simulation of arenas) {
    for (const key of ["step", "snapshot", "handleInput"]) measure(simulation, key);
    if (process.env.LOAD_COLLISION_TIMING === "1") {
      for (const key of ["moveFeed", "moveParts", "separateParts", "collectEther", "resolveAbsorptions"])
        measure(simulation, key);
      measure(simulation.combat, "update", "combatUpdate");
      for (const key of ["hit", "vortex", "planKnuckles", "rememberKnuckleContacts", "updateSwords"])
        measure(simulation.combat, key);
    }
  }
  if (process.env.LOAD_COLLISION_TIMING === "1") {
    measure(require("../../src/server/arena/arena-hazards").ArenaHazards.prototype, "collect", "collectHazards");
  }
  for (const key of ["save", "writeSnapshot", "applyArenaProgress", "consume"])
    measure(profiles, key);
  if (profiles.applyArenaGroup) measure(profiles, "applyArenaGroup", "applyArenaProgress");
  if (process.env.LOAD_EVENT_HISTOGRAM === "1") {
    const draft = profiles.arenaProgressDraft;
    profiles.arenaProgressDraft = function (previous, batchId, events, at) {
      const histogram = stats.progressEvents ||= {};
      for (const event of events) histogram[event.type] = (histogram[event.type] || 0) + 1;
      return draft.call(this, previous, batchId, events, at);
    };
  }
  if (process.env.LOAD_PROFILE_TIMING === "1") {
    for (const key of ["prepareSnapshot", "arenaProgressDraft", "arenaView", "arenaAppearance", "identity", "competitionDue", "refreshCompetition", "open"])
      measure(profiles, key);
  }
  if (process.env.LOAD_DISK_TIMING === "1") {
    for (const method of ["applyArenaProgress", "applyArenaGroup"]) {
      const apply = profiles[method];
      if (!apply) continue;
      profiles[method] = function (...args) {
        const measured = stats;
        const result = apply.apply(this, args);
        const confirmed = changes => {
          if (!changes) return;
          const record = (ids, at) => {
            if (!ids.length) return;
            const delay = Date.now() - at;
            const stat = (measured.confirmation ||= { n: 0, ms: 0, max: 0 });
            stat.n++;
            stat.ms += delay;
            stat.max = Math.max(stat.max, delay);
          };
          if (method === "applyArenaGroup") changes.forEach((ids, i) => record(ids, args[0][i].at));
          else record(changes, args[2]);
        };
        if (Array.isArray(result)) confirmed(result);
        else result.then(confirmed, () => {});
        return result;
      };
    }
  }
  if (profiles.journal) {
    measure(profiles.journal, "publishStaged");
    measure(profiles.journal, "commit", "syncCommit");
    if (profiles.journal.commitArena) measure(profiles.journal, "commitArena", "startArenaCommit");
    if (process.env.LOAD_DISK_TIMING === "1") {
      measure(profiles.journal, "encode", "encodeJournalEntry");
      if (process.env.LOAD_SLOW_DISK === "1") {
        // Inject exactly one delayed flush on this temporary store's WAL.
        // Let the client observe ordinary updates before the delayed tick.
        const delayMs = Number(process.env.LOAD_DISK_DELAY_MS || 250);
        if (!Number.isInteger(delayMs) || delayMs < 1 || delayMs > 2500) throw Error("Invalid disk delay");
        let remaining = 5;
        const inject = fd => phase === "combined" && fd === profiles.journal.fd && --remaining === 0;
        if (profiles.journal.commitArena) {
          const flush = fs.fsync;
          fs.fsync = function (fd, done) {
            if (!inject(fd)) return flush(fd, done);
            stats.injectedDiskDelayMs = delayMs;
            const before = stats.step?.n || 0;
            return flush(fd, error => setTimeout(() => {
              stats.stepsDuringDiskDelay = (stats.step?.n || 0) - before;
              done(error);
            }, delayMs));
          };
        } else {
          const sync = fs.fsyncSync;
          fs.fsyncSync = function (fd) {
            if (inject(fd)) {
              stats.injectedDiskDelayMs = delayMs;
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
            }
            return sync(fd);
          };
        }
      }
      // Only the synthetic server process is instrumented. Worker I/O and
      // other running servers do not contribute to these main-thread timings.
      for (const key of ["writeSync", "fsyncSync", "renameSync"]) measure(fs, key);
    }
  }
  let applied = {};
  for (const simulation of arenas) {
    const applyEffect = simulation.boosterEffects.apply;
    simulation.boosterEffects.apply = function (target, booster, ...args) {
      const result = applyEffect.call(this, target, booster, ...args);
      const key = booster.id;
      const counts = (applied[key] ||= { attempts: 0, applied: 0 });
      counts.attempts++;
      if (result?.ok !== false) counts.applied++;
      return result;
    };
  }
  const q = (a) => {
    a.sort((a, b) => a - b);
    return {
      n: a.length,
      p50: a[Math.floor(a.length * 0.5)] || 0,
      p95: a[Math.floor(a.length * 0.95)] || 0,
      p99: a[Math.floor(a.length * 0.99)] || 0,
      max: a.at(-1) || 0,
    };
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const send = (c, m) => {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ spawnSerial: c.p.spawnSerial, ...m }));
  };
  async function main() {
    app.httpServer.listen(0, "127.0.0.1");
    await once(app.httpServer, "listening");
    const url = "ws://127.0.0.1:" + app.httpServer.address().port;
    if (lobbyDriver) {
      const tokens = [], profileIds = [];
      for (let i = 0; i < lobbyCount; i++) {
        const auth = profiles.open(fixture?.tokens[count + i]);
        profiles.transact(auth.token, randomUUID(), "synthetic-lobby-fixture", p => {
          p.wallet.coins = 100000;
          if(process.env.LOAD_REALISTIC === "1") {
            p.wallet.coins=1000000;p.wallet.crystals=1000000;p.wallet.bucks=1000000;
            p.level=Math.max(121,p.level);p.progress=freshProgress(p.level);
            p.roulette.tickets+=1000;p.roulette.earned+=1000;
          }
          p.inventory.candy = 100;
          if(process.env.LOAD_ALCHEMY==="1") {
            const rules=require("../../public/shared/alchemy-rules");
            p.alchemy={version:1,natural:1e12,ingredients:Object.fromEntries(rules.ingredients.map(i=>[i.id,1e6])),learned:[],equipped:"strength"};
            for(const potion of rules.potions)p.inventory[potion.boosterId]=stock;
          }
          p.account = require("../../src/server/accounts/account-benefits").fresh();
          p.account.vipUntil = p.account.premiumUntil = Date.now() + 86400000;
        });
        tokens.push(auth.token);
        profileIds.push(profiles.find(auth.token).id);
      }
      await ask({type:"setup",base:url.replace("ws:","http:"),tokens,profileIds,alchemyRunId:events?.active()?.id,
        clanIds:tokens.map(token=>profiles.find(token).clanId)},lobbyDriver);
    }
    for (let i = 0; i < clientCount; i++) {
      if (process.env.LOAD_CONNECT_INTERVAL) await sleep(Number(process.env.LOAD_CONNECT_INTERVAL));
      const auth = profiles.open(fixture?.tokens[i]),
        p = profiles.find(auth.token);
      if (!fixture) { p.level = 600; p.progress = freshProgress(600); }
      else if (p.level < 121) { p.level = 121; p.progress = freshProgress(121); }
      p.personal.nameSet = true;
      p.personal.introPending = false;
      const loadoutIndex = withBots ? Math.floor(i * loadouts.length / clientCount) : i % perRoom;
      p.quickSlots = [...loadouts[loadoutIndex % loadouts.length]];
      if (combat) {
        p.account = require("../../src/server/accounts/account-benefits").fresh();
        p.account.vipUntil = p.account.premiumUntil = Date.now() + 86400000;
      }
      for (const id of p.quickSlots.filter(Boolean)) p.inventory[id] = stock;
      if(process.env.LOAD_ALCHEMY==="1") {
        const rules=require("../../public/shared/alchemy-rules"),potion=rules.potions[i%rules.potions.length];
        p.alchemy={version:1,natural:0,ingredients:{},learned:[potion.id],equipped:potion.id};
        p.inventory[potion.boosterId]=stock;
      }
      if (p.quickSlots.includes("easter_egg")) {
        p.easter ||= { runs: {}, chests: [], batches: [], trophies: [] };
        p.easter.batches.push({ count: stock, expiresAt: require("../../src/server/events/easter-hunt").expiresAt(Date.now()) });
      }
      const roomId = "arena-" + (Math.floor(i / perRoom) + 1),
        reservation =
          roomCount > 1 || coordinated
            ? app.arenaRooms.reserve(p.id, {
                requestId: randomUUID(),
                preferredArenaId: roomId,
              })
            : null,
        simulation = app.rooms.get(roomId).arena;
      const connected = await ask({
        type: "connect",
        url: url + (reservation?.wsPath || ""),
        ticket: reservation?.ticket,
        roomId,
        indexInRoom: i % perRoom,
        token: auth.token,
        boosters: p.quickSlots,
        potion: p.alchemy?.equipped ? "alchemy_"+p.alchemy.equipped : null,
      }, perRoomDriver ? drivers[Math.floor(i / perRoom)] : drivers[0]);
      const c = { p: simulation.players.get(connected.playerId) };
      const receiptHistory = Number(process.env.LOAD_RECEIPT_HISTORY || 0);
      if (!Number.isInteger(receiptHistory) || receiptHistory < 0 || receiptHistory > 5000)
        throw Error("Use 0–5000 synthetic per-life absorption receipts");
      if (receiptHistory) profiles.transact(auth.token, randomUUID(), "synthetic-life-history", draft => {
        draft.quests.session.seen = Object.fromEntries(
          Array.from({length:receiptHistory}, (_,n)=>["synthetic-victim:"+n,true]));
      });
      clients.push(c);
      const slot = i % perRoom;
      const desiredMass = mixedMass ? (slot === 34 ? 480000 : masses[slot % masses.length]) : 4000;
      const mass = Math.min(desiredMass, massLimitForLevel(p.level) * simulation.maxParts);
      seededMasses.add(mass);
      const x = 250 + ((i % perRoom) % 7) * 480,
        y = 200 + Math.floor((i % perRoom) / 7) * 440;
      Object.assign(c.p, {
        mass: Math.min(mass, massLimitForLevel(p.level)),
        radius: radiusForMass(Math.min(mass, massLimitForLevel(p.level))),
        x,
        y,
        targetX: x,
        targetY: y,
        protectedUntil: 0,
        ...(mixedMass ? {} : { nextMassDecayAt: Infinity }),
      });
      // Use real split bodies/IDs. No single part may exceed the level cap.
      while (mass > simulation.bodies(c.p).length * massLimitForLevel(p.level)) {
        if (!simulation.splitPlayer(c.p, { spawnSerial: c.p.spawnSerial, sequence: c.p.splitSequence + 1 }, Date.now()))
          throw Error("Cannot seed legal split parts");
      }
      const bodies = simulation.bodies(c.p);
      for (const [ordinal, body] of bodies.entries()) {
        body.mass = Math.floor(mass / bodies.length) + Number(ordinal < mass % bodies.length);
        body.radius = radiusForMass(body.mass);
      }
      simulation.syncParts(c.p);
      c.p.splitSequence = 0;
    }
    if (fixture) profiles.save(structuredClone(profiles.data));
    if (process.env.LOAD_DATABASE_CONFIG)
      database = await require("./database-load-store.cjs").attachTestDatabase(dir, profiles, chat);
    const stageMeter=process.env.LOAD_STAGE_METRICS==='1'
      ?require('./tick-stage-meter.cjs').install({app,profiles,arenas}):null;
    let massPeak, partsPeak, persistence = {}, tickWorkSamples = [];
    function samplePeaks() {
      for (const simulation of arenas) for (const player of simulation.players.values()) {
        if (player.dead || player.isRemnant) continue;
        massPeak = Math.max(massPeak, player.mass);
        partsPeak = Math.max(partsPeak, player.parts?.length || 1);
      }
    }
    function startSimulation() {
      timer = require("../../src/server/arena/tick-clock").startTickClock(() => {
        const at = performance.now();
        if (lastTick) tickGaps.push(at - lastTick);
        lastTick = at;
        app.tick();
        if (tickWorkSamples.length < 32768) tickWorkSamples.push(performance.now() - at);
        const pending = app.persistenceStatus();
        persistence.maxArenaBatches = Math.max(persistence.maxArenaBatches || 0, pending.arenaBatches);
        persistence.maxQueuedActions = Math.max(persistence.maxQueuedActions || 0, pending.queuedActions);
        persistence.pausedSamples = (persistence.pausedSamples || 0) + Number(pending.paused);
        persistence.end = pending;
        samplePeaks();
      }, 50);
      return askAll({ type: "start" });
    }
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    let gcSamples=[];
    const gcObserver=process.env.LOAD_GC_METRICS==='1'?new PerformanceObserver(list=>{
      for(const entry of list.getEntries())if(gcSamples.length<32768)gcSamples.push(entry.duration);
    }):null;
    gcObserver?.observe({entryTypes:['gc']});
    for (const name of (process.env.LOAD_PHASES || "move,split,feed,boosters,combined").split(
      ",",
    )) {
      if (coordinated) {
        const release = once(process, "message");
        process.send({ type: "ready", phase: name });
        await release;
      }
      if (!timer) await startSimulation();
      if (monitorMode && !monitorTimer) {
        monitorStarted = Date.now();
        monitorTimer = setInterval(() => { if (wantsGraphs()) app.serviceObserver.requestMetrics(); }, 5000);
        if (wantsGraphs()) app.serviceObserver.requestMetrics();
      }
      phase = name;
      acceptedInputs={split:0,feed:0};attemptedInputs={split:0,feed:0};
      massPeak = partsPeak = 0;
      samplePeaks();
      stats = {};
      stageMeter?.reset();
      queueTiming = {};
      profileTiming = {};
      persistence = {};
      applied = {};
      botUses = {};
      tickGaps = [];
      tickWorkSamples = [];
      lastTick = null;
      delay.reset();
      gcSamples=[];
      await askAll({ type: "phase", name });
      if (lobbyDriver) await ask({type:"phase",name},lobbyDriver);
      const stopCpuProfile=await require('./phase-cpu-profile.cjs').start(name,dir);
      const resourceBefore=resources.sample();
      const cpu = process.cpuUsage(),
        start = performance.now();
      const socketBytes = () => [...app.wss.clients].reduce((sum, ws) => sum + (ws._socket?.bytesWritten || 0), 0);
      const socketBytesBefore = socketBytes();
      await sleep(duration);
      // Timers may wake slightly before their fractional deadline. Keep the
      // promised full measurement window instead of weakening its assessment.
      while (performance.now() - start < duration)
        await sleep(Math.ceil(duration - (performance.now() - start)));
      const elapsed = performance.now() - start,
        usage = process.cpuUsage(cpu);
      const resourceUsage=resources.delta(resourceBefore);
      const cpuProfile=stopCpuProfile ? await stopCpuProfile() : null;
      const samples = await askAll({ type: "stats" });
      const lobby = lobbyDriver ? await ask({type:"stats"},lobbyDriver) : null;
      const network = samples.length === 1 ? samples[0] : {
        connections: samples.reduce((sum, sample) => sum + sample.connections, 0),
        drivers: samples.map(sample => sample.driver),
        updatesPerClient: samples.reduce((sum, sample) => sum + sample.updatesPerClient, 0) / samples.length,
        clientGapP99Max: Math.max(...samples.map(sample => sample.clientGaps.p99)),
        clientGapMax: Math.max(...samples.map(sample => sample.clientGaps.max)),
        rooms: samples.flatMap((sample) => sample.rooms),
        boosters: samples.reduce((sum, sample) => sum + sample.boosters, 0),
        actionRequests: samples.reduce((sum, sample) => sum + sample.actionRequests, 0),
        actionPending: samples.reduce((sum, sample) => sum + sample.actionPending, 0),
        // Report the worst per-room quantile; do not average percentiles.
        actionLatencyP95Max: Math.max(...samples.map(sample => sample.actionLatencyMs.p95)),
        actionLatencyP99Max: Math.max(...samples.map(sample => sample.actionLatencyMs.p99)),
        actionLatencyMax: Math.max(...samples.map(sample => sample.actionLatencyMs.max)),
        successfulActionLatencyP95Max: Math.max(...samples.map(sample => sample.successfulActionLatencyMs.p95)),
        oldestPendingActionMs: Math.max(...samples.map(sample => sample.oldestPendingActionMs)),
        networkMbps: samples.reduce((sum, sample) => sum + sample.networkMbps, 0),
        ...(process.env.LOAD_WIRE_DIAG === "1" ? {
          wireFields: samples.reduce((sum, sample) => {
            for (const [key, bytes] of Object.entries(sample.wireFields || {}))
              sum[key] = (sum[key] || 0) + bytes;
            return sum;
          }, {}),
          perClientBytes: samples.flatMap(sample => sample.perClientBytes || []),
        } : {}),
        usedByType: Object.fromEntries(catalogIds.map(id =>
          [id, samples.reduce((sum, sample) => sum + (sample.usedByType[id] || 0), 0)])),
      };
      if (coordinated) for (const room of network.rooms) {
        const simulation = app.rooms.get(room.roomId).arena;
        const living = [...simulation.players.values()].filter((p) => !p.dead && !p.isRemnant);
        room.alive = living.length;
        room.parts = living.reduce((sum, p) => sum + simulation.bodies(p).length, 0);
      }
      const row = {
        configuration: { incrementalSettlement: !!profiles.settlementCache,
          profileWorker: !!profiles.arenaPreparer, stateWorkerCount: app.stateWorkers.lanes.length,
          packedFood: process.env.LOAD_PACKED_FOOD === "1", packedParts: process.env.LOAD_PACKED_PARTS !== "0" },
        clanQuests: (() => {
          const boards = Object.values(profiles.data.clans).map(c => c.dailyQuests?.board).filter(Boolean);
          const at = Date.now();
          return { enabled: !!profiles.data.clanQuests, boards: boards.length,
            active: boards.filter(b => b.start <= at && at < b.end && b.quests.length).length,
            eligible: boards.reduce((n,b) => n + Object.keys(b.eligible).length,0),
            contributors: boards.reduce((n,b) => n + Object.keys(b.contributors).length,0),
            contributions: boards.reduce((n,b) => n + Object.values(b.cursors).reduce((a,v) => a+v,0),0) };
        })(),
        chat: { durable: !!chat.writer, receipts: Object.keys(chat.messageReceipts).length,
          pending: chat.writer?.pending || 0 },
        ...(monitorMode ? {monitoring:{mode:monitorMode,requested:wantsGraphs(),collecting:app.serviceObserver.snapshot().collecting}} : {}),
        phase,
        ...(process.env.LOAD_REALISTIC === "1" ? {inputs:{accepted:{...acceptedInputs},attempted:{...attemptedInputs}}} : {}),
        ...(experimentalStepPool ? { experimentalStepPool: { ...experimentalStepPool.stats } } : {}),
        mass: {
          initial: [...seededMasses].sort((a, b) => a - b),
          peak: massPeak, mostParts: partsPeak,
          end: q(arenas.flatMap(a => [...a.players.values()].filter(p => !p.dead && !p.isRemnant).map(p => p.mass))),
        },
        players: clientCount,
        receiptHistory: Number(process.env.LOAD_RECEIPT_HISTORY || 0),
        ...(lobby ? {lobby} : {}),
        ...(withBots ? { liveBots: [...arena.players.values()].filter(p => p.isTestBot && !p.dead).length, botUses } : {}),
        roomCount,
        alive: clients.filter((c) => !c.p.dead).length,
        parts: arenas.reduce(
          (n, a) => n + [...a.players.values()].reduce((s, p) => s + a.bodies(p).length, 0),
          0,
        ),
        food: arenas.reduce((n, a) => n + a.ether.length, 0),
        elapsed,
        cpuPercent: (usage.user + usage.system) / elapsed / 10,
        resourceUsage,
        ...(cpuProfile?{cpuProfile}:{}),
        ...(gcObserver?{mainThreadGc:{...q(gcSamples),totalMs:gcSamples.reduce((a,b)=>a+b,0)}}:{}),
        socketMbps: Math.max(0, socketBytes() - socketBytesBefore) * 8 / elapsed / 1000,
        rssMB: process.memoryUsage().rss / 1048576,
        heapUsedMB: process.memoryUsage().heapUsed / 1048576,
        tickGaps: q(tickGaps),
        tickWorkMs: q(tickWorkSamples),
        eventLoop: { p95: delay.percentile(95) / 1e6, max: delay.max / 1e6 },
        stats,
        ...(stageMeter?{stages:stageMeter.snapshot()}:{}),
        persistence,
        ...(process.env.LOAD_QUEUE_TIMING === "1" ? { queueTiming } : {}),
        ...(process.env.LOAD_PROFILE_TIMING === "1" ? { profileTiming } : {}),
        ...(database ? { database: database.samples.slice() } : {}),
        stateWorkers: { ...app.stateWorkers.stats, lanes: app.stateWorkers.lanes.length },
        profileWorker: profiles.arenaPreparer ? { ...profiles.arenaPreparer.stats } : null,
        effects: applied,
        ...network,
      };
      rows.push(row);
      console.log(JSON.stringify(row));
      if (coordinated) process.send({ type: "sample", row });
    }
    delay.disable();
    gcObserver?.disconnect();
  }
  main()
    .catch((e) => {
      console.error(process.env.LOAD_DATABASE_CONFIG
        ? require("../../src/server/persistence/postgresql-config").safeError(e) : e.stack);
      if (process.env.LOAD_DATABASE_CONFIG) console.error(JSON.stringify({ name: e.name,
        code: e.code, frames: String(e.stack || "").split("\n").filter(line => /^\s+at /.test(line)).slice(0, 12) }));
      process.exitCode = 1;
    })
    .finally(async () => {
      clearInterval(monitorTimer);
      timer?.();
      clearInterval(inputTimer);
      for (const driver of drivers) driver.kill();
      lobbyDriver?.kill();
      database?.sync.pause();
      await app.close();
      await experimentalStepPool?.close();
      fs.writeFileSync(path.join(dir, "close-status.json"), JSON.stringify({
        capturedAt: Date.now(), persistence: app.persistenceStatus(),
      }, null, 2));
      if (database) {
        await database.sync.close();
        try { await database.verify(); }
        catch (e) { console.error(require("../../src/server/persistence/postgresql-config").safeError(e)); process.exitCode = 1; }
      }
      if (process.env.LOAD_RECOVERY_MS) {
        const recovery = { before: process.memoryUsage(), seconds: Number(process.env.LOAD_RECOVERY_MS) / 1000 };
        await new Promise(resolve => setTimeout(resolve, Number(process.env.LOAD_RECOVERY_MS)));
        recovery.afterIdle = process.memoryUsage();
        // Diagnostic only, after all clients and workers have stopped. Never
        // force collection during a measured phase or in the live game.
        if (global.gc) { global.gc(); recovery.afterGc = process.memoryUsage(); }
        fs.writeFileSync(path.join(dir, "recovery.json"), JSON.stringify(recovery, null, 2));
        console.log(JSON.stringify({ recovery }));
      }
      fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(rows, null, 2));
      console.log("Evidence: " + dir);
      if (coordinated) {
        process.off("disconnect", abortOnParentExit);
        process.disconnect();
      }
    });
}
