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
async function removeAsync(directory) {
  // Retired pins are private flat directories. Validate all names/types before
  // deleting any link, then keep metadata I/O off the authoritative game loop.
  const names = await fs.promises.readdir(directory);
  for (const name of names)
    if (!/^snapshot\.json(?:\.wal-\d+)?$/.test(name) ||
        !(await fs.promises.lstat(path.join(directory, name))).isFile())
      throw Error("Unexpected profile read snapshot contents");
  for (const name of names) await fs.promises.unlink(path.join(directory, name));
  await fs.promises.rmdir(directory);
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
function pin(file, files, revision, ownerFile = file) {
  const directory = fs.mkdtempSync(path.join(path.dirname(ownerFile), prefix(ownerFile)));
  const target = path.join(directory, "snapshot.json");
  try {
    if (fs.existsSync(file)) fs.linkSync(file, target);
    for (const source of files) fs.linkSync(source, target + ".wal-" + source.slice(source.lastIndexOf("-") + 1));
  } catch (error) {
    remove(directory);
    throw error;
  }
  let released = false, removal;
  return { file: target, revision,
    release() { if (!released) { remove(directory); released = true; } return removal; },
    releaseAsync() {
      if (released) return removal || Promise.resolve();
      released = true;
      return removal = removeAsync(directory);
    },
  };
}
function filesFor(pin) {
  if (!Object.hasOwn(pin, "files")) return require("./profile-journal").segments(pin.file);
  if (!Array.isArray(pin.files)) throw Error("Invalid profile snapshot files");
  let previous = -1;
  for (const file of pin.files) {
    const prefix = pin.file + ".wal-";
    const suffix = typeof file === "string" && file.startsWith(prefix) ? file.slice(prefix.length) : "";
    const number = Number(suffix);
    if (!/^\d+$/.test(suffix) || !Number.isSafeInteger(number) || number <= previous)
      throw Error("Invalid profile snapshot file order");
    previous = number;
  }
  return pin.files;
}
module.exports = { pin, cleanup, filesFor };
