/* Подготовка графических ресурсов: build-art-contact-sheet. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  sharp = require("sharp"),
  manifest = require("../../design/art-update-prompts.json");
const root = path.resolve(__dirname, "../.."),
  jobs = manifest.jobs.filter(
    (j) => j.source && !j.id.startsWith("banner-") && j.id !== "warheads-v2",
  );
(async () => {
  const layers = [];
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i],
      left = (i % 6) * 164,
      top = Math.floor(i / 6) * 180;
    const buffer = await sharp(j.source)
      .resize(150, 150, { fit: "contain", background: "#e2d6e9" })
      .png()
      .toBuffer();
    layers.push({ input: buffer, left: left + 7, top: top + 4 });
    layers.push({
      input: Buffer.from(
        '<svg width="164" height="22"><text x="82" y="16" text-anchor="middle" font-size="12" fill="#432944">' +
          j.id +
          "</text></svg>",
      ),
      left,
      top: top + 155,
    });
  }
  await sharp({
    create: {
      width: 984,
      height: Math.ceil(jobs.length / 6) * 180,
      channels: 4,
      background: "#e2d6e9",
    },
  })
    .composite(layers)
    .png()
    .toFile(path.join(root, "tests/artifacts/visual-art-contact.png"));
})();
