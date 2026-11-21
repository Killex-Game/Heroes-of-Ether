"use strict";
// Experimental recovery planner. No wallet/profile writes happen here.
// Coordinator requirements: fence admission/IPC before opening the exclusively
// locked journal; apply the returned progress, cast outcomes and watermark in
// ONE durable profile commit; only then acknowledge/close the old epoch.
const { RoomOutbox } = require("./room-outbox");
const validSequence = value => Number.isSafeInteger(value) && value >= 0;
function planRoomRecovery(outbox, receiver, transactions, profileIds) {
  if (!(outbox instanceof RoomOutbox) || !outbox.recoveryOnly || outbox.closed || outbox.fault || outbox.pending)
    throw Error("Recovery requires an exclusively opened existing room journal");
  if (!receiver || receiver.roomId !== outbox.roomId || receiver.epoch !== outbox.epoch ||
      !validSequence(receiver.sequence) || receiver.sequence < outbox.ackSequence || receiver.sequence > outbox.sequence)
    throw Error("Room recovery watermark or epoch differs");
  if (!Array.isArray(transactions) || !Array.isArray(profileIds) || !profileIds.length ||
      new Set(profileIds).size !== profileIds.length) throw Error("Invalid room recovery ownership");
  const profiles = new Set(profileIds), records = new Map();
  for (const tx of transactions) {
    if (!tx || records.has(tx.txId) || typeof tx.txId !== "string" || !tx.txId ||
        tx.roomId !== outbox.roomId || tx.epoch !== outbox.epoch || !profiles.has(tx.profileId) ||
        !["RESERVED", "APPLIED", "REFUNDED"].includes(tx.status)) throw Error("Invalid room recovery transaction");
    records.set(tx.txId, tx);
  }
  const entries = outbox.list(), applied = new Map(), frames = [];
  let lastSequence = outbox.ackSequence, prefixDigest = outbox.ackDigest;
  for (const entry of entries) {
    const frame = entry.frame;
    if (frame.sequence !== ++lastSequence) throw Error("Room recovery journal has a gap");
    for (const event of frame.progress) if (!profiles.has(event?.profileId))
      throw Error("Unowned recovered progress");
    for (const [casts,status] of [[frame.applied,'APPLIED'],[frame.cancelled || [],'REFUNDED']])for(const cast of casts) {
      const tx = records.get(cast.txId);
      if (applied.has(cast.txId) || !tx || tx.profileId !== cast.profileId ||
          tx.lifeId !== cast.lifeId || tx.boosterId !== cast.boosterId || (tx.status !== 'RESERVED' && tx.status !== status))
        throw Error("Conflicting recovered room cast");
      if (frame.sequence <= receiver.sequence && tx.status !== status)
        throw Error("Acknowledged progress has an unresolved cast");
      applied.set(cast.txId,status);
    }
    if (frame.sequence === receiver.sequence) prefixDigest = entry.digest;
    if (frame.sequence > receiver.sequence) frames.push(entry);
  }
  if (lastSequence !== outbox.sequence || receiver.digest !== prefixDigest)
    throw Error("Room recovery prefix checksum differs");
  const outcomes = [];
  for (const tx of transactions) if (tx.status === "RESERVED") outcomes.push({
    txId: tx.txId, status: applied.get(tx.txId) || "REFUNDED",
  });
  return {
    roomId: outbox.roomId, epoch: outbox.epoch, frames, outcomes,
    watermark: { sequence: outbox.sequence, digest: entries.at(-1)?.digest ?? outbox.ackDigest },
  };
}
module.exports = { planRoomRecovery };
