# September batch investigation

The reported failures have separate capture, recognition, normalization, report
ranking, and engine-behavior causes. A paused browser checkpoint is not necessarily
an engine event boundary. Waiting longer cannot fix a different logical effect order.

## Cases

| Battle / turn | Finding and disposition |
| --- | --- |
| 01a09b87… / 3 | Saved failure is visibly paused. OCR omits PLAY. The triangle fallback recognizes it. |
| 01a09b90… / 9 | Same missing PLAY OCR; triangle fallback recognizes the saved failure. |
| 01a09590… / 12 | Same missing PLAY OCR, with extra tooltip text in the controls crop. Triangle fallback recognizes it. |
| e15a8957… / 7 | Abomination's Brain Cramp (ability enum 379) and Drop Bear (371) were silently omitted because Unity omitted false `Nat`. These memories now reach the engine. With the original reference, the matching prefix advances from 4 to 8 checkpoints. A later divergence remains. |
| af414de6… / 11 | Slot 9 is Elephant Seal, obscured by a mana badge. Masking that template region recovers the initial board and 12 of 21 saved frames, versus 1 before. Other occluded frames remain gaps. A later Tarantula Hawk health discrepancy remains, and Slime has unsupported copied ability memory, so diagnosis stays inconclusive. |
| 1176f72c… / 17 | Harpy Eagle cannot summon from the deliberately empty custom deck: the engine returns early for an empty tier-one pool. Preserve that assumption and flag the diagnosis inconclusive. Browser shows a 5/5 Malay Tapir; supplying a guessed pool would conceal missing input evidence. |
| faaac0bb… / 18 | Browser processes Whale/Farmer Crow before Cerberus/Amalgamation. Engine processes Cerberus first. Browser Farmer Crow also buffs Whale to 14/15, Gorilla to 22/22, Chinchilla to 24/27; the engine logs feeding Corncobs but their stats do not change. This needs engine investigation, not a capture delay. |
| 082c1144… / 9 | The +2/+2 is Mammoth's buff to Shark. Browser applies Mammoth, then Aye-aye, then Shark. Engine applies Aye-aye, then Mammoth, then Shark. Both reach Shark 18/25. Intermediate ordering differs; no missing final +2/+2. Versus result text `GAME WON!` was also previously unrecognized. |
| a688ee1c… / 7 | Browser applies Hippo's knockout buff before Pygmy Hog transforms. Engine transforms Hog first. Both later show Hippo 13/9 and Angry Pygmy Hog 5/5. Keep the intermediate mismatch and report reconvergence. |
| b8f05450… / 10 | SIFT matched neighboring Piranha features inside the Leech crop. Rejecting off-center geometry recovers Leech and verifies the initial board. A later Ibex health-reduction discrepancy remains: the source floors damage (`floor(14 × .7) = 9`), leaving 5 health, while the browser shows 4. Rounding the remaining health is a candidate engine correction. |
| 7b2e9a38… / 7 | Browser applies Togian Babirusa's +1 health, then Rhino's knockout damage, then Hog's transform trigger. Engine transforms Hog before the faint/knockout effects. Browser kills the untransformed Hog; engine damages the transformed Hog. Fresh capture reproduces this difference. |

The apparent team deletions came from diagnostic ranking: the old distance counted
an entire missing side as one differing field. An empty end-of-battle snapshot
could beat an almost-correct board. Missing pets now incur a per-pet penalty, and
identity differences also weigh more than an individual stat. Exact matching is
unchanged. A later reconvergence is explanatory evidence, not permission to discard
an earlier mismatch or to fabricate a browser board from engine predictions.

## Engine follow-up

The installed `sap-battle-engine` dependency was not patched. Its source map points
to the attack/faint trigger scheduler (Aye-aye/Pygmy Hog versus faint/knockout
ordering), `catalog/pets/custom/tier-5/farmer-crow.class.ts` and Corncob application,
and custom summon-pool construction. The copied Abomination input omission was
fixed in this repository. Unknown/nested memories remain explicit limitations.

The custom deck stays empty. A correct Harpy Eagle reproduction requires the real
summon pool; the single observed Malay Tapir is not evidence for a complete pool.

## Evidence and checks

Saved original captures remain in `artifacts/bug-scenarios/`. Reprocessed evidence
is under `artifacts/recheck-saved/`, fresh browser runs under
`artifacts/recheck-september/`, and current normalized reports under
`artifacts/recheck-normalization/`. Each directory contains the complete replay
UUID and turn in its name. Reports retain screenshots and candidate regression
fixtures with the selected engine random tape.

The checked-in vision fixtures cover the missed PLAY label, neighboring Piranha,
and mana-covered Elephant Seal. Tests also cover PAUSE rejection, stat settling,
missing-team ranking, reconvergence without false acceptance, copied abilities,
and the empty Harpy Eagle pool.

Validation: `npm test` passed all 27 tests. Fresh capture completed for the three
original control failures: turn 3 (14 checkpoints), turn 9 (16), and turn 12 (26).
Fresh Rhino (11 checkpoints) and Hippo (23) captures also completed and reproduced
the ordering differences. Capture completion does not mean all frames were
readable or that the engine matched the browser.

The fresh Shark run captured 26 pauses and reached the versus result screen, but
full-color OCR returned `GAME WON!` at confidence 0.5. The final fix thresholds an
enlarged result crop, producing confidence 1.0 without reducing the 0.98 acceptance
threshold. A capture-state-machine check using the actual saved screens and real
macOS OCR passed with `complete: true` and winner `player`. The full live replay
was not repeated after that final preprocessing change; its original failed
manifest remains intact. This verification is distinct from a successful fresh
end-to-end run.
