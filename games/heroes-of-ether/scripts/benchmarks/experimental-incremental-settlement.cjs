"use strict";
// Test-only preload: exercise existing behavioral tests with the optional
// incremental settlement enabled. Production defaults remain unchanged.
const profiles = require("../../src/server/profiles/profile-store");
const Original = profiles.ProfileStore;
profiles.ProfileStore = class extends Original {
  constructor(options = {}) { super({incrementalSettlement:true, ...options}); }
};
