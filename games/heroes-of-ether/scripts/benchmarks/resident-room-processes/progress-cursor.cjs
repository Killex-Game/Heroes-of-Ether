"use strict";
// A bounded receipt window supplements the permanent committed sequence. An
// evicted result is UNKNOWN, never permission to execute an old sequence again.
const RECEIPT_WINDOW = 64;
function replayStatus(cursor, sequence, digest) {
  if (sequence > cursor.sequence) return null;
  const receipt = sequence === cursor.sequence ? cursor : cursor.receipts?.find(r => r.sequence === sequence);
  if (!receipt) return Object.assign(Error('Committed progress result no longer available'), { code: 'RESULT_EXPIRED' });
  return receipt.digest === digest ? true : Object.assign(Error('Conflicting room replay'), { code: 'REPLAY_CONFLICT' });
}
function advance(cursor, epoch, sequence, digest) {
  if (cursor.epoch !== epoch || sequence !== cursor.sequence + 1) throw Error('Room progress gap or stale epoch');
  const receipts = cursor.receipts || (cursor.sequence ? [{ sequence: cursor.sequence, digest: cursor.digest }] : []);
  return { epoch, sequence, digest, receipts: [...receipts.slice(-(RECEIPT_WINDOW - 1)), { sequence, digest }] };
}
module.exports = { RECEIPT_WINDOW, replayStatus, advance };
