# Pokémon Team Synergy — project guide

## Purpose
Build a trustworthy, approachable Pokémon team builder that helps players understand their teams and improve them. Prioritize correct, explainable analysis. Choose and disclose the supported game generation and competitive format before making legality or strategic claims.

## Current project (updated November 2026)
- `Frontend/index.html` + `pokemon.js`: builder page and controller (state, persistence, team management, editor, validation and analysis flow).
- `Frontend/logic.js`: type chart, stat formula, EVs, format species filtering (pure).
- `Frontend/formats.js`: format definitions (species, forms, era, learnset version groups, clauses).
- `Frontend/team.js`: slot/team model, versioned multi-team store + v1 migration, rule validation, Showdown/JSON import-export (pure).
- `Frontend/analysis.js`: ability/item-aware defense, coverage, roles, speed, checklist score, observations (pure).
- `Frontend/api.js`: PokeAPI fetch with retry, response parsers; results go through `Frontend/cache.js` (IndexedDB, 7-day TTL, bump `DATA_VERSION` when a parser's output changes). `?cache=off` bypasses all caching for benchmarks; `window.appPerf` holds startup timings.
- `bench/`: benchmark fixture and results for the cache.
- `Frontend/logic.js` type charts are per generation (`typesFor`, `typeChartFor`, `typesInGen` with PokeAPI past types); tests compare every pair with Showdown's data. Pass the format's era (`gen`) to analysis functions.
- `Frontend/calc-loader.js` loads the calculator bundle on demand (panel near viewport, first interaction, or Analyze) and then creates `window.PokeDamage`/`window.PokeThreats`; don't add the vendor scripts to the page directly (Lighthouse: bench/lighthouse.md).
- `Frontend/damage.js` + `damage-panel.js`: adapter onto vendored @smogon/calc (`Frontend/vendor/smogon-calc/`, MIT; maps PokeAPI names to Showdown names) and the calculator panel.
- `Frontend/viability.js`: per-Pokémon competitive viability (stats vs the format's median BST from the usage snapshot, fully evolved/Eviolite, attacks, useful moves, item fit, EVs). Species data comes in via `speciesInfo` (calculator data, loaded on demand). The random team builder uses `pickRandomMoves` (strong STAB, coverage, curated utility; singles/doubles lists; Gen 1-3 type-based split), `randomSpread` (EVs/nature) and `suitsRandomSet`/`RANDOM_ITEMS` to decide which items it may give a set (only items players use, each with the condition under which it helps); `itemFit` drives the item part of the score.
- `calibration/`: score calibration (expert Smogon sample teams vs two baselines: random teams of popular sets and fully random teams; AUC on a held-out split). `CALIBRATED_WEIGHTS`/`CALIBRATION` in analysis.js come from `node calibration/run.js`; rerun it after changing score components and update both.
- `Frontend/threats.js`: matchups vs the most-used Pokémon of a format, from snapshots in `Frontend/data/threats/` built by `scripts/build-threats.js` (Smogon usage via data.pkmn.cc).
- Teams have `format.doubles` (battle style): changes roles, roles score, threats and spread damage. Share links encode the team in the URL fragment (`team.js` encodeShare/decodeShare).
- `Frontend/controls.js`, `report.js`: DOM widgets and report rendering.
- `Frontend/stats.html` + `stats.js`: saved teams page.
- `index.html`/`stats.html` load local CSS/JS with a `?v=YYYYMMDD` tag so browsers don't reuse stale copies; bump it in both files whenever a CSS or JS file changes.
- `tests/*.test.js`: `node --test tests/*.test.js`. `.claude/launch.json` serves the repo on port 8090.

## Status
Done: everything in the original fix list, plus format-aware learnset/ability/item checks, Species/Item Clause, forms (Mega fallback learnsets), multiple named teams, Showdown/JSON import-export, undo, filtered item list, module split, accessibility pass (tab keyboard nav, labels, focus, contrast, skip link), mobile layout, saved teams page. Also done: persistent cache, damage calculator, threat list, singles/doubles mode, share links. Also done: per-generation type charts, Lighthouse fixes (98-100 in all categories). Not done: tier/ban lists, event-move legality, Gen 1-2 stat system, VGC-specific rules, deployment/CI, screen-reader and cross-browser testing.

## Fix and improve (original list; see Status for progress)
1. Complete and verify the type chart: the Fairy attacking row and Dragon color are missing. Test all 18 attacking types and dual-type multipliers, including immunities, against an authoritative generation-specific reference.
2. Coverage currently uses the Pokémon's own types, not selected moves. Label it as type-based potential until replaced with selected damaging moves and their actual types. Account for dual-type targets; do not treat status moves as damage.
3. Speed assumes level 100 without nature. The editor displays base stats; nature checks reference an unconfigured field. Add level, nature and IV controls and correct stat calculations; distinguish base and calculated stats.
4. The EV editor warns above 510 but permits it. Validate limits and explain errors. The randomizer draws broad API items and unfiltered moves; avoid calling teams valid until species, abilities, moves, items and format restrictions are checked.
5. Scores are rough proxies: defense counts distinct weakness types, speed rewards average speed, and build quality counts filled move slots. Recommendations use move-name matching and can overstate conclusions. Explain assumptions and reconsider the overall grade until it is calibrated.
6. Handle API pagination, HTTP errors, loading, retries, missing sprites and partial failures. Prevent slow responses from overwriting newer selections.
7. Team state is memory-only and reports can become stale after edits. Persist safely, refresh or invalidate reports, and guard against accidental clearing.

## Roadmap

### 1. Reliable foundation
- Fix assets and complete the type chart. Add focused tests for all types, representative 4×, ¼× and immunity cases, stat calculations, EV validation and known team examples.
- Separate API access, domain calculations, state and rendering into small modules. Keep calculations pure where practical and preserve the existing flow.
- Add loading, empty, error and retry states. Create a README covering local setup, limitations and checks. Serve `Frontend/` using a local HTTP server when needed and confirm asset paths from that entry point.
- Add accessible labels, keyboard operation, visible focus, status messages, adequate contrast and responsive layouts.

### 2. Accurate team building
- Agree on an initial generation and format; document supported rules. Model species and forms, level, nature, IVs, EVs, ability, held item and four moves. Derive legal choices from reliable version-aware data; flag unknown legality rather than claiming validity.
- Calculate stats correctly and validate duplicate moves, EV limits and relevant team constraints, with useful messages for incomplete builds.
- Calculate coverage from selected moves and show defensive weaknesses, resistances and immunities separately. State exclusions, such as ability and item effects, until implemented and tested.
- Save multiple named teams locally using versioned data; add validated import/export. Consider Pokémon Showdown text compatibility afterward.

### 3. Useful insights and experience
- Show evidence behind findings: shared weaknesses and potential switch-ins, speed tiers, move categories, team roles, hazards, removal and recovery. Distinguish game rules from strategic heuristics.
- Add format-aware recommendations only when the supporting data is validated. If retaining a score, document its components and limits, test representative teams and let users inspect the underlying facts.
- Improve searchable selectors, slot comparison, editing speed, mobile layout, onboarding and undo for destructive edits.

### 4. Further expansion
- Consider matchup previews, team comparisons, damage calculations, threat lists, sharing, and optional accounts or cloud sync. Evaluate data licensing, privacy, costs and format maintenance before adding services.

## Instructions for future work
- Inspect the relevant code and Git state first; preserve user changes. Work in small, reviewable steps and update this guide when behavior changes.
- Introduce a framework or backend only when justified by product and maintenance needs.
- Distinguish implemented features from proposals. Do not claim a team is legal or competitively strong without evidence.
- Test meaningful logic and manually check team editing, analysis, errors, keyboard use and narrow screens. Record commands and checks that could not be run; never claim an unrun check passed.
- Treat remote API data as untrusted and avoid unsafe HTML injection. Keep user data local unless a chosen feature requires otherwise.
