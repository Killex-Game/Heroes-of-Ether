"use strict";
const fs = require("node:fs"),
  path = require("node:path");
function temporary(t, label) {
  const directory = fs.mkdtempSync(path.join(__dirname, ".tmp-" + label + "-"));
  t.after(() => {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== __dirname || !path.basename(resolved).startsWith(".tmp-"))
      throw Error("Небезопасный путь тестового каталога.");
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}
module.exports = { temporary };
