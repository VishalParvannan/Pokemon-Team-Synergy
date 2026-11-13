const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../calibration/lib.js");
const A = require("../Frontend/analysis.js");
const T = require("../Frontend/team.js");

test("AUC: perfect, inverted, chance and ties", () => {
  assert.equal(C.auc([3, 4], [1, 2]), 1);
  assert.equal(C.auc([1, 2], [3, 4]), 0);
  assert.equal(C.auc([1, 1], [1, 1]), 0.5);
  assert.equal(C.auc([2, 0], [1]), 0.5);
  assert.ok(Number.isNaN(C.auc([], [1])));
});

test("bootstrap interval brackets the AUC", () => {
  const pos = [5, 6, 7, 8, 9, 4, 6], neg = [1, 2, 3, 4, 5, 6, 2];
  const a = C.auc(pos, neg);
  const [lo, hi] = C.aucInterval(pos, neg, C.rng(1), 300);
  assert.ok(lo <= a && a <= hi, `${lo} <= ${a} <= ${hi}`);
});

test("PRNG and shuffle are deterministic", () => {
  const a = C.shuffle([1, 2, 3, 4, 5, 6], C.rng(42));
  const b = C.shuffle([1, 2, 3, 4, 5, 6], C.rng(42));
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), [1, 2, 3, 4, 5, 6]);
});

test("weight grid sums to 100 with completeness fixed", () => {
  const g = C.weightGrid(5, 15, true);
  assert.ok(g.length > 1000);
  g.forEach(w => assert.equal(w.offense + w.defense + w.roles + w.threats + w.completeness, 100));
  assert.ok(C.weightGrid(5, 15, false).every(w => w.threats === 0));
});

test("baseline teams: six distinct species with their usage sets", () => {
  const pool = Array.from({ length: 10 }, (_, i) => ({ name: `Mon${i}`, usage: 0.1 * (i + 1), set: { moves: ["Tackle"], ability: "Static", item: null, nature: "Hardy", evs: {} } }));
  const team = C.baselineTeam(pool, C.rng(3));
  assert.equal(team.length, 6);
  assert.equal(new Set(team.map(m => m.species)).size, 6);
  assert.deepEqual(team[0].moves, ["Tackle"]);
});

test("Showdown sets convert to app members with calculator data", () => {
  const calc = C.loadCalc();
  const gen = calc.Generations.get(9);
  const info = {};
  const m = C.toMember(calc, gen, { species: "Great Tusk", ability: "Protosynthesis", item: "Heavy-Duty Boots", nature: "Jolly", evs: { atk: 252, spe: 252 }, moves: ["Headlong Rush", "Rapid Spin", "Rock Slide", "U-turn"] }, info);
  assert.equal(m.name, "great-tusk");
  assert.deepEqual(m.types, ["ground", "fighting"]);
  assert.equal(m.stats.atk, 131);
  assert.equal(m.item, "heavy-duty-boots");
  assert.deepEqual(m.moves, ["headlong-rush", "rapid-spin", "rock-slide", "u-turn"]);
  assert.equal(info["rock-slide"].target, "all-opponents");
  assert.equal(info["rapid-spin"].damageClass, "physical");
  assert.equal(C.toMember(calc, gen, { species: "Not A Pokemon", moves: [] }, info), null);
  // The converted member drives the same analysis the app uses
  const r = A.analyzeTeam([m], info);
  assert.deepEqual(r.roles.removal, ["great-tusk"]);
});

test("score: threat component is included only with threat data, weights renormalize", () => {
  const s = T.createEmptySlot();
  Object.assign(s, { name: "a", types: ["normal"], moves: ["tackle", null, null, null] });
  const info = { tackle: { type: "normal", damageClass: "physical", priority: 0 } };
  const w = { offense: 20, defense: 20, roles: 20, completeness: 15, threats: 25 };
  const without = A.analyzeTeam([s], info, { weights: w }).score;
  assert.ok(!without.components.some(c => c.id === "threats"));
  assert.equal(without.components.reduce((a, c) => a + c.weight, 0), 100);
  const withT = A.analyzeTeam([s], info, { weights: w, threat: { score: 100, considered: 20, notHighShare: 1, ohkoAvoidance: 1 } }).score;
  const comp = withT.components.find(c => c.id === "threats");
  assert.equal(comp.score, 100);
  assert.equal(comp.weight, 25);
  assert.ok(withT.overall > without.overall);
});
