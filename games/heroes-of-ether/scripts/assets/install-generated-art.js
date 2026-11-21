/* Подготовка графических ресурсов: install-generated-art. */
"use strict";
// Uses the bundled image encoder only to package the generated artwork for web.
const fs = require("node:fs"),
  path = require("node:path"),
  sharp = require("sharp");
const root = path.resolve(__dirname, "../.."),
  manifest = require("../../design/art-update-prompts.json");
const original = path.join(root, "design/generated-20261020"),
  backup = path.join(root, "data/backups/visual-gameplay-before-20261019-232355/assets");
fs.mkdirSync(original, { recursive: true });
async function write(source, relative, size, format = "webp") {
  const target = path.join(root, "public", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    const saved = path.join(backup, relative);
    fs.mkdirSync(path.dirname(saved), { recursive: true });
    if (!fs.existsSync(saved)) fs.copyFileSync(target, saved);
  }
  let pipeline = sharp(source).resize(size, size, { fit: "inside", withoutEnlargement: true });
  pipeline = format === "png" ? pipeline.png() : pipeline.webp({ quality: 92 });
  await pipeline.toFile(target);
}
(async () => {
  for (const job of manifest.jobs) {
    if (!job.source) continue;
    const source = path.join(original, job.id + ".png");
    fs.copyFileSync(job.source, source);
    if (/^[fs]\d\d_/.test(job.id))
      await write(source, "assets/clan-crests/v2/" + job.id + ".webp", 512);
    else if (job.id.startsWith("banner-"))
      await write(
        source,
        "assets/banners/" + job.id.replace("banner-", "").replace("-v2", "") + ".webp",
        1024,
      );
    else if (job.id === "warheads-v2")
      await write(source, "assets/boosters/png/warheads.png", 512, "png");
    else if (job.id.startsWith("gender-"))
      await write(source, "assets/identity/" + job.id + ".webp", 256);
    else if (job.id.startsWith("food-"))
      await write(source, "assets/food/" + job.id + ".webp", 128);
  }
  for (const job of manifest.provided) {
    const source = path.join(original, job.id + "-provided.png");
    fs.copyFileSync(job.source, source);
    if (job.id === "premium") await write(source, "assets/accounts/premium.png", 256, "png");
    if (job.id === "rocket") await write(source, "assets/boosters/png/rocket.png", 256, "png");
    if (job.id === "bucks")
      for (const size of [64, 128, 256])
        await write(source, "assets/menu-icons/" + size + "/currency_bucks.webp", size);
  }
  console.log("Artwork installed with originals and replaced-asset backups.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
