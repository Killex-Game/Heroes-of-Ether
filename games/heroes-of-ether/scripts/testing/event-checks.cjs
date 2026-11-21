"use strict";
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "../..");
const common = [
  "tests/unit/event-manager.test.js", "tests/unit/event-timing.test.js",
  "tests/unit/event-lifecycle-cache.test.js", "tests/unit/event-release-coverage.test.js",
  "tests/unit/event-window-timers.test.js",
  "tests/unit/event-roulette-companions.test.js", "tests/unit/state-event-visibility.test.js",
  "tests/unit/lite-event-lifecycle.test.js", "tests/unit/lite-account.test.js",
  "tests/unit/roulette.test.js", "tests/integration/event-admin.test.js",
  "tests/integration/event-seekers.test.js", "tests/integration/lucky-leaderboard.test.js",
  "tests/integration/lucky-week-arena.test.js", "tests/unit/lucky-week.test.js",
];
// Every installed pack must explicitly opt into its own regression suite.
// Prefixes include newly added tests automatically, but a new pack cannot pass
// the release check by silently running only the generic lifecycle tests.
const packs = {
  "core-v1": { prefixes: ["lite-", "roulette."], browser: ["event-manager", "lite-event-cycle"] },
  "lucky-week-v1": { prefixes: ["lucky-"], browser: ["lucky-week", "lite-event-cycle"] },
  "easter-hunt-v1": { prefixes: ["easter-"], browser: ["easter-hunt", "easter-collections-layout"] },
  "black-friday-v1": { prefixes: ["black-friday", "friday-roulette"], browser: ["event-seekers", "events-page"] },
  "ether-alchemy-v1": { prefixes: ["ether-alchemy", "arena-alchemy"], browser: ["ether-alchemy"] },
};
function selectChecks(packId = "all", installed = require("../../src/server/events/event-packs").packs) {
  const missing = Object.keys(installed).filter(id => !Object.hasOwn(packs, id));
  if (missing.length) throw Error("No event-specific verification registered: " + missing.join(", "));
  const ids = packId === "all" ? Object.keys(installed) : [packId];
  for (const id of ids) if (!Object.hasOwn(installed, id)) throw Error("Unknown event pack: " + id);
  const files = new Set(common), browser = new Set(["tests/browser/event-manager.test.js"]);
  const candidates = ["tests/unit", "tests/integration"].flatMap(dir =>
    fs.readdirSync(path.join(root, dir)).filter(name => name.endsWith(".test.js"))
      .map(name => ({ name, file: dir + "/" + name })));
  for (const id of ids) {
    const checks = packs[id], matches = candidates.filter(c => checks.prefixes.some(p => c.name.startsWith(p)));
    if (!matches.some(c => c.file.startsWith("tests/unit/")) ||
        !matches.some(c => c.file.startsWith("tests/integration/")) && id !== "core-v1")
      throw Error("Missing unit/integration coverage for " + id);
    for (const c of matches) files.add(c.file);
    for (const name of checks.browser) browser.add(`tests/browser/${name}.test.js`);
  }
  for (const file of [...files, ...browser]) if (!fs.statSync(path.join(root, file)).isFile())
    throw Error("Missing verification file: " + file);
  return { packs: ids, files: [...files].sort(), browser: [...browser].sort() };
}
module.exports = { selectChecks, root };
