# Score calibration

**Question:** does the team score rate expert-built teams above weaker ones?

## Method
- **Expert teams:** Smogon sample teams (full sets) for Gen 1–9 OU, and Gen 9 Doubles OU / VGC 2024 Reg G / VGC 2025 Reg I, via [pkmn/smogon](https://github.com/pkmn/smogon). 207 usable singles teams (of 211) and 33 doubles teams.
- **Two baselines**, because "weaker" can mean two things:
  - **Popular-set teams** (the hard test): 6 distinct Pokémon drawn at random, weighted by usage, from the format's 120 most-used Pokémon, each with its most common set. Every Pokémon is strong; only the *team* is random. 8 per expert team, at least 80 per format.
  - **Fully random teams** (the "is this team even viable?" test): any species of the generation (battle-only forms excluded), a random item, ability and nature, four random moves and a random 252/252/4 EV spread. 4 per expert team, at least 40 per format. The calculator data has no learnsets, so these moves aren't checked for legality. The test measures species, item and move choices, not legality.
- **Conversion:** sets go through the app's own analysis code (`Frontend/analysis.js`, `viability.js`, `threats.js`, `damage.js`) with each generation's type chart. Species types, base stats, evolution status and move data come from the vendored @smogon/calc data for each generation (`calibration/lib.js`).
- **Metric:** AUC, the probability that a random expert team outscores a random baseline team (0.5 = chance, 1.0 = perfect), against each baseline, with 95% bootstrap confidence intervals (1000 resamples).
- **Split:** 70% train / 30% test within each format and team kind (seed 20261113).
- **Tuning:** a grid over the offense, defense, roles, threat-matchup and viability weights in steps of 5, with completeness fixed at 15. The objective is the mean of the two training AUCs.
- **Selection rule, fixed before looking at test results:** among weights within 0.01 of the best objective, take the most evenly spread.

## What each component tells apart (all data)

| Component | Singles: vs popular / vs random | Doubles: vs popular / vs random |
|---|---|---|
| Offensive coverage | 0.54 / 0.69 | 0.44 / 0.44 |
| Defensive balance | 0.68 / 0.82 | 0.60 / 0.58 |
| Team roles | 0.49 / 0.93 | 0.51 / 0.99 |
| Set completeness | 0.49 / 0.49 | 0.46 / 0.46 |
| Threat matchups | 0.58 / 0.95 | 0.77 / 0.99 |
| **Competitive viability** (new) | 0.45 / **1.00** | 0.63 / **1.00** |

Viability, meaning strong and fully evolved Pokémon with useful items, real attacks and invested EVs, perfectly separates expert teams from random ones. Against popular-set teams it has little or no signal, because those teams are made of strong Pokémon too. Telling *good* teams apart still rests on defense and threat matchups.

## Results on held-out teams (30%)

| | vs popular-set teams | vs fully random teams |
|---|---|---|
| Singles, hand-picked weights (original) | 0.61 [0.53–0.68] | 0.91 [0.86–0.95] |
| Singles, first calibration (no viability) | 0.67 [0.59–0.74] | 0.93 [0.90–0.96] |
| **Singles, current** | **0.65 [0.57–0.71]** | **0.995 [0.989–0.998]** |
| Doubles, hand-picked weights (original) | 0.57 [0.38–0.75] | 0.92 [0.83–0.98] |
| Doubles, first calibration (no viability) | 0.78 [0.61–0.92] | 0.99 [0.97–1.00] |
| **Doubles, current** | **0.78 [0.58–0.93]** | **1.00 [1.00–1.00]** |

Current weights (in `CALIBRATED_WEIGHTS`, `Frontend/analysis.js`):
- **Singles:** offense 20, defense 20, threat matchups 20, viability 20, completeness 15, roles 5.
- **Doubles:** threat matchups 40, viability 35, completeness 15, defense 5, roles 5, offense 0.

Mean test scores, shown in the app as reference points: singles experts 85, popular-set teams 83, fully random teams 66. Doubles: 91 / 88 / 63.

## Honest reading
- **The score now reliably flags unviable teams.** An expert team beats a fully random team over 99% of the time.
- **Ranking good teams against each other is still a weak signal**, at 0.65 in singles and 0.78 in doubles. In singles, adding viability cost a little on the hard test (0.67 → 0.65). The confidence intervals overlap heavily, so the difference may be noise, but it isn't an improvement.
- **The doubles sample is small** (33 expert teams), so its intervals are wide.
- **What the viability criteria are based on:** they follow the VGCguide team-building chapters by Wolfe Glick (2016 World Champion) and Aaron Traylor. Each Pokémon needs a stat strong enough for its job, at least one damaging move, and a clear reason to be there. The fully-evolved, Eviolite, item and EV checks are standard competitive practice rather than claims from those pages.
- **Other caveats:** the expert teams are sample teams, not tournament results. Win rates were not measured. The threat component and the baselines use the same usage data, so threats are measured against the current metagame by design.

## History
- **12 Nov 2026:** first calibration with the popular-set baseline only. Hand-picked weights had a held-out AUC of 0.59 (singles) and 0.50 (doubles). Adding the damage-based threat-matchup component and tuning raised these to 0.63 and 0.69.
- **13 Nov 2026:** per-generation type charts; singles 0.633 → 0.637.
- **13 Nov 2026:** added the competitive viability component and the fully random baseline, prompted by a team of mostly unevolved Pokémon that scored 79 under the old weights. That team now scores 47, below the average fully random team (66). The test split changed when the second baseline was added, so this table's "first calibration" row was re-measured on the new split.

## Bug found by calibration
Gen 1 expert teams first scored *below* every random team (AUC 0.00). Showdown omits Gen 1–2 EVs because they default to maximum, and the converter treated them as 0. This is fixed in `lib.js`.

## Reproduce

    node calibration/build-data.js   # downloads data into calibration/data/ (committed, fetched 2026-11-13)
    node calibration/run.js          # ~25 min the first time (damage calculations), cached afterwards; writes results.json

`results.json` holds every number above.
