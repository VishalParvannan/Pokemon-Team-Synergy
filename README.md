# Pokémon Team Synergy

Static browser app: build a team of six, set level, nature, IVs, EVs, ability, item and moves, then view a type-based synergy report.

## Run
Serve `Frontend/` over HTTP (assets resolve via `../Images/`), e.g. from the repo root:

    python -m http.server 8000

then open http://localhost:8000/Frontend/. PokeAPI and Google Fonts need network access.

## Check
    node --test tests/logic.test.js

Covers the type chart (all 18 attacking types, 4x/¼x/immunity cases), stat formula, EV limits and coverage helpers. UI behavior (editing, errors, keyboard use, narrow screens) has not been tested automatically.

## Rules and limitations
- Type chart: Generation 6+ (with Fairy). Stats: Gen 3+ formula. No format (OU, VGC, ...) is selected, and legality of species, abilities, moves and items is **not** checked. Random teams are unchecked.
- Coverage uses selected damaging moves' types; abilities, items, fixed-damage and variable-power moves are not modeled.
- Defense is by type only (abilities such as Levitate are ignored).
- The score is a documented heuristic, not a competitive rating.
- Teams are saved in this browser's localStorage only.
