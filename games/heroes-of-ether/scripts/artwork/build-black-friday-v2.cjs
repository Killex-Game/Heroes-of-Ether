"use strict";
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '../..');
const sources = 'C:/Users/semen/.codex/generated_images/01a14abe-e850-7ca1-be9b-f32a856dbaba';
const docs = path.join(root, 'docs/artwork/black-friday-20261109');
const output = path.join(root, 'public/assets/events/black-friday');
const assets = [
  ['token-draft', 'exec-1f033f6a-2fb5-4450-a3bf-fe944ae022c5.png', 'Silver coin with raised cat paw, double rim, gold accents, transparent. Draft rejected: remove gold.'],
  ['token-v2', 'exec-d1b1fdd9-c972-4160-b2e5-56d11f3b5105.png', 'Edit token: remove all four gold inserts; uninterrupted silver rim, no gold anywhere. Preserve raised paw, composition and transparent background.'],
  ['regalia-v2', 'exec-50aec2a3-6233-4e3a-a1c0-a6f06e7dedc4.png', 'Standalone open smoky crystal casket, emerald lining, gold fittings, three burgundy cards. Game style. No medal, frame, laurels, ribbon or crown. Transparent.'],
  ['banner-v2', 'exec-dad402bb-8a37-4839-9a38-9895a5ffb33f.png', 'Edit Manya shop banner to charcoal awning, midnight teal and indigo shadows, soft amber lanterns. Preserve Manya and canonical gold coins with five-point star and double rim. No text.'],
];
(async () => {
  fs.mkdirSync(docs, { recursive: true });
  const manifest = [];
  for (const [name, file, prompt] of assets) {
    const source = path.join(sources,file), saved = path.join(docs,name+'.png');
    if (!fs.existsSync(saved)) fs.copyFileSync(source,saved);
    const meta = await sharp(saved).metadata();
    if (name !== 'token-draft') {
      let pipeline = sharp(saved);
      if (name !== 'banner-v2') pipeline = pipeline.trim();
      await pipeline.resize(name === 'banner-v2' ? 1440 : 256, name === 'banner-v2' ? undefined : 256, {fit:'inside',withoutEnlargement:true}).webp({quality:92,alphaQuality:100}).toFile(path.join(output,name+'.webp'));
    }
    manifest.push({name,file:saved,source,tool:'image_gen (built-in)',prompt,hasAlpha:meta.hasAlpha,sha256:crypto.createHash('sha256').update(fs.readFileSync(saved)).digest('hex')});
  }
  fs.writeFileSync(path.join(docs,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(manifest.map(({name,hasAlpha,sha256})=>({name,hasAlpha,sha256})));
})();
