const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

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
const TH = require("../Frontend/threats.js")(D);

function set(name, over = {}) {
  return {
    name, level: 100, nature: "hardy", ability: null, item: null, moves: [null, null, null, null],
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, ...over
  };
}

// Small fixed snapshot (shape of Frontend/data/threats/*.json) so tests don't depend on regenerated data
const SNAPSHOT = {
  format: "gen9ou",
  threats: [
    { name: "Great Tusk", usage: 0.33, set: { ability: "Protosynthesis", item: "Heavy-Duty Boots", nature: "Jolly", evs: { atk: 252, def: 4, spe: 252 }, moves: ["Headlong Rush", "Rapid Spin", "Ice Spinner", "Stealth Rock"] } },
    { name: "Gholdengo", usage: 0.27, set: { ability: "Good as Gold", item: "Choice Scarf", nature: "Timid", evs: { spa: 252, spd: 4, spe: 252 }, moves: ["Shadow Ball", "Make It Rain", "Recover", "Nasty Plot"] } },
    { name: "Fakemon-Nonexistent", usage: 0.1, set: { ability: null, item: null, nature: "Hardy", evs: {}, moves: ["Tackle"] } }
  ]
};

// A team of three grounded Fire types with Fire moves: Great Tusk should wreck it
// (not Charizard: it is part Flying, so immune to Headlong Rush)
const FIRE = ["arcanine", "typhlosion", "heatran"].map(n => set(n, { moves: ["flamethrower", "flare-blitz", null, null], evs: { hp: 0, atk: 252, def: 0, spa: 252, spd: 0, spe: 4 } }));

test("snapshot choice follows format generation and doubles", () => {
  assert.equal(TH.snapshotFor({ era: 4 }), "gen4ou");
  assert.equal(TH.snapshotFor({ era: null }), "gen9ou");
  assert.equal(TH.snapshotFor({ era: 9 }, true), "gen9doublesou");
  assert.equal(TH.snapshotFor({ era: null }, true), "gen9doublesou");
  assert.equal(TH.snapshotFor({ era: 5 }, true), null); // no doubles usage data for older generations
});

test("usage sets convert to calculator-ready slots", () => {
  const s = TH.threatSlot(SNAPSHOT.threats[0]);
  assert.equal(s.nature, "jolly");
  assert.equal(s.evs.atk, 252);
  assert.equal(s.evs.hp, 0);
  assert.equal(TH.threatSlot({ name: "Tauros", set: { ability: "No Ability", moves: [], evs: {} } }).ability, null);
});

test("Great Tusk is a high-level threat to an all-Fire team", () => {
  const r = TH.analyzeThreats(9, SNAPSHOT, FIRE);
  const tusk = r.entries.find(e => e.name === "Great Tusk");
  assert.equal(tusk.level, "high");
  assert.ok(tusk.ohkoed.length >= 2, tusk.ohkoed.join(","));
  assert.equal(tusk.safeSwitchIns.length, 0);
  assert.ok(tusk.vs.every(v => v.incoming.move === "Headlong Rush"));
  assert.deepEqual(r.summary.skipped, ["Fakemon-Nonexistent"]);
  assert.equal(r.summary.considered, 2);
  assert.equal(r.entries[0].level, "high"); // sorted most dangerous first
});

test("a Flying/Levitate switch-in counts as safe against Ground attacks", () => {
  const team = [set("corviknight", { moves: ["brave-bird", "body-press", null, null], evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 }, nature: "impish" })];
  const tusk = TH.analyzeThreats(9, SNAPSHOT, team).entries.find(e => e.name === "Great Tusk");
  assert.deepEqual(tusk.safeSwitchIns, ["corviknight"]);
  assert.equal(tusk.ohkoed.length, 0);
});

test("speed comparison uses calculated stats and Choice Scarf", () => {
  const slow = [set("heatran", { moves: ["flamethrower", null, null, null] })];
  const gold = TH.analyzeThreats(9, SNAPSHOT, slow).entries.find(e => e.name === "Gholdengo");
  assert.equal(gold.vs[0].faster, "threat");
  assert.ok(gold.threatSpeed > 300, `scarfed Gholdengo speed ${gold.threatSpeed}`);
});

test("best answer is the member with the strongest hit", () => {
  const team = [set("garchomp", { moves: ["earthquake", null, null, null], evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 }, nature: "jolly" }), set("chansey", { moves: ["seismic-toss", null, null, null] })];
  const gold = TH.analyzeThreats(9, SNAPSHOT, team).entries.find(e => e.name === "Gholdengo");
  assert.equal(gold.bestAnswer.name, "garchomp");
  assert.equal(gold.bestAnswer.move, "earthquake");
});

test("threat score: fewer high threats and OHKOs score higher", () => {
  const corv = [set("corviknight", { moves: ["brave-bird", "body-press", null, null], evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 }, nature: "impish" })];
  const fire = TH.threatScore(TH.analyzeThreats(9, SNAPSHOT, FIRE), SNAPSHOT);
  const bulky = TH.threatScore(TH.analyzeThreats(9, SNAPSHOT, corv), SNAPSHOT);
  assert.equal(fire.considered, 2);
  assert.ok(bulky.score > fire.score, `${bulky.score} vs ${fire.score}`);
  assert.ok(fire.score >= 0 && fire.score <= 100);
  assert.equal(TH.threatScore(null, SNAPSHOT), null);
});

test("shipped snapshots are well-formed", () => {
  const dir = path.join(__dirname, "../Frontend/data/threats");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
  assert.ok(files.length >= 10);
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    assert.ok(j.threats.length >= 20, f);
    assert.ok(j.fetched && j.source && j.battles > 0, f);
    j.threats.forEach(t => { assert.ok(t.name && t.usage > 0 && Array.isArray(t.set.moves), `${f} ${t.name}`); });
  }
});
