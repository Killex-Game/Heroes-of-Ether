/* Порог и накопленный прогресс отдельных степеней достижений. */
"use strict";
// A degree consumes its full target. Legacy rewards remain earned; their next
// degree starts after the last completed target, without taking rewards back.
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
function ensure(state, definitions, value) {
  if (state.stageSpent === undefined)
    state.stageSpent = Object.fromEntries(
      definitions.map((d) => {
        const claimed = state.claimed[d.id] || 0;
        return [d.id, Math.min(value(d), claimed ? d.thresholds[claimed - 1] : 0)];
      }),
    );
  return state.stageSpent;
}
function validate(state, definitions, value) {
  if (state.stageSpent === undefined) return;
  if (
    !state.stageSpent ||
    Array.isArray(state.stageSpent) ||
    definitions.some((d) => !integer(state.stageSpent[d.id]) || state.stageSpent[d.id] > value(d))
  )
    throw Error("Повреждён прогресс степеней достижений.");
}
function current(state, d, total) {
  if (d.exception === true) return total;
  if (state.claimed[d.id] >= d.thresholds.length) return d.thresholds.at(-1);
  const spent =
    state.stageSpent?.[d.id] ??
    (state.claimed[d.id] || 0 ? d.thresholds[state.claimed[d.id] - 1] : 0);
  return Math.max(0, total - spent);
}
function consume(state, d) {
  if (d.exception !== true) state.stageSpent[d.id] += d.thresholds[state.claimed[d.id] || 0];
}
function reset(state, id) {
  if (state.stageSpent) state.stageSpent[id] = 0;
}
module.exports = { ensure, validate, current, consume, reset };
