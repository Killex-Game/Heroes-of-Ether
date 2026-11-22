"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const art=require('../../public/shared/lobby-menu-art');
test('every lobby menu button has artwork for all five themes, including future additions',()=>{
 const root=path.resolve(__dirname,'../../public'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const tags=[...html.matchAll(/<button\b[^>]*>/g)].map(m=>m[0]).filter(t=>/class="[^"]*\bmenu-tile\b/.test(t));
 const ids=tags.map(t=>t.match(/\bid="([^"]+)"/)[1]);assert.deepEqual(ids.sort(),Object.keys(art.buttons).sort());
 for(const theme of art.themes)for(const icon of Object.values(art.buttons)){
  const source=art.source(theme,icon);if(theme==='default'&&!source)continue;
  assert.ok(source&&fs.existsSync(path.join(root,source.split(/[?#]/)[0])),theme+'/'+icon);
  if(theme!=='default'&&['promo','news','pets'].includes(icon))assert.ok(source.includes('/'+theme+'/'));
 }
 assert.ok(html.indexOf('shared/lobby-menu-art.js')<html.indexOf('ui/cosmetics/league-appearance.js'));
});
