# Pokémon Team Synergy

Static browser app: build teams of six, pick a format and battle style, check the team against that format's species list and learnsets, run damage calculations, and get a report on coverage, shared weaknesses, roles, speed and the most-used threats in the format.

## Run
Serve the repo root over HTTP (pages resolve images via `../Images/`), e.g.:

    python -m http.server 8080

then open http://localhost:8080/Frontend/ (builder) or http://localhost:8080/Frontend/stats.html (saved teams). PokeAPI and Google Fonts need network access.

## Check
    node --test tests/*.test.js

79 tests. They cover the score calibration tooling (AUC, baselines, set conversion), the persistent cache, type chart, stat formula, EV limits, format filtering, team storage and migration, Showdown/JSON import and export, share links, rule validation, ability-aware defense, singles and doubles role detection, speed tiers, score ordering on example teams, damage calculations (including a known Showdown result and older-generation mechanics) and threat analysis. The UI is checked by hand (see below), not automatically.

## Features
- **Damage calculator**: attacker and move from your team; the defender is a team member or any Pokémon with an assumed spread. It uses your exact sets (level, nature, EVs, IVs, ability, item) and the format's generation mechanics, with weather, critical hits and doubles spread reduction. Powered by [@smogon/calc](https://github.com/smogon/damage-calc), the engine behind Pokémon Showdown's calculator, vendored in `Frontend/vendor/smogon-calc/` (MIT).
- **Threat list**: your team against the 40 most-used Pokémon of the format's OU tier (or Gen 9 Doubles OU), each with its most common set. For each threat: who it OHKOs, safe switch-ins (take ≤ 50% from its strongest move), your best hit, and who is faster. Every matchup is a damage calculation.
- **Singles or Doubles** per team: changes the roles checked (hazards and pivoting vs. speed control, Fake Out, Protect, spread moves and redirection), the roles score, threat data and spread damage.
- **Share links**: the team is compressed into the URL fragment (about 500 characters for six Pokémon). Fragments are not sent to servers. Opening a link adds the team as a new saved team.
- Multiple named teams (new, duplicate, rename, delete) saved in this browser's localStorage; data from the old single-team version is migrated.
- Import/export: Pokémon Showdown text and JSON. Imports become a new team.
- Undo for clearing, random teams, removing a Pokémon and deleting a team.
- Live rule checks, with a list of what is *not* checked.
- Random teams that follow the selected format and pass the rule checks.
- Saved teams page (`stats.html`).
- Persistent cache: processed PokeAPI data is kept in IndexedDB for 7 days ("Clear cached data" in the footer resets it).

## Score calibration
The team score was calibrated against 240 expert teams (Smogon sample teams) and 1,994 random teams built from the same formats' most common sets. On held-out teams, an expert team now outscores a random one **63% of the time in singles** (was 59%) and **69% in doubles** (was 50%, i.e. chance). Damage-based threat matchups were the strongest new signal. It is a real but weak signal, and the app says so. Method, per-format numbers and caveats: [calibration/README.md](calibration/README.md).

## Performance
Repeat visits: **0 PokeAPI requests instead of 34**, **no JSON to parse instead of 1.7 MB**, and the page is **ready 47% sooner** (206 → 110 ms median of 5 runs). First visits are unchanged. Method, raw numbers and caveats: [bench/README.md](bench/README.md). The threat analysis (40 threats × your team, both directions) ran in 0.7–0.8 s for 3–4 Pokémon in the browser pane; it runs on the main thread when you press Analyze.

## Data sources
- Species, moves, learnsets, abilities and items: [PokeAPI](https://pokeapi.co/).
- Damage mechanics: [@smogon/calc 0.12.0](https://www.npmjs.com/package/@smogon/calc).
- Threats: Smogon usage statistics as republished by [pkmn/smogon](https://github.com/pkmn/smogon) (data.pkmn.cc). `scripts/build-threats.js` writes small dated snapshots to `Frontend/data/threats/` (about 11 KB per format; the sample covers e.g. 608,936 Gen 9 OU battles). Re-run it to refresh:

      node scripts/build-threats.js

## Rules and limitations
- **Formats** (`Frontend/formats.js`): All Pokémon, Generation 1–9, and the Scarlet/Violet and Sword/Shield regional dexes. Each format sets allowed species and forms, the game generation whose rules apply, and the games whose learnsets define legal moves.
- **Checked**: species and forms in the format, moves learnable in the format's games (PokeAPI learnsets), duplicate moves, abilities belonging to the species, hidden abilities before Gen 5, abilities and items introduced after the format's generation, no abilities before Gen 3 or items in Gen 1, EV/IV limits, Species Clause, Item Clause (warning), Mega Stones and one Mega per team (warnings).
- **Not checked**: tier bans, restricted legendaries, event/egg-move combinations, per-game item availability, Gen 1–2 stat systems, Tera types, Dynamax and Z-moves. VGC rules (level 50, bring six pick four) are not applied in Doubles. The app never says a team is legal.
- **Analysis**: type summaries use the Gen 6+ chart; damage and threats use the format's generation. Defense includes some abilities (Levitate, Flash Fire, Thick Fat, …) and Air Balloon. Roles are detected from move and ability names. The score's weights are calibrated per battle style (see above). Formats without usage data leave out the threat component and rescale the other weights. It is not a competitive rating.
- **Threats** assume each threat's single most common set, full HP, no Tera, hazards, boosts or field effects. Doubles usage data exists only for Generation 9. Formats without their own usage data (regional dexes, All Pokémon) use their generation's OU data.
- **Items**: limited to battle categories (held items, berries, plates, Mega Stones, Z-Crystals, …).

## Manual checks done
In the browser pane on a local server:
- **Builder:** loading the page, a Gen 9 random team (no rule problems), the analysis, a Showdown export → import round trip, switching to Gen 4 (out-of-generation moves, items and species flagged), Clear → Undo, arrow-key tab navigation, the saved teams page.
- **Calculator:** matches Showdown's output for Choice Band Garchomp Earthquake vs Heatran. Also checked: an outside defender with an assumed spread, weather, attacker switching, focus kept after changes, and 0.75× spread damage in Doubles.
- **Threats:** threat lists for singles and doubles teams, and the message for Doubles in Gen 5.
- **Share links:** round trip, and a damaged link handled gracefully.
- **Layout:** 375px-wide with no horizontal scrolling.

Not done: screen-reader testing, other browsers.
