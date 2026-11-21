"use strict";
// Internal presentation transport only. Float64 preserves the simulation's
// exact numbers. Unknown layouts keep the original structured-clone path.
const numeric = ["x", "y", "mass", "radius", "mergeVersion", "mergeMs", "burnMs"];
const plainKeys = ["id", ...numeric];
const birthKeys = ["id", ...numeric.slice(0, 5), "birth", ...numeric.slice(5)];
function canonical(part) {
  const keys = Object.keys(part), expected = Object.hasOwn(part, "birth") ? birthKeys : plainKeys;
  if (keys.length !== expected.length) return false;
  for (let i = 0; i < keys.length; i++) if (keys[i] !== expected[i]) return false;
  for (const key of numeric) if (typeof part[key] !== "number") return false;
  return typeof part.id === "string";
}
function packPlayers(players) {
  let count = 0;
  const eligible = players.map(player => {
    const parts = player.parts;
    const pack = Array.isArray(parts) && parts.length >= 4 && parts.every(canonical);
    if (pack) count += parts.length;
    return pack;
  });
  if (!count) return { players, partValues: null };
  const partValues = new Float64Array(count * 7);
  let offset = 0;
  const packed = players.map((player, i) => {
    if (!eligible[i]) return player;
    const parts = { offset, ids: [], births: [] };
    for (const part of player.parts) {
      if (Object.hasOwn(part, "birth")) parts.births.push([parts.ids.length, part.birth]);
      parts.ids.push(part.id);
      partValues[offset++] = part.x;
      partValues[offset++] = part.y;
      partValues[offset++] = part.mass;
      partValues[offset++] = part.radius;
      partValues[offset++] = part.mergeVersion;
      partValues[offset++] = part.mergeMs;
      partValues[offset++] = part.burnMs;
    }
    return { ...player, parts };
  });
  return { players: packed, partValues };
}
function unpackPlayers(players, values) {
  if (values == null) return players;
  if (!(values instanceof Float64Array)) throw Error("Invalid worker parts");
  let consumed = 0;
  const result = players.map(player => {
    if (player.parts == null || Array.isArray(player.parts)) return player;
    const packed = player.parts;
    if (!packed || packed.offset !== consumed || !Array.isArray(packed.ids) ||
        !Array.isArray(packed.births) || consumed + packed.ids.length * 7 > values.length)
      throw Error("Invalid worker part range");
    let birthIndex = 0;
    const parts = packed.ids.map((id, i) => {
      const part = { id, x: values[consumed++], y: values[consumed++],
        mass: values[consumed++], radius: values[consumed++], mergeVersion: values[consumed++] };
      if (packed.births[birthIndex]?.[0] === i) part.birth = packed.births[birthIndex++][1];
      part.mergeMs = values[consumed++]; part.burnMs = values[consumed++];
      return part;
    });
    if (birthIndex !== packed.births.length) throw Error("Invalid worker part birth");
    return { ...player, parts };
  });
  if (consumed !== values.length) throw Error("Unused worker part coordinates");
  return result;
}
module.exports = { packPlayers, unpackPlayers };
