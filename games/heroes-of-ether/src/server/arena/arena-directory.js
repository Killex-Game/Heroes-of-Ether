/* Распределение мест между изолированными игровыми комнатами.
 * Один экземпляр принадлежит одному координатору. Межпроцессных блокировок здесь нет.
 * Комнаты starting необходимо создать в worker и подтвердить через markReady().
 * Модуль не запускает серверы, не арендует машины и не читает рабочие профили.
 */
"use strict";
const { randomUUID, randomBytes } = require("node:crypto");
const defaults = require("../../../config/arena-rooms.json");
const { arenaName, groups, names } = require("./arena-names");
const FULL_MESSAGE = "Сейчас все арены заняты, попробуйте позже";

function desiredArenaCount(occupied, policy = defaults) {
  if (!Number.isInteger(occupied) || occupied < 0) throw new RangeError("Invalid occupancy");
  let count = policy.minimumArenas;
  while (
    count < policy.maximumArenas &&
    occupied >= count * policy.arenaCapacity - policy.spareSeatsBeforeExpansion
  ) {
    count = Math.min(policy.maximumArenas, count + policy.expansionBatch);
  }
  return count;
}

class ArenaDirectory {
  constructor({ policy = defaults, now = Date.now, levelGroups = false } = {}) {
    this.levelGroups = levelGroups;
    this.policy = Object.freeze({ ...defaults, ...policy });
    for (const [key, value] of Object.entries(this.policy)) {
      if (
        key !== "enabled" &&
        (!Number.isSafeInteger(value) || value < (key === "spareSeatsBeforeExpansion" ? 0 : 1))
      )
        throw new RangeError(`Invalid policy: ${key}`);
    }
    const p = this.policy;
    if (
      p.minimumArenas > p.maximumArenas ||
      p.spareSeatsBeforeExpansion >= p.minimumArenas * p.arenaCapacity ||
      p.maximumArenaPlayers > p.maximumArenas * p.arenaCapacity ||
      typeof now !== "function"
    )
      throw new RangeError("Inconsistent arena policy");
    this.now = now;
    this.rooms = new Map();
    this.players = new Map();
    this.remnants = new Map(); // ID оставшейся модели -> комната, отдельно от профиля.
    this.expand();
  }

  occupancy() {
    return (
      [...this.players.values()].filter((p) => p.state !== "lobby").length + this.remnants.size
    );
  }

  expand() {
    if (this.levelGroups) {
      // One permanent home per level band; additional rooms follow actual demand.
      // A single global room/player budget applies across all three bands.
      for (const group of groups) {
        const members = [...this.rooms.values()].filter(r => r.group === group.id);
        const occupied = members.reduce((n, r) => n + this.roomOccupancy(r.id), 0);
        const wanted = desiredArenaCount(occupied, { ...this.policy, minimumArenas: 1 });
        while (members.length < wanted && this.rooms.size < this.policy.maximumArenas) {
          const id = "arena-" + (this.rooms.size + 1);
          const room = { id, group: group.id, name: names[members.length], status: "starting", workerLease: null, heartbeatAt: null };
          this.rooms.set(id, room);
          members.push(room);
        }
      }
      return;
    }
    const wanted = desiredArenaCount(this.occupancy(), this.policy);
    // Пока не уменьшаем число комнат: исключаем скачки списка и выселение игроков.
    while (this.rooms.size < wanted) {
      const id = `arena-${this.rooms.size + 1}`;
      this.rooms.set(id, { id, status: "starting", workerLease: null, heartbeatAt: null });
    }
  }

  roomOccupancy(id) {
    return (
      [...this.players.values()].filter((p) => p.arenaId === id).length +
      [...this.remnants.values()].filter((roomId) => roomId === id).length
    );
  }

  markReady(id) {
    // Вызывать только после успешного создания симуляции, из доверенного worker RPC.
    const room = this.rooms.get(id);
    if (!room || room.status === "ready") throw new Error("Room not awaiting a worker");
    const workerLease = randomUUID();
    Object.assign(room, { status: "ready", workerLease, heartbeatAt: this.now() });
    return workerLease;
  }

  heartbeat(id, workerLease) {
    this.sweep();
    const room = this.rooms.get(id);
    if (!room || room.status !== "ready" || room.workerLease !== workerLease) return false;
    room.heartbeatAt = this.now();
    return true;
  }

  markOffline(id, workerLease) {
    const room = this.rooms.get(id);
    if (!room || !workerLease || room.workerLease !== workerLease) return false;
    Object.assign(room, { status: "offline", workerLease: null, heartbeatAt: null });
    for (const [modelId, roomId] of this.remnants) if (roomId === id) this.remnants.delete(modelId);
    for (const player of this.players.values()) {
      if (player.arenaId === id) this.toLobby(player);
    }
    return true;
  }

  toLobby(player) {
    Object.assign(player, {
      state: "lobby",
      arenaId: null,
      ticket: null,
      expiresAt: null,
      seenAt: this.now(),
    });
  }

  sweep() {
    const now = this.now();
    for (const room of this.rooms.values()) {
      if (room.status === "ready" && now - room.heartbeatAt >= this.policy.workerHeartbeatTtlMs)
        this.markOffline(room.id, room.workerLease);
    }
    for (const [id, player] of this.players) {
      if (player.state === "reserved" && now >= player.expiresAt) this.toLobby(player);
      if (player.state === "lobby" && now - player.seenAt >= this.policy.lobbyPresenceTtlMs)
        this.players.delete(id);
    }
  }

  enterLobby(playerId) {
    this.sweep();
    if (typeof playerId !== "string" || !playerId || playerId.length > 128)
      throw new TypeError("Authenticated internal player ID required");
    const existing = this.players.get(playerId);
    if (existing) {
      existing.seenAt = this.now();
      return { ok: true, state: existing.state };
    }
    // 400 мест для игры + 30 гарантированных мест для лобби.
    // При неполных аренах в лобби может находиться больше 30 человек.
    if (this.players.size >= this.policy.maximumArenaPlayers + this.policy.lobbyReserve)
      return { ok: false, code: "ONLINE_LIMIT", message: "Сервер заполнен, попробуйте позже" };
    const player = {};
    this.toLobby(player);
    this.players.set(playerId, player);
    return { ok: true, state: "lobby" };
  }

  reserve(playerId, preferredArenaId = null, group = null) {
    this.sweep();
    const player = this.players.get(playerId);
    if (!player) return { ok: false, code: "SESSION_REQUIRED" };
    player.seenAt = this.now();
    if (player.state !== "lobby") return { ok: false, code: "ALREADY_JOINING_OR_PLAYING" };
    if (this.levelGroups && (!groups.some(g => g.id === group) ||
        (preferredArenaId && this.rooms.get(preferredArenaId)?.group !== group)))
      return { ok: false, code: "ARENA_LEVEL", message: "Выбери комнату своего уровня." };
    if (this.occupancy() >= this.policy.maximumArenaPlayers) return this.full();
    const available = [...this.rooms.values()].filter(
      (r) => r.status === "ready" && (!this.levelGroups || r.group === group) && this.roomOccupancy(r.id) < this.policy.arenaCapacity,
    );
    // Автовход сначала наполняет уже используемые арены.
    available.sort(
      (a, b) =>
        this.roomOccupancy(b.id) - this.roomOccupancy(a.id) ||
        Number(a.id.slice(6)) - Number(b.id.slice(6)),
    );
    const room = available.find((r) => r.id === preferredArenaId) || available[0];
    if (!room) return this.full();
    Object.assign(player, {
      state: "reserved",
      arenaId: room.id,
      ticket: randomBytes(32).toString("base64url"),
      expiresAt: this.now() + this.policy.reservationTtlMs,
    });
    // Учитываем и короткие брони: одновременные входы не переполняют комнату.
    this.expand();
    return {
      ok: true,
      arenaId: room.id,
      ticket: player.ticket,
      expiresAt: player.expiresAt,
      workerLease: room.workerLease,
      redirected: !!preferredArenaId && preferredArenaId !== room.id,
    };
  }

  confirm(playerId, ticket, workerLease, group = null) {
    this.sweep();
    const player = this.players.get(playerId);
    const room = this.rooms.get(player?.arenaId);
    if (
      !player ||
      player.state !== "reserved" ||
      player.ticket !== ticket ||
      room?.status !== "ready" ||
      room.workerLease !== workerLease ||
      (this.levelGroups && room.group !== group)
    )
      return { ok: false, code: "INVALID_RESERVATION" };
    player.state = "playing";
    player.ticket = null; // Однократное использование, в том числе при повторном запросе.
    player.expiresAt = null;
    return { ok: true, arenaId: player.arenaId };
  }

  leaveArena(playerId) {
    const player = this.players.get(playerId);
    if (!player) return false;
    // В production сначала остановить старую игровую сессию в worker.
    this.toLobby(player);
    return true;
  }

  disconnect(playerId) {
    // Вызывается координатором после завершения сессии, не из неподтверждённого HTTP.
    return this.players.delete(playerId);
  }

  full() {
    return { ok: false, code: "ARENAS_FULL", message: FULL_MESSAGE };
  }

  list(group = null) {
    this.sweep();
    return [...this.rooms.values()].filter(r => !group || r.group === group).map((room) => {
      const members = [...this.players.values()].filter((p) => p.arenaId === room.id);
      const active = members.filter((p) => p.state === "playing").length;
      const lingering = [...this.remnants.values()].filter((id) => id === room.id).length;
      return {
        id: room.id,
        name: room.name || arenaName(room.id),
        ...(this.levelGroups ? { group: room.group } : {}),
        status: room.status,
        playing: active + lingering,
        reserved: members.length - active,
        capacity: this.policy.arenaCapacity,
        joinable:
          room.status === "ready" &&
          members.length + lingering < this.policy.arenaCapacity &&
          this.occupancy() < this.policy.maximumArenaPlayers,
      };
    });
  }
}
module.exports = { ArenaDirectory, desiredArenaCount, FULL_MESSAGE };
