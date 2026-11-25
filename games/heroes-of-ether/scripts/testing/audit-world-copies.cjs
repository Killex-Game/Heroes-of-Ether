"use strict";
// Structural inventory, not a substitute for tracing aliases/callback writes.
const fs = require("node:fs"), path = require("node:path"), acorn = require("acorn");
const root = path.resolve(__dirname, "../..");
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
function inventory() {
  const rows = [], errors = [], counts = {};
  for (const section of ["src", "public", "config"]) {
    const all = files(path.join(root, section)); counts[section] = all.length;
    for (const file of all.filter(file => /\.(?:js|cjs)$/.test(file))) {
      const relative = path.relative(root, file).replaceAll("\\", "/"), source = fs.readFileSync(file, "utf8");
      let tree;
      try { tree = acorn.parse(source, { ecmaVersion: "latest", sourceType: "script", locations: true }); }
      catch (error) { errors.push({ file: relative, error: error.message }); continue; }
      function visit(node) {
        if (!node || typeof node !== "object") return;
        if (node.type === "CallExpression") {
          const callee = node.callee, name = callee.type === "Identifier" ? callee.name :
            callee.type === "MemberExpression" && !callee.computed ? callee.property.name : "";
          if (["structuredClone", "clone", "copyArenaData", "copyRecord", "cloneClans", "clanDraft",
            "postMessage", "transactWorld", "transactProfile", "transact", "stringify"].includes(name))
            rows.push({ file: relative, line: node.loc.start.line, name, arguments: node.arguments.length,
              expression: source.slice(node.start, Math.min(node.end, node.start + 180)).replace(/\s+/g, " ") });
        }
        for (const [key, value] of Object.entries(node)) {
          if (key === "loc") continue;
          if (Array.isArray(value)) value.forEach(visit);
          else if (value && typeof value === "object") visit(value);
        }
      }
      visit(tree);
    }
  }
  return { counts, errors, rows };
}
if (require.main === module) process.stdout.write(JSON.stringify(inventory(), null, 2) + "\n");
module.exports = { inventory };
