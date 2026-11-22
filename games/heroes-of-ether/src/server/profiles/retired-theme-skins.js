"use strict";
const { currentSkinId } = require("../../../public/shared/player-identity");
function migrate(profile) {
  let changed = false;
  if (profile.grantedSkins !== undefined && (!Array.isArray(profile.grantedSkins) ||
      new Set(profile.grantedSkins).size !== profile.grantedSkins.length ||
      profile.grantedSkins.some(id => !require("../../../public/shared/player-identity").validSkin(currentSkinId(id)))))
    throw Error("Повреждены награды промокодов. Сохранение не перезаписано.");
  const id = currentSkinId(profile.skinId);
  if (id !== profile.skinId) { profile.skinId = id; changed = true; }
  if (Array.isArray(profile.grantedSkins) && profile.grantedSkins.some(id => currentSkinId(id) !== id)) {
    profile.grantedSkins = [...new Set(profile.grantedSkins.map(currentSkinId))];
    changed = true;
  }
  return changed;
}
module.exports = { migrate };
