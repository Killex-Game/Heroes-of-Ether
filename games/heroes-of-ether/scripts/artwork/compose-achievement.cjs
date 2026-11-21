"use strict";
// Deterministic assembly. New artwork must contain the illustration only, without a frame.
// node scripts/artwork/compose-achievement.cjs input.png output.webp
const path = require("node:path"),
  fs = require("node:fs"),
  sharp = require("sharp");
const assets = path.resolve(__dirname, "../../public/assets/achievements/template");
async function compose(input, output) {
  if (path.resolve(input) === path.resolve(output))
    throw Error("Use separate source and output files.");
  const illustration = await sharp(input)
    .resize(256, 256, { fit: "contain", background: "#00000000" })
    .composite([{ input: path.join(assets, "interior-mask.svg"), blend: "dest-in" }])
    .png()
    .toBuffer();
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  await sharp(illustration)
    .composite([{ input: path.join(assets, "canonical-gold-frame.png") }])
    .webp({ lossless: true })
    .toFile(output);
}
module.exports = { compose };
if (require.main === module) {
  if (process.argv.length !== 4)
    throw Error("Usage: node compose-achievement.cjs input.png output.webp");
  compose(process.argv[2], process.argv[3]).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
