/* Benchmark-only preload: compare a saved source revision without changing live files. */
"use strict";
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const directory = process.env.BENCH_SOURCE_OVERRIDE_DIR;
if (!directory) throw Error('BENCH_SOURCE_OVERRIDE_DIR is required for this benchmark preload');
const root = path.resolve(__dirname, '../../src/server/arena');
const sources = new Map(['arena-hazards.js', 'socket-frames.js', 'state-workers.js', 'state-worker.js'].map(name =>
  [path.join(root, name), fs.readFileSync(path.resolve(directory, name), 'utf8')]));
const standard = Module._extensions['.js'];
Module._extensions['.js'] = function(mod, file) {
  const source = sources.get(file);
  return source === undefined ? standard(mod, file) : mod._compile(source, file);
};
