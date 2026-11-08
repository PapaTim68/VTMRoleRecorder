# VTM Role Recorder

A local browser app for recording observed Vampire: The Masquerade dice rolls during a stream or game. Character sheets are entered once as editable Attribute and Skill ratings; roll pools are calculated from those ratings, with a per-roll modifier for situational changes.

## Run locally

Double-click `start-server.bat` to start the local server, then open <http://127.0.0.1:8000>. Press Ctrl+C in the server window to stop it.

Alternatively, run Python's static file server from the repository folder:

```powershell
py -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000> in a browser. The app has no build or package-install step. Records are stored in that browser's local storage; use **Export backup** regularly to save a portable JSON backup. Importing a backup replaces the current local app data.

To load the converted workbook history, first export any app data you want to keep, then use **Import backup** to select `vtm-role-recorder-import.json`. The backup creates a separate session for each episode sheet, EP01–EP45; EP43 is included as an empty session because its worksheet has no recorded events. Episode sheets are the source of truth; the aggregate **All** sheet is not imported to avoid duplicating rolls. The episode sheets sum to 5,590 dice (4,100 normal and 1,490 Hunger), while the workbook's **All** summary reports 5,513 (4,035 normal and 1,478 Hunger), so the workbook's episode logs and aggregate do not reconcile by 77 dice. The 5,590 episode-sheet count includes 4 dice recorded on DMG rows; roll-only reports exclude those, while **Source dice** preserves the sheet total. Source success totals and the **Source success / dice** ratio reproduce the workbook's DICE/SUCCESS calculation, including special values stored in its DICE and SUCCESS cells; these are kept separate from roll successes and outcome statistics. Rows without a recorded outcome retain their dice and successes but are excluded from outcome counts and success-rate denominators. Damage and Health entries are separate history events, not rolls. The roster uses the latest populated episode's available character data and Hunger trackers. Since the workbook does not contain roll timestamps or resource maxima, imported rolls display `Imported`, and resource maxima use the app defaults unless the imported current value exceeds them. David/Bub has no character-sheet data in the episode sheets, so those ratings use the app's defaults.

## Use

- The initial roster has two players and one Storyteller. Add players up to five.
- Select a player tab to edit that character's sheet and current/maximum Hunger, Willpower, and Health. Resource changes are added to the session history and can be undone.
- Use **Open player tab** on a selected character to open a focused recorder in a separate browser tab. Each player page has a direct URL (`?participant=<id>`). The layout reflows for narrow or zoomed-in windows; on compact screens, scroll as needed. All tabs on the same local app address stay synchronized through browser storage.
- Open **History & stats** in a separate tab to review the roll history and reports. Choose a session or **All sessions · Total**. Reports show roll-only dice and successes, the source-sheet successes-per-die ratio, outcome distribution, Rouse success rates, damage dealt, Health changes, and a per-player Hunger chart indexed by recorded roll count. Total roll dice includes Rouse-check dice; unresolved outcomes are omitted from outcome counts and rate denominators. Each player's line continues across every roll, stays level while others roll, and ends at the latest Hunger value recorded in that report scope. Use **Copy graph image** beside the Hunger chart to copy its PNG to the clipboard. Use **Copy dice table** and **Copy Rouse table** beside their respective tables to copy aligned plain-text tables. Clipboard access requires a browser that supports clipboard writing; the app must be served from localhost or another secure context.
- In **Quick roll**, select an Attribute and a Skill from the Physical, Social, and Mental groups to immediately prefill the roll form. Enter observed results before recording; selection does not record automatically.
- In quick entry, choose an Attribute + Skill to calculate the base pool, then enter a modifier. Hunger dice default to current Hunger, limited by the pool, and are shown separately as part of the total dice pool.
- Difficulty defaults to 2. Success or Failure is selected automatically from observed successes and difficulty; use the outcome buttons to override it when a roll is Critical, Bestial failure, or Messy critical.
- Roll history keeps tracker changes but no longer includes a free-text note field. Older backups with note values remain importable; their notes are ignored.
- Use the **Rouse Check** buttons for player characters: success leaves Hunger unchanged; failure adds 1 Hunger (up to its maximum). Both results are recorded.
- After a player roll, spend 1 Willpower to reroll up to three non-Hunger dice once; enter the successes from those dice and they are added to the original roll. The Willpower tracker and history record the spend.
- Select the Storyteller tab to name the Storyteller and log NPC rolls using total dice, results, difficulty, and outcome. Attribute and Skill are optional labels, and no single Storyteller character sheet is assumed.
- Enter observed successes, difficulty, and outcome for player rolls, then record the roll.
- Start a new session, then edit its name to keep its roll history separate. Roster and resource values carry over between sessions.

## Checks

Run the unit tests with Node.js (no dependencies need to be installed):

```powershell
npm test
```

Run a single test file with `node --test tests/core.test.mjs`. There are no separate build or lint commands; the app is plain HTML, CSS, and JavaScript modules.
