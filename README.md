# Pokémon Team Synergy

Static browser app: build teams of six, pick a format and battle style, check the team against that format's species list and learnsets, run damage calculations, and get a report on coverage, shared weaknesses, roles, speed and the most-used threats in the format.

## Run
Serve the repo root over HTTP (pages resolve images via `../Images/`), e.g.:

    python -m http.server 8080

then open http://localhost:8080/Frontend/ (builder) or http://localhost:8080/Frontend/stats.html (saved teams). PokeAPI and Google Fonts need network access.

## Check
    node --test tests/*.test.js

99 tests. They cover the Gen 1–2 stat system (over 4,000 species/level/DV/stat-experience combinations checked against Pokémon Showdown's calculator), VGC rules (restricted and mythical limits, Item Clause, team size), competitive viability (evolution and Eviolite, item fit, move quality, EVs, a reported weak team), the type charts of every generation (all 2,677 attacker/defender pairs checked against Pokémon Showdown's data), the score calibration tooling (AUC, baselines, set conversion), the persistent cache, stat formula, EV limits, format filtering, team storage and migration, Showdown/JSON import and export, share links, rule validation, ability-aware defense, singles and doubles role detection, speed tiers, score ordering on example teams, damage calculations (including a known Showdown result and older-generation mechanics) and threat analysis. The UI is checked by hand (see below), not automatically.

## Features
- **Damage calculator** (loaded on demand, so it doesn't slow the first page load): attacker and move from your team; the defender is a team member or any Pokémon with an assumed spread. It uses your exact sets (level, nature, EVs, IVs, ability, item) and the format's generation mechanics, with weather, critical hits and doubles spread reduction. Powered by [@smogon/calc](https://github.com/smogon/damage-calc), the engine behind Pokémon Showdown's calculator, vendored in `Frontend/vendor/smogon-calc/` (MIT).
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
The team score combines offense, defense, roles, set completeness, damage-based **threat matchups** against the format's most-used Pokémon, and **competitive viability**. Viability grades each Pokémon on stats compared with the format's top Pokémon, being fully evolved (or holding Eviolite), real attacks, useful moves, an item that helps it, and EV investment, following the VGCguide team-building chapters by Wolfe Glick and Aaron Traylor.

The weights were calibrated against 240 expert teams (Smogon sample teams), 1,992 random teams of popular sets and 1,000 fully random teams. On held-out teams, an expert team outscores a **fully random team 99.5% of the time** in singles (100% in doubles). It outscores a **random team of popular sets 65% of the time in singles and 78% in doubles**. So the score reliably flags unviable teams but only roughly ranks strong ones, and the app says so, showing reference averages next to every score. Method, numbers and caveats: [calibration/README.md](calibration/README.md).

## Performance
Repeat visits: **0 PokeAPI requests instead of 34**, **no JSON to parse instead of 1.7 MB**, and the page is **ready 47% sooner** (206 → 110 ms median of 5 runs). First visits are unchanged. Method, raw numbers and caveats: [bench/README.md](bench/README.md). The threat analysis (40 threats × your team, both directions) ran in 0.7–0.8 s for 3–4 Pokémon in the browser pane; it runs on the main thread when you press Analyze.

## Quality (Lighthouse)
Lighthouse 13.6, first visit, both pages: performance 98–100, accessibility 100, best practices 100, SEO 100 (mobile and desktop). Before fixes, the builder scored 89 for performance on mobile, 95 for accessibility and 91 for SEO. Total Blocking Time on mobile fell from 410 ms to 20 ms by loading the damage calculator only when it is needed. Details: [bench/lighthouse.md](bench/lighthouse.md).

## Data sources
- Species, moves, learnsets, abilities and items: [PokeAPI](https://pokeapi.co/).
- Damage mechanics: [@smogon/calc 0.12.0](https://www.npmjs.com/package/@smogon/calc).
- Threats: Smogon usage statistics as republished by [pkmn/smogon](https://github.com/pkmn/smogon) (data.pkmn.cc). `scripts/build-threats.js` writes small dated snapshots to `Frontend/data/threats/` (about 11 KB per format; the sample covers e.g. 608,936 Gen 9 OU battles). Re-run it to refresh:

      node scripts/build-threats.js

## Rules and limitations
- **Formats** (`Frontend/formats.js`): All Pokémon, Generation 1–9, the Scarlet/Violet and Sword/Shield regional dexes, and **VGC 2026 (Scarlet/Violet)**. Each format sets allowed species and forms, the game generation whose rules apply, and the games whose learnsets define legal moves.
- **Checked**: species and forms in the format, moves learnable in the format's games (PokeAPI learnsets), duplicate moves, abilities belonging to the species, hidden abilities before Gen 5, abilities and items introduced after the format's generation, no abilities before Gen 3 or items in Gen 1, EV/IV limits, Species Clause, Item Clause (warning), Mega Stones and one Mega per team (warnings).
- **VGC 2026 (Scarlet/Violet)** follows Pokémon Showdown's VGC 2026 ladder: always doubles, level 50 (higher levels are scaled down for stats, damage and threats), bring 6 pick 4 (teams need at least 4), at most 2 restricted legendaries, no mythicals, Species Clause and Item Clause (an error here). Pokémon with no Scarlet/Violet learnset are flagged as probably not obtainable. Threats come from that ladder's usage statistics, at level 50. Tera and team-preview choices are not modelled. The official 2026 circuit moved to Pokémon Champions, which is not supported (its data isn't in PokeAPI).
- **Gen 1–2 stats** use those games' system, as Pokémon Showdown does: DVs 0–15 (the HP DV follows from the others), stat experience shown on the 0–252 EV scale with no total cap, no natures or abilities, one Special stat in Gen 1, and Special Attack/Defense sharing one stat experience and DV in Gen 2. Base stats are the generation's own (PokeAPI past stats), so Gen 1 Special and pre-Gen 6 values are used where they differ.
- **Not checked**: tier bans outside VGC, event/egg-move combinations, per-game item availability, Tera types, Dynamax and Z-moves. The app never says a team is legal.
- **Type charts** are per generation: no Fairy before Gen 6, Steel resisting Ghost and Dark in Gen 2–5, and Gen 1's own chart (no Dark or Steel, Ghost not affecting Psychic, Bug and Poison super effective against each other, Ice neutral on Fire). Pokémon use their typing for that generation (e.g. Clefable is Normal before Gen 6, from PokeAPI's past types). "All Pokémon" uses the current chart.
- **Analysis**: damage and threats use the format's generation mechanics. Defense includes some abilities (Levitate, Flash Fire, Thick Fat, …) and Air Balloon. Roles are detected from move and ability names. The score's weights are calibrated per battle style (see above). Formats without usage data leave out the threat component and rescale the other weights. It is not a competitive rating.
- **Threats** assume each threat's single most common set, full HP, no Tera, hazards, boosts or field effects. Doubles usage data exists only for Generation 9. Formats without their own usage data (regional dexes, All Pokémon) use their generation's OU data.
- **Items**: limited to battle categories (held items, berries, plates, Mega Stones, Z-Crystals, …).

## Manual checks done
In the browser pane on a local server:
- **Builder:** loading the page, a Gen 9 random team (no rule problems), the analysis, a Showdown export → import round trip, switching to Gen 4 (out-of-generation moves, items and species flagged), Clear → Undo, arrow-key tab navigation, the saved teams page.
- **Calculator:** matches Showdown's output for Choice Band Garchomp Earthquake vs Heatran. Also checked: an outside defender with an assumed spread, weather, attacker switching, focus kept after changes, and 0.75× spread damage in Doubles.
- **Threats:** threat lists for singles and doubles teams, and the message for Doubles in Gen 5.
- **Share links:** round trip, and a damaged link handled gracefully.
- **Layout:** 375px-wide with no horizontal scrolling.
- **Gen 1–2:** Gen 2 Gengar's stats (323/228/218/358/248/318) match Showdown; changing a DV updates the derived HP DV; Gen 1 shows one Special stat and no item field; random Gen 2 teams have no natures or abilities and maximum stat experience.
- **VGC:** battle style locked to doubles, new Pokémon at level 50, 3 restricted and a mythical flagged, random teams within the restricted limit, threats calculated at level 50 (confirmed from the HP values in the calculator's output).

## Accessibility checks
- **Automated (axe-core 4.14, WCAG 2.0–2.2 A/AA plus best practices), in Edge:** 20 views (editor overview, Pokémon editor, Gen 2 editor, every report tab, saved teams page) at 1280px and 375px. All 20 pass. The audit found and fixed low-contrast type labels (now at least 5.6:1) and a sideways-scrolling type chart that keyboard users couldn't reach.
- **Keyboard only:** the skip link is the first stop; Analyze, the report tabs (arrow keys, Home/End) and Back work without a mouse; focus moves to the report when it opens and back to the button that opened it; all 58 focusable controls show a focus outline.

Not done: testing with an actual screen reader (NVDA, VoiceOver), and browsers other than Chromium-based Edge (Firefox, Safari).
