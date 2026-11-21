"use strict";
const activities = require("./event-activities");
const snapshots = new WeakMap();

// Progress can arrive after a manual stop. Resolve by the action timestamp,
// including stopped launches, rather than by current public availability.
// Cache only between the selected pack's boundaries. There is no TTL, timer,
// profile scan, persistence or reward mutation on this read path.
function findRunAt(manager, at, pack) {
  if (!manager?.data) return null;
  const data = manager.data, runs = data.runs;
  let snapshot = snapshots.get(data);
  if (!snapshot || snapshot.runs !== runs || snapshot.length !== runs.length ||
      snapshot.revision !== data.revision) {
    snapshot = { runs, length: runs.length, revision: data.revision, packs: new Map() };
    snapshots.set(data, snapshot);
  }
  const cached = snapshot.packs.get(pack);
  if (cached && at >= cached.from && at < cached.until) return cached.run;
  let from = -Infinity, until = Infinity, selected = null;
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    if (!activities.includes(run.manifest, pack)) continue;
    const end = run.stoppedAt ?? run.endsAt;
    if (end <= run.startsAt) continue; // cancelled before its scheduled start
    if (!selected && run.startsAt <= at && at < end) selected = run;
    for (const boundary of [run.startsAt, end]) {
      if (boundary <= at) from = Math.max(from, boundary);
      else until = Math.min(until, boundary);
    }
  }
  snapshot.packs.set(pack, { from, until, run: selected });
  return selected;
}
module.exports = { findRunAt };
