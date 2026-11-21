"use strict";
// Experimental reservations share the existing per-profile durable receipt
// ledger. Only unresolved IDs need a bounded live index; resolved evidence is
// retained in the permanent, bucketed operation ledger across room epochs.
const receipts = require("../../profiles/operation-receipts");
const easter = require("../../events/easter-hunt");
const { BOOSTERS } = require("../../boosters/booster-catalog");
const accounts = require("../../accounts/account-benefits");
const loadout = require("../../../../public/shared/quick-slot-rules");
const moderation = require("../../admin/moderation");
const keyOK = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const requestOK = value => typeof value === "string" && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
const encode = tx => JSON.stringify(["resident-cast-v1", tx]);
function read(profile, txId) {
  const value = receipts.read(profile, txId);
  if (value === receipts.MISSING) return null;
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw Error("Operation ID already used"); }
  const tx = parsed?.[1];
  if (parsed?.[0] !== "resident-cast-v1" || !tx || tx.txId !== txId || tx.profileId !== profile.id ||
      !["RESERVED", "APPLIED", "REFUNDED"].includes(tx.status)) throw Error("Operation ID already used");
  return tx;
}
function identity(input, profile, at) {
  const profileId=profile.id;
  if (!requestOK(input?.txId) || !input.txId.startsWith(profileId+'_') ||
      ![input.roomId,input.epoch,input.lifeId,input.boosterId,profileId].every(keyOK) ||
      typeof input.intent !== "string" || !input.intent || input.intent.length > 4096)
    throw Error("Invalid resident cast identity");
  return { txId:input.txId, roomId:input.roomId, epoch:input.epoch, lifeId:input.lifeId,
    boosterId:input.boosterId, profileId, intent:input.intent, createdAt:at, status:"RESERVED" };
}
function expiration(profile,tx,at) {
  if(tx.boosterId==='easter_egg')tx.expiresAt=Math.min(...(profile.easter?.batches || [])
    .filter(b=>b.count>0 && b.expiresAt>at).map(b=>b.expiresAt));
  if(tx.boosterId==='easter_egg' && !Number.isSafeInteger(tx.expiresAt))throw Error('No unexpired booster lot');
}
function same(a,b) {
  return ["txId","roomId","epoch","lifeId","boosterId","profileId","intent"].every(k=>a[k]===b[k]);
}
function reserve(profile, tx, at) {
  moderation.requirePlayable(profile, at);
  if (profile.progress.session?.id !== tx.lifeId) throw Error("Resident cast life differs");
  const benefits=accounts.benefits(profile,at);
  if (!profile.quickSlots?.some((id,index)=>id===tx.boosterId && loadout.unlocked(index,benefits,profile.level)))
    throw Error("Resident booster is not equipped");
  if (!BOOSTERS.get(tx.boosterId)?.ready || !(profile.inventory[tx.boosterId]>0))
    throw Error("Resident booster inventory is empty");
  if (Object.keys(profile.residentCasts || {}).length >= 8) throw Error("Resident cast reservations are full");
  if (tx.boosterId === "easter_egg") {
    easter.consume(profile,at);
  }
  profile.inventory[tx.boosterId]--;
  // No successfulBooster, peak mass, quest or achievement credit at reservation.
  // Keep the equipped slot until outcome; this is a hold, not a successful use.
  profile.residentCasts={...profile.residentCasts,[tx.txId]:true};
}
function resolve(profile, tx, status, at) {
  if (!['APPLIED','REFUNDED'].includes(status) || tx.status!=="RESERVED" || !profile.residentCasts?.[tx.txId])
    throw Error("Resident cast outcome conflicts");
  if (status==="REFUNDED") {
    // Return exactly the reserved lot, retaining its original expiration.
    // An already expired lot is recorded as returned-and-expired, never renewed.
    if (tx.boosterId!=="easter_egg" || tx.expiresAt>at) {
      const count=(profile.inventory[tx.boosterId] || 0)+1;
      if(!Number.isSafeInteger(count) || count<1)throw Error('Resident refund inventory overflow');
      profile.inventory[tx.boosterId]=count;
      if (tx.boosterId==="easter_egg") {
        const lot=profile.easter.batches.find(b=>b.expiresAt===tx.expiresAt);
        if(lot)lot.count++;else profile.easter.batches.push({count:1,expiresAt:tx.expiresAt});
      }
    }
  }
  if (!profile.inventory[tx.boosterId] && profile.quickSlots)
    profile.quickSlots=profile.quickSlots.map(id=>id===tx.boosterId?null:id);
  profile.residentCasts={...profile.residentCasts};delete profile.residentCasts[tx.txId];
  const outcome={...tx,status,resolvedAt:at};
  receipts.recordArena(profile,tx.txId,encode(outcome));
  return outcome;
}
module.exports={read,identity,same,expiration,reserve,resolve,encode,keyOK};
