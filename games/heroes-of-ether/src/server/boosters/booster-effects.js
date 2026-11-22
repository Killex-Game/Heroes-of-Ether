/* Изменение массы и частей шара от бустеров, поджог и периодические эффекты. */
"use strict";
const { randomUUID } = require("node:crypto");
const { RULES, radiusForMass: radius } = require("../arena/arena-simulation");
const { BOOSTERS } = require("./booster-catalog");
const arenaPets = require("../pets/arena-pets");

// Все изменения массы выполняются на сервере, целыми числами.
class BoosterEffects {
  constructor(arena) {
    this.arena = arena;
  }
  split(
    p,
    body,
    count,
    now,
    rocket = false,
    minHitMass = 20,
    splitLimitDamage = 0,
    pieceShare = null,
    settle = true,
  ) {
    const a = this.arena,
      id = a.bodyId(p, body);
    this.tickSwordBurns(p, now);
    body = a.bodies(p).find((part) => a.bodyId(p, part) === id);
    if (p.dead || !body) return false;
    const capped = a.bodies(p).length >= a.maxParts;
    if (capped) {
      if (splitLimitDamage > 0) {
        const loss = Math.max(
          1,
          Math.floor(body.mass * splitLimitDamage * arenaPets.damageFactor(p)),
        );
        body.mass = Math.max(RULES.MIN_PART_MASS, body.mass - loss);
        body.radius = radius(body.mass);
        a.syncParts(p);
      }
      return false;
    }
    if (rocket && body.mass < minHitMass) return false;
    count = Math.min(
      count,
      a.maxParts + 1 - a.bodies(p).length,
      Math.floor(body.mass / RULES.MIN_PART_MASS),
    );
    if (count < 2) return false;
    a.prepareMergeTimers(p);
    if (!p.parts)
      p.parts = [
        {
          id: p.mainPartId,
          x: p.x,
          y: p.y,
          mass: p.mass,
          radius: p.radius,
          vx: 0,
          vy: 0,
          mergeVersion: p.mergeVersion,
        },
      ];
    body = p.parts.find((b) => b.id === id);
    delete p.effects.sponge;
    const piece = Math.max(
      RULES.MIN_PART_MASS,
      Math.floor(body.mass * (pieceShare ?? 1 / (rocket ? 10 : count))),
    );
    body.mass -= piece * (count - 1);
    body.radius = radius(body.mass);
    body.mergeAt = now + RULES.MERGE_DELAY_MS;
    const children = [body];
    const anchored = p.effects.web > now;
    for (let i = 1; i < count; i++) {
      const angle =
        Math.atan2(p.targetY - body.y, p.targetX - body.x) + (i / (count - 1) - 0.5) * Math.PI;
      p.parts.push({
        id: randomUUID(),
        birth: { tick: a.tick, x: body.x, y: body.y },
        splitStartedAt: now,
        mass: piece,
        radius: radius(piece),
        x: body.x + (anchored ? 0 : Math.cos(angle)),
        y: body.y + (anchored ? 0 : Math.sin(angle)),
        vx: anchored ? 0 : Math.cos(angle) * 18,
        vy: anchored ? 0 : Math.sin(angle) * 18,
        mergeVersion: 0,
        mergeAt: body.mergeAt,
      });
      children.push(p.parts[p.parts.length - 1]);
    }
    this.splitSwordBurn(p, id, children, now);
    if (settle) {
      a.refreshMergeTimer(p);
      a.separateParts(p, now);
      a.syncParts(p);
    }
    return true;
  }
  splitToLimit(p, now, onSplit) {
    this.tickSwordBurns(p, now);
    if (p.dead) return false;
    const groups = this.arena.bodies(p).map((body) => ({ body, count: 1 }));
    let slots = this.arena.maxParts - groups.length,
      changed = false;
    // Allocate a bounded number of pieces, keeping every existing body in its place.
    // Only settle geometry once; no per-projectile target search survives the hit.
    while (slots > 0) {
      let selected;
      for (const group of groups)
        if (
          group.body.mass >= (group.count + 1) * RULES.MIN_PART_MASS &&
          (!selected || group.body.mass / group.count > selected.body.mass / selected.count)
        )
          selected = group;
      if (!selected) break;
      selected.count++;
      slots--;
    }
    for (const group of groups)
      if (group.count > 1) {
        const before = this.arena.bodies(p).length;
        const divided = this.split(p, group.body, group.count, now, false, 20, 0, null, false);
        if(divided) onSplit?.(this.arena.bodies(p).length-before+1);
        changed = divided || changed;
      }
    if (changed) {
      this.arena.refreshMergeTimer(p);
      this.arena.separateParts(p, now);
      this.arena.syncParts(p);
    }
    return changed;
  }
  halve(p, now) {
    for (const body of [...this.arena.bodies(p)]) this.split(p, body, 2, now);
  }
  apply(p, b, now, body = this.arena.mainBody(p)) {
    if (b.kind === "sword") {
      const id = this.arena.bodyId(p, body);
      this.tickSwordBurns(p, now);
      body = this.arena.bodies(p).find(part => this.arena.bodyId(p, part) === id);
      if (p.dead || !body) return;
      if (body.mass <= BOOSTERS.get("fire").destroyAtOrBelowMass) {
        this.removeBurnedBody(p, body, now);
        return;
      }
      const partId = this.arena.bodyId(p, body);
      p.swordBurns.push({
        partId,
        start: now,
        until: now + b.durationMs,
        budget: Math.floor(body.mass * b.fraction * arenaPets.damageFactor(p)),
        applied: 0,
      });
      this.refreshSwordEffect(p);
      return;
    }
    if (b.kind === "poison") {
      delete p.effects.poison;
      delete p.effects.mega_poison;
      p.damageTicks = (p.damageTicks || []).filter((e) => e.kind !== "poison");
    }
    if (b.kind === "poison") {
      (p.damageTicks ||= []).push({
        kind: b.kind,
        id: b.id,
        // Multiply the percentage before dividing: 700 * 35% must be 245,
        // not 244 from the binary approximation of 0.35.
        budget: Math.floor(((p.mass * (b.fraction * 100)) / 100) * arenaPets.damageFactor(p)),
        start: now,
        until: now + b.durationMs,
        interval: b.tickMs,
        applied: 0,
        next: now + b.tickMs,
      });
      p.effects[b.id] = now + b.durationMs;
    } else if (b.kind === "cake") {
      p.nextCakeAt = now + 1000;
      p.cakeRemainder = 0;
      p.cakeGiftFactor = b.effectFactor || 1;
      p.cakeGrowthFraction = b.growthFraction;
      p.effects[b.id] = now + b.durationMs;
    } else if (b.kind === "lock") {
      p.effects[b.id] = Math.max(now, p.effects[b.id] || 0) + b.durationMs;
    }
  }
  tick(p, now) {
    const a = this.arena;
    this.tickSwordBurns(p, now);
    if (p.dead) return;
    // Обрабатываем секунды по порядку: результат не зависит от частоты тиков.
    const damage = p.damageTicks || [];
    while (true) {
      const next = Math.min(
        ...damage.map((e) => e.next),
        p.nextCakeAt <= p.effects.cake ? p.nextCakeAt : Infinity,
        p.nextEasterAt <= p.effects.easter_egg ? p.nextEasterAt : Infinity,
      );
      if (!Number.isFinite(next) || next > now) break;
      for (const e of damage)
        if (e.next === next) {
          const due = Math.floor(e.budget * Math.min(1, (next - e.start) / (e.until - e.start)));
          const before = a.bodies(p).map((part) => ({ part, mass: part.mass }));
          a.loseMass(p, Math.max(0, due - e.applied));
          this.ejectPoisonFood(p, before, next);
          e.applied = due;
          e.next = next >= e.until ? Infinity : Math.min(e.until, next + e.interval);
        }
      if (p.nextCakeAt === next && next <= p.effects.cake) {
        const raw =
          Math.min(
            1000 * (p.cakeGiftFactor || 1),
            p.mass * (p.cakeGrowthFraction || BOOSTERS.get("cake").growthFraction),
          ) *
            arenaPets.positiveFactor(p) +
          (p.cakeRemainder || 0);
        this.grow(p, Math.floor(raw), p.cakeGiftFactor || 1, now);
        p.cakeRemainder = raw % 1;
        p.nextCakeAt += 1000;
      }
      if (p.nextEasterAt === next && next <= p.effects.easter_egg) {
        for (const part of a.bodies(p))
          a.gainMass(
            p,
            Math.floor((p.easterAlchemyAmount || BOOSTERS.get("easter_egg").amount) * (p.easterGiftFactor || 1)),
            part,
            now,
          );
        p.nextEasterAt += BOOSTERS.get("easter_egg").tickMs;
      }
    }
    p.damageTicks = damage.filter((e) => Number.isFinite(e.next));
  }
  ejectPoisonFood(p, before, now) {
    const a = this.arena;
    for (const { part, mass } of before) {
      const loss = mass - part.mass;
      if (loss <= 0) continue;
      // Only 15% of actual poison damage becomes food. Carry hundredths across
      // ticks, parts and repeated hits so small losses do not round away.
      const units = loss * 15 + (p.poisonFoodRemainder || 0);
      const emitted = Math.floor(units / 100);
      p.poisonFoodRemainder = units % 100;
      if (!emitted) continue;
      const count = a.reserveFeedSpace(Math.ceil(emitted / 5), now, true);
      if (!count) {
        // At the arena limit combine food instead of losing mass or growing packets without bound.
        let closest,
          nearest = Infinity,
          ownFound = false;
        for (const orb of a.ether) {
          const own = orb.poisonFood && orb.sourceId === p.id;
          if (!orb.ejected || (ownFound && !own)) continue;
          const distance = (orb.x - part.x) ** 2 + (orb.y - part.y) ** 2;
          if ((!ownFound && own) || distance < nearest) {
            closest = orb;
            nearest = distance;
            ownFound = Boolean(own);
          }
        }
        if (closest) {
          closest.value += emitted;
          closest.expiresAt = Math.max(closest.expiresAt, now + RULES.FEED_LIFETIME_MS);
        }
        continue;
      }
      const startAngle = a.random() * Math.PI * 2;
      for (let i = 0; i < count; i++) {
        const angle = startAngle + (i * Math.PI * 2) / count,
          nx = Math.cos(angle),
          ny = Math.sin(angle);
        const radius = 6,
          distance = part.radius + radius + 4;
        a.ether.push({
          id: "e" + (++a.etherSequence).toString(36),
          ejected: true,
          poisonFood: true,
          value: Math.floor(emitted / count) + (i < emitted % count ? 1 : 0),
          radius,
          artValue: 5,
          color: "#8cd968",
          x: Math.max(radius, Math.min(a.world.width - radius, part.x + nx * distance)),
          y: Math.max(radius, Math.min(a.world.height - radius, part.y + ny * distance)),
          vx: nx * RULES.FEED_SPEED,
          vy: ny * RULES.FEED_SPEED,
          updatedAt: now,
          sourceId: p.id,
          sourcePickupAt: now + RULES.FEED_PICKUP_DELAY_MS,
          expiresAt: now + RULES.FEED_LIFETIME_MS,
        });
      }
    }
  }
  refreshSwordEffect(p) {
    const until = Math.max(0, ...p.swordBurns.map((e) => e.until));
    if (until) p.effects.fire_sword = until;
    else delete p.effects.fire_sword;
  }
  tickSwordBurns(p, now) {
    if (!p.swordBurns?.length) {
      p.swordBurns ||= [];
      delete p.effects.fire_sword;
      return;
    }
    const a = this.arena;
    p.swordBurns = (p.swordBurns || []).filter((e) => {
      // Removing a part can collapse the final part back into the player model.
      // Resolve its stable id again, rather than retaining the removed object.
      const part = a.bodies(p).find((body) => a.bodyId(p, body) === e.partId);
      if (p.dead || !part) return false; // Поглощённый шар не передаёт огонь остальным.
      const due = Math.floor(
        e.budget * Math.min(1, Math.max(0, now - e.start) / (e.until - e.start)),
      );
      const loss = Math.max(0, due - e.applied);
      part.mass = Math.max(RULES.MIN_PART_MASS, part.mass - loss);
      part.radius = radius(part.mass);
      e.applied = due;
      if (loss > 0 && part.mass <= BOOSTERS.get("fire").destroyAtOrBelowMass) {
        this.removeBurnedBody(p, part, now);
        return false;
      }
      return now < e.until;
    });
    a.syncParts(p);
    this.refreshSwordEffect(p);
  }
  splitSwordBurn(p, id, children, now) {
    const burns = p.swordBurns.filter((e) => e.partId === id);
    p.swordBurns = p.swordBurns.filter((e) => e.partId !== id);
    const total = children.reduce((sum, b) => sum + b.mass, 0);
    for (const e of burns) {
      const remaining = e.budget - e.applied;
      const shares = children.map((part) => ({
        part,
        raw: (remaining * part.mass) / total,
      }));
      let rest = remaining;
      for (const s of shares) {
        s.budget = Math.floor(s.raw);
        rest -= s.budget;
      }
      shares.sort((a, b) => (b.raw % 1) - (a.raw % 1));
      for (const s of shares) if (rest-- > 0) s.budget++;
      for (const s of shares)
        p.swordBurns.push({
          partId: s.part.id,
          start: now,
          until: e.until,
          budget: s.budget,
          applied: 0,
        });
    }
  }
  mergeSwordBurns(p, ids, survivor, now) {
    this.tickSwordBurns(p, now);
    const burns = p.swordBurns.filter((e) => ids.includes(e.partId));
    if (!burns.length) return;
    p.swordBurns = p.swordBurns.filter((e) => !ids.includes(e.partId));
    for (const e of burns)
      p.swordBurns.push({
        partId: survivor,
        start: now,
        until: e.until,
        budget: e.budget - e.applied,
        applied: 0,
      });
    this.refreshSwordEffect(p);
  }
  grow(p, amount, giftFactor = 1, now = Infinity) {
    const a = this.arena,
      parts = a.bodies(p);
    const budget = Math.max(0, Math.min(amount, 1000 * arenaPets.positiveFactor(p) * giftFactor)),
      total = p.mass;
    const shares = parts.map((part) => ({
      part,
      share: (budget * part.mass) / total,
    }));
    let rest = budget;
    for (const s of shares) {
      s.gain = Math.floor(s.share);
      rest -= s.gain;
    }
    shares.sort((x, y) => (y.share % 1) - (x.share % 1));
    for (const s of shares) if (rest-- > 0) s.gain++;
    // Доля насыщенного шара не переходит другим: сила Торта остаётся прежней.
    for (const s of shares) a.gainMass(p, s.gain, s.part, now);
  }
  burn(p, body, now, fraction = 0.5) {
    const a = this.arena;
    if (p.dead || !a.bodies(p).includes(body)) return;
    const resistance = arenaPets.damageFactor(p);
    const threshold = BOOSTERS.get("fire").destroyAtOrBelowMass;
    const damageFraction = Math.max(0, Math.min(1, fraction * resistance));
    // Remove binary floating-point noise before integer mass rounding (e.g. 57%).
    const loss = Math.floor(body.mass * damageFraction + 1e-9);
    if (body.mass <= threshold || body.mass - loss <= threshold) {
      this.removeBurnedBody(p, body, now);
      return;
    }
    body.mass -= loss;
    body.radius = radius(body.mass);
    a.syncParts(p);
  }
  removeBurnedBody(p, body, now) {
    const a = this.arena;
    if (p.dead || !a.bodies(p).includes(body)) return;
    a.combat.contacts.push({
      type: "partRemoved",
      reason: "fire",
      tick: a.tick,
      key: p.id + ":" + a.bodyId(p, body),
      x: body.x,
      y: body.y,
    });
    const remaining = a.bodies(p).filter((b) => b !== body);
    if (remaining.length) {
      p.parts = remaining;
      a.syncParts(p);
      return;
    }
    a.accrueMass(p, now, true);
    p.dead = true;
    p.endedAt = now;
    a.combatEvents.push({
      type: "burned",
      victimId: p.id,
      lifeId: p.lifeId,
      durationSeconds: Math.max(0, Math.floor((now - p.lifeStartedAt) / 1000)),
    });
  }
  startSponge(p, now, durationMs = BOOSTERS.get("sponge").durationMs) {
    const a = this.arena;
    // Губка снимает только ожидание. Движение и слияние остаются общими для всех частей.
    a.prepareMergeTimers(p);
    for (const part of p.parts || []) part.mergeAt = Math.min(part.mergeAt, now);
    a.refreshMergeTimer(p);
    p.effects.sponge = now + durationMs;
  }
}
module.exports = { BoosterEffects };
