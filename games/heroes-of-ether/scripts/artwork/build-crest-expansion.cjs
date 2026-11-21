const fs = require("node:fs"),
  path = require("node:path"),
  sharp = require("sharp");
const root = path.resolve(__dirname, "../..");
const manifest = require("../../docs/artwork/crest-expansion-20261025.json");
(async () => {
  for (const item of manifest.items) {
    const source = path.join(root, item.source),
      output = path.join(root, item.output);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    if (!fs.existsSync(source)) fs.copyFileSync(item.generatedSource, source);
    const meta = await sharp(source).metadata();
    if (!meta.hasAlpha) throw Error("Expected transparent source: " + item.id);
    await sharp(source)
      .resize(512, 512, { fit: "contain", background: "#00000000" })
      .webp({ quality: 95, alphaQuality: 100 })
      .toFile(output);
    console.log(item.id, "512x512 gold, alpha");
  }
})();
