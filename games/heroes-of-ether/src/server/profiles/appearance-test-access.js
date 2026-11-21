"use strict";
const config = require("../../../config/appearance-testing.json");
// Explicit owner-approved preview. Never grants medals or account benefits.
const all = (profile) =>
  config.allAppearanceProfileIds?.includes(typeof profile === "string" ? profile : profile?.id) ===
  true;
const clan = (value) => all(value?.ownerId);
module.exports = { all, clan };
