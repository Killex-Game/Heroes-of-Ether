"use strict";
// Package the generated transparent artwork; no drawing or alpha reconstruction.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '../..');
const docs = path.join(root, 'docs/artwork/daily-stars-20261107');
const targets = [
  [2, 'exec-a3952bb9-f0c6-4881-9938-6a220cd1db69.png'],
  [3, 'exec-7c82634f-04f2-4e6f-a45d-245d1a667848.png'],
];
(async () => {
  fs.mkdirSync(docs, {recursive:true});
  const assets = [];
  for (const [place, file] of targets) {
    const source = path.join('C:/Users/semen/.codex/generated_images/01a14abe-e850-7ca1-be9b-f32a856dbaba', file);
    const original = path.join(docs, `greatness-${place}.png`);
    if (!fs.existsSync(original)) fs.copyFileSync(source, original);
    const meta = await sharp(original).metadata();
    if (!meta.hasAlpha) throw Error('Missing transparency');
    const output = `assets/regalia/daily/canonical-star-v2/greatness-${place}.webp`;
    fs.mkdirSync(path.dirname(path.join(root,'public',output)),{recursive:true});
    await sharp(original).resize(256,256,{fit:'contain'}).webp({quality:94,alphaQuality:100}).toFile(path.join(root,'public',output));
    assets.push({place, source, output, sha256:crypto.createHash('sha256').update(fs.readFileSync(original)).digest('hex')});
  }
  fs.writeFileSync(path.join(docs,'manifest.json'),JSON.stringify({tool:'image_gen.imagegen',date:'2026-11-07',assets},null,2)+'\n');
  console.log(JSON.stringify(assets.map(({place,output})=>({place,output}))));
})().catch(e=>{console.error(e);process.exitCode=1;});
