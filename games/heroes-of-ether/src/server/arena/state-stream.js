/* Передача актуального состояния арены без накопления старых снимков. */
"use strict";

const STATE_PROTOCOL = require("../../../public/shared/platform-contract").stateProtocol(1);
const wire = require("../../../public/shared/arena-wire");
const visibility = require("./visibility");
const MAX_STATE_BUFFER = 64 * 1024;
// Keep a small bounded pipeline across the network round trip. A single
// outstanding state caps movement updates at 1 / RTT even on an idle server.
const MAX_IN_FLIGHT = 4;
const MAX_VISUAL_EVENTS = 128;
const VISUAL_EVENT_TTL = 2000;
const encodedSnapshots = new WeakMap();
const encodedFood = new WeakMap();
const frozenJson = new WeakMap();
function jsonField(value) {
  if (value && typeof value === "object") {
    const cached = frozenJson.get(value);
    if (cached !== undefined) return cached;
  }
  if (value && typeof value === "object" && Object.isFrozen(value)) {
    // A frozen outer object alone is not enough: mutable children or custom
    // serializers must still be observed on every frame.
    const proto = Object.getPrototypeOf(value);
    if ((proto === Object.prototype || proto === null || proto === Array.prototype) &&
        typeof value.toJSON !== "function" &&
        Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor =>
          Object.hasOwn(descriptor, "value") && (descriptor.value === null ||
          ["string", "number", "boolean", "undefined"].includes(typeof descriptor.value)))) {
      const json = JSON.stringify(value);
      frozenJson.set(value, json);
      return json;
    }
  }
  return JSON.stringify(value);
}
const fieldNames = new Map();
function fieldPrefix(key) {
  let prefix = fieldNames.get(key);
  if (prefix === undefined) {
    prefix = JSON.stringify(key) + ":";
    // Extension fields may come from an evolving schema. Bound the cache;
    // arbitrary keys must not become process-lifetime allocations.
    if (fieldNames.size < 128) fieldNames.set(key, prefix);
  }
  return prefix;
}
const encodedEvents = new WeakMap();
const presentationEvents = new WeakMap();
const eventKinds = ["events", "audioEvents", "visualEvents"];
let eventSerial = 0;
const rankingCache = new WeakMap();
let rankingSerial = 0;
function rankingFor(rows) {
  if (rows === undefined) return null;
  if (rows === null) return { id: 0, json: "null" };
  let ranking = rankingCache.get(rows);
  if (!ranking) {
    ranking = { id: ++rankingSerial, json: JSON.stringify(rows) };
    rankingCache.set(rows, ranking);
  }
  return ranking;
}
function eventPayload(batches) {
  const payload = eventKinds.map((key) => {
    const rows = batches[key];
    return {
      rows,
      ids: rows.map((row) => row.serial),
      events: rows.map((row) => row.event),
      wire: '"' + key + '":[' + rows.map((row) => row.json).join(",") + "]",
    };
  });
  // Immediate receivers share the exact event list even with different views
  // or state sequence numbers. Encode the text only once for that list.
  payload.prefix = Buffer.from("," + payload.map(batch => batch.wire).join(",") + ',"stateSequence":');
  // Split/feed bursts can carry hundreds of event IDs. The signature is a
  // property of this shared payload, not of each recipient's camera/sequence.
  payload.signature = JSON.stringify(payload.map(batch => batch.ids));
  return payload;
}
function renderEvent(event) {
  if (event.type !== "absorbed") return event;
  const { type, victimId, victimPartId, victimX, victimY, tick } = event;
  return { type, victimId, victimPartId, victimX, victimY, tick };
}
function eventsFor(snapshot, presentationOnly) {
  const cache = presentationOnly ? presentationEvents : encodedEvents;
  let batches = cache.get(snapshot);
  if (!batches) {
    batches = Object.fromEntries(
      eventKinds.map((key) => [
        key,
        (snapshot[key] || []).map((source) => {
          const event = presentationOnly && key === "events" ? renderEvent(source) : source;
          return {
            event,
            json: JSON.stringify(event),
            serial: ++eventSerial,
          };
        }),
      ]),
    );
    cache.set(snapshot, batches);
  }
  return batches;
}
const initialHistory = {};
// Snapshot-local memo tables contain only encoded results, never references to
// older baselines. Numeric keys avoid thousands of ephemeron tables per second
// while keeping distinct histories (including stalled peers) separate. The one
// weak identity table stores numbers only; neither it nor these maps retain a
// previous snapshot. Each memo table dies with its owning snapshot/selection.
const historyIds = new WeakMap();
let historySerial = 0;
function historyId(value) {
  if (!value) return 0;
  let id = historyIds.get(value);
  if (id === undefined) historyIds.set(value, (id = ++historySerial));
  return id;
}
class HistoryCache {
  get(key) { return this.values?.get(historyId(key)); }
  has(key) { return this.values?.has(historyId(key)) || false; }
  set(key, value) { (this.values ??= new Map()).set(historyId(key), value); }
  add(key) { this.set(key, true); }
}
// A termination is needed for bodies in the new view OR the last transmitted
// view (including a victim already removed from this snapshot). Never filter
// gameplay progress: this is only the presentation copy of absorption events.
// Unknown/legacy event shapes and all audio/contact effects remain unchanged.
function visibleEventPayload(payload, players, previous) {
  const rows = payload[0].rows;
  if (!rows.some(row => row.event.type === "absorbed" && typeof row.event.victimId === "string"))
    return payload;
  const views = payload.views ??= new WeakMap();
  let view = views.get(players);
  if (!view) views.set(players, (view = {
    ids: new Set(players.map(player => player.id)), histories: new HistoryCache(),
  }));
  const cached = view.histories.get(previous);
  if (cached) return cached;
  const selected = rows.filter(({ event }) => event.type !== "absorbed" ||
    typeof event.victimId !== "string" || view.ids.has(event.victimId) || previous.has(event.victimId));
  const result = selected.length === rows.length ? payload : eventPayload({
    events: selected, audioEvents: payload[1].rows, visualEvents: payload[2].rows,
  });
  view.histories.set(previous, result);
  return result;
}
const closeObject = Buffer.from("}");
const byId = (rows) => {
  const result = new Map();
  for (const row of rows) result.set(row.id, row);
  return result;
};
const emptyBaseline = new Map();
// Distinct camera rectangles often select exactly the same players or shots.
// Intern ordered selections within this snapshot only; the previous selection
// remains specific to each connection, including after a skipped tick.
function visibleRows(rows, ids, selections) {
  let key = "", word = 0;
  for (let i = 0; i < rows.length; i++) {
    if (ids.has(rows[i].id)) word |= 1 << (i & 31);
    if ((i & 31) === 31 || i === rows.length - 1) {
      key += String.fromCharCode(word & 65535, word >>> 16);
      word = 0;
    }
  }
  let group = selections.get(key);
  if (!group) {
    group = rows.filter(row => ids.has(row.id));
    selections.set(key, group);
  }
  return group;
}
// Compare world snapshots once, independently of camera position and ACK
// sequence. Ordinals are local to one snapshot, so keep both translations.
function foodChanges(current, previous) {
  let changes = current.changes.get(previous);
  if (changes) return changes;
  const oldOrdinals = new Int32Array(current.rows.length).fill(-1);
  const newOrdinals = new Int32Array(previous.rows.length).fill(-1);
  const kinds = new Uint8Array(current.rows.length); // 0 unchanged, 1 moved, 2 full
  for (let i = 0; i < current.rows.length; i++) {
    const row = current.rows[i], old = previous.index.get(row.id);
    if (old === undefined) continue; // a birth is always sent in full
    oldOrdinals[i] = old;
    newOrdinals[old] = i;
    const prior = previous.rows[old];
    if (prior === row) continue;
    if (prior.meta !== row.meta) kinds[i] = 2;
    else if (prior.px !== row.px || prior.py !== row.py) kinds[i] = 1;
  }
  changes = { oldOrdinals, newOrdinals, kinds };
  current.changes.set(previous, changes);
  return changes;
}
function foodSection(current, previous, compact, binaryMoves, schema) {
  const cache = current.foodSections ??= new HistoryCache();
  let formats = cache.get(previous);
  if (!formats) cache.set(previous, (formats = []));
  const format = Number(compact) | (Number(binaryMoves) << 1) | (Number(schema) << 2);
  return formats[format] ??= buildFoodSection(current, previous, compact, binaryMoves, schema);
}
function buildFoodSection(current, previous, compact, binaryMoves, schema) {
  const { food, foodWords } = current;
  const old = previous.food, oldWords = previous.foodWords;
  const changes = old && foodChanges(food, old);
  const removed = [], upsert = [];
  let moves, used = 0;
  if (old) {
    for (let i = 0; i < old.rows.length; i++) {
      if (oldWords) {
        i = nextVisibleOrdinal(oldWords, i);
        if (i < 0 || i >= old.rows.length) break;
      }
      const next = changes.newOrdinals[i];
      if (next < 0 || (foodWords && !(foodWords[next >>> 5] & (1 << (next & 31)))))
        removed.push(old.rows[i].id);
    }
  }
  for (let i = 0; i < food.rows.length; i++) {
    if (foodWords) {
      i = nextVisibleOrdinal(foodWords, i);
      if (i < 0 || i >= food.rows.length) break;
    }
    const prior = changes ? changes.oldOrdinals[i] : -1;
    const visibleBefore = prior >= 0 && (!oldWords || (oldWords[prior >>> 5] & (1 << (prior & 31))));
    const kind = visibleBefore ? changes.kinds[i] : 2;
    if (!kind) continue;
    const row = food.rows[i];
    if (kind === 1 && binaryMoves && row.movementId !== undefined) {
      // toString below copies the used bytes synchronously. One scratch
      // buffer suffices across all recipients of this immutable room frame.
      moves ??= food.scratch ??= Buffer.allocUnsafe(food.rows.length * 8);
      moves.writeUInt32LE(row.movementId, used);
      moves.writeUInt32LE(row.movementXY, used + 4);
      used += 8;
    } else if (compact) {
      // Most movement goes out as eight binary bytes. Build its JSON form
      // only if a recipient actually needs a birth or a legacy update.
      const prefix = row.position ??= JSON.stringify([row.id, row.px, row.py]).slice(0, -1);
      upsert.push(kind === 1 ? (row.move ??= prefix + "]") : schema
        ? (row.schemaFull ??= prefix + "," + JSON.stringify(wire.packFoodMetadata(JSON.parse(row.meta))) + "]")
        : (row.full ??= prefix + "," + row.meta + "]"));
    }
    else {
      row.legacy ??= '{"id":' + JSON.stringify(row.id) + ',"x":' + row.px +
        ',"y":' + row.py + (row.meta.length > 2 ? "," + row.meta.slice(1) : "}");
      upsert.push(row.legacy);
    }
  }
  if (!compact && !old) return '"ether":[' + upsert.join(",") + "]";
  return (compact ? '"foodDelta"' : '"etherDelta"') + ':{"removed":' +
    JSON.stringify(removed) + ',"upsert":[' + upsert.join(",") + "]" +
    (moves ? ',"moves":"' + moves.toString("base64", 0, used) + '"' : "") + "}";
}
// Walk set bits in a viewport rather than every off-screen particle. Ordinals
// remain in snapshot order; births, departures and ACK baselines are unchanged.
function nextVisibleOrdinal(words, from) {
  let word = from >>> 5;
  let bits = words[word] & (-1 << (from & 31));
  while (!bits && ++word < words.length) bits = words[word];
  return bits ? word * 32 + 31 - Math.clz32(bits & -bits) : -1;
}
function canonicalFoodKeys(keys) {
  return (keys.length === 6 || keys.length === 8 || keys.length === 9) &&
    keys[0] === "id" && keys[1] === "x" && keys[2] === "y" && keys[3] === "value" &&
    keys[4] === "radius" && keys[5] === "color" &&
    (keys.length === 6 || (keys[6] === "artValue" && keys[7] === "ejected" &&
      (keys.length === 8 || keys[8] === "birth")));
}
function sameFoodMetadata(orb, keys, previous, compareNested) {
  if (!previous || keys.length !== previous.keys.length) return false;
  // Canonical simulation rows contain a handful of scalar fields. Avoid a
  // dynamic nested-value walk for every particle, while explicitly checking
  // the full key order so extensions, deletions and cloned rows remain valid.
  if (compareNested && previous.canonical && canonicalFoodKeys(keys)) {
    const values = previous.values;
    if (orb.id !== values[0] || orb.value !== values[3] || orb.radius !== values[4] || orb.color !== values[5] ||
        (keys.length > 6 && (orb.artValue !== values[6] || orb.ejected !== values[7]))) return false;
    if (keys.length < 9) return true;
    const birth = orb.birth;
    return birth !== null && (typeof birth === "object" || typeof birth === "function")
      ? 8 in previous.nested && previous.nested[8] === jsonField(birth)
      : !(8 in previous.nested) && birth === values[8];
  }
  for (let i = 0; i < keys.length; i++) {
    const field = keys[i];
    if (field !== previous.keys[i]) return false;
    if (field === "x" || field === "y") continue;
    const value = orb[field];
    if (compareNested && value !== null && (typeof value === "object" || typeof value === "function")) {
      if (!(i in previous.nested) || previous.nested[i] !== jsonField(value)) return false;
    } else if ((compareNested && i in previous.nested) || value !== previous.values[i]) return false;
  }
  return true;
}
function encodeFood(orb, roomCache) {
  // W snapshots copy positions but share their immutable launch information.
  // Keep a single weak entry per live particle, never a history of its frames.
  const birth = orb.birth;
  const key = orb.ejected ? (birth && typeof birth === "object" && Object.isFrozen(birth) ? birth : null) : orb;
  const previous = roomCache ? roomCache.previous.get(orb.id) : key && encodedFood.get(key);
  const keys = (roomCache || key) && Object.keys(orb);
  // Structured clone does not preserve object identity/frozen flags between
  // worker jobs. A room-local cache compares values instead. Keep nested JSON
  // separately so mutating a birth/extension cannot hide a metadata change.
  const sameMetadata = sameFoodMetadata(orb, keys, previous, !!roomCache);
  const { id } = orb;
  const px = Math.round(orb.x * 10) / 10, py = Math.round(orb.y * 10) / 10;
  if (sameMetadata && previous.row.px === px && previous.row.py === py) {
    if (roomCache) roomCache.remember(id, previous, previous);
    return previous.row;
  }
  let meta;
  if (sameMetadata) meta = previous.row.meta;
  else {
    const { id, x, y, ...metadata } = orb;
    meta = JSON.stringify(metadata);
  }
  const row = { id, px, py, meta };
  if (orb.ejected && typeof id === "string" && id[0] === "e") {
    const number = parseInt(id.slice(1), 36);
    if (number >= 0 && number <= 0xffffffff && id === "e" + number.toString(36) &&
        px >= 0 && px <= 6553.5 && py >= 0 && py <= 6553.5) {
      row.movementId = number;
      row.movementXY = Math.round(py * 10) * 65536 + Math.round(px * 10);
    }
  }
  if (roomCache) {
    let record = previous;
    if (sameMetadata) record.row = row;
    else {
      const nested = [];
      const values = keys.map((field, i) => {
        const value = orb[field];
        if (value !== null && (typeof value === "object" || typeof value === "function")) {
          nested[i] = jsonField(value);
          return undefined;
        }
        return value;
      });
      record = { keys, values, nested, row,
        canonical: canonicalFoodKeys(keys) && !nested.some((_, i) => i !== 8) };
    }
    roomCache.remember(id, record, previous);
    return row;
  }
  if (!key) return row;
  if (sameMetadata) previous.row = row;
  else {
    const values = keys.map(field => orb[field]);
    const primitive = value => value === null || (typeof value !== "object" && typeof value !== "function");
    if (values.every(value => primitive(value) || (value === birth && Object.isFrozen(birth) &&
        Object.values(birth).every(primitive))))
      encodedFood.set(key, { keys, values, row });
    else encodedFood.delete(key);
  }
  return row;
}
// One cache per room, shared by all its streams. Only the most recent frame's
// particles survive; previous wire rows are immutable and ACK baselines remain
// connection-local. No profiles, rewards or authoritative entities are cached.
class RoomFoodEncoder {
  constructor() { this.previous = new Map(); this.generation = 0; }
  remember(id, record, prior) {
    if (prior?.generation !== this.generation) this.seen++;
    record.generation = this.generation;
    // The record is mutable cache bookkeeping; its published row is replaced,
    // never mutated. Keep the live ID index instead of allocating thousands of
    // Map entries again on every tick of every room.
    if (prior !== record) this.previous.set(id, record);
  }
  encode(rows) {
    this.generation++;
    this.seen = 0;
    const encoded = rows.map(orb => encodeFood(orb, this));
    if (this.previous.size > this.seen)
      for (const [id, record] of this.previous)
        if (record.generation !== this.generation) this.previous.delete(id);
    return encoded;
  }
}
const perConnection = new Set([
  "ether",
  "etherDelta",
  "stateSequence",
  "events",
  "audioEvents",
  "visualEvents",
  "leaderboard",
  "clanLeaderboard",
  "playersDelta",
]);
function encodeFields(value, parts) {
  const fields = new Map();
  // Avoid entry/filter/map tuple arrays for every field of every player and
  // projectile on each tick. Object.keys preserves the existing wire order.
  for (const key of Object.keys(value)) {
    const field = value[key];
    if (field !== undefined)
      fields.set(key, key === "parts" && Array.isArray(parts) ? parts :
        typeof field === "number" ? (Number.isFinite(field) ? String(field) : "null") :
        typeof field === "boolean" ? (field ? "true" : "false") :
        field === null ? "null" : jsonField(field));
  }
  return fields;
}
const privatePlayerFields = new Set([
  "lifeSeconds", "lifeElapsedMs", "accessoryAbilities", "boostersUsed", "boosterUses",
  "boosterLimit", "massLimit", "canSplit", "canFeed", "mergeMs", "shieldCooldowns",
  "boosterCooldowns", "boosterCooldownMs", "forcedMovement", "potion",
]);
class EncodedPlayer {
  constructor(value) {
    this.id = value.id;
    this.parts = value.parts;
    this.deltas = new HistoryCache();
    this.motionDeltas = new HistoryCache();
    this.formationDeltas = new HistoryCache();
    this.schemaDeltas = new HistoryCache();
    this.value = value;
    this.cachedFields = null;
  }
  get fields() {
    return this.cachedFields ??= encodeFields(this.value, this.parts);
  }
}
function encodedPlayer(value) { return new EncodedPlayer(value); }

// Shared accessors keep one stable object layout. Snapshot-local lazy values
// still avoid encoding invisible entities, without allocating getter closures
// and redefining a property for every projectile on every update.
class EncodedEntity {
  constructor(value) {
    this.id = value.id;
    this.x = value.x;
    this.y = value.y;
    this.coordinateChanges = new HistoryCache();
    this.deltas = new HistoryCache();
    this.value = value;
    this.cachedJson = null;
    this.cachedFields = null;
  }
  get json() { return this.cachedJson ??= JSON.stringify(this.value); }
  get fields() { return this.cachedFields ??= encodeFields(this.value); }
}
function encodeEntity(value) { return new EncodedEntity(value); }
// Other players only need the two rendering flags. Account deadlines, slot
// allowances and daily currency bonuses belong to the owner's private HUD.
// Reuse four immutable values, including when a profile revision changes.
const visibleAccounts = Array.from({ length: 4 }, (_, mask) =>
  Object.freeze({ vip: !!(mask & 1), premium: !!(mask & 2) }));
function playerProjection(player) {
  const value = wire.packPlayer(player), room = {}, self = { id: player.id };
  for (const key of Object.keys(value)) {
    if (privatePlayerFields.has(key)) self[key] = value[key];
    else if (key === "account") {
      self.account = value.account;
      room.account = value.account && visibleAccounts[Number(!!value.account.vip) | (Number(!!value.account.premium) << 1)];
    } else if (key === "pet") {
      self.pet = value.pet;
      room.pet = value.pet && { id: value.pet.id, level: value.pet.level, active: value.pet.active };
    } else if (key === "turbo") {
      self.turbo = value.turbo;
      room.turbo = value.turbo && { active: value.turbo.active, remainingMs: value.turbo.remainingMs };
    } else room[key] = value[key];
  }
  return { full: encodedPlayer(value), room: encodedPlayer(room), self: encodedPlayer(self) };
}
function encodeShared(snapshot, foodEncoder) {
  let encoded = encodedSnapshots.get(snapshot);
  if (encoded) return encoded;
  const common = Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => !perConnection.has(key)),
  );
  const food = foodEncoder ? foodEncoder.encode(snapshot.ether || []) : (snapshot.ether || []).map(orb => encodeFood(orb));
  const compact = { ...common };
  compact.playerCount = (snapshot.players || []).filter((p) => !p.departure).length;
  delete compact.players;
  delete compact.projectiles;
  delete compact.hazards;
  const core = JSON.stringify(compact).slice(0, -1);
  const shots = (snapshot.projectiles || []).map(encodeEntity);
  const hazards = (snapshot.hazards || []).map(encodeEntity);
  const projections = (snapshot.players || []).map(playerProjection);
  const players = projections.map(player => player.full);
  encoded = {
    // Legacy clients alone need the full object form of all players.
    get common() {
      return JSON.stringify(common).slice(0, -1);
    },
    get compact() {
      return (
        core +
        ',"projectiles":[' +
        shots.map((x) => x.json).join(",") +
        '],"hazards":[' +
        hazards.map((x) => x.json).join(",") +
        "]"
      );
    },
    core,
    shots,
    hazards,
    views: new Map(),
    selections: { players: new Map(), shots: new Map(), hazards: new Map() },
    players,
    roomPlayers: projections.map(player => player.room),
    selfPlayers: new Map(projections.map(player => [player.self.id, player.self])),
    food: { rows: food, index: new Map(), changes: new HistoryCache() },
    wires: new HistoryCache(),
  };
  for (let i = 0; i < food.length; i++) encoded.food.index.set(food[i].id, i);
  encodedSnapshots.set(snapshot, encoded);
  return encoded;
}

function encodeView(source, view, privateHud = false) {
  const key = (privateHud ? "hud:" : "") + (view?.key || "*");
  let encoded = source.views.get(key);
  if (encoded) return encoded;
  encoded = {
    core: source.core,
    shots: view ? visibleRows(source.shots, view.projectiles, source.selections.shots) : source.shots,
    hazards: view ? visibleRows(source.hazards, view.hazards, source.selections.hazards) : source.hazards,
    get compact() {
      return (
        source.core +
        ',"projectiles":[' +
        this.shots.map((x) => x.json).join(",") +
        '],"hazards":[' +
        this.hazards.map((x) => x.json).join(",") +
        "]"
      );
    },
    players: view ? visibleRows(privateHud ? source.roomPlayers : source.players, view.players,
      privateHud ? (source.selections.roomPlayers ??= new Map()) : source.selections.players)
      : privateHud ? source.roomPlayers : source.players,
    food: source.food,
    foodWords: view?.foodWords,
    wires: new HistoryCache(),
  };
  source.views.set(key, encoded);
  return encoded;
}

const playerSchemaFields = new Set(wire.playerKeys);
function playerDelta(player, previous, motion = false, schema = false) {
  const history = previous || initialHistory;
  const cache = schema ? player.schemaDeltas : motion === 2 ? player.formationDeltas : motion ? player.motionDeltas : player.deltas;
  if (cache.has(history)) return cache.get(history);
  const changed = [];
  const fields = schema ? new Map() : null;
  const add = (key, value) => {
    if (schema) fields.set(key, value);
    else changed.push(fieldPrefix(key) + value);
  };
  let onlyCoordinates = previous && player.coordinateChanges;
  for (const [key, value] of player.fields) {
    if (key === "id" || previous?.fields.get(key) === value) continue;
    if (key !== "x" && key !== "y") onlyCoordinates = false;
    if (key === "parts" && Array.isArray(player.parts)) {
      const packed = motion === 2 ? wire.formationDelta(player.parts, previous?.parts)
        : motion ? wire.motionDelta(player.parts, previous?.parts) : undefined;
      if (packed !== undefined) {
        if (packed) add("parts", typeof packed === "string" ? '"' + packed + '"' : JSON.stringify(packed));
        continue;
      }
      // The part diff already compares every transmitted field. Serializing
      // the entire formation first duplicates that work on every moving tick.
      const delta = wire.partDelta(player.parts, previous?.parts);
      if (delta.ids || delta.rows.length) add("parts", JSON.stringify(delta));
    } else if (schema && (key === "effects" || key === "instantEffects")) {
      const effects = player.schemaEffects ??= new Map();
      if (!effects.has(key)) effects.set(key, JSON.stringify(wire.packEffects(player.value[key])));
      add(key, effects.get(key));
    } else add(key, value);
  }
  const unset = previous
    ? [...previous.fields.keys()].filter((key) => !player.fields.has(key))
    : [];
  if (unset.length) add("unset", JSON.stringify(unset));
  if (schema) {
    let result = null;
    if (!previous || fields.size) {
      let mask = 0;
      const values = [], extra = [];
      wire.playerKeys.forEach((key, i) => { if (fields.has(key)) { mask |= 1 << i; values.push(fields.get(key)); } });
      for (const [key, value] of fields) if (!playerSchemaFields.has(key)) extra.push(fieldPrefix(key) + value);
      if (extra.length) values.push("{" + extra.join(",") + "}");
      result = "[" + JSON.stringify(player.id) + "," + mask + (values.length ? "," + values.join(",") : "") + "]";
    }
    cache.set(history, result);
    return result;
  }
  if (onlyCoordinates && !unset.length && changed.length &&
      Number.isFinite(player.x) && Number.isFinite(player.y))
    player.coordinateChanges.add(previous);
  const result =
    !previous || changed.length
      ? '{"id":' + JSON.stringify(player.id) + (changed.length ? "," + changed.join(",") : "") + "}"
      : null;
  cache.set(history, result);
  return result;
}

function entityDelta(rows, next, previous, motion) {
  const changes = [];
  let moves, used = 0;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const prior = previous.get(row.id);
    const delta = playerDelta(row, prior);
    if (!delta) continue;
    if (motion && index <= 65535 && row.coordinateChanges.has(prior)) {
      moves ??= Buffer.allocUnsafe(rows.length * 18);
      moves.writeUInt16LE(index, used);
      moves.writeDoubleLE(row.x, used + 2);
      moves.writeDoubleLE(row.y, used + 10);
      used += 18;
    } else changes.push(delta);
  }
  // A Map on the receiver keeps survivors in their old order and appends new
  // entities. Only an actual reorder (e.g. a new shot before a held sword)
  // needs an explicit order on the wire.
  const removed = [];
  let survivorIndex = 0, orderChanged = false;
  for (const id of previous.keys()) {
    if (next.has(id)) {
      if (rows[survivorIndex++].id !== id) orderChanged = true;
    } else removed.push(id);
  }
  return '{"removed":' +
      JSON.stringify(removed) +
      ',"upsert":[' +
      changes.join(",") +
      "]" +
      (orderChanged ? ',"ids":' + JSON.stringify([...next.keys()]) : "") +
      (moves ? ',"moves":"' + moves.toString("base64", 0, used) + '"' : "") +
      "}";
}

function playersDelta(rows, next, previous, motion, schema) {
  const updates = [], removed = [];
  for (const row of rows) {
    const delta = playerDelta(row, previous.get(row.id), motion, schema);
    if (delta) updates.push(delta);
  }
  for (const id of previous.keys()) if (!next.has(id)) removed.push(id);
  return '{"removed":' + JSON.stringify(removed) + ',"upsert":[' + updates.join(",") + "]}";
}

const deltaSections = new WeakMap();
function sectionFor(key, rows, previous, motion, schema = false) {
  let section = deltaSections.get(rows);
  if (!section) {
    section = { next: byId(rows), standard: new HistoryCache(), motion: new HistoryCache(), formation: new HistoryCache(), schema: new HistoryCache() };
    deltaSections.set(rows, section);
  }
  const cache = schema ? section.schema : motion === 2 ? section.formation : motion ? section.motion : section.standard;
  let bytes = cache.get(previous);
  if (!bytes) {
    const encode = key === "players" ? playersDelta : entityDelta;
    bytes = Buffer.from(',"' + key + 'Delta":' + encode(rows, section.next, previous, motion, schema));
    cache.set(previous, bytes);
  }
  return { next: section.next, bytes };
}

// Snapshots may replace one another. Purchases, chat and saved life results use
// the separate reliable channel in game-server and never pass through this queue.
class ArenaStateStream {
  constructor(ws, send, now, foodEncoder = null) {
    this.ws = ws;
    this.send = send;
    this.now = now;
    this.foodEncoder = foodEncoder;
    this.playerSchema = ws.protocol === wire.PLAYER_SCHEMA_PROTOCOL;
    this.schema = this.playerSchema || ws.protocol === wire.SCHEMA_PROTOCOL;
    this.formation = this.schema || ws.protocol === wire.PROTOCOL;
    this.privateHud = this.formation || ws.protocol === wire.PRIVATE_STATE_PROTOCOL || ws.protocol === wire.HUD_PROTOCOL;
    this.motion = this.privateHud || ws.protocol === wire.MOTION_PROTOCOL;
    this.presentationOnly = this.motion || ws.protocol === wire.PRESENTATION_PROTOCOL;
    this.entityDeltas = this.presentationOnly || ws.protocol === wire.ENTITY_PROTOCOL;
    this.compact = this.entityDeltas || ws.protocol === wire.LEGACY_PROTOCOL;
    this.acknowledged = ws.protocol === STATE_PROTOCOL || this.compact;
    this.players = this.projectiles = this.hazards = emptyBaseline;
    this.previousEncoded = initialHistory;
    this.sequence = 0;
    this.acknowledgedSequence = 0;
    this.inFlight = null;
    this.pending = null;
    this.events = new Map();
    this.audioEvents = new Map();
    this.visualEvents = new Map();
  }
  publish(snapshot) {
    const at = this.now();
    const batches = eventsFor(snapshot, this.presentationOnly);
    const immediate = !this.pending && this.canSend();
    if (!immediate) {
      for (const key of eventKinds) {
        const queue = this[key];
        for (const row of batches[key]) {
          if (!queue.has(row.json)) queue.set(row.json, { at, row });
        }
        for (const [id, item] of queue) if (at - item.at > VISUAL_EVENT_TTL) queue.delete(id);
        while (queue.size > MAX_VISUAL_EVENTS) queue.delete(queue.keys().next().value);
      }
    }
    const previous = this.pending;
    this.pending = { ...snapshot };
    // A blocked connection only keeps the latest snapshot. Do not build its
    // viewport and wire data for states that will never be sent.
    this.pendingSnapshot = snapshot;
    // Rankings are refreshed once a second and must survive a skipped snapshot.
    for (const key of ["leaderboard", "clanLeaderboard"])
      if (!this.pending[key] && previous?.[key]) this.pending[key] = previous[key];
    // Unblocked peers all see this tick's same event sequence. Only a stalled
    // connection needs its own queue to merge across skipped snapshots.
    if (immediate && !batches.payload) {
      const unique = {};
      for (const key of eventKinds) {
        const seen = new Set();
        unique[key] = batches[key].filter((row) => {
          if (seen.has(row.json)) return false;
          seen.add(row.json);
          return true;
        }).slice(-MAX_VISUAL_EVENTS);
      }
      batches.payload = eventPayload(unique);
    }
    this.flush(immediate ? batches.payload : null);
  }
  acknowledge(sequence) {
    if (
      !this.acknowledged ||
      !Number.isSafeInteger(sequence) ||
      sequence <= this.acknowledgedSequence ||
      sequence > this.sequence
    )
      return false;
    // WebSocket is ordered: accepting N also confirms all earlier snapshots.
    this.acknowledgedSequence = sequence;
    this.inFlight = sequence === this.sequence ? null : this.sequence;
    this.flush();
    return true;
  }
  canSend() {
    return this.ws.readyState === 1 && this.ws.bufferedAmount <= MAX_STATE_BUFFER &&
      (!this.acknowledged || this.sequence - this.acknowledgedSequence < MAX_IN_FLIGHT);
  }
  flush(payload) {
    if (!this.pending || !this.canSend()) return;
    const packet = this.pending,
      source = this.acknowledged ? encodeShared(this.pendingSnapshot, this.foodEncoder) : null,
      view = this.compact
        ? visibility.select(this.pendingSnapshot, this.viewport, this.ws.playerId)
        : null,
      encoded = view || this.privateHud ? encodeView(source, view, this.privateHud) : source;
    this.pending = null;
    this.pendingSnapshot = null;
    if (!payload) {
      const at = this.now(), queued = {};
      for (const key of eventKinds) {
        queued[key] = [...this[key].values()]
          .filter((item) => at - item.at <= VISUAL_EVENT_TTL)
          .map((item) => item.row);
        this[key].clear();
      }
      payload = eventPayload(queued);
    }
    if (this.presentationOnly && view)
      payload = visibleEventPayload(payload, encoded.players, this.players);
    const ranks = encoded ? [rankingFor(packet.leaderboard), rankingFor(packet.clanLeaderboard)] : [];
    let cache, cacheKey;
    if (encoded) {
      // Players who received the same previous snapshot need the exact same
      // delta. Encode its UTF-8 bytes once for the whole group, not 35 times.
      cache = encoded.wires.get(this.previousEncoded);
      if (!cache) encoded.wires.set(this.previousEncoded, (cache = new Map()));
      const format = Number(this.compact) | (Number(this.entityDeltas) << 1) |
        (Number(this.presentationOnly) << 2) | (Number(this.motion) << 3) | (Number(this.privateHud) << 4) |
        (Number(this.formation) << 5) | (Number(this.schema) << 6) | (Number(this.playerSchema) << 7);
      cacheKey = format + ":" + (this.sequence + 1) + ":" +
        (ranks[0]?.id ?? "-") + ":" + (ranks[1]?.id ?? "-") + ":" + payload.signature +
        (this.privateHud ? ":" + (this.ws.playerId || "") : "");
      const cached = cache.get(cacheKey);
      if (cached) {
        this.players = cached.players;
        this.projectiles = cached.projectiles;
        this.hazards = cached.hazards;
        this.self = cached.self;
        this.inFlight = ++this.sequence;
        this.previousEncoded = encoded;
        this.send(this.ws, cached.data);
        return;
      }
    }
    if (this.acknowledged) {
      packet.foodWire = foodSection(encoded, this.previousEncoded, this.compact, this.presentationOnly, this.schema);
      packet.stateSequence = ++this.sequence;
      this.inFlight = packet.stateSequence;
    }
    if (encoded) {
      const common = this.entityDeltas ? encoded.core : this.compact ? encoded.compact : encoded.common;
      const pieces = [Buffer.from(common + "," + packet.foodWire)];
      if (this.compact) {
        const section = sectionFor("players", encoded.players, this.players, this.formation ? 2 : this.motion, this.playerSchema);
        pieces.push(section.bytes);
        this.players = section.next;
      }
      // Event bodies were encoded once per room snapshot. Re-encoding them in
      // both the cache key and payload for every receiver dominated split/W bursts.
      const tail = [String(packet.stateSequence)];
      if (this.privateHud) {
        const self = source.selfPlayers.get(this.ws.playerId);
        const previous = this.self?.id === self?.id ? this.self : null;
        tail.push('"selfDelta":' + (self ? (playerDelta(self, previous) ||
          '{"id":' + JSON.stringify(self.id) + '}') : "null"));
        this.self = self;
      }
      if (ranks[0]) tail.push('"leaderboard":' + ranks[0].json);
      if (ranks[1]) tail.push('"clanLeaderboard":' + ranks[1].json);
      pieces.push(payload.prefix, Buffer.from(tail.join(",")));
      if (this.entityDeltas) {
        for (const [key, rows] of [
          ["projectiles", encoded.shots],
          ["hazards", encoded.hazards],
        ]) {
          const delta = sectionFor(key, rows, this[key], this.motion);
          this[key] = delta.next;
          pieces.push(delta.bytes);
        }
      }
      pieces.push(closeObject);
      const data = Buffer.concat(pieces);
      cache.set(cacheKey, {
        data,
        players: this.players,
        projectiles: this.projectiles,
        hazards: this.hazards,
        self: this.self,
      });
      this.previousEncoded = encoded;
      this.send(this.ws, data);
    } else {
      eventKinds.forEach((key, index) => { packet[key] = payload[index].events; });
      this.send(this.ws, JSON.stringify(packet));
    }
  }
}

module.exports = {
  ArenaStateStream,
  RoomFoodEncoder,
  STATE_PROTOCOL,
  COMPACT_STATE_PROTOCOL: wire.PROTOCOL,
  MAX_IN_FLIGHT,
};
