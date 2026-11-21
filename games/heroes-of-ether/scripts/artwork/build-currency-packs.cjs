"use strict";
// Копируем оригиналы imagegen и уменьшаем их для интерфейса, не меняя рисунок.
const fs = require("node:fs"),
  path = require("node:path"),
  sharp = require("sharp");
const root = path.resolve(__dirname, "../.."),
  doc = path.join(root, "docs/artwork/currency-packs-20261025"),
  sourceDir = path.join(doc, "sources"),
  output = path.join(root, "public/assets/currency-packs/v1"),
  backup = path.resolve(root, "../../backups/currency-packs-20261025/public/assets/menu-icons");
async function main() {
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  for (const entry of JSON.parse(fs.readFileSync(path.join(doc, "generated.json"), "utf8"))) {
    const original = path.join(sourceDir, entry.id + ".png");
    if (!fs.existsSync(original)) fs.copyFileSync(entry.source, original);
    const meta = await sharp(original).metadata();
    if (!meta.hasAlpha) throw Error(entry.id + ": alpha required");
    const target = path.join(output, entry.id + ".webp");
    await sharp(original)
      .resize(512, 512, { fit: "contain", background: "#00000000" })
      .webp({ quality: 92 })
      .toFile(target);
    results.push({
      id: entry.id,
      width: 512,
      height: 512,
      alpha: true,
      bytes: fs.statSync(target).size,
    });
    if (entry.id === "bucks-stack") {
      for (const size of [64, 128, 256]) {
        const oldPath = path.join(root, `public/assets/menu-icons/${size}/currency_bucks.webp`),
          saved = path.join(backup, String(size), "currency_bucks.webp");
        fs.mkdirSync(path.dirname(saved), { recursive: true });
        if (!fs.existsSync(saved)) fs.copyFileSync(oldPath, saved);
        await sharp(original)
          .resize(size, size, { fit: "contain", background: "#00000000" })
          .webp({ quality: 95 })
          .toFile(oldPath);
      }
    }
  }
  fs.writeFileSync(path.join(doc, "exports.json"), JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify({
      exported: results.length,
      bytes: results.reduce((s, r) => s + r.bytes, 0),
      sharedBucksSizes: [64, 128, 256],
    }),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
