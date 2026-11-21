"use strict";
// Only data consumed by the resident simulation. Persistent wallets, quest
// ledgers, transaction receipts and account history stay with the profile owner.
function roomProfile(p) {
  return { id:p.id, revision:p.revision, name:p.name, skinId:p.skinId, level:p.level,
    quickSlots:p.quickSlots, appearance:p.appearance,
    account:{vipUntil:p.account?.vipUntil||0,premiumUntil:p.account?.premiumUntil||0},
    social:{giftEffects:p.social?.giftEffects,marriage:p.social?.marriage} };
}
module.exports={roomProfile};
