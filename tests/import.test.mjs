import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatSuccessDiceRatio,
  summarizeRolls,
  validateState,
} from "../core.js";

const state = validateState(JSON.parse(
  readFileSync(new URL("../vtm-role-recorder-import.json", import.meta.url), "utf8"),
));

test("episode backup retains source dice and separates Damage and Health records", () => {
  const all = summarizeRolls(state.participants, state.sessions.flatMap((session) => session.rolls));
  assert.equal(state.sessions.length, 45);
  assert.equal(state.sessions.find((session) => session.name === "EP43").rolls.length, 0);
  assert.equal(all.totals.sourceDice, 5590);
  assert.equal(all.totals.dice, 5586);
  assert.equal(all.totals.sourceSuccesses, 3018);
  assert.equal(all.totals.damage, 15);
  assert.equal(all.totals.healthChange, -13);
  assert.equal(
    state.sessions.flatMap((session) => session.rolls).filter((roll) => roll.type === "damage").length,
    6,
  );
  assert.equal(
    state.sessions.flatMap((session) => session.rolls)
      .filter((roll) => roll.type === "resource" && roll.resource === "health").length,
    7,
  );
});

test("EP45 Josh totals match the episode sheet DICE/SUCCESS statistic", () => {
  const session = state.sessions.find((item) => item.name === "EP45");
  const josh = summarizeRolls(state.participants, session.rolls)
    .participants.find((participant) => participant.label === "Josh");
  assert.equal(josh.dice, 54);
  assert.equal(josh.successes, 29);
  assert.equal(josh.sourceSuccesses, 33);
  assert.equal(josh.damage, 6);
  assert.equal(josh.healthChange, -2);
  assert.equal(formatSuccessDiceRatio(josh.sourceSuccesses, josh.sourceDice), "0.61");
});
