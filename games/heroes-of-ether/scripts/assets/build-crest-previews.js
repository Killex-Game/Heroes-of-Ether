/* Подготовка графических ресурсов: build-crest-previews. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, "../.."),
  source = path.join(root, "design/clan-crest-kit-v1"),
  out = path.join(root, "design/crest-style-references");
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
    for (const category of ["frames", "symbols"])
      for (const item of JSON.parse(
        fs.readFileSync(path.join(source, category + ".json"), "utf8"),
      )) {
        const svg = fs.readFileSync(path.join(source, item.file), "utf8");
        if (/<script|<foreignObject|\son\w+=|href\s*=/i.test(svg)) throw Error("Active SVG");
        await page.setContent(
          "<style>html,body{margin:0;background:transparent}svg{display:block;width:512px;height:512px}</style>" +
            svg,
        );
        await page.screenshot({ path: path.join(out, item.id + ".png"), omitBackground: true });
      }
    console.log("30 reference PNGs rendered from inert vector originals");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
