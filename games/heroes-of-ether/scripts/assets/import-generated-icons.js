/* Подготовка графических ресурсов: import-generated-icons. */
"use strict";
// Только копирование и стандартное уменьшение PNG; рисунок не перерабатывается.
const fs = require("node:fs"),
  path = require("node:path"),
  sharp = require("sharp");
const root = path.resolve(__dirname, "../..");
async function main() {
  const [warheads, bucks] = process.argv.slice(2);
  if (!warheads || !bucks) throw Error("Укажите два исходных PNG: Боеголовки и Баксы.");
  const sources = path.join(root, "design/generated-icons-20261019");
  fs.mkdirSync(sources, { recursive: true });
  for (const [name, source] of [
    ["warheads", warheads],
    ["bucks", bucks],
  ])
    fs.copyFileSync(source, path.join(sources, name + ".png"));
  await sharp(warheads)
    .resize(256, 256, { fit: "contain", background: "#00000000" })
    .png()
    .toFile(path.join(root, "public/assets/boosters/png/warheads.png"));
  for (const size of [64, 128])
    await sharp(bucks)
      .resize(size, size, { fit: "contain", background: "#00000000" })
      .webp({ lossless: true })
      .toFile(path.join(root, `public/assets/menu-icons/${size}/currency_bucks.webp`));
  console.log(
    "Imported warheads PNG (256) and bucks WebP (64/128); original PNGs preserved in design/generated-icons-20261019.",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
