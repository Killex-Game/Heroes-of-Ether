"use strict";
const { BOOSTERS, BOOSTER_RULES, BoosterError } = require("../boosters/booster-catalog");
const { radiusForMass, canAbsorbSize, massLimitForLevel } = require("../arena/arena-simulation");
const { intersection } = require("../arena/projectile-combat");
const LIFE_BOOSTERS = 20;
const PERSONAL = [...BOOSTERS.values()].filter((b) => b.ready && !["clan", "potion"].includes(b.tier));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Decisions run at the bot think interval, never in the 50 ms collision loop.
// Supplies belong to this arena life and never refill a saved inventory or wallet.
class BotBrain {
  constructor(arena, random = Math.random, { boostersEnabled = false } = {}) {
    this.arena = arena;
    this.random = random;
    // Включается только явной настройкой, запас ограничен текущей жизнью.
    this.boostersEnabled = boostersEnabled;
    this.lives = new Map();
  }
  start(p, at) {
    const bag = [];
    const take = (pool, count) => {
      const left = [...pool];
      while (count-- > 0 && left.length) {
        const i = Math.min(left.length - 1, Math.floor(this.random() * left.length));
        bag.push(left.splice(i, 1)[0].id);
      }
    };
    take(
      PERSONAL.filter((b) => b.kind === "mass"),
      4,
    );
    take(
      PERSONAL.filter((b) => b.kind === "shield"),
      3,
    );
    take(
      PERSONAL.filter((b) => ["speed", "sponge"].includes(b.kind)),
      2,
    );
    take(
      PERSONAL.filter((b) => b.target === "direction"),
      11,
    );
    const state = {
      lifeId: p.lifeId,
      bag,
      used: 0,
      nextBoosterAt: at + 2600,
      nextSplitAt: at + 2500,
      lastSplitAt: -Infinity,
      nextFeedAt: at,
      feedBurst: 0,
      nextWanderAt: 0,
      wander: null,
      seen: new Map(),
    };
    this.lives.set(p.id, state);
    return state;
  }
  forget(p) {
    this.lives.delete(p.id);
  }
  scan(p, at, state) {
    const a = this.arena,
      body = a.mainBody(p),
      own = a.bodies(p);
    const enemies = [],
      allies = [],
      threats = [],
      seen = new Map();
    for (const other of a.players.values()) {
      if (other.dead || other.id === p.id) continue;
      for (const part of a.bodies(other)) {
        const d = distance(body, part);
        if (d > 900 + body.radius + part.radius) continue;
        const key = other.lifeId + ":" + a.bodyId(other, part),
          old = state.seen.get(key);
        const dt = old ? (at - old.at) / 1000 : 0;
        const entry = {
          player: other,
          body: part,
          distance: d,
          vx: dt > 0 ? clamp((part.x - old.x) / dt, -200, 200) : 0,
          vy: dt > 0 ? clamp((part.y - old.y) / dt, -200, 200) : 0,
        };
        seen.set(key, { x: part.x, y: part.y, at });
        if (other.clanId && (other.clanId === p.clanId || other.clanPrefix === "KILL")) {
          allies.push(entry);
          continue;
        }
        enemies.push(entry);
        if (other.protectedUntil > at || a.hasEffect(other, "lock", at)) continue;
        for (const piece of own) {
          const gap = distance(piece, part) - piece.radius - part.radius;
          if (canAbsorbSize(part, piece) && gap < 270) {
            threats.push({ ...entry, own: piece, gap });
          }
        }
      }
    }
    state.seen = seen;
    enemies.sort((x, y) => x.distance - y.distance);
    threats.sort((x, y) => x.gap - y.gap);
    const prey = enemies
      .filter((e) => e.player.protectedUntil <= at && canAbsorbSize(body, e.body))
      .sort((x, y) => x.distance / Math.sqrt(x.body.mass) - y.distance / Math.sqrt(y.body.mass))[0];
    const ally = allies
      .filter(
        (e) =>
          e.player.clanId === p.clanId &&
          e.player.protectedUntil <= at &&
          body.mass >= 60 &&
          e.body.mass < body.mass * 0.7 &&
          e.distance < body.radius + e.body.radius + 260,
      )
      .sort((x, y) => x.distance - y.distance)[0];
    const incoming = a.combat.shots.some((s) => {
      if (s.ownerId === p.id && !s.landed) return false;
      if (distance(s, body) > body.radius + 230) return false;
      return s.landed || (body.x - s.x) * s.dx + (body.y - s.y) * s.dy > 0;
    });
    return { body, own, enemies, allies, threats, prey, ally, incoming };
  }
  safePoint(p, ctx, target, at) {
    const { body, threats, allies } = ctx,
      a = this.arena;
    let dx = target.x - body.x,
      dy = target.y - body.y;
    const length = Math.hypot(dx, dy) || 1;
    dx = dx / length;
    dy = dy / length;
    // Nearby allies can absorb each other under the normal arena rules.
    for (const e of allies) {
      const gap = e.distance - body.radius - e.body.radius;
      if (gap < 30) {
        const d = Math.max(1, e.distance),
          weight = (30 - gap) / 15;
        dx += ((body.x - e.body.x) / d) * weight;
        dy += ((body.y - e.body.y) / d) * weight;
      }
    }
    for (const e of threats) {
      const d = Math.max(1, distance(e.own, e.body)),
        weight = 2 + (270 - e.gap) / 90;
      dx += ((e.own.x - e.body.x) / d) * weight;
      dy += ((e.own.y - e.body.y) / d) * weight;
    }
    for (const s of a.combat.shots) {
      if (!s.landed || distance(s, body) > body.radius + 85 || a.hasEffect(p, "shield", at))
        continue;
      const d = Math.max(1, distance(s, body));
      dx += ((body.x - s.x) / d) * 3;
      dy += ((body.y - s.y) / d) * 3;
    }
    const margin = body.radius + 60;
    if (body.x < margin) dx += (margin - body.x) / 35;
    if (body.x > a.world.width - margin) dx -= (body.x - a.world.width + margin) / 35;
    if (body.y < margin) dy += (margin - body.y) / 35;
    if (body.y > a.world.height - margin) dy -= (body.y - a.world.height + margin) / 35;
    // Preserve a safe standoff target for feeding when no avoidance is required.
    const scale = Math.min(400, length);
    return {
      x: clamp(body.x + dx * scale, body.radius, a.world.width - body.radius),
      y: clamp(body.y + dy * scale, body.radius, a.world.height - body.radius),
    };
  }
  destination(p, ctx, state, at) {
    const { body, prey, ally, threats } = ctx;
    if (threats.length) {
      const e = threats[0].body;
      return { x: body.x + (body.x - e.x), y: body.y + (body.y - e.y) };
    }
    if (
      prey &&
      prey.distance < body.radius + prey.body.radius + 450 &&
      !this.arena.hasEffect(p, "lock", at)
    )
      return { x: prey.body.x + prey.vx * 0.3, y: prey.body.y + prey.vy * 0.3 };
    if (ally) {
      const d = Math.max(1, ally.distance),
        stand = body.radius + ally.body.radius + 40;
      return {
        x: ally.body.x + ((body.x - ally.body.x) / d) * stand,
        y: ally.body.y + ((body.y - ally.body.y) / d) * stand,
      };
    }
    let food = null,
      best = Infinity;
    for (const orb of this.arena.ether) {
      if (orb.sourceId === p.id && orb.sourcePickupAt > at) continue;
      const score = distance(body, orb) / Math.sqrt(orb.value);
      if (score < best && distance(body, orb) < 650) {
        food = orb;
        best = score;
      }
    }
    if (food && !this.arena.hasEffect(p, "lock", at)) return food;
    if (!state.wander || at >= state.nextWanderAt || distance(body, state.wander) < 40) {
      state.wander = {
        x: 100 + this.random() * (this.arena.world.width - 200),
        y: 100 + this.random() * (this.arena.world.height - 200),
      };
      state.nextWanderAt = at + 5000;
    }
    return state.wander;
  }
  split(p, ctx, state, at) {
    const { body, prey, enemies, own, threats } = ctx;
    if (
      at < state.nextSplitAt ||
      !prey ||
      threats.length ||
      own.length >= 4 ||
      p.protectedUntil > at ||
      this.arena.hasEffect(p, "lock", at) ||
      this.arena.hasEffect(p, "root", at) ||
      this.arena.hasEffect(p, "sponge", at)
    )
      return;
    const half = { radius: radiusForMass(Math.floor(body.mass / 2)) };
    if (
      body.mass < 20 ||
      !canAbsorbSize(half, prey.body) ||
      prey.distance < body.radius - prey.body.radius / 3 + 20 ||
      prey.distance > half.radius + prey.body.radius + 110 ||
      !this.clearShot(p, ctx, prey.body, half.radius)
    )
      return;
    // Splitting affects every eligible part. Do not expose any half to a nearby enemy.
    if (
      own.some((part) =>
        enemies.some(
          (e) =>
            e.player.protectedUntil <= at &&
            distance(part, e.body) < part.radius + e.body.radius + 350 &&
            canAbsorbSize(e.body, { radius: radiusForMass(Math.floor(part.mass / 2)) }),
        ),
      )
    )
      return;
    this.arena.handleInput(
      p.id,
      { type: "split", spawnSerial: p.spawnSerial, sequence: p.splitSequence + 1 },
      at,
    );
    state.nextSplitAt = at + 10000;
    state.lastSplitAt = at;
  }
  clearShot(p, ctx, aim, pad = 10) {
    return !ctx.allies.some(
      (e) =>
        intersection(
          ctx.body.x,
          ctx.body.y,
          aim.x,
          aim.y,
          e.body.x,
          e.body.y,
          e.body.radius + pad,
        ) !== null,
    );
  }
  feed(p, ctx, state, at) {
    const { ally, body, threats, enemies, own } = ctx;
    if (
      !ally ||
      threats.length ||
      own.length !== 1 ||
      p.protectedUntil > at ||
      at < state.nextFeedAt ||
      body.mass < 60 ||
      this.arena.hasEffect(ally.player, "lock", at)
    )
      return;
    const gap = ally.distance - body.radius - ally.body.radius;
    if (
      gap < 12 ||
      gap > 90 ||
      enemies.some(
        (e) =>
          intersection(
            body.x,
            body.y,
            ally.body.x,
            ally.body.y,
            e.body.x,
            e.body.y,
            e.body.radius + 20,
          ) !== null,
      )
    )
      return;
    if (
      this.arena.handleInput(
        p.id,
        {
          type: "feed",
          spawnSerial: p.spawnSerial,
          sequence: p.feedSequence + 1,
          x: ally.body.x,
          y: ally.body.y,
        },
        at,
      )
    ) {
      state.feedBurst++;
      state.nextFeedAt = at + (state.feedBurst >= 6 ? 10000 : 400);
      if (state.feedBurst >= 6) state.feedBurst = 0;
    }
  }
  choice(p, b, ctx, state, at, escape) {
    const a = this.arena,
      { body, threats, prey, enemies, incoming, own } = ctx;
    const danger = threats.length > 0,
      gap = threats[0]?.gap ?? Infinity;
    const target = danger ? threats[0] : prey || enemies.find((e) => e.player.protectedUntil <= at);
    let score = 0,
      aim = escape;
    if (b.kind === "mass") {
      if (body.mass >= massLimitForLevel(p.level)) return null;
      score = danger
        ? 85
        : body.mass < 450
          ? 65
          : prey && !canAbsorbSize({ radius: radiusForMass(body.mass / 2) }, prey.body)
            ? 25
            : 0;
    } else if (b.kind === "shield") {
      if (!a.hasEffect(p, "shield", at) && (incoming || enemies[0]?.distance < body.radius + 260))
        score = incoming ? 100 : 45;
    } else if (b.kind === "speed") {
      if (!a.hasEffect(p, "speed", at) && (danger || prey?.distance > body.radius + 100))
        score = danger ? 90 : 50;
    } else if (b.kind === "sponge") {
      if (own.length > 1 && !a.hasEffect(p, "sponge", at) && at - state.lastSplitAt > 2500)
        score = danger ? 95 : 55;
    } else if (b.id === "harpoon" && danger && gap > 20) {
      // A miss pulls the owner to the flight endpoint too; use a clear escape corridor.
      if (
        distance(body, escape) < 150 ||
        enemies.some((e) => distance(e.body, escape) < e.body.radius + body.radius + 100)
      )
        return null;
      score = 70;
    } else {
      if (!target || target.player.protectedUntil > at || a.hasEffect(target.player, "shield", at))
        return null;
      if (b.id === "hook" || b.id === "harpoon") {
        if (
          danger ||
          !canAbsorbSize(body, target.body) ||
          target.distance < body.radius + target.body.radius + 30
        )
          return null;
      }
      if (b.id === "glove" && !danger) return null;
      if (b.kind === "rocket" && target.body.mass < b.minHitMass) return null;
      if (["divide", "knuckles"].includes(b.kind) && target.body.mass < 4) return null;
      if (a.hasEffect(target.player, b.kind, at)) return null;
      const speed = b.flightSpeed || BOOSTER_RULES.FLIGHT_SPEED;
      const range = Math.min(b.maxDistance || Infinity, (speed * b.flightMs) / 1000);
      const flightDistance = Math.max(0, target.distance - body.radius - target.body.radius);
      if (flightDistance > range - 10) return null;
      const lead = Math.min(2, flightDistance / speed);
      aim = {
        x: clamp(target.body.x + target.vx * lead, 0, a.world.width),
        y: clamp(target.body.y + target.vy * lead, 0, a.world.height),
      };
      if (distance(body, aim) - body.radius - target.body.radius > range) return null;
      score = danger ? (b.id === "glove" || b.kind === "lock" ? 95 : 70) : 40;
    }
    if (!score || (b.target === "direction" && !this.clearShot(p, ctx, aim))) return null;
    return { b, aim, score: score + this.random() * 12 };
  }
  use(p, choice, state, at) {
    if (!this.boostersEnabled) return null;
    const b = choice.b;
    if (["clan", "potion"].includes(b.tier) || !b.ready || state.used >= LIFE_BOOSTERS || !state.bag.includes(b.id))
      return null;
    try {
      const apply = this.arena.prepareBooster(
        p.id,
        { boosterId: b.id, spawnSerial: p.spawnSerial, aimX: choice.aim.x, aimY: choice.aim.y },
        at,
      );
      const event = apply();
      state.bag.splice(state.bag.indexOf(b.id), 1);
      state.used++;
      state.nextBoosterAt = at + 2200 + this.random() * 1000;
      return { ...event, mass: p.mass };
    } catch (error) {
      if (!(error instanceof BoosterError)) throw error;
      return null; // Rejected attempts do not consume a life supply.
    }
  }
  act(p, at) {
    if (p.dead) return null;
    const state =
      this.lives.get(p.id)?.lifeId === p.lifeId ? this.lives.get(p.id) : this.start(p, at);
    const ctx = this.scan(p, at, state);
    const destination = this.safePoint(p, ctx, this.destination(p, ctx, state, at), at);
    this.arena.handleInput(p.id, { type: "move", ...destination, spawnSerial: p.spawnSerial }, at);
    this.split(p, ctx, state, at);
    // Re-read bodies after a split before feeding or using a booster.
    const fresh = { ...ctx, body: this.arena.mainBody(p), own: this.arena.bodies(p) };
    this.feed(p, fresh, state, at);
    if (
      !this.boostersEnabled ||
      at < state.nextBoosterAt ||
      p.protectedUntil > at ||
      state.used >= LIFE_BOOSTERS
    )
      return null;
    const choices = state.bag
      .map((id) => this.choice(p, BOOSTERS.get(id), fresh, state, at, destination))
      .filter(Boolean)
      .sort((x, y) => y.score - x.score);
    for (const choice of choices) {
      const event = this.use(p, choice, state, at);
      if (event) return event;
    }
    return null;
  }
}
module.exports = { BotBrain, LIFE_BOOSTERS };
