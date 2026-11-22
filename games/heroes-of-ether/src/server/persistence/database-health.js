"use strict";
// Read-only diagnostic. No profile data, URI, writer ID or credentials in output.
function syncHealth(status, now = Date.now(), intervalMs = 30000) {
  const age = (time) => (Number.isFinite(time) && time > 0 && time <= now ? now - time : null);
  const syncAgeMs = age(status?.syncedAt);
  const checkAgeMs = age(status?.checkedAt);
  const lastError =
    typeof status?.lastError === "string" && /^[A-Z_0-9]{1,50}$/.test(status.lastError)
      ? status.lastError
      : status?.lastError
        ? "DATABASE_OPERATION_FAILED"
        : null;
  const staleAfterMs = intervalMs * 3;
  const state = !status
    ? "missing"
    : status.stopped
      ? "stopped"
      : !status.connected || lastError
        ? "error"
        : syncAgeMs === null ||
            checkAgeMs === null ||
            syncAgeMs > staleAfterMs ||
            checkAgeMs > staleAfterMs
          ? "stale"
          : "ok";
  return {
    state,
    syncAgeMs,
    checkAgeMs,
    staleAfterMs,
    lastError,
    revision: Number.isSafeInteger(status?.revision) ? status.revision : null,
    lastChangedDocuments: Number.isSafeInteger(status?.changedDocuments)
      ? status.changedDocuments
      : null,
    lastPayloadBytes: Number.isSafeInteger(status?.payloadBytes) ? status.payloadBytes : null,
  };
}
module.exports = { syncHealth };
