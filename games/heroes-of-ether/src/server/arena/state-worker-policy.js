"use strict";
// Resource limits, not gameplay rules. Memory values are MiB; deadlines are ms.
const STATE_WORKER_LIMITS = Object.freeze({
  MAX_WORKERS: 8,
  DEFAULT_MAX_ROOMS: 3,
  TIMEOUT_MS: 2000,
  OLD_GENERATION_MB: 128,
  YOUNG_GENERATION_MB: 32,
});
module.exports = { STATE_WORKER_LIMITS };
