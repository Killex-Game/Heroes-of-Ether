"use strict";

// Internal worker transport only. Float64 keeps the exact simulation values;
// protocol encoding, per-client visibility and ACK histories stay unchanged.
const fields = ["x", "y", "mass", "radius", "mergeVersion", "mergeMs", "burnMs"];
const plainKeys = "id,x,y,mass,radius,mergeVersion,mergeMs,burnMs";
const birthKeys = "id,x,y,mass,radius,mergeVersion,birth,mergeMs,burnMs";
function packState(snapshot) {
  const count = (snapshot.players || []).reduce((n, p) => n + (p.parts?.length || 0), 0);
  if (count < 64) return { snapshot };
  const values = new Float64Array(count * fields.length), rows = [], births = [];
  let packed = 0;
  const players = snapshot.players.map(player => {
    if (!Array.isArray(player.parts)) return player;
    const start = rows.length;
    for (const part of player.parts) {
      const keys = Object.keys(part).join(","), ordinal = rows.length;
      if (typeof part.id !== "string" || (keys !== plainKeys && keys !== birthKeys) ||
          fields.some(key => typeof part[key] !== "number")) {
        // Future/legacy fields are copied intact instead of silently dropped.
        rows.push(part);
        continue;
      }
      rows.push(part.id);
      for (let i = 0; i < fields.length; i++) values[ordinal * fields.length + i] = part[fields[i]];
      if (keys === birthKeys) births.push(ordinal, part.birth);
      packed++;
    }
    return { ...player, parts: [start, rows.length] };
  });
  if (!packed) return { snapshot };
  return { snapshot: { ...snapshot, players }, partData: { values, rows, births } };
}
function unpackState(group) {
  if (!group.partData) return group.snapshot;
  const { values, rows, births } = group.partData;
  let birthIndex = 0;
  const decoded = rows.map((row, ordinal) => {
    if (typeof row !== "string") return row;
    const offset = ordinal * fields.length;
    const part = { id: row, x: values[offset], y: values[offset + 1], mass: values[offset + 2],
      radius: values[offset + 3], mergeVersion: values[offset + 4] };
    if (births[birthIndex] === ordinal) {
      part.birth = births[birthIndex + 1];
      birthIndex += 2;
    }
    part.mergeMs = values[offset + 5];
    part.burnMs = values[offset + 6];
    return part;
  });
  for (const player of group.snapshot.players)
    if (Array.isArray(player.parts)) player.parts = decoded.slice(player.parts[0], player.parts[1]);
  return group.snapshot;
}
module.exports = { packState, unpackState };
