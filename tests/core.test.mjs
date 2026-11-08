import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTRIBUTES,
  SKILLS,
  applyRouseResult,
  availableWillpowerRerollDice,
  adjustResource,
  calculateOutcome,
  calculatePool,
  createInitialState,
  formatSuccessDiceRatio,
  formatTextTable,
  hungerDiceCount,
  summarizeRolls,
  validateState,
} from "../core.js";

test("initial state includes two players and one Storyteller in a session", () => {
  const state = createInitialState();
  assert.equal(state.participants.filter((participant) => participant.role === "player").length, 2);
  assert.equal(state.participants.filter((participant) => participant.role === "storyteller").length, 1);
  assert.ok(state.sessions.some((session) => session.id === state.activeSessionId));
  assert.equal(Object.keys(state.participants[0].attributes).length, ATTRIBUTES.length);
  assert.equal(Object.keys(state.participants[0].skills).length, SKILLS.length);
});

test("pool calculation combines sheet values and applies a bounded modifier", () => {
  const participant = {
    attributes: { Dexterity: 3 },
    skills: { Stealth: 2 },
  };
  assert.equal(calculatePool(participant, "Dexterity", "Stealth"), 5);
  assert.equal(calculatePool(participant, "Dexterity", "Stealth", -2), 3);
  assert.equal(calculatePool(participant, "Dexterity", "Stealth", -20), 0);
  assert.equal(calculatePool(participant, "Unknown", "", 2), 2);
});

test("Hunger dice are limited by both Hunger and pool size", () => {
  assert.equal(hungerDiceCount(4, 7), 4);
  assert.equal(hungerDiceCount(4, 2), 2);
  assert.equal(hungerDiceCount(0, 7), 0);
});

test("success-to-dice ratios use successes divided by dice", () => {
  assert.equal(formatSuccessDiceRatio(33, 54), "0.61");
  assert.equal(formatSuccessDiceRatio(0, 0), "—");
});

test("plain-text tables align columns and normalize newlines", () => {
  assert.equal(
    formatTextTable(["NAME", "TOTAL"], [["Trace\nElspeth", 6]]),
    "+---------------+-------+\n| NAME          | TOTAL |\n+---------------+-------+\n| Trace Elspeth | 6     |\n+---------------+-------+",
  );
});

test("report summaries separate unresolved outcomes and special events", () => {
  const state = createInitialState();
  const participant = state.participants[0];
  const rolls = [
    { participantId: participant.id, type: "roll", pool: 6, hungerDice: 2, successes: 3, outcome: "Success" },
    { participantId: participant.id, type: "roll", pool: 3, hungerDice: 1, successes: 1, outcome: "Success", outcomeRecorded: false },
    { participantId: participant.id, type: "rouse", pool: 1, hungerDice: 0, successes: 1, outcome: "Rouse success", outcomeRecorded: false },
    { participantId: participant.id, type: "damage", amount: 6, sourceDice: 4 },
    { participantId: participant.id, type: "resource", resource: "health", from: 5, to: 3, sourceSuccess: -2 },
  ];
  const { participants, totals, outcomes } = summarizeRolls(state.participants, rolls);
  assert.equal(participants[0].rolls, 2);
  assert.equal(participants[0].outcomeRolls, 1);
  assert.equal(participants[0].dice, 10);
  assert.equal(participants[0].normalDice, 7);
  assert.equal(participants[0].hungerDice, 3);
  assert.equal(participants[0].successes, 5);
  assert.equal(participants[0].successfulRolls, 1);
  assert.equal(participants[0].rouses, 1);
  assert.equal(participants[0].resolvedRouses, 0);
  assert.equal(participants[0].rouseSuccesses, 0);
  assert.equal(participants[0].damage, 6);
  assert.equal(participants[0].healthChange, -2);
  assert.equal(participants[0].sourceDice, 14);
  assert.equal(participants[0].sourceSuccesses, 9);
  assert.equal(totals.outcomeRolls, 1);
  assert.equal(totals.sourceDice, 14);
  assert.equal(totals.sourceSuccesses, 9);
  assert.equal(outcomes.Success, 1);
});

test("Willpower rerolls are capped at three non-Hunger dice", () => {
  assert.equal(availableWillpowerRerollDice(8, 2), 3);
  assert.equal(availableWillpowerRerollDice(3, 2), 1);
  assert.equal(availableWillpowerRerollDice(4, 4), 0);
});

test("backup validation accepts a Willpower reroll record", () => {
  const state = createInitialState();
  const participant = state.participants[0];
  const original = {
    id: "original",
    participantId: participant.id,
    participantName: participant.name,
    characterName: participant.characterName,
    time: "12:00",
    timestamp: new Date().toISOString(),
    type: "roll",
    check: "Dexterity + Athletics",
    pool: 5,
    hungerDice: 2,
    successes: 2,
    difficulty: 2,
    outcome: "Success",
  };
  state.sessions[0].rolls.push(original, {
    id: "reroll",
    participantId: participant.id,
    participantName: participant.name,
    characterName: participant.characterName,
    time: "12:01",
    timestamp: new Date().toISOString(),
    type: "reroll",
    check: "Willpower reroll",
    pool: 3,
    rerolledDice: 3,
    hungerDice: 0,
    successes: 4,
    difficulty: 2,
    outcome: "Other",
    parentRollId: original.id,
    successChange: { from: 2, to: 6 },
    outcomeBefore: "Success",
    outcomeAfter: "Success",
    resourceChange: { resource: "willpower", from: 3, to: 2 },
  });
  assert.equal(validateState(state), state);
});

test("successes and difficulty determine the default roll outcome", () => {
  assert.equal(calculateOutcome(1, 2), "Failure");
  assert.equal(calculateOutcome(2, 2), "Success");
  assert.equal(calculateOutcome(5, 2), "Success");
});

test("resource adjustments stay between zero and the maximum", () => {
  const participant = { resources: { willpower: { current: 2, max: 3 }, hunger: { current: 5, max: 10 } } };
  adjustResource(participant, "willpower", 2);
  assert.equal(participant.resources.willpower.current, 3);
  adjustResource(participant, "willpower", -8);
  assert.equal(participant.resources.willpower.current, 0);
  adjustResource(participant, "hunger", 0);
  assert.equal(participant.resources.hunger.max, 5);
});

test("Rouse failure adds Hunger and success leaves it unchanged", () => {
  const participant = { resources: { hunger: { current: 2, max: 5 } } };
  assert.deepEqual(applyRouseResult(participant, true), { resource: "hunger", from: 2, to: 2 });
  assert.deepEqual(applyRouseResult(participant, false), { resource: "hunger", from: 2, to: 3 });
  participant.resources.hunger.current = 5;
  assert.deepEqual(applyRouseResult(participant, false), { resource: "hunger", from: 5, to: 5 });
});

test("backup validation rejects incorrect roster sizes and accepts app state", () => {
  const state = createInitialState();
  assert.equal(validateState(state), state);
  state.sessions[0].rolls.push({
    id: "legacy-roll",
    participantId: state.participants[0].id,
    participantName: state.participants[0].name,
    characterName: state.participants[0].characterName,
    time: "12:00",
    timestamp: new Date().toISOString(),
    type: "roll",
    check: "Dexterity + Athletics",
    pool: 1,
    hungerDice: 0,
    successes: 1,
    difficulty: 1,
    outcome: "Success",
    note: "Old backup note",
  });
  validateState(state);
  assert.equal("note" in state.sessions[0].rolls[0], false);
  state.participants = state.participants.filter((participant) => participant.role !== "storyteller");
  assert.throws(() => validateState(state), /2–5 players and exactly one Storyteller/);
});

test("backup validation accepts damage events and rejects invalid amounts", () => {
  const state = createInitialState();
  const participant = state.participants[0];
  state.sessions[0].rolls.push({
    id: "damage",
    participantId: participant.id,
    participantName: participant.name,
    time: "12:00",
    timestamp: new Date().toISOString(),
    type: "damage",
    amount: 3,
  });
  assert.equal(validateState(state), state);
  state.sessions[0].rolls[0].amount = -1;
  assert.throws(() => validateState(state), /damage entry/);
});
