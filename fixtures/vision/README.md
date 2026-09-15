These stat strips come from the injected sample battle in browser SAP (1280×720 canvas), frames 0 and 2. Other screen areas are blanked. Glyph templates were rendered from the supplied LapsusPro-Bold.otf using the browser canvas. They exercise real rendered digits, including negative health, independently of the engine.

September batch regressions: `paused-ant.png` is the turn-3 control timeout
(01a09b87); `play-icon.png` is its exact 29×30 PLAY triangle crop at (548,29).
`leech-neighbor.png` is turn 10 (01a097ff), with Leech in slot 3 and Piranha
in slot 4. `elephant-seal-mana.png` is turn 11 (01a071af), with Elephant Seal
in slot 9 obscured by a mana badge. These are saved browser pixels, independent
of engine predictions.

`versus-result.png` is the fresh Shark/Mammoth versus result screen (01a093f2,
turn 9). Full-color macOS OCR reads GAME WON! at confidence 0.5; the enlarged,
thresholded result crop reads it at confidence 1.0.
