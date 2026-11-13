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

// Independent reference: Pokémon Showdown's per-generation type data, shipped inside @smogon/calc
function showdownTypes(genNum) {
  const fs = require("fs"), path = require("path"), vm = require("vm");
  const ctx = { window: {}, console };
  ctx.self = ctx.window;
  vm.createContext(ctx);
  for (const f of ["data.min.js", "calc.min.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../Frontend/vendor/smogon-calc", f), "utf8"), ctx);
  return ctx.window.calc.Generations.get(genNum).types;
}

test("type charts match Pokémon Showdown for every generation and every type pair", () => {
  for (let gen = 1; gen <= 9; gen++) {
    const sd = showdownTypes(gen);
    const sdTypes = [...sd].map(t => t.name.toLowerCase()).filter(t => L.ALL_TYPES.includes(t));
    assert.deepEqual([...L.typesFor(gen)].sort(), sdTypes.sort(), `types in gen ${gen}`);
    for (const atk of sdTypes) for (const def of sdTypes) {
      const expected = sd.get(atk).effectiveness[def.charAt(0).toUpperCase() + def.slice(1)];
      assert.equal(L.getDefensiveMultiplier([def], atk, gen), expected, `gen ${gen}: ${atk} -> ${def}`);
    }
  }
});

test("older-generation chart quirks", () => {
  assert.equal(L.getDefensiveMultiplier(["psychic"], "ghost", 1), 0); // Gen 1 bug
  assert.equal(L.getDefensiveMultiplier(["psychic"], "ghost", 2), 2);
  assert.equal(L.getDefensiveMultiplier(["steel"], "dark", 4), 0.5);
  assert.equal(L.getDefensiveMultiplier(["steel"], "dark", 6), 1);
  assert.equal(L.typesFor(1).length, 15);
  assert.equal(L.typesFor(5).length, 17);
  assert.equal(L.typesFor(9).length, 18);
  assert.equal(L.typesFor(null).length, 18);
  assert.equal(L.dualTypeCoverage(["ground"], 1).total, 105);
  assert.equal(L.dualTypeCoverage(["ground"], 5).total, 136);
  assert.ok(!L.coveredTypes(["fighting"], 5).includes("fairy"));
});

test("Pokémon types by generation (PokeAPI past_types)", () => {
  const clefablePast = [{ gen: 5, types: ["normal"] }];
  assert.deepEqual(L.typesInGen(["fairy"], clefablePast, 4), ["normal"]);
  assert.deepEqual(L.typesInGen(["fairy"], clefablePast, 5), ["normal"]);
  assert.deepEqual(L.typesInGen(["fairy"], clefablePast, 6), ["fairy"]);
  assert.deepEqual(L.typesInGen(["fairy"], clefablePast, null), ["fairy"]);
  const magnemitePast = [{ gen: 1, types: ["electric"] }];
  assert.deepEqual(L.typesInGen(["electric", "steel"], magnemitePast, 1), ["electric"]);
  assert.deepEqual(L.typesInGen(["electric", "steel"], magnemitePast, 2), ["electric", "steel"]);
  // Several changes: the earliest entry that still covers the generation applies
  const multi = [{ gen: 2, types: ["a"] }, { gen: 5, types: ["b"] }];
  assert.deepEqual(L.typesInGen(["c"], multi, 1), ["a"]);
  assert.deepEqual(L.typesInGen(["c"], multi, 3), ["b"]);
  assert.deepEqual(L.typesInGen(["c"], multi, 7), ["c"]);
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
