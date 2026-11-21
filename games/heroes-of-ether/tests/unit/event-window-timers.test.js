"use strict";
const test = require("node:test"), assert = require("node:assert/strict"),
  fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");

// Exercise the actual window controllers with a deterministic scheduler. This
// verifies background work; visual layout/FPS still need browser scenarios.
for (const [file, exported] of [
  ["easter-hunt-page", "KillexEasterPage"],
  ["black-friday", "KillexBlackFriday"],
  ["events-page", "KillexEventsPage"],
]) test(`${file}: hidden window does no periodic rendering or profile requests`, () => {
  const intervals = new Map(), listeners={}, micro=[], document = { hidden: false,documentElement:{},addEventListener:(name,fn)=>listeners[name]=fn }, window = {
    KillexWindows: { open: dialog => { dialog.open = true; } },
  };
  let id = 0, renders = 0, requests = 0;
  const context=vm.createContext({window,document,addEventListener(){},MutationObserver:class{observe(){}},
    queueMicrotask:fn=>micro.push(fn),setTimeout:fn=>{intervals.set(++id,fn);return id;},clearTimeout:key=>intervals.delete(key)});
  const flush=()=>{while(micro.length)micro.shift()();};
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../public/shared/activity-scheduler.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../../public/ui/progression", file + ".js"), "utf8"), context);
  const controller = Object.assign(Object.create(window[exported].prototype), {
    owner: { isLobby: () => true, loadProfile: () => requests++ },
    dialog: { open: false }, message: {}, notice: {}, select: () => {},
    syncMotion: () => {}, layout: () => {},
    render: () => renders++, sync: () => renders++, update: () => renders++,
  });
  controller.open();
  controller.open(); // reopening replaces the old timer rather than accumulating it
  flush();
  assert.equal(intervals.size, 1);
  const initial = { renders, requests };
  document.hidden = true;
  listeners.visibilitychange();flush();assert.equal(intervals.size,0);
  for (let i = 0; i < 120; i++) for (const tick of intervals.values()) tick();
  assert.deepEqual({ renders, requests }, initial);
  document.hidden = false;
  listeners.visibilitychange();flush();
  for (let i = 0; i < 30; i++) {const [key,tick]=[...intervals][0];intervals.delete(key);tick();flush();}
  assert.equal(renders, initial.renders + 30);
  assert.equal(requests, initial.requests + 1);
  controller.dialog.open=false;window.KillexActivity.sync();flush();assert.equal(intervals.size,0);
});
