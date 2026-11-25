"use strict";
const accounts = require("../accounts/account-benefits");
const appearance = require("./league-appearance");
const identity = require("../../../public/shared/player-identity");

// Published profile branches are immutable. Wallet/progress commits replace the
// profile, but do not change these appearance inputs. Keep no strong reference
// to an obsolete profile and invalidate conservatively for in-place revisions.
// Personal frames are earned grants. Clan membership/economy/crests are not
// inputs to leagueAppearance.selected; clan identity is published separately.
class ArenaAppearanceCache {
  constructor() { this.entries = new WeakMap(); }
  get(store, profile, at) {
    const key = profile.appearance || profile;
    const cached = this.entries.get(key);
    if (cached && cached.id === profile.id && cached.accountInput === profile.account &&
        cached.skinInput === profile.skinId && cached.collections === profile.purchasedSkinCollections &&
        cached.grantedSkins === profile.grantedSkins && cached.claimed === profile.honors?.claimed &&
        cached.medals === profile.honors?.medals &&
        cached.testBackgrounds === store.unlockLeagueBackgrounds && cached.testFrames === store.unlockLeagueFrames &&
        at >= cached.from && at < cached.until &&
        (cached.source.deref() !== profile || cached.revision === profile.revision)) {
      if (cached.source.deref() !== profile) cached.source = new WeakRef(profile);
      cached.revision = profile.revision;
      return cached.value;
    }
    const account = accounts.publicAccount(profile, at);
    const skinId = identity.skinAllowed(profile.skinId, account, appearance.skinSets(profile),
      profile.purchasedSkinCollections, profile.grantedSkins) ? profile.skinId : "moon-dragon";
    const selected = appearance.selected(profile, store.data.clans, at,
      store.unlockLeagueBackgrounds, store.unlockLeagueFrames);
    let until = account.currencyBonusResetAt;
    for (const end of [account.vipUntil, account.premiumUntil, ...Object.values(profile.appearance?.grants || {})])
      if (Number.isFinite(end) && end > at) until = Math.min(until, end);
    const value = { account, skinId, appearance: selected };
    this.entries.set(key, { value, from: at, until, id: profile.id, source: new WeakRef(profile),
      revision: profile.revision, accountInput: profile.account, skinInput: profile.skinId,
      collections: profile.purchasedSkinCollections, grantedSkins: profile.grantedSkins,
      claimed: profile.honors?.claimed, medals: profile.honors?.medals,
      testBackgrounds: store.unlockLeagueBackgrounds, testFrames: store.unlockLeagueFrames });
    return value;
  }
}
module.exports = { ArenaAppearanceCache };
