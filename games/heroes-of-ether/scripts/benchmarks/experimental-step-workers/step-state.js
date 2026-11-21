"use strict";

// Internal checkpoint, NOT a client snapshot. Preserve Maps/Sets and shared
// references (notably unsplit player bodies captured by Vortex).
const { Arena } = require("../../../src/server/arena/arena-simulation");
const { Combat } = require("../../../src/server/arena/projectile-combat");
const { BoosterEffects } = require("../../../src/server/boosters/booster-effects");
const { ArenaHazards } = require("../../../src/server/arena/arena-hazards");
const { AlchemyField } = require("../../../src/server/arena/alchemy-field");
const arenaExcluded = new Set(["random", "backgroundRandom", "players", "combat", "boosterEffects", "hazards", "alchemyField"]);
const data = (object, excluded) => Object.fromEntries(Object.entries(object)
  .filter(([key, value]) => !excluded.has(key) && typeof value !== "function"));
const contextExcluded = new Set(["arena", "hitBounds", "shots"]);

function capture(arena) {
  const bodies = [...arena.players.values()].flatMap(p => arena.bodies(p));
  const shots = arena.combat.shots.map(shot => {
    const { vortexCaptures, ...row } = shot;
    if (vortexCaptures) row.captureRows = bodies.filter(b => vortexCaptures.has(b))
      .map(b => [b, vortexCaptures.get(b)]);
    return row;
  });
  return {
    arena: data(arena, arenaExcluded), players: arena.players,
    combat: { ...data(arena.combat, contextExcluded), shots },
    hazards: arena.hazards ? data(arena.hazards, new Set(["arena"])) : null,
    alchemy: data(arena.alchemyField, new Set(["arena", "index", "candidates"])),
  };
}

function install(arena, state) {
  // WebSocket handlers and pending booster validations retain player objects.
  // Keep their identity; a reply must never resurrect/replace their old life.
  const rebound = new Map();
  for (const [id, incoming] of state.players) {
    const current = arena.players.get(id);
    if (!current) continue;
    rebound.set(incoming, current);
    for (const key of Object.keys(current)) if (!(key in incoming)) delete current[key];
    Object.assign(current, incoming);
    state.players.set(id, current);
  }
  Object.assign(arena, state.arena);
  arena.players.clear();
  for (const [id, p] of state.players) arena.players.set(id, p);
  Object.assign(arena.combat, state.combat);
  arena.combat.hitBounds = null;
  for (const shot of arena.combat.shots) {
    if (!shot.captureRows) continue;
    shot.vortexCaptures = new WeakMap(shot.captureRows.map(([body, value]) => [
      rebound.get(body) || body,
      { ...value, source: rebound.get(value.source) || value.source,
        target: rebound.get(value.target) || value.target },
    ]));
    delete shot.captureRows;
  }
  if (state.hazards) {
    arena.hazards ||= new ArenaHazards(arena);
    Object.assign(arena.hazards, state.hazards);
  } else delete arena.hazards;
  arena.alchemyField ||= new AlchemyField(arena);
  Object.assign(arena.alchemyField, state.alchemy, { index: null, candidates: [] });
  return arena;
}

function restore(state, random) {
  // Skip constructor spawning/refilling: the checkpoint is the complete world.
  const arena = Object.create(Arena.prototype);
  arena.random = random;
  arena.backgroundRandom = () => { throw Error("Background selection outside step boundary"); };
  arena.players = new Map();
  arena.combat = new Combat(arena);
  arena.boosterEffects = new BoosterEffects(arena);
  return install(arena, state);
}

// Reserve random numbers without losing unused values. If a worker fails,
// the synchronous step consumes exactly the same prefix, once.
class RandomTape {
  constructor(arena) {
    this.source = arena.random;
    this.values = [];
    this.offset = 0;
    arena.random = () => this.offset < this.values.length
      ? this.values[this.offset++] : this.source();
  }
  reserve(count) {
    this.values = this.values.slice(this.offset);
    this.offset = 0;
    while (this.values.length < count) this.values.push(this.source());
    return this.values;
  }
  consume(count) {
    if (!Number.isInteger(count) || count < 0 || count > this.values.length)
      throw Error("Invalid worker entropy count");
    this.offset = count;
  }
}
module.exports = { capture, restore, install, RandomTape };
