/* Подготовка графических ресурсов: remove-button-ornaments. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "../.."),
  directory = path.join(root, "public/assets/ui");
let count = 0;
for (const file of fs
  .readdirSync(directory, { recursive: true })
  .filter((f) => /^button_.*\.svg$/.test(path.basename(f)))) {
  const source = path.join(directory, file),
    svg = fs.readFileSync(source, "utf8");
  const next = svg.replace(
    /<path d="(?:M (?:25|255) (?:30|33)\.5 [^"]+|M(?:23|251) 34h6 M(?:23|251) 38h6)"[^>]*\/>/g,
    () => {
      count++;
      return "";
    },
  );
  if (next === svg) continue;
  fs.writeFileSync(source, next);
}
console.log("Removed side ornaments:", count);
