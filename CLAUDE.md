# Pokémon Team Synergy — project guide

## Purpose
Build a trustworthy, approachable Pokémon team builder that helps players understand their teams and improve them. Prioritize correct, explainable analysis. Choose and disclose the supported game generation and competitive format before making legality or strategic claims.

## Current project (reviewed October 2026)
- `Frontend/index.html`: main team builder and report interface.
- `Frontend/pokemon.js`: state, PokeAPI requests, editor rendering, random team generation, and analysis.
- `Frontend/styles.css`: dark theme and layout.
- `Frontend/stats.html`: empty.
- `Images/`: local artwork. The page references `Images/pokeball.png` relative to `Frontend/`, but the image is in the root `Images/` directory; verify and fix the path.
- Static browser HTML, CSS and JavaScript. No package manifest, backend, build system or automated tests were found. PokeAPI and Google Fonts require network access.

## What exists
- Six team slots, an overview and individual editing tabs.
- PokeAPI supplies lists (limited to 900 Pokémon and 1,000 items), sprites, abilities, base stats and move pools.
- Ability and item selection, up to four distinct moves, and EV sliders and number inputs. IVs exist in state but have no editor; nature and level are not configurable.
- Random team generation and clearing the team.
- A report with estimated offensive coverage, weaknesses and resistances, speed tiers, component scores, an overall grade and suggestions. These are preliminary heuristics, not validated competitive analysis.

## Status (updated after first improvement pass)
Done: complete type chart + tests (`Frontend/logic.js`, `tests/logic.test.js`), pokeball path, move-based coverage, level/nature/IV controls with calculated stats, enforced EV cap, fetch retry/pagination/race guards, escaped API HTML, localStorage persistence, stale-report hiding, clear confirmation, README. Not yet done: format/generation selection and legality, species forms, multiple named teams, import/export, searchable selectors, further modularization (API/state/rendering), UI/keyboard/mobile manual checks, `stats.html`. Item list is still unfiltered.

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
