/* Test-only preload: compare saved replication sources without editing the
 * running game's files. Worker threads inherit this preload; clients do not. */
"use strict";
const Module = require("node:module"), fs = require("node:fs"), path = require("node:path");
if (!process.env.LOAD_BASELINE_STATE) throw Error("LOAD_BASELINE_STATE is required");
const directory = path.resolve(process.env.LOAD_BASELINE_STATE);
const files = new Map(["state-stream.js", "state-worker.js"].map(name => [
  path.resolve(__dirname, "../../src/server/arena", name), path.join(directory, name),
]));
const readJs = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  const baseline = files.get(filename);
  if (baseline) module._compile(fs.readFileSync(baseline, "utf8"), filename);
  else readJs(module, filename);
};
