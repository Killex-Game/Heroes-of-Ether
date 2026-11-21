"use strict";
const { ArenaDirectory } = require("./arena-directory");
const { arenaName, groupForLevel } = require("./arena-names");
const { BoosterError } = require("../boosters/booster-catalog");
const fail = (message, code, status = 409) =>
  Object.assign(new BoosterError(message, status), { code });

class ArenaRooms {
  constructor({ policy, now = Date.now, gameNow, connections, createRoom, holdRemnants = true, levelGroups = false, profileFor = () => null }) {
    this.now = now;
    this.gameNow = gameNow;
    this.connections = connections;
    this.createRoom = createRoom;
    this.holdRemnants = holdRemnants;
    this.profileFor = profileFor;
    this.directory = new ArenaDirectory({ policy, now, levelGroups });
    this.rooms = new Map();
    this.requests = new Map();
    this.ensureRooms();
  }
  ensureRooms() {
    for (const entry of this.directory.rooms.values()) {
      if (this.rooms.has(entry.id)) continue;
      this.rooms.set(entry.id, this.createRoom(entry.id, entry.group));
      this.directory.markReady(entry.id);
    }
  }
  refresh() {
    const at = this.now();
    // Все симуляции принадлежат этому процессу. Их готовность подтверждается
    // после создания; отсутствие сетевого worker здесь не имитируется таймером.
    for (const entry of this.directory.rooms.values())
      if (entry.status === "ready") entry.heartbeatAt = at;
    this.directory.remnants.clear();
    if (this.holdRemnants)
      for (const room of this.rooms.values())
        for (const p of room.arena.players.values())
          if (p.isRemnant && !p.dead && p.removeAt > this.gameNow())
            this.directory.remnants.set(p.id, room.id);
    for (const [id, player] of this.directory.players) {
      if (player.state !== "playing" || this.connections.has(id)) continue;
      this.directory.toLobby(player);
    }
    this.directory.sweep();
    this.directory.expand();
    this.ensureRooms();
    for (const [key, record] of this.requests)
      if (at - record.createdAt > 90000) this.requests.delete(key);
  }
  hasLobbySpace(id) {
    this.refresh();
    return (
      this.directory.players.has(id) ||
      this.directory.players.size <
        this.directory.policy.maximumArenaPlayers + this.directory.policy.lobbyReserve
    );
  }
  enterLobby(id) {
    this.refresh();
    const result = this.directory.enterLobby(id);
    if (!result.ok) throw fail(result.message, result.code, 503);
  }
  group(id) { return groupForLevel(this.profileFor(id)?.level).id; }
  list(id) {
    this.refresh();
    return this.directory.list(id && this.directory.levelGroups ? this.group(id) : null);
  }
  reserve(id, input) {
    if (
      !input ||
      typeof input.requestId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(input.requestId || "") ||
      (input.preferredArenaId != null &&
        (typeof input.preferredArenaId !== "string" ||
          !/^arena-[1-9][0-9]*$/.test(input.preferredArenaId) ||
          Number(input.preferredArenaId.slice(6)) > this.directory.policy.maximumArenas))
    )
      throw fail("Некорректный выбор арены.", "INVALID_ARENA", 400);
    this.enterLobby(id);
    const key = `${id}:${input.requestId}`;
    const previous = this.requests.get(key);
    const player = this.directory.players.get(id);
    if (this.directory.levelGroups && player.state === "reserved" &&
        this.directory.rooms.get(player.arenaId)?.group !== this.group(id)) {
      this.directory.toLobby(player);
      throw fail("Уровень изменился. Выбери комнату снова.", "ARENA_LEVEL");
    }
    if (previous) {
      if (previous.preferredArenaId !== (input.preferredArenaId || null))
        throw fail("Номер подключения уже использован.", "REQUEST_CONFLICT");
      if (player.state === "reserved" && player.ticket === previous.result.ticket)
        return previous.result;
      throw fail("Это подключение уже завершено. Нажми «Играть» ещё раз.", "RESERVATION_EXPIRED");
    }
    if (this.connections.has(id) || player.state === "playing")
      throw fail("Ты уже играешь в другой вкладке. Сначала выйди в лобби.", "ARENA_ACTIVE");
    if (player.state === "reserved")
      throw fail("Подключение уже выполняется в другой вкладке.", "ARENA_ACTIVE");
    const reservation = this.directory.reserve(id, input.preferredArenaId, this.group(id));
    if (!reservation.ok)
      throw fail(reservation.message || "Не удалось выбрать арену.", reservation.code, reservation.code === "ARENA_LEVEL" ? 409 : 503);
    this.ensureRooms();
    player.requestId = input.requestId;
    const result = {
      arenaId: reservation.arenaId,
      name: this.directory.rooms.get(reservation.arenaId)?.name || arenaName(reservation.arenaId),
      ticket: reservation.ticket,
      expiresAt: reservation.expiresAt,
      wsPath: `/ws/${reservation.arenaId}`,
      redirected: reservation.redirected,
    };
    this.requests.set(key, {
      preferredArenaId: input.preferredArenaId || null,
      createdAt: this.now(),
      result,
    });
    return result;
  }
  cancel(id, requestId) {
    this.refresh();
    const player = this.directory.players.get(id);
    if (player?.state === "reserved" && player.requestId === requestId)
      this.directory.toLobby(player);
    return { ok: true };
  }
  claim(id, arenaId, ticket) {
    this.refresh();
    const player = this.directory.players.get(id);
    if (!player || player.arenaId !== arenaId || typeof ticket !== "string") return false;
    const room = this.directory.rooms.get(arenaId);
    if (this.directory.levelGroups && room?.group !== this.group(id)) {
      this.directory.toLobby(player);
      return false;
    }
    return this.directory.confirm(id, ticket, room?.workerLease, this.group(id)).ok;
  }
  release(id) {
    this.directory.leaveArena(id);
  }
}
module.exports = { ArenaRooms };
