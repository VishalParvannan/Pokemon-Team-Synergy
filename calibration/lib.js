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
    moveInfo[id] = { type: m.type.toLowerCase(), damageClass: m.category.toLowerCase(), priority: m.priority || 0, power: m.bp || 0, target: TARGETS[data.target] || "selected-pokemon" };
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

// "Random" baseline: any species of the generation (battle-only forms excluded), random item,
// random ability, four random moves (calc data has no learnsets, so moves may be unlearnable) and a
// random 252/252/4 EV spread. Represents an unoptimized team, the case the viability check targets.
const BATTLE_ONLY = /-(mega|primal|gmax|eternamax|zen|terastal|stellar|ultra|crowned|blade|school|pirouette|noice|hangry|busted|gulping|gorging|complete|hero|totem)(-|$)/;
const NATURE_NAMES = ["Hardy", "Adamant", "Modest", "Jolly", "Timid", "Bold", "Calm", "Impish", "Careful", "Brave", "Quiet", "Relaxed", "Sassy", "Naive", "Hasty", "Lonely", "Mild", "Rash", "Gentle", "Lax", "Docile", "Serious", "Bashful", "Quirky", "Naughty"];
const listCache = new Map();
function genLists(gen) {
  if (!listCache.has(gen.num)) {
    const species = [...gen.species].filter(s => !BATTLE_ONLY.test(T.normalizeId(s.name)));
    const items = [...gen.items].map(i => i.name);
    const moves = [...gen.moves].filter(m => !m.isZ && !m.isMax && m.name !== "Struggle" && m.name !== "(No Move)").map(m => m.name);
    listCache.set(gen.num, { species, items, moves });
  }
  return listCache.get(gen.num);
}
function randomTeam(gen, rand) {
  const { species, items, moves } = genLists(gen);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const chosen = new Set();
  while (chosen.size < 6) chosen.add(pick(species));
  return [...chosen].map(s => {
    const mv = new Set();
    while (mv.size < 4) mv.add(pick(moves));
    const stats = shuffle(STAT_KEYS, rand);
    return {
      species: s.name,
      ability: s.abilities ? Object.values(s.abilities)[Math.floor(rand() * Object.values(s.abilities).length)] : undefined,
      item: gen.num >= 2 && items.length ? pick(items) : undefined,
      nature: pick(NATURE_NAMES),
      evs: gen.num >= 3 ? { [stats[0]]: 252, [stats[1]]: 252, [stats[2]]: 4 } : undefined,
      moves: [...mv]
    };
  });
}

// AUC: probability that a random positive outscores a random negative (ties count half).
// Rank-based (Mann-Whitney U), O(n log n).
function auc(pos, neg) {
  if (!pos.length || !neg.length) return NaN;
  const all = pos.map(v => [v, 1]).concat(neg.map(v => [v, 0])).sort((a, b) => a[0] - b[0]);
  let rankSumPos = 0;
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j < all.length && all[j][0] === all[i][0]) j++;
    const avgRank = (i + j + 1) / 2; // ranks i+1..j share their average
    for (let k = i; k < j; k++) if (all[k][1]) rankSumPos += avgRank;
    i = j;
  }
  return (rankSumPos - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length);
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

// Every weight combination in steps of `step` over `keys` (the last key takes the remainder), with
// completeness fixed: complete sets can't calibrate it. Default keys match the earlier 4-way search.
function weightGrid(step = 5, completeness = 15, withThreats = false, keys) {
  const k = keys || (withThreats ? ["offense", "defense", "threats", "roles"] : ["offense", "defense", "roles"]);
  const rest = 100 - completeness;
  const out = [];
  const walk = (i, left, acc) => {
    if (i === k.length - 1) { out.push({ offense: 0, defense: 0, roles: 0, threats: 0, viability: 0, ...acc, [k[i]]: left, completeness }); return; }
    for (let v = 0; v <= left; v += step) walk(i + 1, left - v, { ...acc, [k[i]]: v });
  };
  walk(0, rest, {});
  return out;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

module.exports = { loadCalc, rng, shuffle, toMember, baselineTeam, randomTeam, auc, aucInterval, weightGrid, mean };
