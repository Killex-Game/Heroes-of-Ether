"use strict";
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const layout=require('../../../public/shared/news-layout');
let releases;
function sources(events,at){
  if(!releases){const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../../public/shared/release-notes.js'),'utf8'),context,{timeout:100});releases=[context.window.KillexRelease,...(context.window.KillexReleaseArchive||[])];}
  return layout.sources(releases,events?.publicView(at),events?.publicScheduled(at));
}
module.exports={sources};
