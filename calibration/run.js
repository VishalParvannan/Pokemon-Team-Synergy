#!/usr/bin/env node
// Calibrates and evaluates the team score. Expert teams (Smogon sample teams) are compared with two
// baselines:
//   popular: random combinations of the formats' most common sets (good Pokémon, random teams)
//   random:  random species, items and moves with EVs (an unoptimized team)
// Weights are tuned on a 70% training split for the average of both AUCs and judged on the
// held-out 30%. Writes calibration/results.json.
// Usage: node calibration/run.js   (after node calibration/build-data.js)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const A = require("../Frontend/analysis.js");
const C = require("./lib.js");

const DATA = path.join(__dirname, "data");
const POPULAR_PER_EXPERT = 8;
const RANDOM_PER_EXPERT = 4;
const TRAIN_SHARE = 0.7;
const SEED = 20261113;
const SELECT_TOLERANCE = 0.01;
const COMPONENT_IDS = ["offense", "defense", "roles", "completeness", "threats", "viability"];
// Earlier weight sets, kept fixed so results stay comparable and reproducible
const ORIGINAL_WEIGHTS = { offense: 30, defense: 30, roles: 25, completeness: 15, threats: 0, viability: 0 }; // hand-picked
const PREVIOUS_WEIGHTS = { // first calibration (popular baseline only, no viability component)
  singles: { offense: 30, defense: 30, roles: 0, completeness: 15, threats: 25, viability: 0 },
  doubles: { offense: 5, defense: 10, roles: 5, completeness: 15, threats: 65, viability: 0 }
};

const GROUPS = {
  singles: { doubles: false, formats: ["gen9ou", "gen8ou", "gen7ou", "gen6ou", "gen5ou", "gen4ou", "gen3ou", "gen2ou", "gen1ou"].map(f => ({ id: f, pool: f })) },
  doubles: { doubles: true, formats: [{ id: "gen9doublesou", pool: "gen9doublesou" }, { id: "gen9vgc2024regg", pool: "gen9doublesou" }, { id: "gen9vgc2025regi", pool: "gen9doublesou" }] }
};

const calc = C.loadCalc();
const D = require("../Frontend/damage.js")(calc);
const TH = require("../Frontend/threats.js")(D);
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
const snapshotFile = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, "../Frontend/data/threats", `${id}.json`), "utf8"));

// Threat matchups need ~0.5 s of damage calculations per team: cache component scores by team content
const CACHE_FILE = path.join(__dirname, ".cache", "components.json");
const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) : {};
const CODE_VERSION = crypto.createHash("sha1").update(["../Frontend/analysis.js", "../Frontend/threats.js", "../Frontend/damage.js", "../Frontend/viability.js", "lib.js"].map(f => fs.readFileSync(path.join(__dirname, f), "utf8")).join("")).digest("hex").slice(0, 10);

// Component scores do not depend on the weights, so compute them once per team
function components(sets, gen, doubles, snapshot, refBst) {
  const key = crypto.createHash("sha1").update(JSON.stringify([CODE_VERSION, gen.num, doubles, snapshot.format, sets])).digest("hex");
  if (cache[key] !== undefined) return cache[key];
  const moveInfo = {};
  const members = sets.map(s => C.toMember(calc, gen, s, moveInfo));
  let out = null;
  if (!members.some(m => !m)) {
    const info = Object.fromEntries(Object.entries(moveInfo).filter(([, v]) => v));
    const r = A.analyzeTeam(members, info, { doubles, gen: gen.num, refBst, speciesInfo: (name) => D.speciesInfo(gen.num, name), weights: { viability: 1 } });
    out = Object.fromEntries(r.score.components.map(c => [c.id, c.score]));
    out.viability = r.viability.score;
    const top = { ...snapshot, threats: snapshot.threats.slice(0, TH.SCORE_TOP_N) };
    const t = TH.threatScore(TH.analyzeThreats(gen.num, top, members, { doubles }), top);
    out.threats = t ? t.score : 0;
  }
  cache[key] = out;
  return out;
}
const overall = (comp, w) => {
  let num = 0, den = 0;
  COMPONENT_IDS.forEach(id => { num += (comp[id] || 0) * (w[id] || 0); den += w[id] || 0; });
  return num / den;
};

function buildGroup(name, group) {
  const rand = C.rng(SEED + name.length);
  const rows = []; // { format, kind: expert | popular | random, split, comp }
  let skipped = 0;
  for (const f of group.formats) {
    const genNum = Number(f.id.match(/^gen(\d)/)[1]);
    const gen = calc.Generations.get(genNum);
    const experts = read(`${f.id}-teams.json`);
    const pool = read(`${f.pool}-pool.json`);
    const snapshot = snapshotFile(group.doubles ? "gen9doublesou" : f.id);
    const refBst = TH.referenceBst(genNum, snapshot);
    const lists = { expert: [], popular: [], random: [] };
    experts.forEach(t => {
      const comp = components(t.data, gen, group.doubles, snapshot, refBst);
      if (comp) lists.expert.push({ format: f.id, kind: "expert", comp, name: t.name });
      else skipped++;
    });
    for (let i = 0; i < Math.max(80, experts.length * POPULAR_PER_EXPERT); i++) {
      const comp = components(C.baselineTeam(pool, rand), gen, group.doubles, snapshot, refBst);
      if (comp) lists.popular.push({ format: f.id, kind: "popular", comp });
    }
    for (let i = 0; i < Math.max(40, experts.length * RANDOM_PER_EXPERT); i++) {
      const comp = components(C.randomTeam(gen, rand), gen, group.doubles, snapshot, refBst);
      if (comp) lists.random.push({ format: f.id, kind: "random", comp });
    }
    process.stderr.write(`${f.id}: ${lists.expert.length} expert, ${lists.popular.length} popular, ${lists.random.length} random\n`);
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    // Split each format and kind separately so every format appears in both splits
    Object.values(lists).forEach(list => {
      C.shuffle(list, rand).forEach((row, i) => { row.split = i < Math.round(list.length * TRAIN_SHARE) ? "train" : "test"; rows.push(row); });
    });
  }
  return { rows, skipped };
}

function scores(rows, kind, w) { return rows.filter(r => r.kind === kind).map(r => overall(r.comp, w)); }
function evaluate(rows, w) {
  const e = scores(rows, "expert", w), p = scores(rows, "popular", w), r = scores(rows, "random", w);
  const vsPopular = C.auc(e, p), vsRandom = C.auc(e, r);
  return { vsPopular, vsRandom, objective: (vsPopular + vsRandom) / 2, e, p, r };
}

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const results = { generated: new Date().toISOString().slice(0, 10), data: read("manifest.json"), method: {
  experts: "Smogon sample teams (pkmn/smogon)",
  popularBaseline: `random teams of 6 distinct species drawn by usage from each format's 120 most-used Pokémon, each with its most common set (${POPULAR_PER_EXPERT} per expert team, min 80 per format)`,
  randomBaseline: `random teams: any species of the generation (battle-only forms excluded), random item, ability and nature, four random moves (no learnset check), random 252/252/4 EVs (${RANDOM_PER_EXPERT} per expert team, min 40 per format)`,
  split: `${TRAIN_SHARE * 100}/${100 - TRAIN_SHARE * 100} train/test per format and team kind, seed ${SEED}`,
  metric: "AUC = probability an expert team outscores a baseline team, reported against each baseline; 95% CI by bootstrap (1000 resamples)",
  tuning: `grid over offense/defense/roles/threat-matchup/viability weights in steps of 5 with completeness fixed at 15; objective = mean of the two training AUCs; among weights within ${SELECT_TOLERANCE} of the best objective the most evenly spread is chosen (rule fixed before viewing test results)`,
  threats: "threat-matchup component uses the 20 most-used Pokémon of the format (Gen 9 Doubles OU for doubles) with their most common sets"
}, groups: {} };

for (const [name, group] of Object.entries(GROUPS)) {
  const { rows, skipped } = buildGroup(name, group);
  const train = rows.filter(r => r.split === "train");
  const test = rows.filter(r => r.split === "test");
  const rand = C.rng(SEED * 7 + name.length);

  // Signal carried by each component on its own (all data)
  const perComponent = {};
  COMPONENT_IDS.forEach(id => {
    const get = (kind) => rows.filter(r => r.kind === kind).map(r => r.comp[id] || 0);
    perComponent[id] = { vsPopular: round(C.auc(get("expert"), get("popular"))), vsRandom: round(C.auc(get("expert"), get("random"))),
      meanExpert: round(C.mean(get("expert")), 1), meanPopular: round(C.mean(get("popular")), 1), meanRandom: round(C.mean(get("random")), 1) };
  });

  // Tune on train
  const prev = PREVIOUS_WEIGHTS[name];
  const dist = (w) => ["offense", "defense", "roles", "threats", "viability"].reduce((a, k) => a + Math.abs(w[k] - prev[k]), 0);
  const grid = C.weightGrid(5, 15, true, ["offense", "defense", "roles", "threats", "viability"]).map(w => ({ w, obj: evaluate(train, w).objective }));
  const best = grid.reduce((b, g) => (!b || g.obj > b.obj + 1e-9 || (Math.abs(g.obj - b.obj) <= 1e-9 && dist(g.w) < dist(b.w))) ? g : b, null);
  // Selection rule fixed before looking at test results: within SELECT_TOLERANCE of the best training
  // objective, take the most evenly spread weights (smallest largest weight); ties toward the previous weights.
  const spread = (w) => Math.max(w.offense, w.defense, w.roles, w.threats, w.viability);
  const chosen = grid.filter(g => g.obj >= best.obj - SELECT_TOLERANCE).sort((a, b) => spread(a.w) - spread(b.w) || dist(a.w) - dist(b.w))[0];

  const summarize = (subset, w) => {
    const e = evaluate(subset, w);
    return {
      vsPopular: round(e.vsPopular), vsPopularCi95: C.aucInterval(e.e, e.p, rand).map(x => round(x)),
      vsRandom: round(e.vsRandom), vsRandomCi95: C.aucInterval(e.e, e.r, rand).map(x => round(x)),
      meanExpert: round(C.mean(e.e), 1), meanPopular: round(C.mean(e.p), 1), meanRandom: round(C.mean(e.r), 1),
      counts: { expert: e.e.length, popular: e.p.length, random: e.r.length }
    };
  };
  const perFormat = {};
  group.formats.forEach(f => {
    const sub = rows.filter(r => r.format === f.id);
    const c = evaluate(sub, chosen.w), p = evaluate(sub, prev);
    perFormat[f.id] = { previousVsPopular: round(p.vsPopular), chosenVsPopular: round(c.vsPopular), previousVsRandom: round(p.vsRandom), chosenVsRandom: round(c.vsRandom), experts: sub.filter(r => r.kind === "expert").length };
  });

  results.groups[name] = {
    teams: { expert: rows.filter(r => r.kind === "expert").length, popular: rows.filter(r => r.kind === "popular").length, random: rows.filter(r => r.kind === "random").length, skippedExpert: skipped },
    perComponent,
    originalWeights: ORIGINAL_WEIGHTS, previousWeights: prev, bestFitWeights: best.w, chosenWeights: chosen.w,
    original: { test: summarize(test, ORIGINAL_WEIGHTS) },
    previous: { test: summarize(test, prev) },
    bestFit: { train: summarize(train, best.w), test: summarize(test, best.w) },
    chosen: { train: summarize(train, chosen.w), test: summarize(test, chosen.w), all: summarize(rows, chosen.w) },
    perFormat
  };
}

fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(results, null, 2) + "\n");

const fmt = (s) => `vs popular ${s.vsPopular} ${JSON.stringify(s.vsPopularCi95)}, vs random ${s.vsRandom} ${JSON.stringify(s.vsRandomCi95)}`;
for (const [name, g] of Object.entries(results.groups)) {
  console.log(`\n== ${name}: ${g.teams.expert} expert, ${g.teams.popular} popular-baseline, ${g.teams.random} random-baseline teams (${g.teams.skippedExpert} expert skipped)`);
  console.log("Per component AUC (vs popular / vs random):", Object.entries(g.perComponent).map(([k, v]) => `${k} ${v.vsPopular}/${v.vsRandom}`).join(" | "));
  console.log(`Original weights, test: ${fmt(g.original.test)}`);
  console.log(`Previous weights ${JSON.stringify(g.previousWeights)}, test: ${fmt(g.previous.test)}`);
  console.log(`Best-fit weights ${JSON.stringify(g.bestFitWeights)}, test: ${fmt(g.bestFit.test)}`);
  console.log(`Chosen weights   ${JSON.stringify(g.chosenWeights)}, test: ${fmt(g.chosen.test)}`);
  console.log(`Mean score on test, chosen: experts ${g.chosen.test.meanExpert}, popular ${g.chosen.test.meanPopular}, random ${g.chosen.test.meanRandom}`);
  console.log("Per format (previous -> chosen, vs popular | vs random):", Object.entries(g.perFormat).map(([k, v]) => `${k} ${v.previousVsPopular}->${v.chosenVsPopular} | ${v.previousVsRandom}->${v.chosenVsRandom} (n=${v.experts})`).join("; "));
}
