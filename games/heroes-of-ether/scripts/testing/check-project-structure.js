"use strict";

// Проверка переносов: импорты, HTML/CSS, каталоги изображений и список переименований.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const parser = require("prettier/plugins/babel").parsers.babel;
const root = path.resolve(__dirname, "../..");
const publicRoot = path.join(root, "public");
const failures = [];
let scripts = 0,
  references = 0;

function filesBelow(directory) {
  // Archived third-party licence pages keep links to their original sites;
  // they are evidence, not application pages served from public/.
  const relative = path.relative(root, directory).split(path.sep);
  if (relative[0] === "docs" && relative[1] === "audio" && relative.at(-1) === "evidence")
    return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    if (
      ["node_modules", "data", "design", "output", "artifacts", "backups"].includes(item.name) ||
      item.name.startsWith(".tmp-")
    )
      return [];
    const full = path.join(directory, item.name);
    return item.isDirectory() ? filesBelow(full) : [full];
  });
}
function exists(filename, owner) {
  references++;
  if (!fs.existsSync(filename))
    failures.push(path.relative(root, owner) + " → " + path.relative(root, filename));
}
function visit(node, callback) {
  if (!node || typeof node !== "object") return;
  callback(node);
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "comments", "tokens", "errors"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => visit(child, callback));
    else if (value && typeof value === "object") visit(value, callback);
  }
}
function localUrl(url, owner, base = path.dirname(owner)) {
  if (/^(?:[a-z]+:|\/\/|#)/i.test(url) || url.includes("${")) return;
  const value = decodeURIComponent(url.split(/[?#]/)[0]);
  if (value) {
    const resolved = path.resolve(
      value.startsWith("/") ? publicRoot : base,
      value.replace(/^\//, ""),
    );
    // Строковые префиксы динамического пути (food-, clan_) проверяются до папки.
    exists(
      !path.extname(value) && !fs.existsSync(resolved) ? path.dirname(resolved) : resolved,
      owner,
    );
  }
}
for (const file of filesBelow(root)) {
  const extension = path.extname(file);
  if (![".js", ".cjs", ".html", ".css"].includes(extension)) continue;
  const source = fs.readFileSync(file, "utf8");
  // Archived experiment imports resolve only after the documented relocation.
  const relocatedExperiment = path.relative(root, file).split(path.sep).slice(0, 3).join("/") ===
    "scripts/benchmarks/experimental-packed-parts";
  if (extension === ".js" || extension === ".cjs") {
    scripts++;
    try {
      new vm.Script(source, { filename: file });
      visit(parser.parse(source), (node) => {
        const callee = node.callee;
        const requireCall =
          node.type === "CallExpression" &&
          (callee?.name === "require" ||
            (callee?.type === "MemberExpression" &&
              callee.object?.name === "require" &&
              callee.property?.name === "resolve"));
        const argument = node.arguments?.[0];
        if (requireCall && !relocatedExperiment && argument?.type === "StringLiteral" && argument.value.startsWith(".")) {
          references++;
          try {
            require.resolve(path.resolve(path.dirname(file), argument.value));
          } catch {
            failures.push(path.relative(root, file) + " → require(" + argument.value + ")");
          }
        }
        if (
          file.startsWith(publicRoot + path.sep) &&
          node.type === "StringLiteral" &&
          node.value.startsWith("assets/")
        ) {
          localUrl(node.value, file, publicRoot);
        }
      });
    } catch (error) {
      failures.push(path.relative(root, file) + ": " + error.message);
    }
  } else if (extension === ".html") {
    for (const match of source.matchAll(/\b(?:src|href)=["']([^"']+)["']/g))
      localUrl(match[1], file);
    if (
      file === path.join(publicRoot, "index.html") &&
      /<script>[\s\S]*\S[\s\S]*<\/script>/.test(source)
    )
      failures.push("index.html still contains inline application code");
  } else {
    for (const match of source.matchAll(/url\((["']?)([^)"']+)\1\)/g)) localUrl(match[2], file);
  }
}
const identity = require("../../public/shared/player-identity");
for (const skin of identity.allSkins) {
  // Variant catalogs may retain a legacy filename that is no longer served.
  // Check the actual public resolver and every selectable resolution instead.
  localUrl(identity.skinSource(skin, 128), __filename, publicRoot);
  localUrl(skin.arena, __filename, publicRoot);
  for (const asset of Object.values(skin.variants || {}))
    localUrl(asset, __filename, publicRoot);
}
for (const item of require("../../src/server/boosters/booster-catalog").BOOSTERS.values()) {
  localUrl(item.icon, __filename, publicRoot);
}
const renames = require("../../docs/file-renames.json");
for (const entry of renames) {
  exists(path.join(root, entry.new), __filename);
  if (entry.old !== "server.js" && fs.existsSync(path.join(root, entry.old)))
    failures.push("Old file still exists: " + entry.old);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `PASS: ${scripts} JavaScript files, ${references} references, ${renames.length} renames; HTML/CSS and skin/booster catalogs resolve.`,
  );
}
