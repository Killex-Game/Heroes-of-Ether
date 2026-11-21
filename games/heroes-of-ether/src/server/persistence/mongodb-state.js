"use strict";
// No imports from the simulation. All hashing, file reads and network I/O run
// in the persistence worker (or in an explicitly offline deployment command).
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require('node:util');
const { MongoClient } = require("mongodb");
const { credentials } = require("./mongodb-config");
const { recover, segments, REVISION } = require("../profiles/profile-journal");
const AUXILIARY = ["game-events.json", "clan-chat.json"];
const chatStorage = require('./mongodb-chat');
const documentStorage = require('./mongodb-documents');
const TX = {
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
  readPreference: "primary",
  timeoutMS: 20000,
};
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
    fail("MONGO_INVALID_SNAPSHOT");
  const revision = world[REVISION] || 0;
  if (!Number.isSafeInteger(revision) || revision < 0) fail("MONGO_INVALID_REVISION");
  if(documentFormat!==0&&documentFormat!==1)fail('MONGO_INVALID_DOCUMENT_FORMAT');
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
  if(chatFormat!==0 && chatFormat!==1)fail('MONGO_INVALID_CHAT_FORMAT');
  for (const file of AUXILIARY)
    if (Object.hasOwn(auxiliary, file)) {
      if(file==='clan-chat.json' && chatFormat===1)chatStorage.packChat(auxiliary[file],add);
      else add(`aux:${file}`, auxiliary[file]);
    }
  const chatRevision=auxiliary['clan-chat.json']?.[REVISION]||0;
  if(!Number.isSafeInteger(chatRevision)||chatRevision<0)fail('MONGO_INVALID_CHAT_REVISION');
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
  for(const doc of documents)if(hash(doc.value)!==doc.hash)fail('MONGO_CHECKSUM_FAILED');
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
    else fail("MONGO_UNKNOWN_DOCUMENT");
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
    fail("MONGO_CHECKSUM_FAILED");
  return { world, auxiliary, snapshot, manifest };
}
function readLocal(dataDir, journal = false) {
  const file = path.join(dataDir, "profiles.json");
  const world = journal ? recover(file).data : JSON.parse(fs.readFileSync(file, "utf8"));
  const auxiliary = {};
  for (const name of AUXILIARY) {
    const source = path.join(dataDir, name);
    if (journal && name === 'clan-chat.json' &&
      (fs.existsSync(source) || fs.existsSync(source+'.wal') || segments(source).length)) {
      const saved = recover(source);
      if (fs.existsSync(source) || saved.revision) auxiliary[name] = saved.data;
    } else if (fs.existsSync(source)) auxiliary[name] = JSON.parse(fs.readFileSync(source, "utf8"));
  }
  return { world, auxiliary, snapshot: pack(world, auxiliary) };
}
// Offline verification/export compare every logical value after each reader
// has verified its own stored checksums. Chat sharding changes document IDs and
// the storage digest, even when the entire world and chat are unchanged.
function sameContents(left, right) {
  return hash(left.world) === hash(right.world) && hash(left.auxiliary) === hash(right.auxiliary);
}
// Arrays and unsafe dotted keys are replaced at their nearest safe parent.
// Unchanged archives/receipts are never retransmitted for a wallet increment.
function fieldPatch(before, after, prefix = "value", patch = { $set: {}, $unset: {} }) {
  // Documents are already canonical, checksum-verified private values. Comparing
  // each branch must not canonicalize/copy/hash its whole history again.
  if (isDeepStrictEqual(before, after)) return patch;
  if (
    object(before) &&
    object(after) &&
    [...Object.keys(before), ...Object.keys(after)].every((key) => key && !/[.$\0]/.test(key))
  ) {
    for (const key of Object.keys(before))
      if (!Object.hasOwn(after, key)) patch.$unset[`${prefix}.${key}`] = "";
    for (const key of Object.keys(after)) {
      if (!Object.hasOwn(before, key)) patch.$set[`${prefix}.${key}`] = after[key];
      else fieldPatch(before[key], after[key], `${prefix}.${key}`, patch);
    }
  } else patch.$set[prefix] = after;
  return patch;
}
function changes(previous, next) {
  const operations = [];
  for (const [id, doc] of next.docs) {
    const old = previous?.docs.get(id);
    if (old?.hash === doc.hash && !!old.chunked === !!doc.chunked) continue;
    if (!old) operations.push({ insertOne: { document: doc } });
    else {
      const update = fieldPatch(old.value, doc.value);
      update.$set.hash = doc.hash;
      if(doc.chunked)update.$set.chunked=true;
      else if(old.chunked)update.$unset.chunked='';
      if (!Object.keys(update.$unset).length) delete update.$unset;
      operations.push({ updateOne: { filter: { _id: id }, update } });
    }
  }
  for (const id of previous?.docs.keys() || [])
    if (!next.docs.has(id)) operations.push({ deleteOne: { filter: { _id: id } } });
  return operations;
}
function assertCompatible(remote, local, sourceId) {
  if (!remote || remote.version !== 1 || remote.sourceId !== sourceId)
    fail("MONGO_SOURCE_MISMATCH");
  if (local.revision < remote.revision) fail("MONGO_CLOUD_AHEAD");
  if (local.revision === remote.revision && local.worldHash !== remote.worldHash)
    fail("MONGO_DIVERGED");
  if(local.chatRevision<(remote.chatRevision||0))fail('MONGO_CHAT_CLOUD_AHEAD');
  if(remote.chatHash && local.chatRevision===remote.chatRevision && local.chatHash!==remote.chatHash)
    fail('MONGO_CHAT_DIVERGED');
}
class MongoState {
  constructor(config) {
    this.config = config;
    this.writer = config.writerId || randomUUID();
    const uri = credentials(config.credentialsFile);
    const connection = {
      monitorCommands: false,
      maxPoolSize: 3,
      minPoolSize: 0,
      maxIdleTimeMS: 60000,
      waitQueueTimeoutMS: 15000,
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 20000,
      appName: "HeroEther-persistence",
    };
    this.client = new MongoClient(uri, connection);
    // Cursor getMore uses connection-level socket options. A separate cold
    // reader permits slow transfers without extending live write timeouts.
    this.reader = new MongoClient(uri, { ...connection, maxPoolSize: 1,
      socketTimeoutMS: 120000, compressors: ['zlib'], zlibCompressionLevel: 1 });
    this.db = this.client.db(config.database);
    this.metrics = require('./mongodb-metrics').observeMongo(this.client);
    this.state = this.metrics.collection(this.db.collection("state"));
    this.meta = this.metrics.collection(this.db.collection("metadata"));
    const readDb = this.reader.db(config.database);
    this.readState = readDb.collection('state');
    this.readMeta = this.metrics.collection(readDb.collection('metadata'));
  }
  async transaction(fn) {
    const session = this.client.startSession();
    try {
      return await session.withTransaction(() => fn(session), TX);
    } finally {
      await session.endSession();
    }
  }
  async read() {
    // All state writes atomically advance the manifest generation. Majority
    // reads in one causal session, fenced by identical manifests before/after,
    // are accepted only if no writer changed the snapshot during the cursor.
    // This avoids both transaction lifetime and snapshot-history expiration
    // on slow cold transfers. A concurrent change fails closed, never mixes
    // revisions. acquire() separately CAS-checks this generation and lease.
    const session = this.reader.startSession({ causalConsistency: true });
    const options = { session, readPreference: 'primary', readConcern: { level: 'majority' },
      maxTimeMS: 540000, signal: AbortSignal.timeout(540000) };
    let manifest;
    const documents = [];
    try {
      await this.reader.connect();
      manifest = await this.readMeta.findOne({ _id: "state" }, options);
      if (!manifest) fail("MONGO_NOT_INITIALIZED");
      // One completed cursor read, regardless of its internal wire batches.
      await this.metrics.run('read',async()=>{
        for await (const document of this.readState.find({}, { ...options, batchSize: 100 }))
          documents.push(document);
      });
      const after = await this.readMeta.findOne({ _id: 'state' }, options);
      if (!isDeepStrictEqual(manifest, after)) fail('MONGO_CONCURRENT_READ');
    } finally {
      try { await session.endSession(); } finally { await this.reader.close(); }
    }
    // The unchanged generation fences every cursor batch. Hashing the result
    // needs no open session and must not consume its network deadline.
    // Keep every checksum/revision check before returning the verified world.
    return unpack(documents, manifest);
  }
  async initialize(snapshot) {
    // Explicit offline migration into an empty, separately named game database.
    if ((await this.db.listCollections({}, { nameOnly: true }).toArray()).length)
      fail("MONGO_DATABASE_NOT_EMPTY");
    await this.db.createCollection("state");
    await this.db.createCollection("metadata");
    const manifest = {
      _id: "state",
      version: 1,
      sourceId: this.config.sourceId,
      generation: 1,
      revision: snapshot.revision,
      documentFormat:snapshot.documentFormat,
      chatFormat:snapshot.chatFormat,chatRevision:snapshot.chatRevision,chatHash:snapshot.chatHash,
      digest: snapshot.digest,
      worldHash: snapshot.worldHash,
      updatedAt: new Date(),
    };
    await this.transaction(async (session) => {
      await this.state.insertMany([...snapshot.docs.values()], { session });
      await this.meta.insertOne(manifest, { session });
    });
    const verified = await this.read();
    if (verified.snapshot.digest !== snapshot.digest) fail("MONGO_CHECKSUM_FAILED");
    return verified;
  }
  async acquire(local) {
    const remote = await this.read();
    assertCompatible(remote.manifest, local, this.config.sourceId);
    const now = new Date();
    const result = await this.meta.updateOne(
      {
        _id: "state",
        generation: remote.manifest.generation,
        sourceId: this.config.sourceId,
        $or: [
          { leaseUntil: { $lt: now } },
          { leaseUntil: { $exists: false } },
          { writer: this.writer },
        ],
      },
      { $set: { writer: this.writer, leaseUntil: new Date(now.getTime() + 120000) } },
    );
    if (result.matchedCount !== 1) fail("MONGO_WRITER_BUSY");
    this.previous = remote.snapshot;
    this.manifest = remote.manifest;
    return { revision: remote.manifest.revision, generation: remote.manifest.generation };
  }
  async sync(next) {
    if (this.pending && this.pending.digest !== next.digest) await this.sync(this.pending);
    assertCompatible(this.manifest, next, this.config.sourceId);
    this.pending = next;
    const operations = changes(this.previous, next);
    const base = this.manifest;
    const updated = {
      ...base,
      generation: base.generation + 1,
      revision: next.revision,
      documentFormat:next.documentFormat,
      chatFormat:next.chatFormat,chatRevision:next.chatRevision,chatHash:next.chatHash,
      digest: next.digest,
      worldHash: next.worldHash,
      updatedAt: new Date(),
    };
    // Reconcile a committed transaction whose acknowledgement was lost. Never
    // replay grants: snapshots contain both balances and idempotency receipts.
    await this.transaction(async (session) => {
      const current = await this.meta.findOne({ _id: "state" }, { session });
      if (current?.sourceId !== this.config.sourceId || current.writer !== this.writer)
        fail("MONGO_WRITER_LOST");
      if (
        current.generation === updated.generation &&
        current.digest === next.digest &&
        current.revision === next.revision
      )
        return;
      if (current.generation !== base.generation) fail("MONGO_CONCURRENT_WRITE");
      if (operations.length) await this.state.bulkWrite(operations, { session, ordered: true });
      const result = await this.meta.updateOne(
        { _id: "state", generation: base.generation, writer: this.writer },
        {
          $set: {
            generation: updated.generation,
            revision: updated.revision,
            documentFormat:updated.documentFormat,
            chatFormat:updated.chatFormat,chatRevision:updated.chatRevision,chatHash:updated.chatHash,
            digest: updated.digest,
            worldHash: updated.worldHash,
            updatedAt: updated.updatedAt,
            leaseUntil: new Date(Date.now() + 120000),
          },
        },
        { session },
      );
      if (result.matchedCount !== 1) fail("MONGO_CONCURRENT_WRITE");
    });
    this.previous = next;
    this.manifest = updated;
    this.pending = null;
    return {
      revision: next.revision,
      generation: updated.generation,
      changedDocuments: operations.length,
      payloadBytes: Buffer.byteLength(JSON.stringify(operations)),
      syncedAt: Date.now(),
    };
  }
  async close() {
    try {
      if (this.manifest)
        await this.meta.updateOne(
          { _id: "state", writer: this.writer },
          { $unset: { writer: "", leaseUntil: "" } },
          { timeoutMS: 5000 },
        );
    } finally {
      try { await this.client.close(); } finally { await this.reader.close(); }
    }
  }
}
module.exports = {
  MongoState,
  pack,
  unpack,
  readLocal,
  sameContents,
  changes,
  fieldPatch,
  assertCompatible,
  hash,
  AUXILIARY,
};
