"use strict";
const { randomUUID } = require("node:crypto");
const { intersection } = require("./projectile-combat");
const { RULES, radiusForMass: radius } = require("./arena-simulation");
const { CircleIndex } = require("./spatial-collision-index");
const { BOOSTERS } = require("../boosters/booster-catalog");
const questActions = require("./quest-actions");
const arenaPets = require("../pets/arena-pets");
const HAZARD_RULES = Object.freeze({
  BASE_COUNT: 40,
  MAX_COUNT: 80,
  MASS: 50,
  EAT_RATIO: 1.32,
  FEED_LIMIT: 100,
  FEED_GROWTH_MULTIPLIER: 2,
  LAUNCH_SPEED: 450,
  DRAG: 2,
  CELL_COOLDOWN_MS: 60000,
});
const multiplyingBoosters = new Set(["rocket", "warheads", "mine", "axe"]);
const emptyColumn = [];
// Player-keyed scratch data disappears when the player leaves the room.
const sweptStarts = new WeakMap();

// One physical population. Easter changes its appearance and pickup reward,
// never creates a second overlapping set of collectible objects.
class ArenaHazards {
  constructor(arena) {
    this.arena = arena;
    this.runId = null;
    this.items = [];
    this.recent = new Map();
    this.nextAt = 0;
    this.bodyStarts = new Map();
    this.contacts = [];
  }
  eggType() {
    const roll = this.arena.random();
    return roll < 0.25 ? 0 : roll < 0.5 ? 1 : roll < 0.75 ? 2 : 3;
  }
  setRun(run) {
    const id = run?.id || null;
    if (id === this.runId) return;
    this.runId = id;
    for (const item of this.items) item.eggType = id ? this.eggType() : null;
  }
  cell(x, y) {
    const { width, height } = this.arena.world;
    return Math.floor((x / width) * 8) + ":" + Math.floor((y / height) * 8);
  }
  create(x, y, now) {
    return {
      id: randomUUID(),
      x,
      y,
      mass: HAZARD_RULES.MASS,
      radius: radius(HAZARD_RULES.MASS),
      vx: 0,
      vy: 0,
      updatedAt: now,
      eggType: this.runId ? this.eggType() : null,
    };
  }
  replenish(now) {
    const a = this.arena;
    if (![...a.players.values()].some((p) => !p.dead && !p.isRemnant)) {
      this.items = [];
      this.recent.clear();
      this.nextAt = 0;
      return;
    }
    for (const [cell, until] of this.recent) if (until <= now) this.recent.delete(cell);
    if (now < this.nextAt) return;
    const budget = HAZARD_RULES.BASE_COUNT - this.items.length;
    // The bodies do not move during replenishment. Prepare this search once,
    // not for every rejected random point (up to 80 attempts per new hazard).
    // A flat list avoids rebuilding an expensive index for very large parts.
    const bodies = [];
    if (budget > 0) for (const p of a.players.values()) if (!p.dead) bodies.push(...a.bodies(p));
    const blocked = (x, y, margin) => {
      for (const body of bodies) {
        const reach = body.radius + margin + 90,
          dx = body.x - x,
          dy = body.y - y;
        if (Math.abs(dx) >= reach || Math.abs(dy) >= reach) continue;
        // Preserve the original exact predicate, including tangent points.
        if (Math.hypot(dx, dy) < body.radius + margin + 90) return true;
      }
      return false;
    };
    for (let n = 0; n < budget; n++) {
      for (let attempt = 0; attempt < 80; attempt++) {
        const margin = radius(HAZARD_RULES.MASS) + 5,
          x = margin + a.random() * Math.max(0, a.world.width - margin * 2),
          y = margin + a.random() * Math.max(0, a.world.height - margin * 2),
          cell = this.cell(x, y);
        if (
          this.recent.has(cell) ||
          this.items.some(
            (item) => Math.hypot(item.x - x, item.y - y) < item.radius + margin + 30,
          ) ||
          blocked(x, y, margin)
        )
          continue;
        this.items.push(this.create(x, y, now));
        this.recent.set(cell, now + HAZARD_RULES.CELL_COOLDOWN_MS);
        break;
      }
    }
    this.nextAt = this.items.length < HAZARD_RULES.BASE_COUNT ? now + 1000 : now;
  }
  beginStep(now) {
    this.contacts = [];
    this.replenish(now);
    this.bodyStarts.clear();
    // Keep life and part IDs as separate keys: concatenating/hashing two UUIDs
    // for every body on every step costs more than the position snapshot itself.
    // Lookup by IDs (not body references) also survives single-body conversion
    // during splitting. A new life can never reuse an earlier swept path.
    for (const p of this.arena.players.values()) {
      if (!p.dead) {
        let scratch = sweptStarts.get(p);
        if (!scratch) {
          scratch = { starts: new Map(), positions: [] };
          sweptStarts.set(p, scratch);
        }
        const { starts, positions } = scratch;
        starts.clear();
        this.bodyStarts.set(p.lifeId, starts);
        let index = 0;
        for (const b of this.arena.bodies(p)) {
          const position = positions[index] || (positions[index] = { x: 0, y: 0 });
          position.x = b.x;
          position.y = b.y;
          starts.set(this.arena.bodyId(p, b), position);
          index++;
        }
      }
    }
    const { width, height } = this.arena.world;
    for (const item of this.items) {
      item.previousX = item.x;
      item.previousY = item.y;
      const dt = Math.max(0, now - item.updatedAt) / 1000,
        decay = Math.exp(-HAZARD_RULES.DRAG * dt);
      item.x += (item.vx * (1 - decay)) / HAZARD_RULES.DRAG;
      item.y += (item.vy * (1 - decay)) / HAZARD_RULES.DRAG;
      item.vx *= decay;
      item.vy *= decay;
      // Fixed axes: avoid three temporary arrays per thorn on every tick.
      // Keep the same operation order and boundary reflection rules.
      if (item.x < item.radius || item.x > width - item.radius) {
        item.x = Math.max(item.radius, Math.min(width - item.radius, item.x));
        item.vx *= -1;
      }
      if (item.y < item.radius || item.y > height - item.radius) {
        item.y = Math.max(item.radius, Math.min(height - item.radius, item.y));
        item.vy *= -1;
      }
      if (Math.hypot(item.vx, item.vy) < 1) item.vx = item.vy = 0;
      item.updatedAt = now;
    }
  }
  // A volley of W pellets shares one index for this pass only. Include the
  // whole swept path and room for growth from earlier pellets in the volley.
  feedIndex() {
    const columns = new Map();
    const fullRadius = radius(HAZARD_RULES.FEED_LIMIT);
    for (const item of this.items) {
      const x0 = item.previousX ?? item.x;
      const r = Math.max(item.radius, fullRadius);
      const first = Math.floor((Math.min(x0, item.x) - r) / RULES.SPATIAL_CELL_SIZE);
      const last = Math.floor((Math.max(x0, item.x) + r) / RULES.SPATIAL_CELL_SIZE);
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last - first > 256)
        return null;
      for (let i = first; i <= last; i++) {
        if (!columns.has(i)) columns.set(i, []);
        columns.get(i).push(item);
      }
    }
    return { columns, count: this.items.length };
  }
  firstHit(ax, ay, bx, by, extraRadius = 0, moving = false, candidates = this.items) {
    let first = null;
    for (const item of candidates) {
      const sx = moving ? (item.previousX ?? item.x) : item.x,
        sy = moving ? (item.previousY ?? item.y) : item.y,
        t = intersection(
          ax - sx,
          ay - sy,
          bx - item.x,
          by - item.y,
          0,
          0,
          item.radius + extraRadius,
        );
      if (t !== null && (!first || t < first.t || (t === first.t && item.id < first.item.id)))
        first = { t, item };
    }
    return first;
  }
  reproduce(parent, dx, dy, now, ownerId, ownerLife) {
    if (this.items.length >= HAZARD_RULES.MAX_COUNT) return false;
    const length = Math.hypot(dx, dy) || 1,
      child = this.create(parent.x, parent.y, now);
    child.vx = ((dx || (dy ? 0 : 1)) / length) * HAZARD_RULES.LAUNCH_SPEED;
    child.vy = (dy / length) * HAZARD_RULES.LAUNCH_SPEED;
    child.birth = { tick: this.arena.tick, x: parent.x, y: parent.y };
    // Credit only the player/life that launched this child, never a later respawn.
    if (ownerId && ownerLife) child.launchedBy = { id: ownerId, lifeId: ownerLife };
    parent.mass = HAZARD_RULES.MASS;
    parent.radius = radius(parent.mass);
    this.items.push(child);
    return true;
  }
  feed(orb, ax, ay, bx, by, now, index) {
    let candidates = this.items;
    if (index && index.count === this.items.length) {
      const first = Math.floor((Math.min(ax, bx) - orb.radius) / RULES.SPATIAL_CELL_SIZE);
      const last = Math.floor((Math.max(ax, bx) + orb.radius) / RULES.SPATIAL_CELL_SIZE);
      if (first === last) candidates = index.columns.get(first) || emptyColumn;
    }
    const hit = this.firstHit(ax, ay, bx, by, orb.radius, true, candidates);
    if (!hit) return false;
    const item = hit.item;
    // Reaching 100 only fills the parent. The NEXT W pellet triggers two 50-mass hazards.
    // At the population cap it stays full until another pellet arrives after a place opens.
    if (item.mass >= HAZARD_RULES.FEED_LIMIT)
      this.reproduce(
        item,
        orb.vx || orb.feedDx || bx - ax,
        orb.vy || orb.feedDy || by - ay,
        now,
        orb.sourceId,
        orb.sourceLife,
      );
    else
      item.mass = Math.min(
        HAZARD_RULES.FEED_LIMIT,
        item.mass + RULES.FEED_MASS * HAZARD_RULES.FEED_GROWTH_MULTIPLIER,
      );
    item.radius = radius(item.mass);
    this.contacts.push({
      type: "hazardContact",
      tick: this.arena.tick,
      key: "food:" + orb.id,
      x: ax + (bx - ax) * hit.t,
      y: ay + (by - ay) * hit.t,
    });
    return true;
  }
  projectileHit(shot, ax, ay, bx, by, radius) {
    return multiplyingBoosters.has(shot.boosterId)
      ? this.firstHit(ax, ay, bx, by, radius, true)
      : null;
  }
  impact(shot, hit, now) {
    this.reproduce(hit.item, shot.dx, shot.dy, now, shot.ownerId, shot.ownerLife);
    this.arena.combat.contacts.push({
      type: "hazardContact",
      tick: this.arena.tick,
      key: "projectile:" + shot.id,
      x: shot.x,
      y: shot.y,
    });
    if (shot.boosterId === "mine")
      this.arena.audioEvents.push({
        id: shot.id,
        type: "mine",
        x: shot.x,
        y: shot.y,
      });
  }
  collect(now) {
    const a = this.arena;
    a.combat.contacts.push(...this.contacts);
    const players = [...a.players.values()].filter(
      (p) =>
        !p.dead &&
        (!p.isRemnant || now < p.removeAt),
    );
    let dirty = true,
      records,
      index;
    for (const item of [...this.items]) {
      if (dirty) {
        records = players
          .filter((p) => !p.dead)
          .flatMap((p) =>
            a
              .bodies(p)
              .filter((b) => b.mass >= HAZARD_RULES.MASS * HAZARD_RULES.EAT_RATIO)
              .map((b) => {
                const start = this.bodyStarts.get(p.lifeId)?.get(a.bodyId(p, b)) || b.birth || b;
                return {
                  p,
                  b,
                  start,
                  x: (start.x + b.x) / 2,
                  y: (start.y + b.y) / 2,
                  radius: b.radius + Math.hypot(start.x - b.x, start.y - b.y) / 2,
                };
              }),
          );
        index =
          a.spatialIndex && records.length >= RULES.SPATIAL_MIN_BODIES
            ? new CircleIndex(records, RULES.SPATIAL_CELL_SIZE)
            : null;
        dirty = false;
      }
      let first = null;
      const previousX = item.previousX ?? item.x,
        previousY = item.previousY ?? item.y,
        query = {
          x: (previousX + item.x) / 2,
          y: (previousY + item.y) / 2,
          radius: item.radius + Math.hypot(previousX - item.x, previousY - item.y) / 2,
        };
      for (const { p, b, start } of index ? index.query(query) : records) {
        if (b.mass < Math.ceil(item.mass * HAZARD_RULES.EAT_RATIO)) continue;
        // Burst when the cell's boundary reaches the hazard's centre.
        const t = intersection(
          start.x - previousX,
          start.y - previousY,
          b.x - item.x,
          b.y - item.y,
          0,
          0,
          b.radius + 1e-7,
        );
        if (t !== null && (!first || t < first.t || (t === first.t && p.id < first.p.id)))
          first = { p, b, t };
      }
      if (!first) continue;
      const { p, b } = first;
      this.items.splice(this.items.indexOf(item), 1);
      questActions.record(a, p, "hazards");
      const launcher = item.launchedBy && a.players.get(item.launchedBy.id);
      if (
        !p.isRemnant &&
        launcher &&
        launcher.id !== p.id &&
        launcher.lifeId === item.launchedBy.lifeId
      )
        questActions.record(a, launcher, "hazardHits", p);
      this.recent.set(this.cell(item.x, item.y), now + HAZARD_RULES.CELL_COOLDOWN_MS);
      if (this.runId && !p.isRemnant && p.profileId) {
        a.progressEvents.push({
          type: "easterPickup",
          playerId: p.id,
          lifeId: p.lifeId,
          runId: this.runId,
          eggType: item.eggType,
        });
      }
      a.gainMass(p, item.mass, b, now);
      const rocket = BOOSTERS.get("rocket");
      // Hazards use 25/25/50; rockets keep their own 10/10/80 balance.
      const canSplit = a.bodies(p).length < a.maxParts &&
        b.mass >= rocket.minHitMass && b.mass >= RULES.MIN_PART_MASS * 2;
      // Easter eggs are the event appearance of the same hazard. Collection
      // credit and mass still apply when the pet prevents its split.
      if (!canSplit || !arenaPets.consumeThorn(p))
        a.boosterEffects.split(p, b, 3, now, true, rocket.minHitMass, 0, 0.25);
      dirty = true;
      a.combat.contacts.push({
        type: "hazardContact",
        tick: a.tick,
        key: "hazard:" + item.id,
        x: item.x,
        y: item.y,
      });
      this.nextAt = now;
    }
    this.replenish(now);
  }
  snapshot() {
    return this.items.map(({ id, x, y, radius, eggType, birth, vx, vy }) => ({
      id,
      x,
      y,
      radius,
      eggType,
      birth,
      moving: !!(vx || vy),
    }));
  }
}
module.exports = { ArenaHazards, HAZARD_RULES };
