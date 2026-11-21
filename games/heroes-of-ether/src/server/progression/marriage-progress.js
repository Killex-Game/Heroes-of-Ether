"use strict";
const stages = require("./achievement-stages");
const IDS = new Set(["strong_love", "always_together", "loving", "valuable"]);

// Only in the private atomic draft of a marriage transition. Completed degrees
// and their rewards remain earned; only the current degree starts over.
function reset(profile, events, at) {
  const { EXTRA_ACHIEVEMENTS } = require("./activity-achievements"), state = profile.activity;
  stages.ensure(state, EXTRA_ACHIEVEMENTS, d => state.values[d.id]);
  for (const d of EXTRA_ACHIEVEMENTS) if (IDS.has(d.id) && state.claimed[d.id] < d.thresholds.length)
    state.values[d.id] = state.stageSpent[d.id];
  delete state.socialCalendar;
  // The legacy gift-history repair must not restore discarded progress after
  // restart or a same-day marriage with the same person.
  state.marriageProgressVersion = 1;
  const lucky = require("../events/lucky-week"), run = lucky.runAt(events, at);
  const eventState = run && profile.eventAchievements?.[run.id];
  if (eventState) {
    const definition = lucky.achievements.find(d => d.id === "lucky_marriage_games");
    stages.ensure(eventState, lucky.achievements, d => eventState.values[d.id] || 0);
    if ((eventState.claimed[definition.id] || 0) < definition.thresholds.length &&
        Object.hasOwn(eventState.values, definition.id))
      eventState.values[definition.id] = eventState.stageSpent[definition.id];
  }
  if (profile.progress.session) delete profile.progress.session.luckyLevel;
  if (profile.progress.lastLife) delete profile.progress.lastLife.pendingEventLevel;
}
module.exports = { reset };
