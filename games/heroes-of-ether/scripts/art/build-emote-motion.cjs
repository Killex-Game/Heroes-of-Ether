"use strict";
// Usage: node scripts/art/build-emote-motion.cjs [path-to-playwright-core]
// Original artwork is read-only. This atlas precomputes the approved small
// rotations so software Canvas backends do not rotate every split cell.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { chromium } = require(process.argv[2] || "playwright-core");
const game = path.resolve(__dirname, "../.."), ids = [1, 6, 4, 5, 3, 8, 9];
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
async function main() {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const records = [];
  try {
    const page = await browser.newPage();
    for (const id of ids) {
      const source = `public/assets/emotes/pets-v1/${id}.webp`;
      const output = `public/assets/emotes/pets-motion-v2/${id}.png`;
      const original = fs.readFileSync(path.join(game, source));
      const encoded = await page.evaluate(async src => {
        const image = new Image(); image.src = src; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = 960; canvas.height = 576;
        const context = canvas.getContext("2d");
        for (let index = 0; index < 15; index++) {
          const x = index % 5 * 192, y = Math.floor(index / 5) * 192;
          context.save(); context.beginPath(); context.rect(x, y, 192, 192); context.clip();
          context.translate(x + 96, y + 24 + 144 * .7);
          context.rotate((index - 7) * Math.PI / 180);
          context.drawImage(image, -72, -144 * .7, 144, 144); context.restore();
        }
        return canvas.toDataURL("image/png").split(",")[1];
      }, "data:image/webp;base64," + original.toString("base64"));
      const bytes = Buffer.from(encoded, "base64");
      fs.mkdirSync(path.dirname(path.join(game, output)), { recursive: true });
      fs.writeFileSync(path.join(game, output), bytes);
      if (hash(fs.readFileSync(path.join(game, source))) !== hash(original)) throw Error("Source changed");
      records.push({ source, sourceSha256: hash(original), output, outputSha256: hash(bytes), bytes: bytes.length });
    }
    console.log(JSON.stringify({ browser: browser.version(), width: 960, height: 576, tile: 192,
      artwork: 144, degrees: [-7, 7], step: 1, columns: 5, pivot: [.5, .7], records }, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
