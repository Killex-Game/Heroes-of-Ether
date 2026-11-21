"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  sharp = require("sharp");
const root = path.resolve(__dirname, "../.."),
  folder = path.join(root, "docs/artwork/easter-hunt-20261026"),
  manifest = require(path.join(folder, "manifest.json"));
(async () => {
  const out = path.join(root, "public/assets/events/easter-hunt");
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(path.join(folder, "sources"), { recursive: true });
  for (const art of manifest.assets) {
    const original = path.join(folder, "sources", art.id + ".png");
    if (!fs.existsSync(original)) fs.copyFileSync(art.source, original);
    await sharp(original)
      .resize(512, 512, { fit: "contain", background: "#00000000" })
      .webp({ quality: 92 })
      .toFile(path.join(out, art.id + ".webp"));
    console.log(
      art.id,
      await sharp(path.join(out, art.id + ".webp"))
        .metadata()
        .then((m) => ({ width: m.width, height: m.height, alpha: m.hasAlpha })),
    );
  }
})();
