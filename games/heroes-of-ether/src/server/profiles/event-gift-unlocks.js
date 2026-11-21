"use strict";
// Permanent event evidence is already saved with the profile. Receiving a gift
// grants no sending rights. These checks run only on catalog reads and gifts.
function unlocked(profile, gift) {
  if (!gift.eventId) return true;
  if (gift.eventId === "black-friday")
    return Object.values(profile.blackFriday?.runs || {}).some(run => Number.isSafeInteger(run.finalAt));
  if (gift.eventId === "easter-hunt")
    return require("../events/easter-hunt").albumPictures(profile).some(art => art.progress >= art.target);
  return false;
}
function catalog(profile) {
  return require("./gift-catalog").gifts.map(gift => gift.eventId ? { ...gift, unlocked: unlocked(profile, gift) } : gift);
}
module.exports = { unlocked, catalog };
