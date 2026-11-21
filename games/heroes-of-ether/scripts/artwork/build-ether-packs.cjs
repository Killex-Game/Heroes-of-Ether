"use strict";
// Экспорт оригиналов imagegen: только прозрачные поля и масштаб для карточек.
const fs = require("node:fs"),
  path = require("node:path"),
  sharp = require("sharp");
const root = path.resolve(__dirname, "../.."),
  doc = path.join(root, "docs/artwork/ether-packs-20261026");
async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(doc, "manifest.json"), "utf8"));
  const results = [];
  for (const item of manifest.assets) {
    const source = path.join(root, item.source),
      target = path.join(root, item.output);
    if (!(await sharp(source).metadata()).hasAlpha) throw Error(`${item.id}: missing alpha`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await sharp(source)
      .trim()
      .resize(448, 448, { fit: "contain", background: "#00000000" })
      .extend({ top: 32, bottom: 32, left: 32, right: 32, background: "#00000000" })
      .webp({ quality: 94, alphaQuality: 100 })
      .toFile(target);
    const meta = await sharp(target).metadata();
    results.push({
      id: item.id,
      output: item.output,
      width: meta.width,
      height: meta.height,
      alpha: meta.hasAlpha,
      bytes: fs.statSync(target).size,
    });
  }
  fs.writeFileSync(path.join(doc, "exports.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
