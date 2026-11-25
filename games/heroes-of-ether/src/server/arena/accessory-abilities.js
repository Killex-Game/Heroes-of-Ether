"use strict";
const accessories = require("../../../public/shared/accessory-catalog");
const catalogAbilities = accessories.abilityList;
const access = require("../profiles/accessory-access");
const { BoosterError } = require("../boosters/booster-catalog");

function start(player, profile) {
  if (player.accessoryAbilities) return;
  player.accessoryAbilities = {
    stock: access.abilities(profile).flatMap((id) => {
      const item = accessories.item(id);
      return item && access.isOwned(profile, id)
        ? catalogAbilities(item).map(ability => ({ accessoryId: id, boosterId: ability.boosterId, count: ability.count }))
        : [];
    }),
    receipts: new Map(),
  };
}
function snapshot(player) {
  return player.accessoryAbilities?.stock.map((item) => ({ ...item })) || [];
}
function use(arena, player, message, now) {
  if (player.dead || player.isRemnant || message.spawnSerial !== player.spawnSerial)
    throw new BoosterError("Бустер аксессуара недоступен за этот вход на арену.", 409);
  const state = player.accessoryAbilities;
  if (
    !state ||
    typeof message.requestId !== "string" ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(message.requestId)
  )
    throw new BoosterError("Некорректный запрос бустера аксессуара.");
  const prior = state.receipts.get(message.requestId);
  if (prior) {
    if (prior.accessoryId !== message.accessoryId)
      throw new BoosterError("Этот запрос уже использован для другого действия.", 409);
    return { ...prior, replay: true };
  }
  const stock = state.stock.find((item) => item.accessoryId === message.accessoryId && item.count > 0);
  if (!stock?.count)
    throw new BoosterError("Бустер аксессуара за этот вход на арену уже использован или недоступен.", 409);
  if (state.stock.find((item) => item.count > 0) !== stock)
    throw new BoosterError("Сначала используй бустеры бабочки, затем шапки.", 409);
  // Этот запас принадлежит жизни. Он не попадает в инвентарь и не расходует обычный слот.
  const apply = arena.prepareBooster(
    player.id,
    {
      boosterId: stock.boosterId,
      spawnSerial: player.spawnSerial,
      aimX: message.aimX,
      aimY: message.aimY,
    },
    now,
    { accessory: true },
  );
  const event = apply();
  stock.count--;
  const result = { accessoryId: stock.accessoryId, boosterId: stock.boosterId, remaining: stock.count };
  state.receipts.set(message.requestId, result);
  return { ...result, event };
}
module.exports = { start, snapshot, use };
