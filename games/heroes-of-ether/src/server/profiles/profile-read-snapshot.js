"use strict";
const fs = require("node:fs"), path = require("node:path");
const prefix = file => path.basename(file) + ".read-";
function remove(directory) {
  // Only our own flat set of links; never recursively remove unknown files.
  const names = fs.readdirSync(directory);
  if (names.some(name => !/^snapshot\.json(?:\.wal-\d+)?$/.test(name) ||
      !fs.lstatSync(path.join(directory, name)).isFile()))
    throw Error("Unexpected profile read snapshot contents");
  for (const name of names) fs.unlinkSync(path.join(directory, name));
  fs.rmdirSync(directory);
}
function cleanup(file) {
  const parent = path.dirname(file);
  if (!fs.existsSync(parent)) return;
  for (const name of fs.readdirSync(parent)) {
    if (!name.startsWith(prefix(file)) || !/^[a-zA-Z0-9]{6}$/.test(name.slice(prefix(file).length))) continue;
    const directory = path.join(parent, name);
    if (fs.lstatSync(directory).isDirectory()) remove(directory);
  }
}
function pin(file, files, revision) {
  const directory = fs.mkdtempSync(path.join(path.dirname(file), prefix(file)));
  const target = path.join(directory, "snapshot.json");
  try {
    if (fs.existsSync(file)) fs.linkSync(file, target);
    for (const source of files) fs.linkSync(source, target + ".wal-" + source.slice(source.lastIndexOf("-") + 1));
  } catch (error) {
    remove(directory);
    throw error;
  }
  let released = false;
  return { file: target, revision, release() { if (!released) { remove(directory); released = true; } } };
}
module.exports = { pin, cleanup };
