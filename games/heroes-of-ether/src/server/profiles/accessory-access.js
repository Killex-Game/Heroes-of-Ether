"use strict";
const catalog = require("../../../public/shared/accessory-catalog");
const preview = require("../../../config/accessory-preview.json");
if (
  typeof preview.enabled !== "boolean" ||
  !Array.isArray(preview.profileIds) ||
  !Array.isArray(preview.accessoryIds) ||
  preview.profileIds.some((id) => typeof id !== "string" || !id) ||
  preview.accessoryIds.some((id) => !catalog.item(id)?.previewOnly)
)
  throw Error("Некорректная настройка тестового гардероба.");
// Серверная витрина для конкретных ID. Имя, клиентские флаги и кошелёк не дают доступ.
function isOwned(profile, id) {
  return (
    catalog.isOwned(profile, id) ||
    !!(
      preview.enabled &&
      catalog.item(id)?.previewOnly &&
      preview.profileIds.includes(profile?.id) &&
      preview.accessoryIds.includes(id)
    )
  );
}
function outfit(profile) {
  return Object.fromEntries(
    Object.entries(catalog.outfit(profile.outfit)).map(([slot, id]) => [
      slot,
      id && isOwned(profile, id) ? id : null,
    ]),
  );
}
// Порядок E фиксирован: все заряды бабочки, затем шапки.
function abilities(profile) {
  const worn = outfit(profile);
  return [worn.bow, worn.hat].filter((id) => catalog.abilityList(catalog.item(id)).length);
}
function ability(profile) {
  return abilities(profile)[0] || null;
}
module.exports = { isOwned, outfit, ability, abilities };
