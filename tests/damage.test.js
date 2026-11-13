const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Load the vendored browser bundles the same way the page does (they assign window.calc)
function loadCalc() {
  const ctx = { window: {}, console };
  ctx.self = ctx.window;
  vm.createContext(ctx);
  for (const f of ["data.min.js", "calc.min.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../Frontend/vendor/smogon-calc", f), "utf8"), ctx);
  }
  return ctx.window.calc;
}
const D = require("../Frontend/damage.js")(loadCalc());

function set(name, over = {}) {
  return {
    name, level: 100, nature: "hardy", ability: null, item: null, moves: [null, null, null, null],
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, ...over
  };
}
const gen9 = D.generation(9);

test("calculator loads", () => {
  assert.equal(D.available, true);
  assert.equal(require("../Frontend/damage.js")(undefined).available, false);
});

test("PokeAPI names map to calculator species, moves, items and abilities", () => {
  assert.equal(D.resolveSpecies(gen9, "rotom-wash"), "Rotom-Wash");
  assert.equal(D.resolveSpecies(gen9, "tornadus-incarnate"), "Tornadus");
  assert.equal(D.resolveSpecies(gen9, "tauros-paldea-combat-breed"), "Tauros-Paldea-Combat");
  assert.equal(D.resolveSpecies(gen9, "mr-mime"), "Mr. Mime");
  assert.equal(D.resolveSpecies(gen9, "not-a-pokemon"), null);
  assert.equal(D.resolveMove(gen9, "u-turn"), "U-turn");
  assert.equal(D.resolveMove(gen9, "will-o-wisp"), "Will-O-Wisp");
  assert.equal(D.resolveItem(gen9, "choice-scarf"), "Choice Scarf");
  assert.equal(D.resolveAbility(gen9, "flash-fire"), "Flash Fire");
});

test("known calculation: 252+ Atk Choice Band Garchomp Earthquake vs 252 HP Heatran OHKOs", () => {
  const garchomp = set("garchomp", { nature: "adamant", item: "choice-band", evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 } });
  const heatran = set("heatran", { evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 4, spe: 252 } });
  const r = D.calculate(9, garchomp, "earthquake", heatran);
  assert.equal(r.error, undefined);
  assert.ok(r.minPct > 100, `min ${r.minPct}%`);
  assert.match(r.ko, /OHKO/);
  assert.match(r.desc, /Choice Band Garchomp Earthquake vs\. 252 HP/);
});

test("set details change the result: EVs, nature, item and ability", () => {
  const base = set("garchomp", { evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe: 0 } });
  const target = set("clefable");
  const plain = D.calculate(9, base, "dragon-claw", target);
  assert.equal(plain.max, 0); // Fairy is immune to Dragon
  const eq = D.calculate(9, base, "earthquake", target);
  const banded = D.calculate(9, { ...base, item: "choice-band" }, "earthquake", target);
  const adamant = D.calculate(9, { ...base, nature: "adamant" }, "earthquake", target);
  assert.ok(banded.max > eq.max);
  assert.ok(adamant.max > eq.max);
  const levitate = D.calculate(9, base, "earthquake", set("rotom-wash", { ability: "levitate" }));
  assert.equal(levitate.max, 0);
  const bulky = D.calculate(9, base, "earthquake", D.hypotheticalSlot("clefable", "physical"));
  assert.ok(bulky.maxPct < eq.maxPct);
});

test("status moves and unknown data return errors instead of throwing", () => {
  const a = set("garchomp");
  assert.match(D.calculate(9, a, "swords-dance", set("clefable")).error, /status move/);
  assert.match(D.calculate(9, a, "not-a-move", set("clefable")).error, /not in the calculator/);
  assert.match(D.calculate(9, set("missingno-x"), "earthquake", set("clefable")).error, /not in the calculator/);
  assert.equal(D.isDamaging(gen9, "seismic-toss"), true);
  assert.equal(D.isDamaging(gen9, "toxic"), false);
});

test("older generations use their own mechanics", () => {
  // Gen 4 has no Fairy type: Clefable is Normal, so Dragon Claw hits it
  const r = D.calculate(4, set("garchomp"), "dragon-claw", set("clefable"));
  assert.ok(r.max > 0);
});

test("bestMove picks the strongest damaging move", () => {
  const a = set("garchomp", { moves: ["swords-dance", "dragon-claw", "earthquake", "fire-fang"] });
  const best = D.bestMove(9, a, set("heatran"));
  assert.equal(best.move, "earthquake");
});

test("defender spread presets", () => {
  const s = D.hypotheticalSlot("clefable", "special");
  assert.equal(s.evs.hp, 252);
  assert.equal(s.evs.spd, 252);
  assert.equal(s.nature, "calm");
  assert.equal(D.hypotheticalSlot("clefable", "bogus").evs.hp, 0);
});
