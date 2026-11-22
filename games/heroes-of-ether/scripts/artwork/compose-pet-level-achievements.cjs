"use strict";
// Fit complete generated characters inside the single canonical achievement frame.
const fs = require("node:fs"),
  path = require("node:path"),
  sharp = require("sharp");
const { compose } = require("./compose-achievement.cjs");
const root = path.resolve(__dirname, "../..");
const portraits = {
  zaya: "#156b91",
  leva: "#254d87",
  drakosha: "#117b75",
  manya: "#793461",
};
(async () => {
  for (const [id, color] of Object.entries(portraits)) {
    const source = path.join(
        root,
        "design/achievement-portraits/sources",
        `pet_level_${id}.png`,
      ),
      silhouette = await sharp(source)
        .trim()
        .resize(176, 176, { fit: "contain", background: "#00000000" })
        .ensureAlpha()
        .raw()
        .toBuffer();
    let radius = 1;
    for (let y = 0; y < 176; y++)
      for (let x = 0; x < 176; x++)
        if (silhouette[(y * 176 + x) * 4 + 3] > 8)
          radius = Math.max(radius, Math.hypot(x - 87.5, y - 87.5));
    // 77px safe circle leaves space between every visible extremity and the frame.
    const size = Math.floor(176 * Math.min(1, 77 / radius)),
      portrait = await sharp(silhouette, { raw: { width: 176, height: 176, channels: 4 } })
        .resize(size, size)
        .png()
        .toBuffer(),
      background = Buffer.from(
        `<svg width="256" height="256"><defs><radialGradient id="bg"><stop stop-color="${color}"/><stop offset="1" stop-color="#151a36"/></radialGradient></defs><circle cx="128" cy="123" r="100" fill="url(#bg)"/></svg>`,
      ),
      illustration = path.join(
        root,
        "design/achievement-portraits/illustrations",
        `pet_level_${id}.png`,
      );
    fs.mkdirSync(path.dirname(illustration), { recursive: true });
    await sharp(background)
      .composite([
        { input: portrait, left: Math.round(128 - size / 2), top: Math.round(122 - size / 2) },
      ])
      .png()
      .toFile(illustration);
    await compose(
      illustration,
      path.join(root, "public/assets/achievements/illustrated-v2", `pet_level_${id}.webp`),
    );
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
