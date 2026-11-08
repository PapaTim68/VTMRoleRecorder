export const STORAGE_KEY = "vtm-role-recorder-v1";
export const APP_VERSION = 1;
const RESOURCE_LIMITS = { hunger: 5, willpower: 99, health: 99 };
const OUTCOMES = new Set([
  "Success", "Failure", "Critical", "Bestial failure", "Messy critical",
  "Rouse success", "Rouse failure", "Other",
]);

export const ATTRIBUTES = [
  "Strength", "Dexterity", "Stamina",
  "Charisma", "Manipulation", "Composure",
  "Intelligence", "Wits", "Resolve",
];

export const SKILL_GROUPS = {
  Physical: ["Athletics", "Brawl", "Craft", "Drive", "Firearms", "Larceny", "Melee", "Stealth", "Survival"],
  Social: ["Animal Ken", "Etiquette", "Insight", "Intimidation", "Leadership", "Performance", "Persuasion", "Streetwise", "Subterfuge"],
  Mental: ["Academics", "Awareness", "Finance", "Investigation", "Medicine", "Occult", "Politics", "Science", "Technology"],
};

export const SKILLS = Object.values(SKILL_GROUPS).flat();

export function makeId() {
  return crypto.randomUUID();
}

export function makeParticipant(role, name) {
  return {
    id: makeId(),
    role,
    name,
    characterName: role === "storyteller" ? "Storyteller" : name,
    attributes: Object.fromEntries(ATTRIBUTES.map((attribute) => [attribute, 0])),
    skills: Object.fromEntries(SKILLS.map((skill) => [skill, 0])),
    resources: {
      hunger: { current: 0, max: 5 },
      willpower: { current: 3, max: 3 },
      health: { current: 5, max: 5 },
    },
  };
}

export function makeSession(name) {
  return { id: makeId(), name, createdAt: new Date().toISOString(), rolls: [] };
}

export function createInitialState() {
  const players = [makeParticipant("player", "Player 1"), makeParticipant("player", "Player 2")];
  const storyteller = makeParticipant("storyteller", "Storyteller");
  const session = makeSession("Session 1");
  return {
    version: APP_VERSION,
    participants: [...players, storyteller],
    sessions: [session],
    activeSessionId: session.id,
  };
}

export function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

export function calculatePool(participant, attribute, skill, modifier = 0) {
  const attributeValue = attribute ? clamp(participant.attributes[attribute] ?? 0, 0, 5) : 0;
  const skillValue = skill ? clamp(participant.skills[skill] ?? 0, 0, 5) : 0;
  return Math.max(0, attributeValue + skillValue + clamp(modifier, -20, 20));
}

export function hungerDiceCount(hunger, pool) {
  return Math.min(clamp(hunger, 0, 5), clamp(pool, 0, 99));
}

export function availableWillpowerRerollDice(pool, hungerDice) {
  return Math.min(3, Math.max(0, clamp(pool, 0, 99) - clamp(hungerDice, 0, 99)));
}

export function calculateOutcome(successes, difficulty) {
  return clamp(successes, 0, 99) >= clamp(difficulty, 0, 99) ? "Success" : "Failure";
}

export function adjustResource(participant, resourceName, delta) {
  const resource = participant.resources[resourceName];
  if (!resource) throw new RangeError(`Unknown resource: ${resourceName}`);
  const max = clamp(resource.max, 0, RESOURCE_LIMITS[resourceName]);
  resource.max = max;
  resource.current = clamp(resource.current + delta, 0, max);
}

export function applyRouseResult(participant, success) {
  const hungerBefore = participant.resources.hunger.current;
  if (!success) adjustResource(participant, "hunger", 1);
  return {
    resource: "hunger",
    from: hungerBefore,
    to: participant.resources.hunger.current,
  };
}

export function formatSuccessDiceRatio(successes, dice) {
  return dice ? (successes / dice).toFixed(2) : "—";
}

export function formatTextTable(headers, rows) {
  const normalize = (value) => String(value ?? "").replace(/[\r\n]+/g, " ");
  const values = [headers, ...rows].map((row) => row.map(normalize));
  const widths = headers.map((header, index) =>
    Math.max(...values.map((row) => row[index].length)));
  const separator = `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`;
  const formatRow = (row) =>
    `| ${row.map((value, index) => value.padEnd(widths[index])).join(" | ")} |`;
  return [separator, formatRow(values[0]), separator, ...values.slice(1).map(formatRow), separator].join("\n");
}

export function summarizeRolls(participants, rolls) {
  const emptyOutcomes = () => ({
    Success: 0,
    Failure: 0,
    Critical: 0,
    "Messy critical": 0,
    "Bestial failure": 0,
    Other: 0,
  });
  const statsByParticipant = new Map(participants.map((participant) => [
    participant.id,
    {
      id: participant.id,
      role: participant.role,
      label: participant.role === "storyteller" ? participant.name : participant.characterName || participant.name,
      rolls: 0,
      outcomeRolls: 0,
      rouses: 0,
      resolvedRouses: 0,
      outcomes: emptyOutcomes(),
      dice: 0,
      sourceDice: 0,
      normalDice: 0,
      hungerDice: 0,
      successes: 0,
      successfulRolls: 0,
      rouseSuccesses: 0,
      damage: 0,
      healthChange: 0,
      sourceSuccesses: 0,
    },
  ]));
  const outcomeCounts = emptyOutcomes();
  for (const roll of rolls) {
    let stats = statsByParticipant.get(roll.participantId);
    if (!stats) {
      stats = {
        id: roll.participantId,
        role: "unknown",
        label: roll.characterName || roll.participantName,
        rolls: 0,
        outcomeRolls: 0,
        rouses: 0,
        resolvedRouses: 0,
        outcomes: emptyOutcomes(),
        dice: 0,
        sourceDice: 0,
        normalDice: 0,
        hungerDice: 0,
        successes: 0,
        successfulRolls: 0,
        rouseSuccesses: 0,
        damage: 0,
        healthChange: 0,
        sourceSuccesses: 0,
      };
      statsByParticipant.set(roll.participantId, stats);
    }
    if (roll.type === "resource") {
      if (roll.resource === "health") {
        stats.healthChange += roll.to - roll.from;
        stats.sourceSuccesses += roll.sourceSuccess ?? 0;
      }
      continue;
    }
    if (roll.type === "damage") {
      stats.damage += roll.amount;
      stats.sourceDice += roll.sourceDice ?? 0;
      stats.sourceSuccesses += roll.amount;
      continue;
    }
    if (roll.type === "reroll") continue;
    stats.dice += roll.pool;
    stats.sourceDice += roll.pool;
    stats.normalDice += roll.pool - roll.hungerDice;
    stats.hungerDice += roll.hungerDice;
    stats.successes += roll.successes;
    stats.sourceSuccesses += roll.sourceSuccess ?? roll.successes;
    if (roll.type === "rouse") {
      stats.rouses += 1;
      if (roll.outcomeRecorded !== false) {
        stats.resolvedRouses += 1;
        if (roll.outcome === "Rouse success" || roll.successes > 0) stats.rouseSuccesses += 1;
      }
      continue;
    }
    stats.rolls += 1;
    if (roll.outcomeRecorded === false) continue;
    stats.outcomeRolls += 1;
    const outcome = Object.hasOwn(outcomeCounts, roll.outcome) ? roll.outcome : "Other";
    stats.outcomes[outcome] += 1;
    outcomeCounts[outcome] += 1;
    if (["Success", "Critical", "Messy critical"].includes(outcome)) stats.successfulRolls += 1;
  }
  const items = [...statsByParticipant.values()];
  const totals = items.reduce((total, item) => ({
    rolls: total.rolls + item.rolls,
    outcomeRolls: total.outcomeRolls + item.outcomeRolls,
    dice: total.dice + item.dice,
    sourceDice: total.sourceDice + item.sourceDice,
    normalDice: total.normalDice + item.normalDice,
    hungerDice: total.hungerDice + item.hungerDice,
    successes: total.successes + item.successes,
    successfulRolls: total.successfulRolls + item.successfulRolls,
    rouses: total.rouses + item.rouses,
    resolvedRouses: total.resolvedRouses + item.resolvedRouses,
    rouseSuccesses: total.rouseSuccesses + item.rouseSuccesses,
    damage: total.damage + item.damage,
    healthChange: total.healthChange + item.healthChange,
    sourceSuccesses: total.sourceSuccesses + item.sourceSuccesses,
  }), {
    rolls: 0,
    outcomeRolls: 0,
    dice: 0,
    sourceDice: 0,
    normalDice: 0,
    hungerDice: 0,
    successes: 0,
    successfulRolls: 0,
    rouses: 0,
    resolvedRouses: 0,
    rouseSuccesses: 0,
    damage: 0,
    healthChange: 0,
    sourceSuccesses: 0,
  });
  return { participants: items, outcomes: outcomeCounts, totals };
}

export function validateState(value) {
  if (!value || value.version !== APP_VERSION || !Array.isArray(value.participants) ||
      !Array.isArray(value.sessions) || value.sessions.length === 0) {
    throw new TypeError("This file is not a valid VTM Role Recorder backup.");
  }
  if (value.participants.some((participant) => !participant || typeof participant !== "object")) {
    throw new TypeError("A participant in this backup is not valid character data.");
  }
  const players = value.participants.filter((participant) => participant.role === "player");
  const storytellers = value.participants.filter((participant) => participant.role === "storyteller");
  if (players.length < 2 || players.length > 5 || storytellers.length !== 1 ||
      value.participants.length !== players.length + storytellers.length) {
    throw new TypeError("A backup must contain 2–5 players and exactly one Storyteller.");
  }
  for (const participant of value.participants) {
    if (typeof participant.id !== "string" || !participant.id ||
        typeof participant.name !== "string" || typeof participant.characterName !== "string" ||
        !participant.attributes || typeof participant.attributes !== "object" ||
        !participant.skills || typeof participant.skills !== "object" ||
        !participant.resources || typeof participant.resources !== "object") {
      throw new TypeError("A participant in this backup is missing required character data.");
    }
    for (const attribute of ATTRIBUTES) {
      if (!Number.isInteger(participant.attributes[attribute]) ||
          participant.attributes[attribute] < 0 || participant.attributes[attribute] > 5) {
        throw new TypeError(`The ${attribute} rating for ${participant.name} must be between 0 and 5.`);
      }
    }
    for (const skill of SKILLS) {
      if (!Number.isInteger(participant.skills[skill]) ||
          participant.skills[skill] < 0 || participant.skills[skill] > 5) {
        throw new TypeError(`The ${skill} rating for ${participant.name} must be between 0 and 5.`);
      }
    }
    for (const [resourceName, maxLimit] of Object.entries(RESOURCE_LIMITS)) {
      const resource = participant.resources[resourceName];
      if (!resource || !Number.isInteger(resource.current) || !Number.isInteger(resource.max) ||
          resource.max < 0 || resource.max > maxLimit ||
          resource.current < 0 || resource.current > resource.max) {
        throw new TypeError(`${resourceName} values for ${participant.name} are invalid.`);
      }
    }
  }
  if (value.sessions.some((session) => !session || typeof session !== "object")) {
    throw new TypeError("A session in this backup is not valid session data.");
  }
  for (const session of value.sessions) {
    if (typeof session.id !== "string" || !session.id ||
        typeof session.name !== "string" || !Array.isArray(session.rolls)) {
      throw new TypeError("A session in this backup is missing its name or roll history.");
    }
    for (const roll of session.rolls) {
      if (!roll || typeof roll !== "object" || typeof roll.id !== "string" || !roll.id ||
          typeof roll.participantId !== "string" || typeof roll.participantName !== "string" ||
          typeof roll.time !== "string" || typeof roll.timestamp !== "string") {
        throw new TypeError("A roll in this backup contains invalid data.");
      }
      delete roll.note;
      if (roll.type === "resource") {
        if (!RESOURCE_LIMITS[roll.resource] || !Number.isInteger(roll.from) ||
            !Number.isInteger(roll.to) || roll.from < 0 || roll.from > RESOURCE_LIMITS[roll.resource] ||
            roll.to < 0 || roll.to > RESOURCE_LIMITS[roll.resource] ||
            (roll.sourceSuccess !== undefined &&
             (!Number.isInteger(roll.sourceSuccess) || roll.sourceSuccess < -99 || roll.sourceSuccess > 99))) {
          throw new TypeError("A resource change in this backup contains invalid data.");
        }
        continue;
      }
      if (roll.type === "damage") {
        if (!Number.isInteger(roll.amount) || roll.amount < 0 || roll.amount > 99 ||
            (roll.sourceDice !== undefined &&
             (!Number.isInteger(roll.sourceDice) || roll.sourceDice < 0 || roll.sourceDice > 99))) {
          throw new TypeError("A damage entry in this backup contains invalid data.");
        }
        continue;
      }
      if (typeof roll.characterName !== "string" || typeof roll.check !== "string" ||
          !Number.isInteger(roll.pool) || roll.pool < 0 || roll.pool > 99 ||
          !Number.isInteger(roll.hungerDice) || roll.hungerDice < 0 || roll.hungerDice > roll.pool ||
          !Number.isInteger(roll.successes) || roll.successes < 0 ||
          !Number.isInteger(roll.difficulty) || roll.difficulty < 0 ||
          !OUTCOMES.has(roll.outcome) ||
          (roll.type !== undefined && !["roll", "rouse", "reroll"].includes(roll.type)) ||
          (roll.outcomeRecorded !== undefined && typeof roll.outcomeRecorded !== "boolean") ||
          (roll.sourceSuccess !== undefined &&
           (!Number.isInteger(roll.sourceSuccess) || roll.sourceSuccess < -99 || roll.sourceSuccess > 99))) {
        throw new TypeError("A roll in this backup contains invalid data.");
      }
      if (roll.resourceChange &&
          (!["hunger", "willpower"].includes(roll.resourceChange.resource) ||
           !Number.isInteger(roll.resourceChange.from) || !Number.isInteger(roll.resourceChange.to) ||
           roll.resourceChange.from < 0 || roll.resourceChange.from > RESOURCE_LIMITS[roll.resourceChange.resource] ||
           roll.resourceChange.to < 0 || roll.resourceChange.to > RESOURCE_LIMITS[roll.resourceChange.resource])) {
        throw new TypeError("A roll resource change in this backup contains invalid data.");
      }
      if (roll.type === "reroll" &&
          (typeof roll.parentRollId !== "string" || !roll.parentRollId ||
           !Number.isInteger(roll.rerolledDice) || roll.rerolledDice < 1 || roll.rerolledDice > 3 ||
           roll.rerolledDice !== roll.pool || roll.hungerDice !== 0 ||
           !roll.resourceChange || roll.resourceChange.resource !== "willpower" ||
           roll.resourceChange.from !== roll.resourceChange.to + 1 ||
           !Number.isInteger(roll.successChange?.from) || !Number.isInteger(roll.successChange?.to) ||
           roll.successChange.to !== roll.successChange.from + roll.successes ||
           !["Success", "Failure", "Critical", "Bestial failure", "Messy critical", "Other"].includes(roll.outcomeBefore) ||
           !["Success", "Failure", "Critical", "Bestial failure", "Messy critical", "Other"].includes(roll.outcomeAfter))) {
        throw new TypeError("A Willpower reroll in this backup contains invalid data.");
      }
    }
  }
  if (typeof value.activeSessionId !== "string" ||
      !value.sessions.some((session) => session.id === value.activeSessionId)) {
    throw new TypeError("The active session in this backup could not be found.");
  }
  return value;
}
