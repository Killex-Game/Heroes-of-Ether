/* Package the owner's original transparent portraits; no redrawing or background. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const sharp = require("sharp");
const root = path.resolve(__dirname, "../..");
async function build(sources) {
  const skins = require("../../public/shared/player-identity").ownerGiftSkins;
  const records = [];
  for (let i = 0; i < skins.length; i++) {
    const skin = skins[i], input = fs.readFileSync(sources[i]);
    const metadata = await sharp(input).metadata();
    if (!metadata.hasAlpha || metadata.width !== metadata.height) throw Error("Expected a square transparent source: " + skin.id);
    const original = path.join(root, "public/assets/skins/owner-gifts-v1/sources", skin.id + ".png");
    fs.mkdirSync(path.dirname(original), { recursive: true }); fs.writeFileSync(original, input);
    const outputs = [];
    for (const [size, asset] of Object.entries(skin.variants)) {
      const file = path.join(root, "public", asset); fs.mkdirSync(path.dirname(file), { recursive: true });
      await sharp(input).resize(+size, +size).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(file);
      outputs.push({ size: +size, bytes: fs.statSync(file).size, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") });
    }
    records.push({ id: skin.id, source: path.basename(sources[i]), width: metadata.width, height: metadata.height,
      sourceSha256: crypto.createHash("sha256").update(input).digest("hex"), provenance: "Provided directly by the game owner for use as a personal gift avatar; original pixels preserved. No external asset downloaded.", outputs });
  }
  fs.writeFileSync(path.join(root, "public/assets/skins/owner-gifts-v1/manifest.json"), JSON.stringify(records, null, 2) + "\n");
  console.log(JSON.stringify(records));
}
if (require.main === module) build(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { build };
