/* Упаковка исходных VIP-портретов в WebP разных размеров для интерфейса и арены. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { accountSkins } = require("../../public/shared/player-identity");
const root = path.resolve(__dirname, "../..");

async function buildVipAvatarVariants() {
  const outputs = [];
  for (const skin of accountSkins.filter((skin) => skin.tier === "vip")) {
    const source = path.join(root, "public/assets/skins", skin.file);
    const metadata = await sharp(source).metadata();
    for (const [size, asset] of Object.entries(skin.variants)) {
      const destination = path.join(root, "public", asset);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      await sharp(source)
        .resize(Number(size), Number(size), {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
          withoutEnlargement: true,
        })
        .webp({ quality: 92, alphaQuality: 100, effort: 6 })
        .toFile(destination);
      outputs.push({
        skinId: skin.id,
        source: skin.file,
        sourceSize: metadata.width,
        size: Number(size),
        asset,
        bytes: fs.statSync(destination).size,
      });
    }
  }
  fs.writeFileSync(
    path.join(root, "public/assets/skins/vip/manifest.json"),
    JSON.stringify(outputs, null, 2) + "\n",
  );
  console.log(`VIP: ${outputs.length} WebP files; original PNG portraits preserved.`);
}
if (require.main === module) {
  buildVipAvatarVariants().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
module.exports = { buildVipAvatarVariants };
