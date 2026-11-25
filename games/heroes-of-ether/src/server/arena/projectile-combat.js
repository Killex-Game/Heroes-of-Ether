/* Полёт и столкновения бустеров, отражения, ловушки и удерживаемый меч. */
"use strict";
const { randomUUID } = require("node:crypto");
const { BOOSTERS, BOOSTER_RULES: R, BoosterError } = require("../boosters/booster-catalog");
const gifts = require("../profiles/gift-effects");
const arenaPets = require("../pets/arena-pets");
const accessories = require("../../../public/shared/accessory-catalog");
const accessoryPassives = require("./accessory-passives");
const vortexRadius = (part) => part.radius + Math.min(240, 100 + part.radius * 0.6);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// Первое пересечение отрезка с кругом: быстрый снаряд не пролетает сквозь малую часть.
function intersection(ax, ay, bx, by, cx, cy, r) {
  // The swept segment cannot touch the circle if both endpoints lie beyond
  // the same side. Most W pellets and player parts are far from each hazard.
  if (
    (ax < cx - r && bx < cx - r) ||
    (ax > cx + r && bx > cx + r) ||
    (ay < cy - r && by < cy - r) ||
    (ay > cy + r && by > cy + r)
  )
    return null;
  const dx = bx - ax,
    dy = by - ay,
    fx = ax - cx,
    fy = ay - cy,
    c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (!a) return null;
  const b = 2 * (fx * dx + fy * dy),
    discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
class Combat {
  constructor(arena) {
    this.arena = arena;
    this.shots = [];
    this.pulls = new Map();
    this.completedPulls = new Map();
    this.contacts = [];
    this.swords = [];
    this.hitBounds = null;
  }
  prepare(player, booster, message, now) {
    booster = accessoryPassives.outgoing(player, booster);
    const outgoing = gifts.arena(player, "outgoing");
    if (booster.kind === "fire") {
      const base = arenaPets.fireFraction(player);
      booster = {
        ...gifts.adjust(booster, outgoing),
        // +25% strength multiplies the base damage; it is not +25 percentage points.
        fireFraction: base * outgoing * (booster.alchemyFireFactor || 1) * (booster.accessoryCritical || 1) *
          (1 + accessories.bonus(player.outfit, "attack") / 100),
      };
    } else booster = gifts.adjust(booster, outgoing);
    if (player.protectedUntil > now)
      throw new BoosterError("Во время защиты появления атаковать нельзя.");
    if (booster.kind === "vortex") {
      const shot = {
        id: randomUUID(),
        boosterId: booster.id,
        effectBooster: booster,
        ownerId: player.id,
        ownerLife: player.lifeId,
        x: player.x,
        y: player.y,
        dx: 0,
        dy: 0,
        launchedAt: now,
        lastAt: now,
        landsAt: now,
        areaLastAt: now,
        landed: true,
      };
      return () => {
        this.shots.push(shot);
        player.effects[booster.id] = Math.max(
          player.effects[booster.id] || 0,
          now + booster.durationMs,
        );
      };
    }
    if (!Number.isFinite(message.aimX) || !Number.isFinite(message.aimY))
      throw new BoosterError("Укажи направление полёта.");
    const world = this.arena.world;
    const aimX = clamp(message.aimX, 0, world.width),
      aimY = clamp(message.aimY, 0, world.height);
    if (booster.kind === "sword") {
      return () => {
        // A fresh use replaces the held blade, keeping a bounded per-player list.
        this.swords = this.swords.filter((s) => s.ownerId !== player.id);
        const sword = {
          id: randomUUID(),
          boosterId: booster.id,
          effectBooster: booster,
          ownerId: player.id,
          ownerLife: player.lifeId,
          until: now + booster.heldMs,
          dx: 1,
          dy: 0,
          contacts: new Map(),
        };
        this.positionSword(sword, player, aimX, aimY);
        this.swords.push(sword);
      };
    }
    // Mines are thrown behind movement; standing still uses the opposite aim direction.
    // Flight, arming, collision and lifetime rules below are shared and unchanged.
    let rear = null;
    if (booster.id === "mine") {
      let mx = player.moveDirection?.x ?? player.targetX - player.x,
        my = player.moveDirection?.y ?? player.targetY - player.y;
      if (
        player.stopped ||
        !Number.isFinite(mx) ||
        !Number.isFinite(my) ||
        Math.hypot(mx, my) < 1
      ) {
        mx = aimX - player.x;
        my = aimY - player.y;
      }
      const length = Math.hypot(mx, my);
      if (length < 1) throw new BoosterError("Укажи направление движения или броска.");
      rear = { x: -mx / length, y: -my / length };
    }
    // Closest edge to the cursor normally; rear outer edge for a mine.
    const body = this.arena
      .bodies(player)
      .reduce((best, part) =>
        rear
          ? (part.x - best.x) * rear.x + (part.y - best.y) * rear.y + part.radius - best.radius > 0
            ? part
            : best
          : Math.max(0, Math.hypot(aimX - part.x, aimY - part.y) - part.radius) <
              Math.max(0, Math.hypot(aimX - best.x, aimY - best.y) - best.radius)
            ? part
            : best,
      );
    const dx = rear ? rear.x : aimX - body.x,
      dy = rear ? rear.y : aimY - body.y;
    const distance = Math.hypot(dx, dy);
    if (!rear && distance < 1) throw new BoosterError("Направь курсор за пределы центра сферы.");
    // Ловушки переживают жизнь и переподключение: лимит привязан к профилю.
    // Считаем и летящие ловушки, чтобы несколько запусков не обходили предел.
    const ownerProfileId = player.profileId || player.id;
    if (
      booster.trap &&
      this.shots.filter(
        (shot) => shot.ownerProfileId === ownerProfileId && BOOSTERS.get(shot.boosterId)?.trap,
      ).length >= R.MAX_TRAPS_PER_PROFILE
    ) {
      throw new BoosterError(
        `На поле уже ${R.MAX_TRAPS_PER_PROFILE} ваших ловушек. Дождитесь срабатывания одной из них. Предмет сохранён.`,
        409,
      );
    }
    const shot = {
      id: randomUUID(),
      boosterId: booster.id,
      petBooster: booster.pet ? { ...booster } : undefined,
      effectBooster: booster,
      ownerId: player.id,
      ownerLife: player.lifeId,
      ownerProfileId,
      sourcePartId: this.arena.bodyId(player, body),
      x: body.x,
      y: body.y,
      dx: dx / distance,
      dy: dy / distance,
      launchedAt: now,
      lastAt: now,
      landsAt: now + booster.flightMs,
      landed: false,
      distanceTravelled: 0,
      maxDistance: booster.maxDistance || Infinity,
    };
    shot.speed = booster.flightSpeed || R.FLIGHT_SPEED;
    return () => {
      const count = booster.fan || 1;
      for (let i = 0; i < count; i++) {
        const angle =
          count === 1 ? 0 : ((i / (count - 1) - 0.5) * booster.fanAngleDegrees * Math.PI) / 180;
        const nx = shot.dx * Math.cos(angle) - shot.dy * Math.sin(angle),
          ny = shot.dx * Math.sin(angle) + shot.dy * Math.cos(angle);
        // Каждый луч веера начинается с края выбранной части, снаружи её контура.
        // У стены сокращаем отступ вдоль луча, сохраняя направление.
        const offset = Math.max(
          0,
          Math.min(
            body.radius + R.PROJECTILE_RADIUS,
            nx > 0 ? (world.width - body.x) / nx : nx < 0 ? -body.x / nx : Infinity,
            ny > 0 ? (world.height - body.y) / ny : ny < 0 ? -body.y / ny : Infinity,
          ),
        );
        this.shots.push({
          ...shot,
          id: randomUUID(),
          x: body.x + nx * offset,
          y: body.y + ny * offset,
          dx: nx,
          dy: ny,
          hitParts: new Set(),
          contactParts: booster.hitOwnerInFlight
            ? new Set([player.lifeId + ":" + shot.sourcePartId])
            : undefined,
        });
      }
    };
  }
  alive(id, life) {
    const p = this.arena.players.get(id);
    return p && !p.dead && p.lifeId === life ? p : null;
  }
  positionSword(sword, owner, aimX = owner.targetX, aimY = owner.targetY) {
    const body = this.arena.mainBody(owner),
      dx = aimX - body.x,
      dy = aimY - body.y,
      length = Math.hypot(dx, dy);
    if (length > 0.01) {
      sword.dx = dx / length;
      sword.dy = dy / length;
    }
    sword.partId = this.arena.bodyId(owner, body);
    sword.imageSize = clamp(body.radius * 0.85, 38, 160) * 1.35;
    // The visible handle-to-tip diagonal spans 1.1 image widths.
    sword.length = sword.imageSize * 1.1;
    sword.x = body.x + sword.dx * (body.radius + sword.length * 0.5);
    sword.y = body.y + sword.dy * (body.radius + sword.length * 0.5);
    return body;
  }
  updateSwords(now) {
    for (const sword of this.swords) {
      if (sword.until <= now) continue;
      const owner = this.alive(sword.ownerId, sword.ownerLife);
      // An earlier sword can kill this owner during the same update.
      if (!owner) continue;
      const body = this.positionSword(sword, owner);
      const ax = body.x + sword.dx * body.radius,
        ay = body.y + sword.dy * body.radius;
      const bx = ax + sword.dx * sword.length,
        by = ay + sword.dy * sword.length;
      const contacts = new Map();
      for (const target of this.arena.players.values()) {
        if (
          target.dead ||
          target.id === owner.id ||
          target.protectedUntil > now ||
          this.arena.hasEffect(target, "shield", now)
        )
          continue;
        for (const part of this.arena.bodies(target)) {
          if (
            intersection(ax, ay, bx, by, part.x, part.y, part.radius + sword.length * 0.07) === null
          )
            continue;
          const key = target.lifeId + ":" + this.arena.bodyId(target, part);
          const lastHit = sword.contacts.get(key);
          const strike =
            lastHit === undefined ||
            now - lastHit >= BOOSTERS.get(sword.boosterId).contactIntervalMs;
          contacts.set(key, strike ? now : lastHit);
          if (strike)
            this.arena.boosterEffects.apply(
              target,
              require("./alchemy-effects").incoming(target, gifts.adjust(
                sword.effectBooster || BOOSTERS.get(sword.boosterId),
                gifts.arena(target, "incoming"),
              )),
              now,
              part,
            );
        }
      }
      sword.contacts = contacts;
    }
    this.swords = this.swords.filter((s) => s.until > now && this.alive(s.ownerId, s.ownerLife));
  }
  pullToPoint(shot, x, y, now) {
    const owner = this.alive(shot.ownerId, shot.ownerLife);
    if (!owner || owner.effects.web > now) return;
    // Hits run before movePull: finish the elapsed step before replacing a pull.
    this.movePull(owner, now);
    const flightLength = Math.hypot(shot.dx || 0, shot.dy || 0),
      dx = flightLength > 0.001 ? shot.dx : x - owner.x,
      dy = flightLength > 0.001 ? shot.dy : y - owner.y,
      length = Math.hypot(dx, dy),
      distance = (R.HARPOON_SPEED * R.PULL_MS) / 1000 * (shot.effectBooster?.alchemyPullFactor || 1) * (shot.effectBooster?.accessoryPullFactor || 1);
    // A later projectile may land behind its moving owner. Keep its flight direction.
    this.pulls.set(owner.id, {
      life: owner.lifeId,
      kind: "harpoon",
      duration: R.PULL_MS,
      dx: (length > 0.001 ? dx / length : 1) * distance,
      dy: (length > 0.001 ? dy / length : 0) * distance,
      startedAt: now,
      applied: 0,
    });
  }
  reflectKnuckles(shot, target, part, now) {
    shot.ricochetUntil ||= now + (shot.effectBooster || BOOSTERS.get(shot.boosterId)).durationMs;
    shot.maxDistance = Infinity;
    shot.landsAt = shot.ricochetUntil;
    shot.lastAt = now;
    shot.boundary = false;
    shot.contactParts ||= new Set();
    shot.contactParts.add(target.lifeId + ":" + this.arena.bodyId(target, part));
    shot.reflectedContacts ||= new Set();
    shot.reflectedContacts.add(target.lifeId + ":" + this.arena.bodyId(target, part));
    this.shieldSound(shot, target, part);
    const rx = shot.x - part.x,
      ry = shot.y - part.y;
    const distance = Math.hypot(rx, ry);
    const nx = distance > 0 ? rx / distance : -shot.dx;
    const ny = distance > 0 ? ry / distance : -shot.dy;
    const inward = Math.min(0, shot.dx * nx + shot.dy * ny);
    shot.dx -= 2 * inward * nx;
    shot.dy -= 2 * inward * ny;
    if (distance < part.radius + R.PROJECTILE_RADIUS) {
      const offset = part.radius + R.PROJECTILE_RADIUS + 0.01;
      shot.x = clamp(part.x + nx * offset, 0, this.arena.world.width);
      shot.y = clamp(part.y + ny * offset, 0, this.arena.world.height);
    }
    shot.motionVersion = (shot.motionVersion || 0) + 1;
  }
  hit(shot, ax, ay, bx, by, now) {
    let first = null;
    // Reject distant parts before allocating hit keys and solving the quadratic.
    // The swept bounds include the complete projectile/trap radius; the exact
    // contact test and its deterministic tie order below remain unchanged.
    const shotRadius = shot.landed ? R.TRAP_RADIUS : R.PROJECTILE_RADIUS,
      left = Math.min(ax, bx) - shotRadius,
      right = Math.max(ax, bx) + shotRadius,
      top = Math.min(ay, by) - shotRadius,
      bottom = Math.max(ay, by) + shotRadius;
    const hitOwnerInFlight = BOOSTERS.get(shot.boosterId)?.hitOwnerInFlight;
    for (const p of this.arena.players.values()) {
      if (
        p.dead ||
        (!shot.landed && !shot.ricochetUntil && !hitOwnerInFlight && p.id === shot.ownerId)
      )
        continue;
      let parts;
      if (this.hitBounds) {
        let bounds = this.hitBounds.get(p);
        if (!bounds) {
          parts = this.arena.bodies(p);
          bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity, parts };
          for (const body of parts) {
            bounds.left = Math.min(bounds.left, body.x - body.radius);
            bounds.right = Math.max(bounds.right, body.x + body.radius);
            bounds.top = Math.min(bounds.top, body.y - body.radius);
            bounds.bottom = Math.max(bounds.bottom, body.y + body.radius);
          }
          this.hitBounds.set(p, bounds);
        }
        if (
          bounds.right < left ||
          bounds.left > right ||
          bounds.bottom < top ||
          bounds.top > bottom
        )
          continue;
        parts = bounds.parts;
      } else parts = this.arena.bodies(p);
      for (const part of parts) {
        if (
          part.x + part.radius < left ||
          part.x - part.radius > right ||
          part.y + part.radius < top ||
          part.y - part.radius > bottom
        )
          continue;
        const key = p.lifeId + ":" + this.arena.bodyId(p, part);
        if (shot.hitParts?.has(key)) continue;
        // A moving body can overlap an already reflected projectile again.
        // Let an outgoing contact separate instead of repeatedly resetting its
        // flight to t=0. Once separated, the same body is eligible again.
        if (shot.reflectedContacts?.has(key)) {
          const distance = Math.hypot(ax - part.x, ay - part.y);
          const edge = part.radius + shotRadius;
          const outgoing = (ax - part.x) * (bx - ax) + (ay - part.y) * (by - ay) >= 0;
          if (distance <= edge + 0.02 && outgoing && !shot.landed) continue;
          shot.contactParts?.delete(key);
          shot.reflectedContacts.delete(key);
        }
        if (shot.contactParts?.has(key) &&
            (!shot.landed || shot.ricochetUntil) &&
            (ax - part.x) * (bx - ax) + (ay - part.y) * (by - ay) >= 0 &&
            Math.hypot(ax - part.x, ay - part.y) >= part.radius + R.PROJECTILE_RADIUS - 0.01)
          continue;
        const t = intersection(
          ax,
          ay,
          bx,
          by,
          part.x,
          part.y,
          part.radius + (shot.landed ? R.TRAP_RADIUS : R.PROJECTILE_RADIUS),
        );
        if (t === null) continue;
        if (!first || t < first.t) {
          first = { t, player: p, part };
        } else if (t === first.t) {
          if (p.id < first.player.id) {
            first.player = p;
            first.part = part;
          }
        }
      }
    }
    return first;
  }
  shieldSound(shot, target, part) {
    this.arena.audioEvents.push({
      id: `shield:${shot.id}:${target.lifeId}:${this.arena.bodyId(target, part)}:${this.arena.tick}`,
      type: "shield",
      targetId: target.id,
      x: shot.x,
      y: shot.y,
    });
  }
  impact(shot, target, now, part = this.arena.mainBody(target), contacts, shieldAt = now) {
    // A hit can split, grow, burn or move bodies before the next projectile.
    // Never reuse their old broad-phase bounds, including any additional contacts.
    this.hitBounds?.delete(target);
    if (contacts) for (const contact of contacts) this.hitBounds?.delete(contact.player);
    const arena = this.arena,
      baseBooster = shot.effectBooster || shot.petBooster || BOOSTERS.get(shot.boosterId),
      booster = accessoryPassives.incoming(target, require("./alchemy-effects").incoming(target, gifts.adjust(
        baseBooster,
        baseBooster.kind === "cake" ? 1 : gifts.arena(target, "incoming"),
      )));
    if (booster.kind === "knuckles") {
      if (target.protectedUntil > shieldAt || arena.hasEffect(target, "shield", shieldAt)) {
        this.reflectKnuckles(shot, target, part, now);
        return "reflected";
      }
      let parts = 0;
      arena.boosterEffects.splitToLimit(target, now, count => parts += count);
      if(parts && target.id!==shot.ownerId)
        require('./quest-actions').record(arena,this.alive(shot.ownerId,shot.ownerLife),'splitParts',target,null,parts);
      return;
    }
    if (target.protectedUntil > shieldAt) {
      this.shieldSound(shot, target, part);
      return;
    }
    if (booster.kind === "fire") {
      if (accessoryPassives.chance(target, "fireBlock", arena.random)) return;
      arena.boosterEffects.burn(
        target,
        part,
        now,
        booster.fireFraction ?? arenaPets.fireFraction(this.alive(shot.ownerId, shot.ownerLife)),
      );
      return;
    }
    if (booster.kind === "awl") {
      const removed = arena.hasEffect(target, "shield", now);
      if (removed && accessoryPassives.chance(target, "shieldResistance", arena.random)) return;
      for (const id of Object.keys(target.effects))
        if (BOOSTERS.get(id)?.kind === "shield" && target.effects[id] > now) {
          delete target.effects[id];
        }
      if (removed) {
        accessoryPassives.shieldBroken(target, now, shot.ownerId);
      }
      return;
    }
    // Pet glove pierces ordinary shields and splits in this same contact.
    // Clan shields still use the shared reflection path below; spawn protection stays above.
    if (booster.id === "pet_glove" && !(target.effects.clan_shield > shieldAt) &&
        arena.hasEffect(target, "shield", shieldAt)) {
      this.shieldSound(shot, target, part);
      if (accessoryPassives.chance(target, "shieldResistance", arena.random)) return;
      for (const id of Object.keys(target.effects))
        if (BOOSTERS.get(id)?.kind === "shield" && target.effects[id] > shieldAt)
          delete target.effects[id];
      accessoryPassives.shieldBroken(target, now, shot.ownerId);
    }
    if (booster.kind !== "cake" && arena.hasEffect(target, "shield", shieldAt)) {
      this.shieldSound(shot, target, part);
      // Гарпун цепляется за щит: тяга принадлежит бросившему игроку.
      // Не передавать снаряд владельцу кланового щита при таком попадании.
      if (booster.pullOnMiss) {
        this.pullToPoint(shot, shot.x, shot.y, now);
        return;
      }
      if (target.effects.clan_shield > shieldAt) {
        // Щит отражает только летящие снаряды. Установленная ловушка
        // поглощается, не перезапускает полёт и не меняет владельца.
        if (booster.trap && (shot.landed || now >= shot.landsAt)) return;
        const sender = this.alive(shot.ownerId, shot.ownerLife),
          anchor = sender
            ? (booster.id === "stone" &&
                arena
                  .bodies(sender)
                  .find((body) => arena.bodyId(sender, body) === shot.sourcePartId)) ||
              arena.mainBody(sender)
            : null;
        let dx = anchor ? anchor.x - shot.x : -(shot.dx || 1),
          dy = anchor ? anchor.y - shot.y : -(shot.dy || 0);
        if (booster.id === "stone" && Math.hypot(dx, dy) < 1e-7) {
          dx = -(shot.dx || 1);
          dy = -(shot.dy || 0);
        }
        const length = Math.hypot(dx, dy) || 1;
        shot.dx = dx / length;
        shot.dy = dy / length;
        if (
          booster.id === "stone" &&
          Math.hypot(shot.x - part.x, shot.y - part.y) < part.radius + R.PROJECTILE_RADIUS
        ) {
          // Moving shields may overlap a flying stone between steps. Return
          // it from the sender-facing edge, never through the shield interior.
          const offset = part.radius + R.PROJECTILE_RADIUS;
          shot.x = clamp(part.x + shot.dx * offset, 0, arena.world.width);
          shot.y = clamp(part.y + shot.dy * offset, 0, arena.world.height);
        }
        const nx = shot.x - part.x,
          ny = shot.y - part.y,
          normal2 = nx * nx + ny * ny;
        const inward = shot.dx * nx + shot.dy * ny;
        if (inward < 0 && normal2 > 0) {
          shot.dx -= (2 * inward * nx) / normal2;
          shot.dy -= (2 * inward * ny) / normal2;
        }
        // Every flying booster leaves the reflecting surface immediately.
        const distance = Math.hypot(shot.x - part.x, shot.y - part.y);
        const edge = part.radius + R.PROJECTILE_RADIUS + 0.01;
        if (distance < edge) {
          const ux = distance > 1e-7 ? (shot.x - part.x) / distance : shot.dx;
          const uy = distance > 1e-7 ? (shot.y - part.y) / distance : shot.dy;
          shot.x = clamp(part.x + ux * edge, 0, arena.world.width);
          shot.y = clamp(part.y + uy * edge, 0, arena.world.height);
        }
        shot.route = [];
        shot.motionVersion = (shot.motionVersion || 0) + 1;
        shot.speed = booster.id === "stone" ? booster.flightSpeed : 200;
        shot.ownerId = target.id;
        shot.ownerLife = target.lifeId;
        shot.sourcePartId = arena.bodyId(target, part);
        shot.contactParts ||= new Set();
        shot.contactParts.add(target.lifeId + ":" + arena.bodyId(target, part));
        shot.reflectedContacts ||= new Set();
        shot.reflectedContacts.add(target.lifeId + ":" + arena.bodyId(target, part));
        shot.boundary = false;
        if (booster.id === "stone") {
          // Preserve the original deadline and travelled distance on every
          // rebound; only the remaining portion of these four seconds flies.
          shot.lastAt = now;
        }
        return "reflected";
      }
      return;
    }
    if (booster.kind === "rocket" || booster.kind === "divide") {
      if (booster.id === "rocket" && target.id !== shot.ownerId)
        require("./quest-actions").record(arena, this.alive(shot.ownerId, shot.ownerLife), "rocketHits", target);
      // Presentation only: shield reflection/protection above never triggers an explosion.
      if (booster.id === "mine")
        arena.audioEvents.push({
          id: shot.id,
          type: "mine",
          targetId: target.id,
          x: shot.x,
          y: shot.y,
        });
      const beforeParts = arena.bodies(target).length;
      const divided = arena.boosterEffects.split(
        target,
        part,
        booster.pieces || 3,
        now,
        booster.kind === "rocket",
        booster.minHitMass,
        booster.splitLimitDamage,
      );
      if(divided && target.id!==shot.ownerId)
        require('./quest-actions').record(arena,this.alive(shot.ownerId,shot.ownerLife),'splitParts',target,null,arena.bodies(target).length-beforeParts+1);
      return;
    }
    if (["poison", "sword", "lock", "cake"].includes(booster.kind)) {
      arena.boosterEffects.apply(target, booster, now, part);
      if(booster.kind==='poison' && target.id!==shot.ownerId)
        require('./quest-actions').record(arena,this.alive(shot.ownerId,shot.ownerLife),'clanPoisonHits',target);
      if (booster.id === "poison" && target.id !== shot.ownerId)
        require("./quest-actions").record(arena, this.alive(shot.ownerId, shot.ownerLife), "poisonHits", target);
      return;
    }
    if (booster.kind === "push") {
      if (target.effects.web > now) return;
      if (target.id !== shot.ownerId) require("./quest-actions").record(arena, this.alive(shot.ownerId, shot.ownerLife), "pushHits", target);
      this.pulls.set(target.id, {
        life: target.lifeId,
        dx: shot.dx * booster.pushDistance,
        dy: shot.dy * booster.pushDistance,
        startedAt: now,
        applied: 0,
        duration: 500,
      });
      return;
    }
    if (booster.kind === "pull") {
      const owner = this.alive(shot.ownerId, shot.ownerLife);
      if (!owner) return;
      if (booster.pullOnMiss) {
        this.pullToPoint(shot, shot.x, shot.y, now);
        return;
      }
      const moving = booster.pullTarget === "self" ? owner : target,
        anchor = moving === owner ? target : owner;
      if (moving.effects.web > now) return;
      // Repeated hits arrive before the movement phase: finish the elapsed
      // movement rather than repeatedly resetting an unapplied tick.
      this.movePull(moving, now);
      const source =
        anchor === owner
          ? arena.bodies(owner).find((body) => arena.bodyId(owner, body) === shot.sourcePartId) ||
            arena.mainBody(owner)
          : part;
      const attached = moving === target ? part : arena.mainBody(moving),
        dx = source.x - attached.x,
        dy = source.y - attached.y,
        distance = Math.hypot(dx, dy),
        travel = R.HOOK_PULL_DISTANCE * (booster.alchemyPullFactor || 1) * (booster.accessoryPullFactor ?? 1),
        fallbackAngle = Math.atan2(-shot.dy, -shot.dx),
        directionX = distance > 0 ? dx / distance : Math.cos(fallbackAngle),
        directionY = distance > 0 ? dy / distance : Math.sin(fallbackAngle);
      // Один прямой перенос от точки попадания к положению отправителя в этот момент.
      // Движение или смена частей отправителя больше не перенаводят уже попавший крюк.
      if (moving === target && target.id !== owner.id) require("./quest-actions").record(arena, owner, "hookHits", target);
      this.pulls.set(moving.id, {
        life: moving.lifeId,
        anchor: anchor.id,
        anchorLife: anchor.lifeId,
        kind: "hook",
        dx: directionX * travel,
        dy: directionY * travel,
        duration: Math.max(1, (travel / (R.HOOK_SPEED * (booster.alchemyPullFactor || 1))) * 1000),
        startedAt: now,
        applied: 0,
      });
    } else {
      if (!["root", "dizzy"].includes(booster.kind) && arena.hasEffect(target, booster.kind, now)) return;
      const until =
        now +
        Math.floor(
          booster.durationMs *
            (booster.id === "freeze"
              ? 1 - accessories.bonus(target.outfit, "freezeReduction") / 100
              : 1),
        );
      if (until <= now) return;
      target.effects[booster.id] = Math.max(target.effects[booster.id] || 0, until);
      if (booster.id === "freeze" && target.id !== shot.ownerId)
        require("./quest-actions").record(arena, this.alive(shot.ownerId, shot.ownerLife), "freezeHits", target);
      (target.effectStrengths ||= {})[booster.id] = booster.multiplier;
      if (booster.kind === "root") {
        if (booster.id === "web") {
          this.pulls.delete(target.id);
          this.completedPulls.delete(target.id);
        }
        target.targetX = target.x;
        target.targetY = target.y;
        target.stopped = true;
        for (const part of arena.bodies(target)) if (target.parts) part.vx = part.vy = 0;
      }
    }
  }
  recordContact(shot, target = null) {
    const pull =
      (shot.effectBooster || shot.petBooster || BOOSTERS.get(shot.boosterId)).kind === "pull";
    this.contacts.push({
      type: "projectileContact",
      tick: this.arena.tick,
      hold: pull,
      ...(pull && target
        ? {
            targets: this.arena.bodies(target).map((part) => ({
              key: target.id + ":" + this.arena.bodyId(target, part),
              x: part.x,
              y: part.y,
            })),
          }
        : {}),
      shot: {
        id: shot.id,
        boosterId: shot.boosterId,
        x: shot.x,
        y: shot.y,
        dx: shot.dx,
        dy: shot.dy,
        moving: false,
        motionVersion: shot.motionVersion || 0,
      },
    });
  }
  update(now) {
    // Reuse only within this synchronous combat step. Movement in other arena
    // phases must never see stale bounds. Small scenes keep the cheaper direct scan.
    if (this.shots.length >= 8) {
      let bodies = 0;
      for (const player of this.arena.players.values())
        if (!player.dead) bodies += player.parts?.length || 1;
      if (bodies >= 64) this.hitBounds = new Map();
    }
    try {
      this.updateProjectiles(now);
    } finally {
      this.hitBounds = null;
    }
  }
  updateProjectiles(now) {
    this.completedPulls.clear();
    this.contacts = [];
    this.updateSwords(now);
    const world = this.arena.world,
      keep = [];
    for (const shot of this.shots) {
      const booster = shot.effectBooster || shot.petBooster || BOOSTERS.get(shot.boosterId);
      if (booster.kind === "vortex") {
        const owner = this.alive(shot.ownerId, shot.ownerLife);
        if (!owner) continue;
        shot.x = owner.x;
        shot.y = owner.y;
        const areaUntil = shot.landsAt + booster.durationMs;
        const dt = Math.max(0, Math.min(now, areaUntil) - shot.areaLastAt) / 1000;
        shot.areaLastAt = Math.min(now, areaUntil);
        this.vortex(shot, dt, now);
        if (now < areaUntil) keep.push(shot);
        continue;
      }
      if (shot.ricochetUntil && now >= shot.ricochetUntil) continue;
      if (!booster.trap && !this.alive(shot.ownerId, shot.ownerLife)) continue;
      const ax = shot.x,
        ay = shot.y,
        stepStart = shot.lastAt;
      const until = Math.min(now, shot.landsAt),
        elapsed = Math.max(0, until - shot.lastAt) / 1000;
      const dx = shot.boundary ? 0 : shot.dx * (shot.speed || R.FLIGHT_SPEED) * elapsed,
        dy = shot.boundary ? 0 : shot.dy * (shot.speed || R.FLIGHT_SPEED) * elapsed;
      const fraction = Math.min(
        1,
        dx > 0 ? (world.width - ax) / dx : dx < 0 ? -ax / dx : 1,
        dy > 0 ? (world.height - ay) / dy : dy < 0 ? -ay / dy : 1,
        Math.hypot(dx, dy) > 0
          ? Math.max(0, (shot.maxDistance ?? Infinity) - (shot.distanceTravelled || 0)) /
              Math.hypot(dx, dy)
          : 1,
      );
      shot.x = clamp(ax + dx * fraction, 0, world.width);
      shot.y = clamp(ay + dy * fraction, 0, world.height);
      shot.lastAt = until;
      shot.distanceTravelled = (shot.distanceTravelled || 0) + Math.hypot(shot.x - ax, shot.y - ay);
      if (fraction < 1) shot.boundary = true;
      const rangeEnded = shot.distanceTravelled + 1e-7 >= (shot.maxDistance ?? Infinity);
      const hazardHit = this.arena.hazards?.projectileHit(
        shot,
        ax,
        ay,
        shot.x,
        shot.y,
        shot.landed ? R.TRAP_RADIUS : R.PROJECTILE_RADIUS,
      );
      if (hazardHit) {
        // Resolve the nearest boundary across players and hazards together.
        const playerHit = this.hit(shot, ax, ay, shot.x, shot.y, now);
        if (!playerHit || hazardHit.t < playerHit.t) {
          shot.x = ax + (shot.x - ax) * hazardHit.t;
          shot.y = ay + (shot.y - ay) * hazardHit.t;
          this.arena.hazards.impact(shot, hazardHit, now);
          this.recordContact(shot);
          continue;
        }
      }
      if (booster.trap) {
        if (booster.flightImpact && !shot.landed) {
          const hit = this.hit(shot, ax, ay, shot.x, shot.y, now);
          if (hit) {
            shot.distanceTravelled -= Math.hypot(shot.x - ax, shot.y - ay) * (1 - hit.t);
            shot.x = ax + (shot.x - ax) * hit.t;
            shot.y = ay + (shot.y - ay) * hit.t;
            if (this.impact(shot, hit.player, now, hit.part) === "reflected") keep.push(shot);
            else this.recordContact(shot, hit.player);
            continue;
          }
        }
        shot.landed = now >= shot.landsAt;
        if (shot.landed) {
          const hit = this.hit(shot, shot.x, shot.y, shot.x, shot.y, now);
          if (hit) {
            if (this.impact(shot, hit.player, now, hit.part) === "reflected") keep.push(shot);
            else this.recordContact(shot, hit.player);
            continue;
          }
        }
        keep.push(shot); // Ловушка переживает смерть/выход отправителя, до первого попадания.
      } else {
        let hit = this.hit(shot, ax, ay, shot.x, shot.y, now);
        if (booster.kind === "fire") {
          while (hit) {
            shot.hitParts.add(hit.player.lifeId + ":" + this.arena.bodyId(hit.player, hit.part));
            this.impact(shot, hit.player, now, hit.part);
            hit = this.hit(shot, ax, ay, shot.x, shot.y, now);
          }
        } else if (hit) {
          shot.distanceTravelled -= Math.hypot(shot.x - ax, shot.y - ay) * (1 - hit.t);
          shot.x = ax + (shot.x - ax) * hit.t;
          shot.y = ay + (shot.y - ay) * hit.t;
          const result = this.impact(
                  shot,
                  hit.player,
                  now,
                  hit.part,
                  hit.contacts,
                  booster.kind === "push" ? stepStart + elapsed * 1000 * fraction * hit.t : now,
                );
          if (
            result === "reflected" &&
            now < shot.landsAt &&
            shot.distanceTravelled < (shot.maxDistance ?? Infinity)
          )
            keep.push(shot);
          else this.recordContact(shot, hit.player);
          continue;
        }
        if (booster.kind === "knuckles" && shot.ricochetUntil && shot.boundary) {
          if (shot.x <= 0 || shot.x >= world.width) shot.dx *= -1;
          if (shot.y <= 0 || shot.y >= world.height) shot.dy *= -1;
          shot.boundary = false;
          shot.route = [];
          shot.motionVersion = (shot.motionVersion || 0) + 1;
        }
        if (now < shot.landsAt && !shot.boundary && !rangeEnded) keep.push(shot);
        else if (booster.pullOnMiss) this.pullToPoint(shot, shot.x, shot.y, now);
      }
    }
    this.shots = keep;
    for (const [id, pull] of this.pulls)
      if (!this.alive(id, pull.life) || (pull.anchor && !this.alive(pull.anchor, pull.anchorLife)))
        this.pulls.delete(id);
  }
  continuePullAfterAbsorption(playerId, otherId, now, kind) {
    // Крюк сохраняет оставшуюся тягу, но поглощение не добавляет ему путь.
    // Гарпун по-прежнему использует своё отдельное правило продолжения.
    if (kind === "hook" || this.arena.players.get(playerId)?.effects.web > now) return;
    // Поглощение идёт после перемещения: перенос мог завершиться в этом же тике.
    const completed = this.completedPulls.get(playerId);
    const pull = this.pulls.get(playerId) || (completed?.at === now && completed.pull);
    if (
      !pull ||
      pull.kind !== kind ||
      pull.continuedAfterAbsorption ||
      !this.alive(playerId, pull.life) ||
      (pull.anchor && !this.alive(pull.anchor, pull.anchorLife)) ||
      !Math.hypot(pull.dx, pull.dy)
    )
      return;
    // Neither pull loses its unspent travel when the first part is eaten.
    // Late absorption still gets the minimum follow-through, once per pull.
    const duration = Math.max(R.PULL_FOLLOW_THROUGH_MS, pull.duration * (1 - pull.applied));
    const scale = duration / pull.duration;
    // Продолжаем из текущей точки с той же скоростью. Неполный последний шаг
    // старого переноса не должен превращаться в рывок при редких серверных тиках.
    pull.dx *= scale;
    pull.dy *= scale;
    pull.applied = 0;
    pull.startedAt = now;
    pull.duration = duration;
    pull.continuedAfterAbsorption = true;
    this.completedPulls.delete(playerId);
    this.pulls.set(playerId, pull);
  }
  movePull(p, now) {
    if (p.effects.web > now) {
      this.pulls.delete(p.id);
      this.completedPulls.delete(p.id);
      return false;
    }
    this.hitBounds?.delete(p);
    const pull = this.pulls.get(p.id);
    if (!pull) return false;
    if (
      !this.alive(p.id, pull.life) ||
      // Shields are checked at impact. Equipping one cannot cancel an
      // already accepted hook impulse, just as with the glove's push.
      (pull.kind === "hook" && p.protectedUntil > now) ||
      (pull.anchor && !this.alive(pull.anchor, pull.anchorLife))
    ) {
      this.pulls.delete(p.id);
      return false;
    }
    const progress = Math.max(
        pull.applied,
        clamp((now - pull.startedAt) / (pull.duration || R.PULL_MS), 0, 1),
      ),
      delta = progress - pull.applied;
    const dx = pull.dx * delta,
      dy = pull.dy * delta;
    const parts = this.arena.bodies(p);
    // Each part reaches its own boundary, without stopping the rest of the group.
    // The accepted impulse keeps its original direction, speed and deadline.
    for (const part of parts) {
      const edge = this.arena.bodyBounds(part);
      part.x = clamp(part.x + dx, edge.minX, edge.maxX);
      part.y = clamp(part.y + dy, edge.minY, edge.maxY);
      if (p.parts) part.vx = part.vy = 0;
    }
    this.arena.syncParts(p);
    pull.applied = progress;
    if (progress >= 1) {
      if (pull.kind === "hook" || pull.kind === "harpoon")
        this.completedPulls.set(p.id, { pull, at: now });
      this.pulls.delete(p.id);
    }
    return true;
  }
  vortex(shot, dt, now) {
    this.hitBounds?.clear();
    const owner = this.alive(shot.ownerId, shot.ownerLife);
    if (!owner || dt <= 0) return;
    const sources = this.arena.bodies(owner);
    // The source parts do not move during this vortex pass. Resolve their
    // radii once, then reject distant objects without a square root per pair.
    const radii = sources.map(vortexRadius);
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (let i = 0; i < sources.length; i++) {
      const { x, y } = sources[i],
        r = radii[i];
      left = Math.min(left, x - r);
      right = Math.max(right, x + r);
      top = Math.min(top, y - r);
      bottom = Math.max(bottom, y + r);
    }
    const captures = (shot.vortexCaptures ||= new WeakMap());
    const nearestSource = (part) => {
      const radius = part.radius || 0;
      if (
        part.x + radius < left ||
        part.x - radius > right ||
        part.y + radius < top ||
        part.y - radius > bottom
      )
        return null;
      // Одна ближайшая зона на объект: пересечение зон не умножает силу.
      let source = null,
        nearest = Infinity;
      for (let i = 0; i < sources.length; i++) {
        const body = sources[i],
          reach = radii[i] + (part.radius || 0),
          dx = body.x - part.x,
          dy = body.y - part.y;
        if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
        const d = dx * dx + dy * dy;
        if (d <= reach * reach && d < nearest) {
          source = body;
          nearest = d;
        }
      }
      return source;
    };
    const move = (part, destination) => {
      if (!destination) return;
      const distance = Math.hypot(destination.x - part.x, destination.y - part.y);
      if (!distance) return;
      const ratio = Math.min(1, (200 * dt) / distance);
      part.x += (destination.x - part.x) * ratio;
      part.y += (destination.y - part.y) * ratio;
    };
    // All captured parts using the same source share its next larger neighbour.
    // Positions and masses of the owner's parts stay fixed for this pass only.
    const nextBySource = new Map();
    const nextLarger = (source) => {
      if (nextBySource.has(source)) return nextBySource.get(source);
      let next = null,
        nearest = Infinity;
      for (const body of sources) {
        if (body.mass <= source.mass) continue;
        const distance = Math.hypot(body.x - source.x, body.y - source.y);
        if (distance < nearest) {
          next = body;
          nearest = distance;
        }
      }
      nextBySource.set(source, next);
      return next;
    };
    const capturedDestination = (part) => {
      let state = captures.get(part);
      if (!state) {
        const source = nearestSource(part);
        if (!source) return null;
        state = { source, target: null, elapsed: 0 };
        captures.set(part, state);
      }
      // Захват живёт только вместе с текущим Вихрем. Удаление/слияние части
      // перенаправляет поток к крупнейшей оставшейся, а не к устаревшей точке.
      if (!sources.includes(state.source)) {
        state.source = sources.reduce((a, b) => (b.mass > a.mass ? b : a));
        state.target = null;
        state.elapsed = 0;
      }
      let remaining = dt;
      for (let i = 0; i < sources.length; i++) {
        if (!sources.includes(state.target) || state.target.mass <= state.source.mass) {
          state.target = nextLarger(state.source);
          state.elapsed = 0;
        }
        if (!state.target) return state.source;
        // За 0,8 с точка притяжения переходит к следующей более крупной части.
        // Одна скорость на объект: пересечения зон не усиливают Вихрь.
        const step = Math.min(remaining, 0.8 - state.elapsed);
        state.elapsed += step;
        remaining -= step;
        if (state.elapsed < 0.8) {
          const blend = state.elapsed / 0.8;
          return {
            x: state.source.x + (state.target.x - state.source.x) * blend,
            y: state.source.y + (state.target.y - state.source.y) * blend,
          };
        }
        state.source = state.target;
        state.target = null;
        state.elapsed = 0;
      }
      return state.source;
    };
    for (const p of this.arena.players.values()) {
      if (p.id === owner.id || p.dead || (p.isRemnant && now >= p.removeAt)) continue;
      if (p.effects.web > now) {
        for (const part of this.arena.bodies(p)) captures.delete(part);
        continue;
      }
      const protectedPlayer = p.protectedUntil > now || this.arena.hasEffect(p, "shield", now);
      for (const part of this.arena.bodies(p)) {
        if (protectedPlayer) captures.delete(part);
        else move(part, capturedDestination(part));
        this.arena.clampPlayer(part);
      }
      this.arena.syncParts(p);
    }
    for (const food of this.arena.ether) move(food, nearestSource(food));
  }
  snapshot() {
    return [
      ...this.shots.flatMap(
        ({
          id,
          boosterId,
          ownerId,
          ownerLife,
          x,
          y,
          dx,
          dy,
          landed,
          boundary,
          motionVersion = 0,
        }) => {
          const owner = boosterId === "vortex" ? this.alive(ownerId, ownerLife) : null;
          if (boosterId === "vortex" && !owner) return [];
          if (owner)
            return this.arena.bodies(owner).map((part) => ({
              id: id + ":" + this.arena.bodyId(owner, part),
              boosterId,
              ownerId,
              partId: this.arena.bodyId(owner, part),
              followPart: true,
              x: part.x,
              y: part.y,
              dx: 0,
              dy: 0,
              landed: true,
              moving: false,
              areaRadius: vortexRadius(part),
            }));
          return [
            {
              id,
              motionVersion,
              boosterId,
              x: owner ? owner.x : x,
              y: owner ? owner.y : y,
              dx,
              dy,
              landed,
              moving: !landed && !boundary,
            },
          ];
        },
      ),
      ...this.swords.map(({ id, boosterId, ownerId, partId, x, y, dx, dy, length, imageSize }) => ({
        id,
        boosterId,
        ownerId,
        partId,
        x,
        y,
        dx,
        dy,
        length,
        imageSize,
        held: true,
        moving: false,
      })),
    ];
  }
}
module.exports = { Combat, intersection, vortexRadius };
