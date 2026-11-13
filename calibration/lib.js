// Calibration helpers: turn Showdown-format sets into the app's team members, build random
// baseline teams, and measure how well a score separates expert teams from baselines.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const T = require("../Frontend/team.js");

function loadCalc() {
  const ctx = { window: {}, console };
  ctx.self = ctx.window;
  vm.createContext(ctx);
  for (const f of ["data.min.js", "calc.min.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../Frontend/vendor/smogon-calc", f), "utf8"), ctx);
  }
  return ctx.window.calc;
}

const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"];
const TARGETS = { allAdjacentFoes: "all-opponents", allAdjacent: "all-other-pokemon" };
const toID = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// Deterministic PRNG so baselines and splits are reproducible
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Showdown set {species, ability, item, nature, evs, ivs, moves, level} -> app slot, plus move info.
// Returns null when the species is unknown to the calculator data for that generation.
function toMember(calc, gen, set, moveInfo) {
  const species = gen.species.get(toID(set.species || set.name));
  if (!species) return null;
  const slot = T.createEmptySlot();
  slot.name = T.normalizeId(species.name);
  slot.species = slot.name;
  slot.types = Array.from(species.types, t => t.toLowerCase()); // Array.from: plain arrays, not the calc sandbox's
  STAT_KEYS.forEach(k => { slot.stats[k] = species.baseStats[k]; });
  slot.ability = set.ability && set.ability !== "No Ability" ? T.normalizeId(set.ability) : null;
  slot.item = set.item ? T.normalizeId(set.item) : null;
  slot.level = set.level || 100;
  slot.nature = set.nature ? set.nature.toLowerCase() : "hardy";
  // In Gen 1-2 Showdown treats any EV a set leaves out as maxed (stat experience), so sets usually omit them
  const defaultEv = gen.num <= 2 ? 252 : 0;
  STAT_KEYS.forEach(k => {
    slot.evs[k] = set.evs && set.evs[k] !== undefined ? set.evs[k] : defaultEv;
    slot.ivs[k] = set.ivs && set.ivs[k] !== undefined ? set.ivs[k] : 31;
  });
  slot.moves = [0, 1, 2, 3].map(i => (set.moves && set.moves[i]) ? T.normalizeId(set.moves[i]) : null);
  (set.moves || []).forEach(name => {
    const id = T.normalizeId(name);
    if (moveInfo[id] !== undefined) return;
    const data = gen.moves.get(toID(name));
    if (!data) { moveInfo[id] = null; return; }
    const m = new calc.Move(gen, data.name);
    moveInfo[id] = { type: m.type.toLowerCase(), damageClass: m.category.toLowerCase(), priority: m.priority || 0, target: TARGETS[data.target] || "selected-pokemon" };
  });
  return slot;
}

// Random baseline: 6 distinct species drawn from the usage pool, weighted by usage, each with its
// most common set. Individual sets are realistic; only the team composition is random.
function baselineTeam(pool, rand) {
  const chosen = [];
  const left = pool.slice();
  while (chosen.length < 6 && left.length) {
    const total = left.reduce((a, p) => a + p.usage, 0);
    let r = rand() * total;
    let i = 0;
    while (i < left.length - 1 && (r -= left[i].usage) > 0) i++;
    chosen.push(left.splice(i, 1)[0]);
  }
  return chosen.map(p => ({ species: p.name, ...p.set }));
}

// AUC: probability that a random positive outscores a random negative (ties count half)
function auc(pos, neg) {
  if (!pos.length || !neg.length) return NaN;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

// 95% bootstrap confidence interval for the AUC
function aucInterval(pos, neg, rand, rounds = 1000) {
  const vals = [];
  for (let r = 0; r < rounds; r++) {
    const p = pos.map(() => pos[Math.floor(rand() * pos.length)]);
    const n = neg.map(() => neg[Math.floor(rand() * neg.length)]);
    vals.push(auc(p, n));
  }
  vals.sort((a, b) => a - b);
  return [vals[Math.floor(rounds * 0.025)], vals[Math.floor(rounds * 0.975)]];
}

// Every weight combination in steps of `step` with completeness fixed (complete sets can't calibrate it).
// With withThreats the threat-matchup weight is searched too.
function weightGrid(step = 5, completeness = 15, withThreats = false) {
  const out = [];
  const rest = 100 - completeness;
  for (let o = 0; o <= rest; o += step) {
    for (let d = 0; o + d <= rest; d += step) {
      for (let t = 0; o + d + t <= rest; t += step) {
        if (!withThreats && t > 0) break;
        out.push({ offense: o, defense: d, roles: rest - o - d - t, completeness, threats: t });
      }
    }
  }
  return out;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

module.exports = { loadCalc, rng, shuffle, toMember, baselineTeam, auc, aucInterval, weightGrid, mean };
