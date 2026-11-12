# Pokémon Team Synergy

Static browser app: build teams of six, pick a format, check them against that format's species list and learnsets, and get a report on coverage, shared weaknesses, roles and speed.

## Run
Serve the repo root over HTTP (pages resolve images via `../Images/`), e.g.:

    python -m http.server 8080

then open http://localhost:8080/Frontend/ (builder) or http://localhost:8080/Frontend/stats.html (saved teams). PokeAPI and Google Fonts need network access.

## Check
    node --test tests/*.test.js

Covers the type chart, stat formula, EV limits, format filtering, team storage and v1 migration, Showdown/JSON import and export, rule validation, ability-aware defense, role detection, speed tiers and score ordering on example teams. The UI is checked by hand (see below), not automatically.

## Features
- Multiple named teams (new, duplicate, rename, delete) saved in this browser's localStorage. Data from the old single-team version is migrated, and its keys are left in place.
- Import/export: Pokémon Showdown text and a JSON format. Imports become a new team.
- Undo for clearing, random teams, removing a Pokémon and deleting a team.
- Live rule checks, with a list of what is *not* checked.
- Saved teams page (`stats.html`).

## Rules and limitations
- **Formats** (`Frontend/formats.js`): All Pokémon, Generation 1–9, and the Scarlet/Violet and Sword/Shield regional dexes. Each format sets allowed species and forms, the game generation whose rules apply, and the games whose learnsets define legal moves.
- **Checked**: species and forms in the format, moves learnable in the format's games (PokeAPI learnsets), duplicate moves, abilities belonging to the species, hidden abilities before Gen 5, abilities and items introduced after the format's generation, no abilities before Gen 3 or items in Gen 1, EV/IV limits, Species Clause, Item Clause (warning), Mega Stones and one Mega per team (warnings).
- **Not checked**: tier bans, restricted legendaries, event/egg-move combinations, Gen 1–2 stat systems, Tera types, Dynamax and Z-moves. The app never says a team is legal.
- **Analysis**: Gen 6+ type chart. Defense includes some abilities (Levitate, Flash Fire, Thick Fat, …) and Air Balloon. Coverage uses selected damaging moves' types. Roles are detected from move and ability names and assume singles. The score is a weighted checklist (weights shown in the report), tested only for sensible ordering, and is not a competitive rating.
- **Items**: limited to battle categories (held items, berries, plates, Mega Stones, Z-Crystals, …).

## Manual checks done
In the browser pane on a local server: loading the page, generating a Gen 9 random team (no rule problems), running the analysis, a Showdown export → import round trip, switching to Gen 4 (out-of-generation moves, items and species flagged), Clear → Undo, arrow-key tab navigation, the saved teams page, and a 375px-wide layout with no horizontal scrolling. Not done: screen-reader testing, other browsers.
