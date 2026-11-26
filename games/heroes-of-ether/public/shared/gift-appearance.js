/* Temporary appearance: active sets replace the portrait; equipped skin stays saved. */
(function(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexGiftAppearance = api;
})(typeof window !== "undefined" ? window : globalThis, root => {
  "use strict";
  const paths = Object.freeze({hex:"assets/skins/negative-sets-v3/1024/hex-witch.webp", infection:"assets/skins/negative-sets-v3/1024/infection-zombie.webp", curse:"assets/skins/negative-sets-v2/1024/curse-pig.webp"});
  function selected(ends, at = Date.now()) {
    for (const id of ["curse", "infection", "hex"]) if (ends?.[id] > at) return id;
    return "";
  }
  const images = new Map();
  function image(id) {
    if (!Object.hasOwn(paths,id) || !root.Image) return null;
    if (!images.has(id)) { const img = new root.Image(); img.src = paths[id]; images.set(id,img); }
    const img = images.get(id);
    return img.complete && img.naturalWidth ? img : null;
  }
  function draw(ctx, id, img, size) {
    if (!img) return;
    ctx.drawImage(img,0,0,size,size);
  }
  const records = new WeakMap(), watched = new Set(); let timer;
  function refresh(host, record) {
    const id=selected(record.ends);
    if (host.dataset.giftVisual === id) return !!id;
    host.dataset.giftVisual=id;
    let overlay=host.querySelector(":scope > .gift-avatar-overlay");
    if (!id) { overlay?.remove(); return false; }
    if (!overlay) { overlay=document.createElement("img"); overlay.className="gift-avatar-overlay";overlay.alt="";overlay.draggable=false;host.append(overlay); }
    overlay.src=paths[id]; return true;
  }
  function tick() {
    timer=null;
    for(const ref of watched) { const host=ref.deref(),record=host&&records.get(host); if(!host?.isConnected||!record||!refresh(host,record))watched.delete(ref); }
    schedule();
  }
  function schedule() { if(!timer && watched.size && !document.hidden)timer=setTimeout(tick,1000); }
  function bind(host, profile) {
    if (!host) return;
    let record=records.get(host);
    if(!record){record={ref:new WeakRef(host)};records.set(host,record);}
    record.ends=profile?.giftAppearance;
    if(refresh(host,record)){watched.add(record.ref);schedule();}else watched.delete(record.ref);
  }
  if(root.document) {
    document.addEventListener("visibilitychange",()=>{clearTimeout(timer);timer=null;if(!document.hidden)tick();});
    document.addEventListener("killex:profile",event=>{for(const id of ["lobbySkin","profileSkin"])bind(document.getElementById(id)?.parentElement,event.detail);});
    root.addEventListener("pagehide",()=>{clearTimeout(timer);timer=null;});
    root.addEventListener("pageshow",()=>{if(watched.size)tick();});
  }
  return Object.freeze({selected, image, draw, bind});
});
