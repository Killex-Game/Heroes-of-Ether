/* Local benchmark only. Load saved sources without changing the running game. */
"use strict";
const Module = require("node:module"), fs = require("node:fs"), path = require("node:path");
if (!process.env.LOAD_BASELINE_PROGRESS) throw Error("LOAD_BASELINE_PROGRESS is required");
const directory = path.resolve(process.env.LOAD_BASELINE_PROGRESS);
const files = new Map([
  "profiles/profile-store.js", "progression/activity-achievements.js",
  "progression/experience-progression.js", "progression/title-chest-rewards.js",
  "arena/tick-clock.js", "arena/arena-simulation.js", "arena/spatial-collision-index.js",
  "progression/treasury-capacity.js", "progression/personal-quests.js",
  "arena/state-stream.js", "arena/state-workers.js", "game-server.js",
].map(name => [path.resolve(__dirname, "../../src/server", name), path.join(directory, path.basename(name))]));
const readJs = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  const baseline = files.get(filename);
  if (baseline) module._compile(fs.readFileSync(baseline, "utf8"), filename);
  else readJs(module, filename);
};
