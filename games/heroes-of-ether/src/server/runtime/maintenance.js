"use strict";
const fs = require("node:fs");
const {selected,modes}=require('../admin/service-availability');
class Maintenance {
  constructor({ filePath = null, now = Date.now } = {}) {
    this.filePath = filePath;
    this.now=now;this.manual = !!filePath && fs.existsSync(filePath);
    this.last='';this.held=null;
    this.timer = filePath ? setInterval(() => this.refresh(), 1000) : null;
    this.timer?.unref();
  }
  async refresh() {
    if (!this.filePath) {this.refreshState();return;}
    if (this.checking) return;
    this.checking = true;
    try {
      await fs.promises.access(this.filePath);
      this.manual=true;
    } catch (e) {
      this.manual=e.code!=="ENOENT";
    } finally {
      this.checking = false;
    }
    this.refreshState();
  }
  bind(provider){this.provider=provider;this.refreshState();}
  desired(){return this.automatic?.length?{mode:'failure',startsAt:this.failureAt,endsAt:null}:this.manual?{mode:'maintenance',startsAt:null,endsAt:null}:selected(this.provider?.(),this.now());}
  setFailure(faults){
    const next=[...new Set(faults)].sort();if(JSON.stringify(next)===JSON.stringify(this.automatic||[]))return;
    if(next.length&&!this.automatic?.length)this.failureAt=this.now();this.automatic=next;this.refreshState();
  }
  get active(){return !!(this.held||this.desired());}
  hold(){this.held=this.desired()||this.held||{mode:'maintenance',startsAt:null,endsAt:null};}
  release(){this.held=null;this.refreshState();}
  set(active) {
    this.manual=!!active;this.refreshState();
  }
  refreshState(){
    const status=this.status(),key=JSON.stringify([status.maintenance,status.mode,status.startsAt,status.endsAt]);
    if(key!==this.last){this.last=key;this.onChange?.(status);}
    if(!this.filePath&&!this.closed){
      const needed=(this.provider?.()?.windows||[]).some(w=>w.enabled&&w.endsAt>this.now());
      if(needed&&!this.timer){this.timer=setInterval(()=>this.refreshState(),1000);this.timer.unref();}
      if(!needed&&this.timer){clearInterval(this.timer);this.timer=null;}
    }
  }
  status(closing = false) {
    const window=this.desired()||this.held||(closing?{mode:'maintenance'}:null);
    const mode=modes.find(m=>m.id===window?.mode);
    return {
      maintenance: !!window,mode:mode?.id||null,title:mode?.title||null,
      message: mode?.id==='maintenance'?"Устанавливаем обновление игры. Вход временно закрыт.":mode?.title||'',
      startsAt:window?.startsAt??null,endsAt:window?.endsAt??null,draining:!!this.held,serverNow:this.now(),
      automatic:!!this.automatic?.length,
      retryAfter: 3,
    };
  }
  close() {
    this.closed=true;
    clearInterval(this.timer);
    this.timer=null;
    this.onChange = null;
  }
}
module.exports = { Maintenance };
