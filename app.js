import {
  ATTRIBUTES,
  SKILLS,
  SKILL_GROUPS,
  STORAGE_KEY,
  applyRouseResult,
  adjustResource,
  availableWillpowerRerollDice,
  calculatePool,
  calculateOutcome,
  clamp,
  createInitialState,
  formatSuccessDiceRatio,
  formatTextTable,
  hungerDiceCount,
  makeId,
  makeParticipant,
  makeSession,
  summarizeRolls,
  validateState,
} from "./core.js";

const $ = (selector) => document.querySelector(selector);
const participantList = $("#participant-list");
const rollHistory = $("#roll-history");
const statusMessage = $("#status-message");
const rollForm = $("#roll-form");
const historyView = $("#history-view");
const historyViewMode = new URLSearchParams(window.location.search).get("view") === "history";

function readState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return createInitialState();
  return validateState(JSON.parse(stored));
}

let state;
try {
  state = readState();
} catch (error) {
  statusMessage.textContent = `Saved data could not be loaded: ${error.message} Export or clear browser storage before continuing.`;
  rollForm.hidden = true;
  throw error;
}
const requestedParticipantId = new URLSearchParams(window.location.search).get("participant");
const requestedParticipant = state.participants.find((item) =>
  item.id === requestedParticipantId && item.role === "player",
);
const standalonePlayerId = requestedParticipant?.id ?? null;
let selectedParticipantId = standalonePlayerId ?? state.participants.find((item) => item.role === "player").id;
let quickAttribute = ATTRIBUTES[0];
let quickSkill = "";
let selectedOutcome = calculateOutcome(0, 2);
const reportParams = new URLSearchParams(window.location.search);
let reportScope = reportParams.get("session") ?? state.activeSessionId;
if (reportScope !== "all" && !state.sessions.some((session) => session.id === reportScope)) {
  reportScope = state.activeSessionId;
}
const expandedSheets = new Set();
if (historyViewMode) {
  document.body.classList.add("history-mode");
  document.title = "History & Stats · VTM Role Recorder";
} else if (standalonePlayerId) {
  document.body.classList.add("standalone-mode");
  document.title = `${requestedParticipant.characterName} · VTM Role Recorder`;
}
historyView.hidden = !historyViewMode;

function activeSession() {
  return state.sessions.find((session) => session.id === state.activeSessionId);
}

function saveState(message = "Saved on this device.") {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    statusMessage.textContent = message;
  } catch (error) {
    statusMessage.textContent = `Could not save changes in this browser: ${error.message}`;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function optionList(values, selected = "", includeBlank = true) {
  const blank = includeBlank ? '<option value="">— None —</option>' : "";
  return blank + values.map((value) =>
    `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`,
  ).join("");
}

function participantSelectOptions(selectedId) {
  return state.participants.map((participant) =>
    `<option value="${escapeHtml(participant.id)}"${participant.id === selectedId ? " selected" : ""}>${escapeHtml(participant.name)} · ${escapeHtml(participant.characterName)}</option>`,
  ).join("");
}

function resourceMarkup(participant, resourceName, label) {
  const resource = participant.resources[resourceName];
  return `
    <div class="resource-row">
      <span class="resource-label">${label}</span>
      <div class="resource-controls">
        <button type="button" class="step-button" data-participant="${escapeHtml(participant.id)}" data-resource="${resourceName}" data-delta="-1" aria-label="Decrease ${label} for ${escapeHtml(participant.name)}">−</button>
        <label class="resource-value">
          <span class="sr-only">${label} current</span>
          <input type="number" min="0" max="${resourceName === "hunger" ? 5 : 99}" value="${resource.current}" data-participant="${escapeHtml(participant.id)}" data-resource-current="${resourceName}" aria-label="${label} current for ${escapeHtml(participant.name)}">
          <span>/</span>
          <span class="sr-only">${label} maximum</span>
          <input type="number" min="0" max="${resourceName === "hunger" ? 5 : 99}" value="${resource.max}" data-participant="${escapeHtml(participant.id)}" data-resource-max="${resourceName}" aria-label="${label} maximum for ${escapeHtml(participant.name)}">
        </label>
        <button type="button" class="step-button" data-participant="${escapeHtml(participant.id)}" data-resource="${resourceName}" data-delta="1" aria-label="Increase ${label} for ${escapeHtml(participant.name)}">＋</button>
      </div>
    </div>`;
}

function statInputs(participant, group, values, label) {
  return `<div class="stat-grid">${values.map((value) => `
    <label class="stat-input">${escapeHtml(value)}
      <input type="number" min="0" max="5" value="${clamp(participant[group][value] ?? 0, 0, 5)}"
        data-participant="${escapeHtml(participant.id)}" data-stat-group="${group}" data-stat="${escapeHtml(value)}"
        aria-label="${escapeHtml(participant.name)} ${label} ${escapeHtml(value)}">
    </label>`).join("")}</div>`;
}

function renderParticipants() {
  if (!state.participants.some((item) => item.id === selectedParticipantId)) {
    selectedParticipantId = state.participants.find((item) => item.role === "player").id;
  }
  const participant = state.participants.find((item) => item.id === selectedParticipantId);
  const isStoryteller = participant.role === "storyteller";
  const playerCount = state.participants.filter((item) => item.role === "player").length;
  const rolls = activeSession().rolls.filter((roll) => roll.participantId === participant.id && roll.type !== "resource");
  const normalRolls = rolls.filter((roll) => roll.type !== "reroll");
  const totalDice = normalRolls.reduce((total, roll) => total + roll.pool, 0);
  const totalResults = normalRolls.reduce((total, roll) => total + roll.successes, 0);
  participantList.innerHTML = `
    <div class="participant-tabs" role="tablist" aria-label="Characters and Storyteller">
      ${state.participants.map((item) => `
        <button type="button" class="participant-tab ${item.id === participant.id ? "active" : ""} ${item.role === "storyteller" ? "storyteller-tab" : ""}"
          id="tab-${escapeHtml(item.id)}" role="tab" aria-selected="${item.id === participant.id}" aria-controls="active-participant"
          data-participant-tab="${escapeHtml(item.id)}">${escapeHtml(item.role === "storyteller" ? item.name : item.characterName || item.name)}</button>`).join("")}
    </div>
    ${isStoryteller ? `
      <article class="participant-card storyteller-card" id="active-participant" role="tabpanel" aria-labelledby="tab-${escapeHtml(participant.id)}">
        <div class="participant-heading">
          <span class="role-tag role-storyteller">STORYTELLER · NPC ROLLS</span>
          <span class="section-note">No single character sheet</span>
        </div>
        <label class="field storyteller-name-field">Storyteller name
          <input type="text" maxlength="40" value="${escapeHtml(participant.name)}" data-participant="${escapeHtml(participant.id)}" data-name="name">
        </label>
        <p class="storyteller-note">Record only the total dice and observed successes. Add an Attribute or Skill in quick entry when you know it.</p>
        <div class="storyteller-stats">
          <div><span>RECORDED ROLLS</span><strong>${normalRolls.length}</strong></div>
          <div><span>TOTAL DICE</span><strong>${totalDice}</strong></div>
          <div><span>TOTAL SUCCESSES</span><strong>${totalResults}</strong></div>
        </div>
      </article>` : `
      <article class="participant-card" id="active-participant" role="tabpanel" aria-labelledby="tab-${escapeHtml(participant.id)}">
        <div class="participant-heading">
          <div class="player-heading-title">
            <span class="role-tag">PLAYER</span>
            <h2 class="player-screen-title">${escapeHtml(participant.characterName)}</h2>
          </div>
          <div class="participant-card-actions">
            <a class="button button-quiet open-player-tab" href="?participant=${encodeURIComponent(participant.id)}" target="_blank" rel="noopener">Open player tab ↗</a>
            ${playerCount > 2 ? `<button type="button" class="text-button remove-player" data-participant="${escapeHtml(participant.id)}">Remove player</button>` : ""}
          </div>
        </div>
        <div class="name-grid">
          <label class="field">Player name
            <input type="text" maxlength="40" value="${escapeHtml(participant.name)}" data-participant="${escapeHtml(participant.id)}" data-name="name">
          </label>
          <label class="field">Character name
            <input type="text" maxlength="40" value="${escapeHtml(participant.characterName)}" data-participant="${escapeHtml(participant.id)}" data-name="characterName">
          </label>
        </div>
        <div class="resources">
          ${resourceMarkup(participant, "hunger", "Hunger")}
          ${resourceMarkup(participant, "willpower", "Willpower")}
          ${resourceMarkup(participant, "health", "Health")}
        </div>
        <details class="sheet-details" ${expandedSheets.has(participant.id) ? "open" : ""}>
          <summary>Edit sheet dice pools</summary>
          <div class="sheet-group">
            <h4>Attributes <span>0–5</span></h4>
            ${statInputs(participant, "attributes", ATTRIBUTES, "attribute")}
          </div>
          <div class="sheet-group">
            <h4>Skills <span>0–5</span></h4>
            ${statInputs(participant, "skills", SKILLS, "skill")}
          </div>
        </details>
        <section class="quick-combinations">
          <div class="quick-heading">
            <div><h3>Quick roll</h3><p>Select an Attribute and Skill to prefill the roll.</p></div>
          </div>
          <div class="quick-attributes" role="group" aria-label="Choose an Attribute">
            ${ATTRIBUTES.map((attribute) => `<button type="button" class="attribute-chip ${attribute === quickAttribute ? "selected" : ""}" aria-pressed="${attribute === quickAttribute}" data-quick-attribute="${escapeHtml(attribute)}">${escapeHtml(attribute)}</button>`).join("")}
          </div>
          <div class="quick-skill-groups">
            ${Object.entries(SKILL_GROUPS).map(([group, skills]) => `
              <section class="quick-skill-group" aria-label="${group} skills">
                <h4>${group}</h4>
                <div class="quick-skills">
                  ${skills.map((skill) => `<button type="button" class="skill-chip ${skill === quickSkill ? "selected" : ""}" aria-pressed="${skill === quickSkill}" data-quick-skill="${escapeHtml(skill)}">${escapeHtml(skill)}</button>`).join("")}
                </div>
              </section>`).join("")}
          </div>
        </section>
      </article>`}`;
  $("#add-player").disabled = state.participants.filter((item) => item.role === "player").length >= 5;
}

function renderSessionControls() {
  const session = activeSession();
  $("#session-name").value = session.name;
  $("#session-select").innerHTML = [...state.sessions].reverse().map((item) =>
    `<option value="${escapeHtml(item.id)}"${item.id === session.id ? " selected" : ""}>${escapeHtml(item.name)}</option>`,
  ).join("");
}

function renderRollForm(keepFields = false) {
  const previousParticipant = $("#roll-participant").value;
  const previousAttribute = $("#roll-attribute").value;
  const previousSkill = $("#roll-skill").value;
  $("#roll-participant").innerHTML = participantSelectOptions(
    state.participants.some((item) => item.id === previousParticipant) ? previousParticipant : state.participants[0].id,
  );
  $("#roll-attribute").innerHTML = optionList(ATTRIBUTES, previousAttribute);
  $("#roll-skill").innerHTML = optionList(SKILLS, previousSkill);
  $("#roll-participant").value = state.participants.some((item) => item.id === selectedParticipantId)
    ? selectedParticipantId
    : state.participants[0].id;
  if (!keepFields) {
    $("#roll-attribute").value = "";
    $("#roll-skill").value = "";
  }
  updatePoolPreview();
}

function historyTableMarkup(rolls, includeSession = false) {
  if (rolls.length === 0) {
    return '<div class="empty-state"><span class="empty-icon">◷</span><strong>No rolls recorded yet</strong><span>Your entries for this session will appear here.</span></div>';
  }
  return `
    <table>
      <thead><tr>${includeSession ? "<th>SESSION</th>" : ""}<th>TIME</th><th>PLAYER / CHARACTER</th><th>CHECK</th><th>DICE</th><th>HUNGER</th><th>RESULTS</th><th>DIFF.</th><th>OUTCOME</th><th>CHANGE</th></tr></thead>
      <tbody>${[...rolls].reverse().map((roll) => `
        <tr class="${roll.type === "resource" ? "resource-history-row" : roll.type === "damage" ? "damage-history-row" : roll.type === "reroll" ? "reroll-history-row" : ""}">
          ${includeSession ? `<td>${escapeHtml(roll.reportSessionName || "")}</td>` : ""}
          <td class="time-cell">${escapeHtml(roll.time)}</td>
          <td><strong>${escapeHtml(roll.participantName)}</strong>${roll.characterName ? `<span class="table-sub">${escapeHtml(roll.characterName)}</span>` : ""}</td>
          <td>${roll.type === "resource" ? "Tracker change" : roll.type === "damage" ? "Damage dealt" : roll.type === "reroll" ? `Willpower reroll · ${roll.rerolledDice} dice` : escapeHtml(roll.check)}</td>
          <td class="number-cell">${roll.type === "resource" || roll.type === "damage" ? "—" : roll.type === "reroll" ? roll.rerolledDice : roll.pool}</td>
          <td class="number-cell">${roll.type === "resource" || roll.type === "damage" || state.participants.find((item) => item.id === roll.participantId)?.role === "storyteller" ? "—" : roll.hungerDice}</td>
          <td class="number-cell">${roll.type === "resource" ? "—" : roll.type === "damage" ? roll.amount : roll.successes}</td>
          <td class="number-cell">${roll.type === "resource" || roll.type === "damage" ? "—" : roll.difficulty}</td>
          <td>${roll.type === "resource"
            ? '<span class="resource-history-tag">TRACKER</span>'
            : roll.type === "damage"
              ? '<span class="resource-history-tag">DAMAGE</span>'
            : roll.type === "reroll"
              ? '<span class="resource-history-tag">REROLL</span>'
              : roll.outcomeRecorded === false
                ? '<span class="resource-history-tag">NO RESULT</span>'
                : `<span class="outcome outcome-${slug(roll.outcome)}">${escapeHtml(roll.outcome)}</span>`}</td>
          <td class="change-cell">${roll.type === "resource"
            ? `${escapeHtml(roll.resource[0].toUpperCase() + roll.resource.slice(1))} ${roll.from} → ${roll.to}`
            : roll.type === "damage"
              ? "—"
            : roll.type === "reroll"
              ? `Willpower ${roll.resourceChange.from} → ${roll.resourceChange.to} · Total ${roll.successChange.to}`
            : roll.resourceChange
              ? `Hunger ${roll.resourceChange.from} → ${roll.resourceChange.to}`
              : "—"}</td>
        </tr>`).join("")}</tbody>
    </table>`;
}

function renderHistory() {
  const rolls = activeSession().rolls;
  $("#roll-count").textContent = String(rolls.filter((roll) => !["resource", "damage", "reroll"].includes(roll.type)).length);
  $("#undo-roll").disabled = rolls.length === 0;
  $("#undo-roll-focused").disabled = rolls.length === 0;
  rollHistory.innerHTML = historyTableMarkup(rolls);
}

function hungerTimelineMarkup(reportRolls) {
  const players = state.participants.filter((participant) => participant.role === "player");
  const totalRolls = reportRolls.filter((roll) => roll.type !== "resource" && roll.type !== "damage").length;
  const width = 760;
  const height = 300;
  const left = 56;
  const right = 738;
  const top = 24;
  const bottom = 244;
  const x = (rollCount) => totalRolls === 0
    ? (left + right) / 2
    : left + (rollCount / totalRolls) * (right - left);
  const y = (hunger) => bottom - (clamp(hunger, 0, 5) / 5) * (bottom - top);
  const colors = ["#ef8399", "#90b7de", "#82c5a5", "#d5ab73", "#b6a4de"];
  const series = players.map((player, index) => {
    const playerEvents = reportRolls.flatMap((roll) => {
      if (roll.participantId !== player.id) return [];
      if (roll.type === "resource" && roll.resource === "hunger") {
        return [{ roll, from: roll.from, to: roll.to }];
      }
      if (roll.resourceChange?.resource === "hunger") {
        return [{ roll, from: roll.resourceChange.from, to: roll.resourceChange.to }];
      }
      return [];
    });
    const currentHunger = playerEvents.at(-1)?.to ?? player.resources.hunger.current;
    const initialHunger = playerEvents[0]?.from ?? currentHunger;
    const coordinates = [[x(0), y(initialHunger)]];
    let hunger = initialHunger;
    let rollCount = 0;
    let eventIndex = 0;
    for (const roll of reportRolls) {
      if (roll.type !== "resource" && roll.type !== "damage") rollCount += 1;
      const event = playerEvents[eventIndex]?.roll === roll ? playerEvents[eventIndex++] : null;
      if (event) {
        event.rollCount = rollCount;
        if (hunger !== event.from) coordinates.push([x(rollCount), y(event.from)]);
        hunger = event.to;
        coordinates.push([x(rollCount), y(hunger)]);
      }
      if (roll.type !== "resource" && roll.type !== "damage") coordinates.push([x(rollCount), y(hunger)]);
    }
    if (hunger !== currentHunger) coordinates.push([x(totalRolls), y(currentHunger)]);
    const points = coordinates.map(([cx, cy], pointIndex) =>
      `${pointIndex === 0 ? "M" : "L"}${cx.toFixed(1)},${cy.toFixed(1)}`).join(" ");
    return { player, playerEvents, color: colors[index % colors.length], points, currentHunger };
  });
  const tickRolls = [...new Set([0, Math.round(totalRolls / 2), totalRolls])];
  return `
    <div class="hunger-chart-wrap">
      <svg class="hunger-timeline" viewBox="0 0 ${width} ${height}" role="img" aria-label="Hunger changes by overall roll count for all players">
        ${[0, 1, 2, 3, 4, 5].map((value) => `
          <line class="chart-grid-line" x1="${left}" y1="${y(value)}" x2="${right}" y2="${y(value)}"></line>
          <text class="chart-axis-label" x="${left - 12}" y="${y(value) + 3}" text-anchor="end">${value}</text>`).join("")}
        ${tickRolls.map((rollCount) => `
          <line class="chart-tick-line" x1="${x(rollCount)}" y1="${bottom}" x2="${x(rollCount)}" y2="${bottom + 5}"></line>
          <text class="chart-axis-label" x="${x(rollCount)}" y="${bottom + 22}" text-anchor="middle">${rollCount}</text>`).join("")}
        <text class="chart-axis-label" x="${(left + right) / 2}" y="${height - 8}" text-anchor="middle">OVERALL ROLLS</text>
        ${series.map((item) => `
          <path class="hunger-series-line" d="${item.points}" stroke="${item.color}"></path>
          ${item.playerEvents.map(({ rollCount, from, to }) => `
            <circle class="hunger-series-point" cx="${x(rollCount)}" cy="${y(to)}" r="3.5" fill="${item.color}">
              <title>${escapeHtml(item.player.characterName || item.player.name)}: Hunger ${from} to ${to} after ${rollCount} rolls</title>
            </circle>`).join("")}`).join("")}
      </svg>
    </div>
    <div class="hunger-chart-legend">
      ${series.map((item) => `
        <span><i style="--series-color:${item.color}"></i>${escapeHtml(item.player.characterName || item.player.name)}
          · Current Hunger ${item.currentHunger}</span>`).join("")}
    </div>
    <p class="chart-caption">The horizontal axis counts recorded rolls, including Rouse checks and Willpower rerolls; tracker-only changes do not count. Each line ends at the latest Hunger value in this report scope.</p>`;
}

function renderReport() {
  if (!historyViewMode) return;
  if (reportScope !== "all" && !state.sessions.some((session) => session.id === reportScope)) {
    reportScope = state.activeSessionId;
  }
  $("#report-scope").innerHTML = [
    '<option value="all">All sessions · Total</option>',
    ...[...state.sessions].reverse().map((session) =>
      `<option value="${escapeHtml(session.id)}">${escapeHtml(session.name)}</option>`),
  ].join("");
  $("#report-scope").value = reportScope;
  const sessions = reportScope === "all"
    ? state.sessions
    : state.sessions.filter((session) => session.id === reportScope);
  const reportRolls = sessions.flatMap((session) =>
    session.rolls.map((roll) => ({ ...roll, reportSessionName: session.name })))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const reportStats = summarizeRolls(state.participants, reportRolls);
  const participants = reportStats.participants;
  const rollStats = reportStats.totals;
  const outcomeCounts = reportStats.outcomes;
  const successRate = rollStats.outcomeRolls ? Math.round((rollStats.successfulRolls / rollStats.outcomeRolls) * 100) : 0;
  const rouseRate = rollStats.resolvedRouses ? Math.round((rollStats.rouseSuccesses / rollStats.resolvedRouses) * 100) : 0;
  const ratio = (dice, successes) => formatSuccessDiceRatio(successes, dice);
  const outcomeOrder = ["Success", "Failure", "Critical", "Messy critical", "Bestial failure", "Other"];
  const maxOutcome = Math.max(1, ...Object.values(outcomeCounts));
  const maxDice = Math.max(1, ...participants.map((item) => item.dice));
  const selectedSessionName = reportScope === "all" ? "All sessions · Total" : sessions[0]?.name ?? "Session";
  const normalDiceRows = participants.map((item) => `
    <div class="report-bar-row">
      <span class="report-bar-label">${escapeHtml(item.label)}</span>
      <div class="report-bar-track" role="img" aria-label="${escapeHtml(item.label)}: ${item.normalDice} normal dice, ${item.hungerDice} Hunger dice">
        <span class="report-bar-normal" style="width:${(item.normalDice / maxDice) * 100}%"></span>
        <span class="report-bar-hunger" style="width:${(item.hungerDice / maxDice) * 100}%"></span>
      </div>
      <span class="report-bar-value">${item.dice}</span>
    </div>`).join("");
  const activeParticipants = participants.filter((item) => item.sourceDice || item.sourceSuccesses || item.rouses);
  const diceTotalRows = activeParticipants.map((item) => `
    <tr>
      <td><strong>${escapeHtml(reportParticipantsLabel(item))}</strong></td>
      <td class="number-cell">${item.sourceDice}</td>
      <td class="number-cell">${item.normalDice}</td>
      <td class="number-cell">${item.hungerDice}</td>
      <td class="number-cell">${item.sourceSuccesses}</td>
      <td class="number-cell">${item.sourceDice ? Math.round((item.sourceSuccesses / item.sourceDice) * 100) : 0}%</td>
    </tr>`).join("");
  const rouseRows = participants.filter((item) => item.rouses).map((item) => `
    <tr>
      <td><strong>${escapeHtml(reportParticipantsLabel(item))}</strong></td>
      <td class="number-cell">${item.resolvedRouses}</td>
      <td class="number-cell">${item.rouseSuccesses}</td>
      <td class="number-cell">${item.resolvedRouses
        ? `${((item.rouseSuccesses / item.resolvedRouses) * 100).toFixed(2).replace(".", ",")}%`
        : "—"}</td>
    </tr>`).join("");
  const rouseRateText = rollStats.resolvedRouses
    ? `${((rollStats.rouseSuccesses / rollStats.resolvedRouses) * 100).toFixed(2).replace(".", ",")}%`
    : "—";
  const outcomeRows = outcomeOrder.map((outcome) => `
    <div class="report-bar-row">
      <span class="report-bar-label">${escapeHtml(outcome)}</span>
      <div class="report-bar-track" role="img" aria-label="${outcomeCounts[outcome]} ${escapeHtml(outcome)} rolls">
        <span class="report-bar-outcome" style="width:${(outcomeCounts[outcome] / maxOutcome) * 100}%"></span>
      </div>
      <span class="report-bar-value">${outcomeCounts[outcome]}</span>
    </div>`).join("");
  $("#report-content").innerHTML = `
    <p class="report-scope-label">${escapeHtml(selectedSessionName)}</p>
    <p class="report-source-note">Roll-only statistics exclude Damage and Health entries. Source totals reproduce the workbook's DICE/SUCCESS calculation, including special values stored in its dice and success cells. All sessions sums the episode sheets and may differ from the workbook's aggregate All sheet.</p>
    <div class="report-metrics">
      <div><span>DICE ROLLS</span><strong>${rollStats.rolls}</strong></div>
      <div><span>TOTAL DICE</span><strong>${rollStats.dice}</strong></div>
      <div><span>SOURCE DICE</span><strong>${rollStats.sourceDice}</strong></div>
      <div><span>NORMAL DICE</span><strong>${rollStats.normalDice}</strong></div>
      <div><span>HUNGER DICE</span><strong>${rollStats.hungerDice}</strong></div>
      <div><span>ROLL SUCCESSES</span><strong>${rollStats.successes}</strong></div>
      <div><span>SOURCE SUCCESS TOTAL</span><strong>${rollStats.sourceSuccesses}</strong></div>
      <div><span>ROLL SUCCESS RATE</span><strong>${successRate}%</strong></div>
      <div><span>ROLL SUCCESS / DICE</span><strong>${ratio(rollStats.dice, rollStats.successes)}</strong></div>
      <div><span>SOURCE SUCCESS / DICE</span><strong>${ratio(rollStats.sourceDice, rollStats.sourceSuccesses)}</strong></div>
      <div><span>ROUSE SUCCESS RATE</span><strong>${rollStats.rouseSuccesses} / ${rollStats.resolvedRouses} recorded · ${rouseRate}%</strong></div>
    </div>
    <div class="report-chart-grid">
      <section class="panel report-panel">
        <h2>Dice by character</h2>
        <p>Normal and Hunger dice recorded in rolls, including Rouse checks.</p>
        <div class="report-legend"><span><i class="legend-normal"></i>Normal dice</span><span><i class="legend-hunger"></i>Hunger dice</span></div>
        ${normalDiceRows || '<p class="report-empty">No roll data in this scope.</p>'}
      </section>
      <section class="panel report-panel">
        <h2>Roll outcomes</h2>
        <p>Recorded result types for regular rolls.</p>
        ${outcomeRows}
      </section>
    </div>
    <section class="panel report-panel report-wide">
      <div class="report-table-heading">
        <h2>Hunger over time</h2>
        <button class="button button-quiet" type="button" data-report-copy="chart">Copy graph image</button>
      </div>
      <p>Recorded Hunger tracker changes for every player in this report scope.</p>
      ${hungerTimelineMarkup(reportRolls)}
      <div class="report-table-heading report-subheading">
        <h3>Rouse checks</h3>
        <button class="button button-quiet" type="button" data-report-copy="rouse">Copy Rouse table</button>
      </div>
      <div class="history-wrap"><table class="report-table report-copy-table">
        <thead><tr><th>CHARACTER</th><th>TOTAL</th><th>SUCCESS</th><th>RATIO</th></tr></thead>
        <tbody>${rouseRows}
          <tr class="report-total-row">
            <td><strong>All</strong></td>
            <td class="number-cell">${rollStats.resolvedRouses}</td>
            <td class="number-cell">${rollStats.rouseSuccesses}</td>
            <td class="number-cell">${rouseRateText}</td>
          </tr>
        </tbody>
      </table></div>
    </section>
    <section class="panel report-panel report-wide">
      <div class="report-table-heading">
        <h2>Episode dice totals</h2>
        <button class="button button-quiet" type="button" data-report-copy="dice">Copy dice table</button>
      </div>
      <div class="history-wrap"><table class="report-table report-copy-table">
        <thead><tr><th>CHARACTER</th><th>TOTAL</th><th>NORMAL</th><th>HUNGER</th><th>SUCCESS</th><th>DICE/SUCCESS</th></tr></thead>
        <tbody>${diceTotalRows}
          <tr class="report-total-row">
            <td><strong>All</strong></td>
            <td class="number-cell">${rollStats.sourceDice}</td>
            <td class="number-cell">${rollStats.normalDice}</td>
            <td class="number-cell">${rollStats.hungerDice}</td>
            <td class="number-cell">${rollStats.sourceSuccesses}</td>
            <td class="number-cell">${rollStats.sourceDice
              ? `${Math.round((rollStats.sourceSuccesses / rollStats.sourceDice) * 100)}%`
              : "—"}</td>
          </tr>
        </tbody>
      </table></div>
    </section>
    <section class="panel report-panel report-wide">
      <h2>Roll and event detail</h2>
      <div class="history-wrap"><table class="report-table">
        <thead><tr><th>CHARACTER</th><th>ROLLS</th><th>NORMAL DICE</th><th>HUNGER DICE</th><th>ROLL SUCCESSES</th><th>ROLL SUCCESS / DICE</th><th>SOURCE DICE</th><th>SOURCE SUCCESSES</th><th>SOURCE SUCCESS / DICE</th><th>ROLL SUCCESS RATE</th><th>DAMAGE DEALT</th><th>HEALTH CHANGE</th><th>ROUSE</th><th>ROUSE SUCCESS RATE</th></tr></thead>
        <tbody>${participants.map((item) => `
          <tr>
            <td><strong>${escapeHtml(item.label)}</strong>${item.role === "storyteller" ? '<span class="table-sub">Storyteller</span>' : ""}</td>
            <td class="number-cell">${item.rolls}</td>
            <td class="number-cell">${item.normalDice}</td>
            <td class="number-cell">${item.hungerDice}</td>
            <td class="number-cell">${item.successes}</td>
            <td class="number-cell">${ratio(item.dice, item.successes)}</td>
            <td class="number-cell">${item.sourceDice}</td>
            <td class="number-cell">${item.sourceSuccesses}</td>
            <td class="number-cell">${ratio(item.sourceDice, item.sourceSuccesses)}</td>
            <td class="number-cell">${item.outcomeRolls ? Math.round((item.successfulRolls / item.outcomeRolls) * 100) : 0}%</td>
            <td class="number-cell">${item.damage}</td>
            <td class="number-cell">${item.healthChange > 0 ? "+" : ""}${item.healthChange}</td>
            <td class="number-cell">${item.rouseSuccesses} / ${item.resolvedRouses} recorded</td>
            <td class="number-cell">${item.resolvedRouses ? Math.round((item.rouseSuccesses / item.resolvedRouses) * 100) : 0}%</td>
          </tr>`).join("")}</tbody>
      </table></div>
    </section>
    <section class="panel report-panel report-wide report-history-panel">
      <h2>Roll history</h2>
      <div class="history-wrap">${historyTableMarkup(reportRolls, reportScope === "all")}</div>
    </section>`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportParticipantsLabel(item) {
  const person = state.participants.find((entry) => entry.id === item.id);
  if (!person) return item.label;
  return person.role === "storyteller"
    ? `Storyteller/${person.name}`
    : `${person.name}/${person.characterName || person.name}`;
}

function reportStatsForScope() {
  const sessions = reportScope === "all"
    ? state.sessions
    : state.sessions.filter((session) => session.id === reportScope);
  return summarizeRolls(state.participants, sessions.flatMap((session) => session.rolls));
}

function reportDiceTableText() {
  const aggregate = reportStatsForScope();
  const characterRows = aggregate.participants
    .filter((item) => item.sourceDice || item.sourceSuccesses || item.rouses)
    .map((item) => [
    reportParticipantsLabel(item),
    item.sourceDice,
    item.normalDice,
    item.hungerDice,
    item.sourceSuccesses,
    item.sourceDice
      ? `${Math.round((item.sourceSuccesses / item.sourceDice) * 100)}%`
      : "—",
  ]);
  characterRows.push([
    "All",
    aggregate.totals.sourceDice,
    aggregate.totals.normalDice,
    aggregate.totals.hungerDice,
    aggregate.totals.sourceSuccesses,
    aggregate.totals.sourceDice
      ? `${Math.round((aggregate.totals.sourceSuccesses / aggregate.totals.sourceDice) * 100)}%`
      : "—",
  ]);
  return formatTextTable(
    ["", "TOTAL", "NORMAL", "HUNGER", "SUCCESS", "DICE/SUCCESS"],
    characterRows,
  );
}

function reportRouseTableText() {
  const aggregate = reportStatsForScope();
  const rows = aggregate.participants.filter((item) => item.rouses).map((item) => [
    reportParticipantsLabel(item),
    item.resolvedRouses,
    item.rouseSuccesses,
    item.resolvedRouses
      ? `${((item.rouseSuccesses / item.resolvedRouses) * 100).toFixed(2).replace(".", ",")}%`
      : "—",
  ]);
  rows.push([
    "All",
    aggregate.totals.resolvedRouses,
    aggregate.totals.rouseSuccesses,
    aggregate.totals.resolvedRouses
      ? `${((aggregate.totals.rouseSuccesses / aggregate.totals.resolvedRouses) * 100).toFixed(2).replace(".", ",")}%`
      : "—",
  ]);
  return formatTextTable(["", "TOTAL", "SUCCESS", "RATIO"], rows);
}

async function copyHungerChart() {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("This browser does not support copying images to the clipboard.");
  }
  const source = $(".hunger-timeline");
  if (!source) throw new Error("The Hunger graph is not available in this report.");
  const svg = source.cloneNode(true);
  const [width, height] = svg.getAttribute("viewBox").split(/\s+/).slice(2).map(Number);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height + 32));
  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", "#17141a");
  svg.insertBefore(background, svg.firstChild);
  const legend = [...$(".hunger-chart-legend").children];
  const labelY = height + 19;
  legend.forEach((entry, index) => {
    const marker = entry.querySelector("i");
    const label = entry.textContent.split("·")[0].trim();
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(40 + (index * (width - 80)) / Math.max(1, legend.length - 1)));
    text.setAttribute("y", String(labelY));
    text.setAttribute("text-anchor", legend.length === 1 ? "middle" : index === 0 ? "start" : index === legend.length - 1 ? "end" : "middle");
    text.setAttribute("fill", marker ? getComputedStyle(marker).backgroundColor : "#d7d0da");
    text.setAttribute("font-family", "Consolas, monospace");
    text.setAttribute("font-size", "10");
    text.textContent = label;
    svg.append(text);
  });
  const styles = document.createElementNS("http://www.w3.org/2000/svg", "style");
  styles.textContent = ".chart-grid-line{stroke:#39333d;stroke-width:1}.chart-tick-line{stroke:#5a525f;stroke-width:1}.chart-axis-label{fill:#a49ca9;font:10px Consolas,monospace}.hunger-series-line{fill:none;stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}.hunger-series-point{stroke:#17141a;stroke-width:1.5}";
  svg.insertBefore(styles, svg.firstChild);
  const svgBlob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" });
  const imageUrl = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = (height + 32) * 2;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser could not create an image canvas.");
    context.scale(2, 2);
    context.drawImage(image, 0, 0, width, height + 32);
    const png = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The browser could not encode the Hunger graph.")), "image/png");
    });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function updatePoolPreview() {
  const participant = state.participants.find((item) => item.id === $("#roll-participant").value);
  if (!participant) return;
  const isStoryteller = participant.role === "storyteller";
  const manual = isStoryteller || $("#pool-mode").value === "manual";
  const base = manual ? 0 : calculatePool(participant, $("#roll-attribute").value, $("#roll-skill").value);
  const modifier = manual ? clamp($("#roll-modifier").value, 0, 99) : clamp($("#roll-modifier").value, -20, 20);
  const pool = manual ? modifier : Math.max(0, base + modifier);
  $("#pool-source-field").hidden = isStoryteller;
  $("#attribute-field").hidden = manual && !isStoryteller;
  $("#skill-field").hidden = manual && !isStoryteller;
  $("#base-pool-wrap").hidden = manual;
  $("#pool-plus").hidden = manual;
  $("#pool-equals").hidden = manual;
  $("#attribute-label").textContent = isStoryteller ? "Attribute (optional)" : "Attribute";
  $("#skill-label").textContent = isStoryteller ? "Skill (optional)" : "Skill";
  $("#modifier-label").textContent = manual ? "Total dice" : "Modifier";
  $("#roll-modifier").min = manual ? "0" : "-20";
  $("#roll-modifier").max = manual ? "99" : "20";
  $("#hunger-field").hidden = isStoryteller;
  $("#difficulty-field").hidden = false;
  $("#outcome-field").hidden = false;
  $("#hunger-hint").hidden = isStoryteller;
  $("#rouse-actions").hidden = isStoryteller;
  $("#successes-label").textContent = isStoryteller ? "Results" : "Successes";
  $("#base-pool").textContent = String(base);
  $("#total-pool").textContent = String(pool);
  $("#roll-hunger").max = String(pool);
  if (!isStoryteller) {
    $("#roll-hunger").value = String(hungerDiceCount(participant.resources.hunger.current, pool));
    $("#hunger-hint").textContent = `Defaults to ${hungerDiceCount(participant.resources.hunger.current, pool)} Hunger dice from current Hunger ${participant.resources.hunger.current}; adjust if the observed roll differs.`;
  }
  renderWillpowerReroll();
}

function renderWillpowerReroll() {
  const section = $("#willpower-reroll");
  const participant = state.participants.find((item) => item.id === $("#roll-participant").value);
  if (!participant || participant.role !== "player") {
    section.hidden = true;
    return;
  }
  const session = activeSession();
  const previousRoll = [...session.rolls].reverse().find((roll) =>
    roll.type === "roll" && roll.participantId === participant.id,
  );
  if (!previousRoll) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const availableDice = availableWillpowerRerollDice(previousRoll.pool, previousRoll.hungerDice);
  const rerollUsed = session.rolls.some((roll) =>
    roll.type === "reroll" && roll.parentRollId === previousRoll.id,
  );
  $("#reroll-summary").textContent = `${previousRoll.check}: ${previousRoll.successes} successes · ${availableDice} non-Hunger dice available (max 3).`;
  $("#reroll-willpower").textContent = `Willpower ${participant.resources.willpower.current}/${participant.resources.willpower.max}`;
  $("#reroll-dice").max = String(availableDice);
  $("#reroll-dice").value = String(Math.max(1, availableDice));
  $("#reroll-successes").max = String(Math.max(0, 99 - previousRoll.successes));
  $("#apply-willpower-reroll").disabled = rerollUsed || availableDice === 0 ||
    participant.resources.willpower.current < 1 || previousRoll.successes >= 99;
  if (rerollUsed) {
    $("#reroll-summary").textContent += " This roll has already used a Willpower reroll.";
  } else if (availableDice === 0) {
    $("#reroll-summary").textContent += " There are no non-Hunger dice to reroll.";
  } else if (participant.resources.willpower.current < 1) {
    $("#reroll-summary").textContent += " No Willpower remains to spend.";
  } else if (previousRoll.successes >= 99) {
    $("#reroll-summary").textContent += " Success total is already at its maximum.";
  }
}

function renderOutcomeSelection() {
  for (const button of $("#roll-outcome-selector").querySelectorAll("[data-outcome]")) {
    const selected = button.dataset.outcome === selectedOutcome;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

function updateOutcomeFromResults() {
  selectedOutcome = calculateOutcome($("#roll-successes").value, $("#roll-difficulty").value);
  renderOutcomeSelection();
}

function prefillQuickSelection() {
  const participant = state.participants.find((item) => item.id === selectedParticipantId);
  if (!participant || participant.role !== "player") return;
  $("#roll-participant").value = participant.id;
  $("#pool-mode").value = "sheet";
  $("#roll-attribute").value = quickAttribute;
  $("#roll-skill").value = quickSkill;
  $("#roll-modifier").value = "0";
  updatePoolPreview();
  $("#roll-successes").value = "";
  $("#roll-successes").focus({ preventScroll: true });
}

function renderAll() {
  renderSessionControls();
  renderParticipants();
  renderRollForm(true);
  renderHistory();
  renderOutcomeSelection();
  renderReport();
}

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY) return;
  if (event.newValue === null) {
    statusMessage.textContent = "Saved data was cleared in another tab. This tab still has its current copy.";
    return;
  }
  try {
    state = validateState(JSON.parse(event.newValue));
  } catch (error) {
    statusMessage.textContent = `Could not sync data from another tab: ${error.message}`;
    return;
  }
  if (!state.participants.some((item) => item.id === selectedParticipantId)) {
    selectedParticipantId = standalonePlayerId ?? state.participants.find((item) => item.role === "player").id;
  }
  renderAll();
  statusMessage.textContent = "Updated from another tab.";
});

$("#session-select").addEventListener("change", (event) => {
  state.activeSessionId = event.target.value;
  saveState("Session changed.");
  renderAll();
});

$("#session-name").addEventListener("change", (event) => {
  activeSession().name = event.target.value.trim() || "Untitled session";
  saveState("Session renamed.");
  renderSessionControls();
});

$("#new-session").addEventListener("click", () => {
  const session = makeSession(`Session ${state.sessions.length + 1}`);
  state.sessions.push(session);
  state.activeSessionId = session.id;
  saveState("New session started.");
  renderAll();
});

$("#add-player").addEventListener("click", () => {
  const players = state.participants.filter((item) => item.role === "player").length;
  if (players >= 5) return;
  const participant = makeParticipant("player", `Player ${players + 1}`);
  state.participants.splice(state.participants.length - 1, 0, participant);
  selectedParticipantId = participant.id;
  $("#pool-mode").value = "sheet";
  $("#roll-modifier").value = "0";
  saveState("Player added.");
  renderAll();
});

function addResourceHistory(participant, resource, from, to) {
  if (from === to) return false;
  const now = new Date();
  activeSession().rolls.push({
    type: "resource",
    id: makeId(),
    timestamp: now.toISOString(),
    time: new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(now),
    participantId: participant.id,
    participantName: participant.name,
    characterName: participant.characterName,
    resource,
    from,
    to,
  });
  return true;
}

participantList.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.participantTab) {
    selectedParticipantId = button.dataset.participantTab;
    renderParticipants();
    $("#roll-participant").value = selectedParticipantId;
    const active = state.participants.find((item) => item.id === selectedParticipantId);
    if (active.role === "storyteller") {
      $("#pool-mode").value = "manual";
      $("#roll-attribute").value = "";
      $("#roll-skill").value = "";
      $("#roll-modifier").value = "0";
    } else {
      $("#pool-mode").value = "sheet";
      $("#roll-modifier").value = "0";
    }
    updatePoolPreview();
    return;
  }
  if (button.dataset.quickSkill) {
    quickSkill = button.dataset.quickSkill;
    renderParticipants();
    prefillQuickSelection();
    return;
  }
  if (button.dataset.quickAttribute) {
    quickAttribute = button.dataset.quickAttribute;
    renderParticipants();
    prefillQuickSelection();
    return;
  }
  const participantId = button.dataset.participant;
  if (button.classList.contains("remove-player")) {
    const players = state.participants.filter((item) => item.role === "player");
    if (players.length <= 2) return;
    state.participants = state.participants.filter((item) => item.id !== participantId);
    expandedSheets.delete(participantId);
    saveState("Player removed.");
    renderAll();
    return;
  }
  if (!button.dataset.resource) return;
  const participant = state.participants.find((item) => item.id === participantId);
  const resource = participant.resources[button.dataset.resource];
  const previous = resource.current;
  adjustResource(participant, button.dataset.resource, Number(button.dataset.delta));
  addResourceHistory(participant, button.dataset.resource, previous, resource.current);
  saveState("Resource updated.");
  renderParticipants();
  renderRollForm(true);
  renderHistory();
});

participantList.addEventListener("toggle", (event) => {
  if (event.target.matches("details.sheet-details")) {
    if (event.target.open) expandedSheets.add(selectedParticipantId);
    else expandedSheets.delete(selectedParticipantId);
  }
}, true);

participantList.addEventListener("change", (event) => {
  const target = event.target;
  const participant = state.participants.find((item) => item.id === target.dataset.participant);
  if (!participant) return;
  if (target.dataset.name) {
    participant[target.dataset.name] = target.value.trim() || (target.dataset.name === "name" ? "Unnamed player" : "Unnamed character");
    target.value = participant[target.dataset.name];
  } else if (target.dataset.stat) {
    participant[target.dataset.statGroup][target.dataset.stat] = clamp(target.value, 0, 5);
    target.value = String(participant[target.dataset.statGroup][target.dataset.stat]);
  } else if (target.dataset.resourceCurrent) {
    const resource = participant.resources[target.dataset.resourceCurrent];
    const previous = resource.current;
    resource.current = clamp(target.value, 0, resource.max);
    target.value = String(resource.current);
    addResourceHistory(participant, target.dataset.resourceCurrent, previous, resource.current);
  } else if (target.dataset.resourceMax) {
    const resource = participant.resources[target.dataset.resourceMax];
    const previous = resource.current;
    resource.max = clamp(target.value, 0, target.dataset.resourceMax === "hunger" ? 5 : 99);
    resource.current = clamp(resource.current, 0, resource.max);
    target.value = String(resource.max);
    addResourceHistory(participant, target.dataset.resourceMax, previous, resource.current);
  } else {
    return;
  }
  saveState();
  if (target.dataset.resourceCurrent || target.dataset.resourceMax) {
    renderParticipants();
    renderRollForm(true);
    renderHistory();
  } else if (target.dataset.name || target.dataset.stat) {
    if (target.dataset.name) renderParticipants();
    renderRollForm(true);
    if (target.dataset.name) renderReport();
  }
});

$("#roll-participant").addEventListener("change", updatePoolPreview);
$("#roll-participant").addEventListener("change", (event) => {
  selectedParticipantId = event.target.value;
  const participant = state.participants.find((item) => item.id === selectedParticipantId);
  if (participant.role === "storyteller") {
    $("#pool-mode").value = "manual";
    $("#roll-attribute").value = "";
    $("#roll-skill").value = "";
    $("#roll-modifier").value = "0";
  } else {
    $("#pool-mode").value = "sheet";
    $("#roll-modifier").value = "0";
  }
  renderParticipants();
  updatePoolPreview();
});
$("#roll-attribute").addEventListener("change", updatePoolPreview);
$("#roll-skill").addEventListener("change", updatePoolPreview);
$("#roll-modifier").addEventListener("input", updatePoolPreview);
$("#roll-successes").addEventListener("input", updateOutcomeFromResults);
$("#roll-difficulty").addEventListener("input", updateOutcomeFromResults);
$("#roll-successes").addEventListener("focus", () => {
  $("#roll-successes").value = "";
  updateOutcomeFromResults();
});
document.addEventListener("focusin", (event) => {
  if (event.target.matches('input[type="number"]')) event.target.select();
});
$("#roll-outcome-selector").addEventListener("click", (event) => {
  const button = event.target.closest("[data-outcome]");
  if (!button) return;
  selectedOutcome = button.dataset.outcome;
  renderOutcomeSelection();
});
$("#pool-mode").addEventListener("change", () => {
  $("#roll-modifier").value = "0";
  updatePoolPreview();
});
$("#report-scope").addEventListener("change", (event) => {
  reportScope = event.target.value;
  const query = reportScope === "all" ? "?view=history&session=all" : `?view=history&session=${encodeURIComponent(reportScope)}`;
  window.history.replaceState(null, "", query);
  renderReport();
});
$("#report-content").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-report-copy]");
  if (!button) return;
  try {
    if (button.dataset.reportCopy === "chart") {
      await copyHungerChart();
      statusMessage.textContent = "Hunger graph copied to the clipboard.";
      return;
    }
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard access is unavailable in this browser.");
    }
    const text = button.dataset.reportCopy === "dice"
      ? reportDiceTableText()
      : reportRouseTableText();
    await navigator.clipboard.writeText(text);
    statusMessage.textContent = button.dataset.reportCopy === "dice"
      ? "Episode dice table copied to the clipboard."
      : "Rouse table copied to the clipboard.";
  } catch (error) {
    statusMessage.textContent = `Copy failed: ${error.message}`;
  }
});
$("#apply-willpower-reroll").addEventListener("click", () => {
  const participant = state.participants.find((item) => item.id === $("#roll-participant").value);
  if (!participant || participant.role !== "player") return;
  const session = activeSession();
  const previousRoll = [...session.rolls].reverse().find((roll) =>
    roll.type === "roll" && roll.participantId === participant.id,
  );
  if (!previousRoll || participant.resources.willpower.current < 1 ||
      session.rolls.some((roll) => roll.type === "reroll" && roll.parentRollId === previousRoll.id)) return;
  const availableDice = availableWillpowerRerollDice(previousRoll.pool, previousRoll.hungerDice);
  const rerolledDice = clamp($("#reroll-dice").value, 1, availableDice);
  if (availableDice === 0) return;
  const addedSuccesses = clamp($("#reroll-successes").value, 0, 99 - previousRoll.successes);
  const previousSuccesses = previousRoll.successes;
  const previousOutcome = previousRoll.outcome;
  const resourceFrom = participant.resources.willpower.current;
  adjustResource(participant, "willpower", -1);
  previousRoll.successes = clamp(previousSuccesses + addedSuccesses, 0, 99);
  if (previousOutcome === "Success" || previousOutcome === "Failure") {
    previousRoll.outcome = calculateOutcome(previousRoll.successes, previousRoll.difficulty);
  }
  const now = new Date();
  session.rolls.push({
    type: "reroll",
    id: makeId(),
    timestamp: now.toISOString(),
    time: new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(now),
    participantId: participant.id,
    participantName: participant.name,
    characterName: participant.characterName,
    check: "Willpower reroll",
    pool: rerolledDice,
    rerolledDice,
    hungerDice: 0,
    successes: addedSuccesses,
    difficulty: previousRoll.difficulty,
    outcome: "Other",
    parentRollId: previousRoll.id,
    successChange: { from: previousSuccesses, to: previousRoll.successes },
    outcomeBefore: previousOutcome,
    outcomeAfter: previousRoll.outcome,
    resourceChange: {
      resource: "willpower",
      from: resourceFrom,
      to: participant.resources.willpower.current,
    },
  });
  saveState("Willpower reroll recorded; successes added to the previous roll.");
  $("#reroll-successes").value = "0";
  renderParticipants();
  renderRollForm(true);
  renderHistory();
});

rollForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const participant = state.participants.find((item) => item.id === $("#roll-participant").value);
  if (!participant) return;
  const manual = $("#pool-mode").value === "manual";
  const isStoryteller = participant.role === "storyteller";
  const attribute = manual && !isStoryteller ? "" : $("#roll-attribute").value;
  const skill = manual && !isStoryteller ? "" : $("#roll-skill").value;
  const modifier = manual ? clamp($("#roll-modifier").value, 0, 99) : clamp($("#roll-modifier").value, -20, 20);
  const pool = manual ? modifier : calculatePool(participant, attribute, skill, modifier);
  const check = isStoryteller
    ? [attribute, skill].filter(Boolean).join(" + ") || "Storyteller pool"
    : manual ? "Manual pool" : [attribute, skill].filter(Boolean).join(" + ") || "Custom roll";
  const now = new Date();
  activeSession().rolls.push({
    type: "roll",
    id: makeId(),
    timestamp: now.toISOString(),
    time: new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(now),
    participantId: participant.id,
    participantName: participant.name,
    characterName: isStoryteller ? "" : participant.characterName,
    check: !manual && modifier ? `${check} (${modifier > 0 ? "+" : ""}${modifier})` : check,
    pool,
    hungerDice: isStoryteller ? 0 : clamp($("#roll-hunger").value, 0, pool),
    successes: clamp($("#roll-successes").value, 0, 99),
    difficulty: clamp($("#roll-difficulty").value, 0, 99),
    outcome: selectedOutcome,
  });
  saveState("Roll recorded.");
  $("#roll-successes").value = "";
  $("#roll-difficulty").value = "2";
  updateOutcomeFromResults();
  renderParticipants();
  renderRollForm(true);
  renderHistory();
  $("#roll-successes").focus();
});

function recordRouse(success) {
  const participant = state.participants.find((item) => item.id === $("#roll-participant").value);
  if (!participant || participant.role !== "player") return;
  const resourceChange = applyRouseResult(participant, success);
  const now = new Date();
  activeSession().rolls.push({
    type: "rouse",
    id: makeId(),
    timestamp: now.toISOString(),
    time: new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(now),
    participantId: participant.id,
    participantName: participant.name,
    characterName: participant.characterName,
    check: "Rouse check",
    pool: 1,
    hungerDice: 0,
    successes: success ? 1 : 0,
    difficulty: 1,
    outcome: success ? "Rouse success" : "Rouse failure",
    resourceChange,
  });
  const message = success
    ? "Rouse success recorded."
    : resourceChange.to > resourceChange.from
      ? "Rouse failure recorded; Hunger increased."
      : "Rouse failure recorded; Hunger is already at maximum.";
  saveState(message);
  renderParticipants();
  renderRollForm(true);
  renderHistory();
}

$("#rouse-success").addEventListener("click", () => recordRouse(true));
$("#rouse-failure").addEventListener("click", () => recordRouse(false));

function undoLastRoll() {
  const rolls = activeSession().rolls;
  if (rolls.length === 0) return;
  const last = rolls.pop();
  const participant = state.participants.find((item) => item.id === last.participantId);
  if (participant && last.type === "resource") {
    participant.resources[last.resource].current = clamp(last.from, 0, participant.resources[last.resource].max);
  } else if (participant && last.type === "reroll") {
    const originalRoll = rolls.find((roll) => roll.id === last.parentRollId);
    if (originalRoll) {
      originalRoll.successes = last.successChange.from;
      originalRoll.outcome = last.outcomeBefore;
    }
    if (last.resourceChange) {
      participant.resources[last.resourceChange.resource].current = clamp(
        last.resourceChange.from,
        0,
        participant.resources[last.resourceChange.resource].max,
      );
    }
  } else if (participant && last.resourceChange) {
    participant.resources[last.resourceChange.resource].current = clamp(
      last.resourceChange.from,
      0,
      participant.resources[last.resourceChange.resource].max,
    );
  }
  saveState("Last roll removed.");
  renderParticipants();
  renderRollForm(true);
  renderHistory();
}

$("#undo-roll").addEventListener("click", undoLastRoll);
$("#undo-roll-focused").addEventListener("click", undoLastRoll);

$("#export-data").addEventListener("click", () => {
  downloadBlob(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }), "vtm-role-recorder-backup.json");
  statusMessage.textContent = "Backup exported.";
});

$("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const imported = validateState(JSON.parse(await file.text()));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
    state = imported;
    statusMessage.textContent = "Backup imported.";
    renderAll();
  } catch (error) {
    statusMessage.textContent = `Backup was not imported: ${error.message}`;
  } finally {
    event.target.value = "";
  }
});

renderAll();
