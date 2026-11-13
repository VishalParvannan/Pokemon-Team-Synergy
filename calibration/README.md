# Score calibration

**Question:** does the team score actually rate expert-built teams above random ones?

## Method
- **Expert teams:** Smogon sample teams (full sets) for Gen 1–9 OU, and Gen 9 Doubles OU / VGC 2024 Reg G / VGC 2025 Reg I, via [pkmn/smogon](https://github.com/pkmn/smogon). 211 singles teams (207 usable) and 33 doubles teams.
- **Baseline teams:** 6 distinct Pokémon drawn at random (weighted by usage) from the format's 120 most-used Pokémon, each with its most common set from Smogon usage statistics. 8 per expert team, at least 80 per format. Every individual set is a popular, reasonable set, so the score can only win by recognising *team* quality. This is deliberately a hard baseline.
- **Conversion:** sets go through the app's own analysis code (`Frontend/analysis.js`, `threats.js`, `damage.js`). Species types, base stats and move data come from the vendored @smogon/calc data for each generation (`calibration/lib.js`).
- **Metric:** AUC, the probability that a random expert team outscores a random baseline team (0.5 = chance, 1.0 = perfect), with 95% bootstrap confidence intervals (1000 resamples).
- **Split:** 70% train / 30% test within each format (seed 20261113).
- **Tuning:** a grid over the offense, defense, roles and threat-matchup weights in steps of 5, with completeness fixed at 15. Complete sample teams can't calibrate completeness, but it still matters for unfinished teams in the app.
- **Selection rule, fixed before looking at test results:** among weights within 0.01 of the best training AUC, take the most evenly spread. This avoids zeroing components on a small sample.

## What each component tells apart (all data)

| Component | Singles AUC | Doubles AUC |
|---|---|---|
| Offensive coverage | 0.54 | 0.44 |
| Defensive balance | 0.66 | 0.60 |
| Team roles | 0.50 | 0.53 |
| Set completeness | 0.49 | 0.46 |
| **Threat matchups** (new) | 0.58 | **0.77** |

Coverage and roles barely separate the groups: random teams of popular sets already have coverage, Stealth Rock and pivots. Defense and the new damage-based threat matchups carry the signal.

## Results on held-out teams (30%)

| | Before (hand-picked weights) | After (calibrated) |
|---|---|---|
| **Singles** (62 expert vs 504 baseline test teams) | 0.59 [0.51–0.67] | **0.63 [0.55–0.70]** |
| **Doubles** (10 vs 94) | 0.50 [0.31–0.70] | **0.69 [0.52–0.84]** |

Chosen weights (now the app's defaults in `CALIBRATED_WEIGHTS`):
- Singles: offense 25, defense 30, threat matchups 30, completeness 15, roles 0 (roles are still shown in the report, unweighted).
- Doubles: threat matchups 65, defense 10, offense 5, roles 5, completeness 15.

The best-fit weights scored slightly higher on the test split in doubles (0.73). They weren't used, because picking them after seeing test results would make the test number optimistic.

Per format, singles AUC (all data, before → after): Gen 9 0.65 → 0.80, Gen 8 0.66 → 0.73, Gen 7 0.65 → 0.72, Gen 6 0.82 → 0.76, Gen 5 0.69 → 0.68, Gen 4 0.60 → 0.78, Gen 3 0.61 → 0.71, Gen 2 0.66 → 0.55, Gen 1 0.61 → 0.62. Doubles: Doubles OU 0.70 → 0.90, VGC Reg G 0.54 → 0.71, VGC Reg I 0.50 → 0.68.

## Honest reading
- **Doubles:** a clear improvement, from chance to about 0.69. The interval is wide because there are only 33 expert teams.
- **Singles:** a modest improvement (0.59 → 0.63) whose interval overlaps the old one. The gain is concentrated in Gen 3–4 and 7–9. Gen 2 and Gen 6 got worse. In Gen 1, all teams share the same handful of Pokémon, so nothing separates them.
- **What this means:** an AUC of 0.63–0.69 is a real but weak signal. Two good-looking teams can be ranked either way, so the app calls the score "a rough signal, not a competitive rating".
- **Caveats:** the experts are sample teams, not tournament results. Win rates were not measured. The threat component and the baseline both use the same usage data, so threats are measured against the current metagame by design.

## Bug found by calibration
Gen 1 expert teams first scored *below* every random team (AUC 0.00). Showdown omits Gen 1–2 EVs because they default to maximum, and the converter treated them as 0. This is fixed in `lib.js`.

## Reproduce

    node calibration/build-data.js   # downloads data into calibration/data/ (already committed, fetched 2026-11-13)
    node calibration/run.js          # ~15 min the first time (damage calculations), cached afterwards; writes results.json

`results.json` holds every number above.
