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
            roll.to < 0 || roll.to > RESOURCE_LIMITS[roll.resource]) {
          throw new TypeError("A resource change in this backup contains invalid data.");
        }
        continue;
      }
      if (typeof roll.characterName !== "string" || typeof roll.check !== "string" ||
          !Number.isInteger(roll.pool) || roll.pool < 0 || roll.pool > 99 ||
          !Number.isInteger(roll.hungerDice) || roll.hungerDice < 0 || roll.hungerDice > roll.pool ||
          !Number.isInteger(roll.successes) || roll.successes < 0 ||
          !Number.isInteger(roll.difficulty) || roll.difficulty < 0 ||
          !OUTCOMES.has(roll.outcome) ||
          (roll.type !== undefined && !["roll", "rouse", "reroll"].includes(roll.type))) {
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
