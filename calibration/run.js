#!/usr/bin/env node
// Calibrates and evaluates the team score. Expert teams (Smogon sample teams) are compared with
// random baseline teams built from the same formats' most common sets. Weights are tuned on a
// 70% training split and judged on the held-out 30%. Writes calibration/results.json.
// Usage: node calibration/run.js   (after node calibration/build-data.js)
const fs = require("fs");
const path = require("path");
const A = require("../Frontend/analysis.js");
const C = require("./lib.js");
const crypto = require("crypto");

const DATA = path.join(__dirname, "data");
const BASELINES_PER_EXPERT = 8;
const TRAIN_SHARE = 0.7;
const SEED = 20261113;
const SELECT_TOLERANCE = 0.01;
// The hand-picked weights the app used before calibration (kept fixed so results are reproducible)
const ORIGINAL_WEIGHTS = { offense: 30, defense: 30, roles: 25, completeness: 15, threats: 0 };

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
const CODE_VERSION = crypto.createHash("sha1").update(["../Frontend/analysis.js", "../Frontend/threats.js", "../Frontend/damage.js", "lib.js"].map(f => fs.readFileSync(path.join(__dirname, f), "utf8")).join("")).digest("hex").slice(0, 10);

// Component scores do not depend on the weights, so compute them once per team
function components(sets, gen, doubles, snapshot) {
  const key = crypto.createHash("sha1").update(JSON.stringify([CODE_VERSION, gen.num, doubles, snapshot.format, sets])).digest("hex");
  if (cache[key] !== undefined) return cache[key];
  const moveInfo = {};
  const members = sets.map(s => C.toMember(calc, gen, s, moveInfo));
  let out = null;
  if (!members.some(m => !m)) {
    const info = Object.fromEntries(Object.entries(moveInfo).filter(([, v]) => v));
    const r = A.analyzeTeam(members, info, { doubles });
    out = Object.fromEntries(r.score.components.map(c => [c.id, c.score]));
    const top = { ...snapshot, threats: snapshot.threats.slice(0, TH.SCORE_TOP_N) };
    const t = TH.threatScore(TH.analyzeThreats(gen.num, top, members, { doubles }), top);
    out.threats = t ? t.score : 0;
  }
  cache[key] = out;
  return out;
}
const overall = (comp, w) => (comp.offense * w.offense + comp.defense * w.defense + comp.roles * w.roles + comp.completeness * w.completeness + comp.threats * (w.threats || 0)) / (w.offense + w.defense + w.roles + w.completeness + (w.threats || 0));

function buildGroup(name, group) {
  const rand = C.rng(SEED + name.length);
  const rows = []; // { format, label: 1 expert | 0 baseline, split, comp }
  let skipped = 0;
  for (const f of group.formats) {
    const genNum = Number(f.id.match(/^gen(\d)/)[1]);
    const gen = calc.Generations.get(genNum);
    const experts = read(`${f.id}-teams.json`);
    const pool = read(`${f.pool}-pool.json`);
    const snapshot = snapshotFile(group.doubles ? "gen9doublesou" : f.id);
    const expertRows = [];
    experts.forEach(t => {
      const comp = components(t.data, gen, group.doubles, snapshot);
      if (comp) expertRows.push({ format: f.id, label: 1, comp, name: t.name });
      else skipped++;
    });
    const baseRows = [];
    for (let i = 0; i < Math.max(80, experts.length * BASELINES_PER_EXPERT); i++) {
      const comp = components(C.baselineTeam(pool, rand), gen, group.doubles, snapshot);
      if (comp) baseRows.push({ format: f.id, label: 0, comp });
      if (i % 50 === 0) process.stderr.write(`${f.id}: ${i} baselines
`);
    }
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    // Split each format separately so every format appears in both splits
    [expertRows, baseRows].forEach(list => {
      C.shuffle(list, rand).forEach((row, i) => { row.split = i < Math.round(list.length * TRAIN_SHARE) ? "train" : "test"; rows.push(row); });
    });
  }
  return { rows, skipped };
}

function evaluate(rows, w) {
  const pos = rows.filter(r => r.label === 1).map(r => overall(r.comp, w));
  const neg = rows.filter(r => r.label === 0).map(r => overall(r.comp, w));
  return { auc: C.auc(pos, neg), meanExpert: C.mean(pos), meanBaseline: C.mean(neg), experts: pos.length, baselines: neg.length, pos, neg };
}

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const results = { generated: new Date().toISOString().slice(0, 10), data: read("manifest.json"), method: {
  experts: "Smogon sample teams (pkmn/smogon)", baseline: `random teams of 6 distinct species drawn by usage from each format's 120 most-used Pokémon, each with its most common set (${BASELINES_PER_EXPERT} per expert team, min 80 per format)`,
  split: `${TRAIN_SHARE * 100}/${100 - TRAIN_SHARE * 100} train/test per format, seed ${SEED}`, metric: "AUC = probability an expert team outscores a baseline team; 95% CI by bootstrap (1000 resamples)",
  tuning: `grid over offense/defense/roles/threat-matchup weights in steps of 5 with completeness fixed at 15 (complete teams cannot calibrate it); then among weights within ${SELECT_TOLERANCE} of the best training AUC the most evenly spread is chosen (rule fixed before viewing test results)`,
  threats: "threat-matchup component uses the 20 most-used Pokémon of the format (Gen 9 Doubles OU for doubles) with their most common sets"
}, groups: {} };

for (const [name, group] of Object.entries(GROUPS)) {
  const { rows, skipped } = buildGroup(name, group);
  const train = rows.filter(r => r.split === "train");
  const test = rows.filter(r => r.split === "test");
  const rand = C.rng(SEED * 7 + name.length);
  const cur = ORIGINAL_WEIGHTS;

  // Signal carried by each component on its own (all data)
  const perComponent = {};
  ["offense", "defense", "roles", "completeness", "threats"].forEach(id => {
    const pos = rows.filter(r => r.label === 1).map(r => r.comp[id]);
    const neg = rows.filter(r => r.label === 0).map(r => r.comp[id]);
    perComponent[id] = { auc: round(C.auc(pos, neg)), meanExpert: round(C.mean(pos), 1), meanBaseline: round(C.mean(neg), 1) };
  });

  // Tune on train
  const dist = (w) => Math.abs(w.offense - cur.offense) + Math.abs(w.defense - cur.defense) + Math.abs(w.roles - cur.roles) + Math.abs((w.threats || 0) - (cur.threats || 0));
  let best = null;
  const grid = C.weightGrid(5, 15, true).map(w => ({ w, auc: evaluate(train, w).auc }));
  for (const g of grid) {
    if (!best || g.auc > best.auc + 1e-9 || (Math.abs(g.auc - best.auc) <= 1e-9 && dist(g.w) < dist(best.w))) best = g;
  }
  // Selection rule fixed before looking at test results: among weights within SELECT_TOLERANCE of the
  // best training AUC, take the most evenly spread (smallest largest weight), to avoid zeroing components
  // on a small sample. Ties broken toward the original weights.
  const spread = (w) => Math.max(w.offense, w.defense, w.roles, w.threats);
  const chosen = grid.filter(g => g.auc >= best.auc - SELECT_TOLERANCE)
    .sort((a, b) => spread(a.w) - spread(b.w) || dist(a.w) - dist(b.w))[0];

  const summarize = (subset, w) => {
    const e = evaluate(subset, w);
    return { auc: round(e.auc), ci95: C.aucInterval(e.pos, e.neg, rand).map(x => round(x)), meanExpert: round(e.meanExpert, 1), meanBaseline: round(e.meanBaseline, 1), experts: e.experts, baselines: e.baselines };
  };
  const perFormat = {};
  group.formats.forEach(f => {
    const sub = rows.filter(r => r.format === f.id);
    perFormat[f.id] = { original: round(evaluate(sub, cur).auc), bestFit: round(evaluate(sub, best.w).auc), chosen: round(evaluate(sub, chosen.w).auc), experts: sub.filter(r => r.label === 1).length };
  });

  results.groups[name] = {
    expertTeams: rows.filter(r => r.label === 1).length, baselineTeams: rows.filter(r => r.label === 0).length, skippedExpertTeams: skipped,
    perComponent,
    originalWeights: cur, bestFitWeights: best.w, chosenWeights: chosen.w,
    original: { all: summarize(rows, cur), train: summarize(train, cur), test: summarize(test, cur) },
    bestFit: { train: summarize(train, best.w), test: summarize(test, best.w) },
    chosen: { train: summarize(train, chosen.w), test: summarize(test, chosen.w) },
    perFormat
  };
}

fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(results, null, 2) + "\n");

for (const [name, g] of Object.entries(results.groups)) {
  console.log(`\n== ${name}: ${g.expertTeams} expert teams vs ${g.baselineTeams} baseline teams (${g.skippedExpertTeams} expert teams skipped)`);
  console.log("Per component AUC:", Object.entries(g.perComponent).map(([k, v]) => `${k} ${v.auc} (${v.meanExpert} vs ${v.meanBaseline})`).join(" | "));
  console.log(`Original weights ${JSON.stringify(g.originalWeights)}: all AUC ${g.original.all.auc} ${JSON.stringify(g.original.all.ci95)}, test AUC ${g.original.test.auc} ${JSON.stringify(g.original.test.ci95)}`);
  console.log(`Best-fit weights ${JSON.stringify(g.bestFitWeights)}: train AUC ${g.bestFit.train.auc}, test AUC ${g.bestFit.test.auc} ${JSON.stringify(g.bestFit.test.ci95)}`);
  console.log(`Chosen weights   ${JSON.stringify(g.chosenWeights)}: train AUC ${g.chosen.train.auc}, test AUC ${g.chosen.test.auc} ${JSON.stringify(g.chosen.test.ci95)}`);
  console.log(`Mean score on test, chosen: experts ${g.chosen.test.meanExpert} vs baseline ${g.chosen.test.meanBaseline}`);
  console.log("Per format (original -> chosen):", Object.entries(g.perFormat).map(([k, v]) => `${k} ${v.original}->${v.chosen} (n=${v.experts})`).join(" | "));
}
