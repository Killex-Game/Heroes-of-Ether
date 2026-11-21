"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  sharp = require("sharp"),
  { compose } = require("./compose-achievement.cjs");
const root = path.resolve(__dirname, "../.."),
  dir = path.join(root, "docs/artwork/easter-hunt-20261026");
(async () => {
  const specs = require(path.join(dir, "achievement-sources.json")).assets;
  for (const s of specs) {
    const dest = path.join(dir, "sources", s.id + ".png");
    if (!fs.existsSync(dest)) fs.copyFileSync(s.source, dest);
  }
  const pairs = [
    ["easter_trail", "egg-ruby"],
    ["easter_collection", "golden-egg"],
    ...specs.map((s) => [s.id, s.id]),
  ];
  for (const [id, source] of pairs) {
    const art = await sharp(path.join(dir, "sources", source + ".png"))
      .trim()
      .resize(172, 180, { fit: "inside" })
      .png()
      .toBuffer();
    const input = path.join(dir, "sources", id + "-interior.png");
    await sharp({ create: { width: 256, height: 256, channels: 4, background: "#173c32" } })
      .composite([{ input: art, gravity: "centre" }])
      .png()
      .toFile(input);
    await compose(
      input,
      path.join(root, "public/assets/achievements/illustrated-v2", id + ".webp"),
    );
  }
  await sharp(path.join(dir, "sources/easter_find.png"))
    .resize(512, 512, { fit: "contain", background: "#00000000" })
    .webp({ quality: 92 })
    .toFile(path.join(root, "public/assets/events/easter-hunt/chest.webp"));
  console.log("7 achievement icons and chest exported");
})();
