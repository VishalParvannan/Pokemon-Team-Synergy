const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../Frontend/logic.js");

test("type chart has all 18 attacking rows with valid values", () => {
  assert.equal(L.ALL_TYPES.length, 18);
  for (const atk of L.ALL_TYPES) {
    assert.ok(L.TYPE_CHART[atk], `missing row ${atk}`);
    for (const [def, m] of Object.entries(L.TYPE_CHART[atk])) {
      assert.ok(L.ALL_TYPES.includes(def), `${atk} -> unknown type ${def}`);
      assert.ok([0, 0.5, 2].includes(m), `${atk} -> ${def} = ${m}`);
    }
  }
});

test("known single-type matchups", () => {
  const m = (d, a) => L.getDefensiveMultiplier(d, a);
  assert.equal(m(["dragon"], "fairy"), 2);
  assert.equal(m(["fairy"], "dragon"), 0);
  assert.equal(m(["fairy"], "poison"), 2);
  assert.equal(m(["steel"], "fairy"), 0.5);
  assert.equal(m(["ghost"], "normal"), 0);
  assert.equal(m(["flying"], "ground"), 0);
  assert.equal(m(["dark"], "psychic"), 0);
  assert.equal(m(["steel"], "poison"), 0);
});

test("dual-type 4x, 1/4x and immunity", () => {
  const m = (d, a) => L.getDefensiveMultiplier(d, a);
  assert.equal(m(["grass", "flying"], "ice"), 4);
  assert.equal(m(["bug", "grass"], "fire"), 4);
  assert.equal(m(["water", "ground"], "grass"), 4);
  assert.equal(m(["steel", "flying"], "grass"), 0.25);
  assert.equal(m(["fire", "dragon"], "fire"), 0.25);
  assert.equal(m(["ground", "flying"], "electric"), 0);
  assert.equal(m(["steel", "ground"], "poison"), 0);
});

test("stat calculation (Garchomp lvl 100, known values)", () => {
  // Garchomp base 108/130/95/80/85/102, 31 IVs, 252 Atk / 252 Spe / 4 HP, Jolly
  const slot = {
    name: "garchomp", level: 100, nature: "jolly",
    stats: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    evs: { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 }
  };
  const s = L.calcAllStats(slot);
  assert.equal(s.hp, 358);
  assert.equal(s.atk, 359);
  assert.equal(s.spe, 333);
  assert.ok(s.spa < L.calcStat("spa", 80, 31, 0, 100, "hardy"));
});

test("shedinja HP and level scaling", () => {
  assert.equal(L.calcStat("hp", 1, 31, 0, 100, "hardy", true), 1);
  assert.equal(L.calcStat("hp", 100, 31, 0, 50, "hardy"), Math.floor((231 * 50) / 100) + 50 + 10);
});

test("EV validation", () => {
  const evs = { hp: 252, atk: 252, def: 0, spa: 0, spd: 0, spe: 0 };
  const r = L.clampEv(evs, "spe", 252);
  assert.equal(r.value, 6);
  assert.ok(r.message);
  assert.equal(L.clampEv(evs, "def", 999).value, 6);
  assert.equal(L.clampEv({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, "hp", 300).value, 252);
  assert.equal(L.clampEv(evs, "atk", -5).value, 0);
});

test("move-based coverage", () => {
  assert.deepEqual(L.coveredTypes([]), []);
  const c = L.coveredTypes(["ground"]);
  assert.ok(c.includes("fire") && c.includes("steel") && !c.includes("flying"));
  const d = L.dualTypeCoverage(["ground", "ice"]);
  assert.equal(d.total, 153);
  assert.ok(d.hit > 0 && d.hit < d.total);
});

test("defensive summary separates immunities", () => {
  const s = L.defensiveSummary([{ types: ["ground", "flying"] }, { types: ["fire"] }]);
  assert.equal(s.electric.immune, 1);
  assert.equal(s.water.weak, 1 + 1);
});

test("format filtering keeps species, forms and lookalike names separate", () => {
  const all = new Set(["porygon", "porygon-z", "charizard", "wormadam", "tauros"]);
  const entries = [
    { name: "porygon", id: 137 }, { name: "porygon-z", id: 474 },
    { name: "charizard", id: 6 }, { name: "charizard-mega-x", id: 10034 }, { name: "charizard-gmax", id: 10196 },
    { name: "wormadam-plant", id: 413 }, { name: "wormadam-sandy", id: 10004 },
    { name: "tauros-paldea-combat-breed", id: 10250 }
  ];
  const allowed = new Set(["porygon", "charizard", "wormadam", "tauros"]);
  assert.deepEqual(L.filterPokemon(entries, all, allowed, ["mega"]),
    ["porygon", "charizard", "charizard-mega-x", "wormadam-plant"]);
  assert.deepEqual(L.filterPokemon(entries, all, allowed, ["paldea"]),
    ["porygon", "charizard", "wormadam-plant", "tauros-paldea-combat-breed"]);
});
