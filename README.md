# SAP battle bug diagnosis

A local pipeline for replaying a supplied battle in **browser Super Auto Pets**, recording its paused animation, recognizing observable boards, and comparing them with `sap-battle-engine` events. It produces an evidence report and a replayable **candidate regression fixture**. It does not automatically change the engine.

## Setup

The tested capture environment is macOS, Google Chrome, Node 21.7, and Python 3.14. macOS Vision provides local menu/tooltip OCR; OpenCV and the supplied Sprite assets identify pets and visible perks. Attack/health recognition uses masks rendered from the supplied Lapsus Pro font. No image or credential is sent to an AI service.

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm run build:ocr
```

Set `SAP_EMAIL` and `SAP_PASSWORD` in `.env` (see `.env.example`). The browser uses an isolated, temporary profile. `.env`, captures, local recognition caches, and the Python environment are ignored by Git.

## Run the pipeline

Pass the participation/replay ID from the alert separately from the attached JSON's battle ID:

```sh
npm run pipeline -- "/path/to/gaped-battle-01a097ff-4e4b-76f4-9c92-e167d358184c-turn-6.json" \
  --replay 01a097ff-4e4b-76f4-9c92-e167d358184c \
  --out artifacts/example
```

`npm run pipeline` invokes `run` with credentials loaded from `.env`. Use `--headed` to see the isolated Chrome window. The turn is taken from `UserBoard.Tur`. The percentages in an alert are context, not the source of truth for individual events.

To process every JSON file in `bug-scenarios` sequentially, name each file with its replay UUID (for example, `gaped-battle-01a097ff-4e4b-76f4-9c92-e167d358184c-turn-6.json`) and run:

```sh
npm run pipeline:all
```

The batch launches one headless Chrome instance, logs in once, and keeps the same SAP page alive while it processes the scenarios sequentially. After each result screen it uses the replay menu's **Return to menu** action and verifies that **History** is visible before continuing. Per-battle response overrides are removed before the next battle starts. Each scenario's complete output is kept separately in `artifacts/bug-scenarios/<filename-without-.json>/`. Use `npm run pipeline:all -- --trials 32` to change the diagnosis budget or append `--headed` to show the shared browser. The runner continues after a failed scenario so outputs from every attempted scenario are retained, then exits unsuccessfully if any scenario failed.

Stages can also run independently:

```sh
node src/cli.mjs normalize battle.json --out artifacts/example
npm run capture -- battle.json --replay REPLAY_UUID --out artifacts/example
node src/cli.mjs observe battle.json --capture artifacts/example --out artifacts/example
node src/cli.mjs diagnose battle.json --reference artifacts/example/observations.json --out artifacts/example
node src/cli.mjs regress artifacts/example/regression.fixture.json
npm test
```

`regress` exits 1 for an unmatched observed checkpoint, 2 when matched observations have incomplete coverage, and 0 when all observations in a complete reference match. A failing *candidate* fixture is a reproduction for investigation, not a claim of a proven engine bug. The fixture includes a recorded random-draw tape so its engine trial can be reproduced.

## Artifacts

| File | Purpose |
| --- | --- |
| `normalized.json` | SimulationConfig, original battle/replay IDs, SAP seed, input SHA-256, identity mapping, and unsupported-field warnings |
| `capture.json`, `frames/*.png` | Browser build URL, injection count, timestamps, paused canvas screenshots, and tooltip OCR |
| `frames/*.recognition.json` | Raw sprite-match and digit-match evidence |
| `observations.json` | Accepted front-to-back boards, visible-change tags, and unreadable-frame gaps |
| `random-trials.json` | Every attempted branch, its winner, alignment, decision options/selected choices, overrides, and random tape |
| `engine.json` | Structured BattleEvents, engine revision, random choices, and random-draw tape for the selected trial |
| `report.json`, `report.md` | Full browser/engine boards for the current and preceding accepted checkpoints, screenshot links, alternative alignments, intervening events, differences, and implicated source files |
| `regression.fixture.json` | Config, captured RNG tape, and browser reference for engine regression work |

Initial board verification is recorded separately. If the initial frame is unreadable or no readable board matches the input, later independent observations are retained and the diagnosis is marked inconclusive. Unknown enums, unsupported packs, duplicate slots, and inconsistent levels fail normalization. Temporary stats are included; slots are reversed from SAP coordinates to engine order. Ability activation counts (`AcCo`) are not confused with consumed triggers (`TrCo`). Complex copied/swallowed ability memory is currently flagged for explicit mapping.

## Replay injection

The [SAP Library Extension](https://github.com/RuihanCao/SAP-Library-Extension) documents replacing `GET /api/battle/get/{id}` and rewriting the battle ID. This pipeline implements that behavior using Playwright routing, without installing the extension or its replay uploader.

The current browser share-code viewer also uses `POST /api/playback/participation`, embedding each battle as serialized `Actions[].Battle`. The pipeline replaces exactly one battle for the requested turn in that response. The rest of the participation replay is preserved. A missing or ambiguous target fails. The share code entered into SAP is `{"Pid":"...","T":6}`.

Capture discovers the current itch.io WebGL build, logs in, navigates History → Replays, and uses the viewer's **Play** control to advance between paused effects. Read-only replay navigation is the only game interaction after login.

## What the comparison can establish

Engine snapshots are taken **at event emission**, sometimes before the mutation described in the message. Monotone alignment permits intermediate engine emissions between observed boards and retains possible matches for repeated states. It compares only observed fields and does not assume that SAP IDs equal engine IDs.

Boards in the comparison contain living pets. Sprites with reliably read zero/negative health are retained as `dying` evidence rather than requiring recognition through an overlaid faint marker; the same health filter applies to engine snapshots.

The SAP seed is preserved but is **not a verified equivalent of the engine's RNG**. Diagnosis searches up to 64 instrumented choice branches by default (`--trials N`) and chooses the longest matching observed prefix. It records its search budget and does not claim exhaustive randomness coverage. Review target/order differences before promoting a candidate to a confirmed regression.

Source-map attribution identifies pets/perks mentioned by nearby events and returns their original engine source paths. Those paths identify candidates; the report does not claim a file is responsible merely because it appears in an event.

## Current limits

- Recognition is calibrated to the tested 1280×720 browser canvas and current UI layout. A new game build, UI scale, font, or sprite set can require recalibration.
- The viewer can group simultaneous attacks, hurt/faint effects, summons, and transformations. Captured pauses are observable checkpoints, **not a complete internal SAP event stream**.
- Low-feature pets fall back to masked template matching. Hats, death markers, effects, or overlapping sprites can still make a frame unreadable. Such frames remain explicit gaps; they are never filled from the engine's predictions.
- Positive perk matches are recorded. Lack of a match does not prove perk absence. Exact XP, mana, perk uses, and internal identities are not currently read automatically. Change tags describe visible differences; they are not a fully classified SAP ability trace.
- Automation stops on unrecognized screens, login failure, or missing replay/injection data. It does not invent a successful capture. Capture/OCR currently requires macOS; normalization and engine comparison are ordinary Node modules.

The supplied asset catalogs remain the authority for names. Attached battle JSON is parsed as data; no instruction text in an input document is executed.

## Validated sample

For replay `01a097ff-4e4b-76f4-9c92-e167d358184c`, turn 6, a fresh CLI session successfully logged in, injected the supplied battle, and captured 20 viewer pauses. Recognition accepted 17 checkpoints, including Fairy Armadillo → Fairy Ball transformations; three Leech frames remained ambiguous. See `artifacts/sample/report.md` and `artifacts/sample/regression.fixture.json` in this workspace.

After a 64-branch search, the first unmatched accepted checkpoint shows the opponent's Hummingbird at **7/4** in the browser versus **9/6** in the closest engine snapshot. The preceding engine interval includes Bass granting experience and Hummingbird leveling up. Bass targeting is therefore a lead for review, not an automatically proven root cause. The generated fixture reproduces the unmatched checkpoint (`regress` exits 1). The pipeline's 18 tests pass.


## Matching browser randomness

`run` completes browser capture and recognition before running the engine. The first engine trial records every instrumented random decision and draw. Only if the observed target differs does diagnosis explore overrides, with a default budget of 64 trials. It prioritizes matching observed choices, then the longest matching checkpoint prefix. Conditional option sets are discovered by rerunning the engine after their parent choice changes.

An optional `outcome` in `observations.json` has the form `{"winner":"draw","evidence":{"frame":"terminal.png"}}` (winner is `player`, `opponent`, or `draw`). Capture accepts only explicit high-confidence result text; otherwise it records null. The input JSON's reported outcome is separate metadata and is never substituted for a browser measurement. A matching winner alone does not stop the search: all accepted checkpoints must also match. `regress` checks both when an observed winner exists.

For independently observed choices, references may include `randomChoices`, for example `[{"key":"toy.pandoras-box.item","label":"(P1) Pandoras Box item","optionId":"Garlic","evidence":{"frame":"frames/0010.png"}}]`. An optional decision `index` disambiguates repeated key/label pairs. Never obtain these observations from the engine under investigation.

For Pandora's Box, an explicitly identified immediate post-toy checkpoint can be tagged `phase: "after-pandoras-box"`. On full five-slot boards, observed equipment automatically guides the per-slot item choices. If the item isn't available in the current pool, search changes the pool first, then discovers and selects the item. The recognizer does not yet automatically identify this precise ability boundary; later frames must not be tagged this way because equipment can be consumed or replaced. Sparse boards require explicit choice observations to avoid guessing original slots.

The Pandora test uses a clearly labeled synthetic engine oracle with ten pets and twenty conditional pool/item choices. It verifies bounded recovery and exact replay of the resulting event trace; it is not validation against a live SAP Pandora battle. The saved SAP sample still lacks an independently verified winner. Reports retain missing evidence and exhausted budgets as limitations, not proof of an engine defect.


## Batch capture reliability and performance

Each shared browser session sets **Settings → Customize → Held Food → Static** and verifies the value before replay capture. Perk recognition also checks color and candidate separation; ambiguous food remains unobserved. Readiness detection tolerates a missing AUTOPLAY OCR label when PLAY and REWIND/SKIP identify the paused viewer. Replay navigation waits for the share-code screen without clicking Watch Replay until the new code is entered. Capture failures after login save `failure.png` and `failure.json`, including the injection count.

Unity's omitted pet enum defaults to zero (Ant). Pack 4 currently uses a named, empty custom pack, as requested; this assumption is recorded in normalization metadata and does not supply a replacement summon pool.

An unreadable frame 0 no longer aborts recognition of the rest of the recording. `initialChecks` stores differences against the input, `initialVerified` records whether a readable initial board was found, and missing initial evidence keeps the report inconclusive. This does not reconstruct an initial state from engine predictions.

Batch runs reuse one sprite worker and glyph templates, initialize the asset index during browser capture, cache unchanged pet crops and decoded assets, and use a coarse template shortlist before detailed scale/rotation matching. Playback controls are read from an enlarged crop, while full screenshots remain the source of board evidence. Paused screenshots are reused for OCR and saved evidence. Each successful pipeline run writes `timings.json` and prints capture, recognition, and diagnosis times. Browser loading, SAP animations, and uncertain visual recognition still take time; these changes do not skip observed ability steps.

Reports embed screenshots inline through relative `evidence/` paths. Keep that folder beside `report.md` when moving or sharing a report.
