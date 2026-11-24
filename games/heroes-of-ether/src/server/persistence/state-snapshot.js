"use strict";
// No imports from the simulation. All hashing, file reads and network I/O run
// in the persistence worker (or in an explicitly offline deployment command).
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");



const { recover, segments, REVISION } = require("../profiles/profile-journal");
const AUXILIARY = ["game-events.json", "clan-chat.json"];
const chatStorage = require('./snapshot-chat');
const documentStorage = require('./snapshot-documents');

const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const hashCanonical = (value) =>
  createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
const hash = (value) => hashCanonical(canonical(value));
const object = (value) => !!value && typeof value === "object" && !Array.isArray(value);
function pack(world, auxiliary = {}, {chatFormat = 1, documentFormat = 1} = {}) {
  if (!object(world) || !object(world.profiles) || !object(world.clans))
    fail("DATABASE_INVALID_SNAPSHOT");
  const revision = world[REVISION] || 0;
  if (!Number.isSafeInteger(revision) || revision < 0) fail("DATABASE_INVALID_REVISION");
  if(documentFormat!==0&&documentFormat!==1)fail('DATABASE_INVALID_DOCUMENT_FORMAT');
  const docs = new Map(), logical = new Map();
  function add(id, value) {
    // A pending snapshot must survive retries even if its caller reuses objects.
    value = canonical(value);
    logical.set(id,value);
    documentStorage.store(id,value,docs,documentFormat);
  }
  for (const table of ["profiles", "clans"])
    for (const [key, value] of Object.entries(world[table])) add(`${table}:${key}`, value);
  add(
    "world",
    Object.fromEntries(
      Object.entries(world).filter(([key]) => !["profiles", "clans"].includes(key)),
    ),
  );
  if(chatFormat!==0 && chatFormat!==1)fail('DATABASE_INVALID_CHAT_FORMAT');
  for (const file of AUXILIARY)
    if (Object.hasOwn(auxiliary, file)) {
      if(file==='clan-chat.json' && chatFormat===1)chatStorage.packChat(auxiliary[file],add);
      else add(`aux:${file}`, auxiliary[file]);
    }
  const chatRevision=auxiliary['clan-chat.json']?.[REVISION]||0;
  if(!Number.isSafeInteger(chatRevision)||chatRevision<0)fail('DATABASE_INVALID_CHAT_REVISION');
  // Document values are already private, recursively ordered copies. Reuse
  // them for the world checksum instead of cloning every profile a second time.
  // Sorting each container preserves the exact legacy JSON bytes and digest.
  const orderedWorld=Object.fromEntries(Object.keys(world).sort().map(key=>[
    key, key==='profiles'||key==='clans'
      ? Object.fromEntries(Object.keys(world[key]).sort().map(id=>[id,logical.get(`${key}:${id}`)]))
      : logical.get('world')[key],
  ]));
  return {
    docs,
    revision,
    documentFormat,
    chatFormat,chatRevision,chatHash:hash(auxiliary['clan-chat.json']||null),
    worldHash: hashCanonical(orderedWorld),
    digest: hash(
      [...docs].map(([id, doc]) => [id, doc.hash]).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}
function unpack(documents, manifest) {
  const world = { profiles: {}, clans: {} },
    auxiliary = {}, chatShards=[];
  for(const doc of documents)if(hash(doc.value)!==doc.hash)fail('DATABASE_CHECKSUM_FAILED');
  for (const doc of documentStorage.restore(documents,manifest.documentFormat??0)) {
    if (doc._id === "world") Object.assign(world, doc.value);
    else if(doc._id.startsWith(chatStorage.PREFIX) && manifest.chatFormat===1)
      chatShards.push({id:doc._id,value:doc.value});
    else if (doc._id.startsWith("profiles:"))
      Object.defineProperty(world.profiles, doc._id.slice(9), {
        value: doc.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    else if (doc._id.startsWith("clans:"))
      Object.defineProperty(world.clans, doc._id.slice(6), {
        value: doc.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    else if (AUXILIARY.includes(doc._id.slice(4)) && doc._id.startsWith("aux:"))
      auxiliary[doc._id.slice(4)] = doc.value;
    else fail("DATABASE_UNKNOWN_DOCUMENT");
  }
  chatStorage.restoreChat(auxiliary,chatShards);
  const snapshot = pack(world, auxiliary,{chatFormat:manifest.chatFormat??0,documentFormat:manifest.documentFormat??0});
  if (
    snapshot.digest !== manifest.digest ||
    snapshot.worldHash !== manifest.worldHash ||
    snapshot.revision !== manifest.revision ||
    (manifest.chatRevision!==undefined && snapshot.chatRevision!==manifest.chatRevision) ||
    (manifest.chatHash!==undefined && snapshot.chatHash!==manifest.chatHash) ||
    snapshot.docs.size !== documents.length
  )
    fail("DATABASE_CHECKSUM_FAILED");
  return { world, auxiliary, snapshot, manifest };
}
function readLocal(dataDir, journal = false, profileSnapshot = null, packSnapshot = pack, readPinned = null) {
  const file = path.join(dataDir, "profiles.json");
  let world;
  if (profileSnapshot) {
    const saved = readPinned ? readPinned(profileSnapshot) : recover(profileSnapshot.file, false);
    if (!Number.isSafeInteger(profileSnapshot.revision) || saved.revision !== profileSnapshot.revision)
      fail("DATABASE_INVALID_REVISION");
    world = saved.data;
  } else world = journal ? recover(file).data : JSON.parse(fs.readFileSync(file, "utf8"));
  const auxiliary = {};
  for (const name of AUXILIARY) {
    const source = path.join(dataDir, name);
    if (journal && name === 'clan-chat.json' &&
      (fs.existsSync(source) || fs.existsSync(source+'.wal') || segments(source).length)) {
      const saved = recover(source);
      if (fs.existsSync(source) || saved.revision) auxiliary[name] = saved.data;
    } else if (fs.existsSync(source)) auxiliary[name] = JSON.parse(fs.readFileSync(source, "utf8"));
  }
  return { world, auxiliary, snapshot: packSnapshot(world, auxiliary) };
}
// Offline verification/export compare every logical value after each reader
// has verified its own stored checksums. Chat sharding changes document IDs and
// the storage digest, even when the entire world and chat are unchanged.
function sameContents(left, right) {
  return hash(left.world) === hash(right.world) && hash(left.auxiliary) === hash(right.auxiliary);
}

module.exports={pack,unpack,hash,canonical,readLocal,sameContents,AUXILIARY};
