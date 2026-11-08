# Copilot instructions for VTMRoleRecorder

## Commands

- Run the app locally: `py -m http.server 8000 --bind 127.0.0.1`, then open `http://127.0.0.1:8000`.
- Run all tests: `npm test`.
- Run a single test file: `node --test tests/core.test.mjs`.
- There is no build or lint step; the app uses browser-native HTML, CSS, and JavaScript modules with no external runtime dependencies.

## Architecture

- `index.html` is the semantic page structure; `styles.css` owns the responsive dark UI.
- `app.js` renders and wires the participant tabs, standalone `?participant=<id>` recorder pages, Attribute/Skill quick-roll buttons, observed-roll form, Rouse controls, session history, cross-tab storage sync, and JSON backup controls.
- `core.js` contains pure state factories, pool/resource calculations, and backup validation. Keep calculation and validation logic here so it can be tested independently.
- All state is stored in browser `localStorage`; there is no server-side state or external API. The Python server is only for serving static files and must stay bound to `127.0.0.1`.
- Standalone player pages use the same localStorage key and origin as the main page; preserve the storage event sync when changing persistence or rendering.
- The Excel workbook in the repository is a reference for the existing episode-based roll log, not an application data store.

## Domain conventions

- A roster contains 2–5 player characters and exactly one Storyteller. Player and Storyteller rolls are both supported.
- Attribute and Skill ratings form the base dice pool. A roll-specific modifier adjusts that pool, and Hunger dice default to `min(current Hunger, pool)` but remain editable for observed exceptions.
- Rolls record the observed successes, difficulty, and outcome; do not generate or infer the streamed dice result.
- The Storyteller represents anonymous NPC rolls: use a manually entered pool and successes, with optional Attribute/Skill labels rather than a character sheet.
- Rouse failure adds one Hunger (bounded by its maximum), while success leaves Hunger unchanged; both are recorded as Rouse events.
- Player Hunger, Willpower, and Health are current/maximum pairs. Resource changes are session-history events; roster and current resource state carries between named sessions, while each session owns its own history.
- Keep backup validation and resource/pool bounds in `core.js`, and update the focused Node tests when changing those rules.
- The state shape is effectively `{ version, participants, sessions, activeSessionId }`; do not introduce server-side persistence or a second store. The app intentionally relies on a single browser `localStorage` key.
- `package.json` only defines the Node test runner; do not assume a build, lint, or dependency-install pipeline exists unless a feature explicitly requires it.
