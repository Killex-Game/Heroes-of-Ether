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
    const source = path.join(root, "public", skin.variants[1024].split("?")[0]);
    const sourceBytes = fs.readFileSync(source);
    const metadata = await sharp(sourceBytes).metadata();
    for (const [size, asset] of Object.entries(skin.variants)) {
      const destination = path.join(root, "public", asset.split("?")[0]);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      await sharp(sourceBytes)
        .resize(Number(size), Number(size), {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
          withoutEnlargement: true,
        })
        .webp({ quality: 92, alphaQuality: 100, effort: 6 })
        .toFile(destination);
      outputs.push({
        skinId: skin.id,
        source: skin.variants[1024],
        sourceSize: metadata.width,
        size: Number(size),
        asset,
        bytes: fs.statSync(destination).size,
      });
    }
  }
  fs.writeFileSync(
    path.join(root, "public/assets/skins/transparent-v2/vip-manifest.json"),
    JSON.stringify(outputs, null, 2) + "\n",
  );
  console.log(`VIP: ${outputs.length} WebP files; current transparent portraits rebuilt.`);
}
if (require.main === module) {
  buildVipAvatarVariants().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
module.exports = { buildVipAvatarVariants };
