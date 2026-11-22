"use strict";
const fs = require("node:fs"), path = require("node:path");
const policy = require("./retired-assets.json");
function checkRetiredAssets(root) {
  const failures = [];
  for (const relative of policy.directories) if (fs.existsSync(path.join(root,relative)))
    failures.push("Retired artwork directory returned: " + relative);
  for (const relative of policy.retired) if (fs.existsSync(path.join(root, relative)))
    failures.push("Retired artwork returned: " + relative);
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "assets") walk(file); continue; }
      if (!/\.(?:js|cjs|html|css)$/.test(entry.name)) continue;
      const source = fs.readFileSync(file, "utf8");
      for (const relative of policy.retired) {
        const asset = relative.startsWith("public/") ? relative.slice(7) : relative;
        if (source.includes(asset)) failures.push(path.relative(root,file) + " references retired artwork " + asset);
      }
    }
  }
  walk(path.join(root,"public")); walk(path.join(root,"src"));
  return failures;
}
module.exports = { checkRetiredAssets };
if (require.main === module) {
  const failures = checkRetiredAssets(path.resolve(__dirname,"../.."));
  if (failures.length) { console.error(failures.join("\n")); process.exitCode=1; }
  else console.log("Retired artwork guard passed");
}
