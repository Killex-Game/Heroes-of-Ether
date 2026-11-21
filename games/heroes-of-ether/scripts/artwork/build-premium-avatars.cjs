"use strict";
// Только упаковка сгенерированных прозрачных оригиналов; рисунок и alpha не дорисовываются.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");
const root = path.resolve(__dirname, "../..");
const folder = path.join(root, "docs/artwork/premium-avatars-20261106");
const prompts = require(path.join(folder, "prompts.json"));
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
(async () => {
  const manifest = { tool: prompts.tool, date: "2026-11-06", assets: [] };
  for (const item of prompts.avatars) {
    const source = path.join(folder, item.id + ".png");
    if (!fs.existsSync(source)) fs.copyFileSync(item.source, source);
    const metadata = await sharp(source).metadata();
    if (!metadata.hasAlpha || metadata.width !== metadata.height)
      throw Error(item.id + ": expected square transparent original");
    const outputs = [];
    for (const size of [64, 128, 256, 512, 1024]) {
      const relative = "assets/skins/premium-v2/" + size + "/" + item.id + ".webp";
      const destination = path.join(root, "public", relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      await sharp(source).resize(size, size).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(destination);
      outputs.push({ size, path: relative, bytes: fs.statSync(destination).size, sha256: hash(destination) });
    }
    manifest.assets.push({ id: item.id, name: item.name, source: path.basename(source), sourceSha256: hash(source), generatedSource: item.source, width: metadata.width, height: metadata.height, outputs });
  }
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("Exported " + manifest.assets.length + " portraits in 5 sizes each.");
})().catch(error => { console.error(error); process.exitCode = 1; });
