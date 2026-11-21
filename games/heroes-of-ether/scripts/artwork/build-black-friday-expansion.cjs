"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), sharp = require("sharp");
const root = path.resolve(__dirname, "../.."), docs = path.join(root, "docs/artwork/black-friday-expansion-20261109");
const { compose } = require("./compose-achievement.cjs");
(async () => {
  const records = JSON.parse(fs.readFileSync(path.join(docs, "prompts.json"), "utf8"));
  for (const r of records) {
    const saved = path.join(docs, r.id + ".png");
    if (!fs.existsSync(saved)) fs.copyFileSync(r.source, saved);
    const meta = await sharp(saved).metadata();
    if (!meta.hasAlpha) throw Error("Missing alpha: " + r.id);
    const directory = r.kind === "achievement" ? "assets/achievements/illustrated-v2" : "assets/events/black-friday";
    r.output = path.join(root, "public", directory, r.id + ".webp");
    const size = r.kind === "achievement" ? 256 : 512;
    const normalized = sharp(saved).trim({ threshold: 8 }).resize(size, size, { fit: "contain", background: "#00000000" });
    if (r.kind === "achievement") {
      // Discard the generated outer rim and assemble with the single canonical master.
      const interior = path.join(docs, r.id + "-composition.png");
      await normalized.png().toFile(interior);
      await compose(interior, r.output);
      r.frame = "public/assets/achievements/template/canonical-gold-frame.png";
      r.frameSha256 = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, r.frame))).digest("hex");
    } else {
      await normalized.webp({ quality: 92, alphaQuality: 100 }).toFile(r.output);
    }
    r.outputSha256 = crypto.createHash("sha256").update(fs.readFileSync(r.output)).digest("hex");
    r.saved = saved;
    r.sha256 = crypto.createHash("sha256").update(fs.readFileSync(saved)).digest("hex");
    r.tool = "image_gen (built-in)";
  }
  fs.writeFileSync(path.join(docs, "manifest.json"), JSON.stringify(records, null, 2) + "\n");
  console.log("Installed " + records.length + " assets");
})().catch(e => { console.error(e); process.exitCode = 1; });
