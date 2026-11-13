const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../calibration/lib.js");
const V = require("../Frontend/viability.js");
const A = require("../Frontend/analysis.js");

const calc = C.loadCalc();
const D = require("../Frontend/damage.js")(calc);

// Build app members from Showdown-style sets, with move data from the calculator
function team(sets, genNum = 9) {
  const gen = calc.Generations.get(genNum);
  const moveInfo = {};
  const members = sets.map(s => C.toMember(calc, gen, s, moveInfo));
  return { members, moveInfo: Object.fromEntries(Object.entries(moveInfo).filter(([, v]) => v)), genNum };
}
function score(sets, genNum = 9, refBst = 570) {
  const t = team(sets, genNum);
  return A.analyzeTeam(t.members, t.moveInfo, { gen: genNum, refBst, speciesInfo: (n) => D.speciesInfo(genNum, n) }).viability;
}
const EVS = { atk: 252, spe: 252, hp: 4 };

test("not fully evolved is penalised unless it holds Eviolite; Eviolite on a final stage is flagged", () => {
  const base = { species: "Porygon2", nature: "Bold", evs: { hp: 252, def: 252, spd: 4 }, moves: ["Recover", "Ice Beam", "Trick Room", "Thunderbolt"] };
  const bare = score([{ ...base, item: "Leftovers" }]).members[0];
  const eviolite = score([{ ...base, item: "Eviolite" }]).members[0];
  assert.ok(bare.unevolved && !eviolite.unevolved);
  assert.ok(eviolite.score > bare.score + 15, `${eviolite.score} vs ${bare.score}`);
  const wasted = score([{ species: "Porygon-Z", item: "Eviolite", evs: EVS, moves: ["Tri Attack", "Shadow Ball", "Nasty Plot", "Ice Beam"] }]).members[0];
  assert.match(wasted.issues.join(" "), /Eviolite only works/);
});

test("items that only work for other species, wrong-type boosters and non-battle items are flagged", () => {
  const issues = (item, moves = ["Earthquake", "Stone Edge", "Swords Dance", "Fire Fang"]) =>
    score([{ species: "Garchomp", item, nature: "Jolly", evs: EVS, moves }]).members[0].issues.join(" ");
  assert.match(issues("Light Ball"), /only works for Pikachu/);
  assert.match(issues("Splash Plate"), /boosts Water moves, but it has none/);
  assert.doesNotMatch(issues("Earth Plate"), /boosts/);
  assert.match(issues("Repeat Ball"), /no effect in battle/);
  assert.doesNotMatch(issues("Iron Ball"), /no effect/);
  assert.match(issues("Assault Vest"), /Assault Vest blocks its status moves/);
  const pika = score([{ species: "Pikachu", item: "Light Ball", nature: "Timid", evs: { spa: 252, spe: 252 }, moves: ["Thunderbolt", "Grass Knot", "Volt Switch", "Protect"] }]).members[0];
  assert.doesNotMatch(pika.issues.join(" "), /only works/);
});

test("moves: needs a damaging move; weak attacks and filler are flagged, utility counts", () => {
  const noAttack = score([{ species: "Blissey", item: "Leftovers", nature: "Bold", evs: { hp: 252, def: 252 }, moves: ["Soft-Boiled", "Toxic", "Protect", "Heal Bell"] }]).members[0];
  assert.match(noAttack.issues.join(" "), /no damaging move/);
  const filler = score([{ species: "Garchomp", item: "Life Orb", nature: "Jolly", evs: EVS, moves: ["Earthquake", "Attract", "Tackle", "Icy Wind"] }]).members[0];
  const text = filler.issues.join(" ");
  assert.match(text, /Attract/);
  assert.match(text, /Tackle/);
  assert.doesNotMatch(text, /Icy Wind/); // speed control counts as utility
});

test("EV investment matters from Gen 3; Gen 1-2 sets are maxed by default", () => {
  const set = { species: "Tyranitar", item: "Leftovers", nature: "Adamant", moves: ["Stone Edge", "Crunch", "Earthquake", "Stealth Rock"] };
  const none = score([set]).members[0];
  const invested = score([{ ...set, evs: { hp: 252, atk: 252, spd: 4 } }]).members[0];
  assert.match(none.issues.join(" "), /no EVs invested/);
  assert.ok(invested.score > none.score);
  const gen2 = score([{ species: "Tyranitar", item: "Leftovers", moves: ["Rock Slide", "Crunch", "Earthquake", "Roar"] }], 2, 505).members[0];
  assert.doesNotMatch(gen2.issues.join(" "), /EVs/);
});

test("stats are judged against the format's reference strength", () => {
  const set = { species: "Magcargo", item: "Leftovers", nature: "Modest", evs: { hp: 252, spa: 252 }, moves: ["Lava Plume", "Earth Power", "Shell Smash", "Stealth Rock"] };
  const strongFormat = score([set], 9, 570).members[0];
  const weakFormat = score([set], 9, 430).members[0];
  assert.ok(weakFormat.score > strongFormat.score);
  assert.match(strongFormat.issues.join(" "), /well below/);
});

test("the reported team of mostly unevolved Pokémon scores far below a Smogon sample team", () => {
  const reported = [
    { species: "Murkrow", item: "Flame Plate", moves: ["Shadow Ball", "Aerial Ace", "Icy Wind", "Swift"] },
    { species: "Magcargo", item: "Light Ball", moves: ["Infestation", "Shell Smash", "Double-Edge", "Temper Flare"] },
    { species: "Delibird", item: "Fist Plate", moves: ["Swift", "Toxic", "Haze", "Tailwind"] },
    { species: "Croconaw", item: "Stone Plate", moves: ["Attract", "Facade", "Breaking Swipe", "Scald"] },
    { species: "Hoothoot", item: "Power Bracer", moves: ["Pluck", "Tackle", "Psychic", "Brave Bird"] },
    { species: "Larvitar", item: "Repeat Ball", moves: ["Giga Impact", "Return", "Brick Break", "Sand Tomb"] }
  ];
  const weak = score(reported);
  const expert = score(require("../calibration/data/gen9ou-teams.json")[0].data);
  assert.ok(weak.score < 35, `reported team ${weak.score}`);
  assert.ok(expert.score > 85, `expert team ${expert.score}`);
  assert.equal(weak.unevolved, 4);
  // The analysis turns this into a high-priority observation
  const t = team(reported);
  const r = A.analyzeTeam(t.members, t.moveInfo, { gen: 9, refBst: 570, speciesInfo: (n) => D.speciesInfo(9, n) });
  const obs = r.observations.find(o => /not fully evolved/.test(o.text));
  assert.equal(obs.priority, "high");
  assert.match(obs.evidence, /Larvitar/);
});

test("without species data, viability still works from the slot's own stats", () => {
  const t = team([{ species: "Garchomp", item: "Life Orb", nature: "Jolly", evs: EVS, moves: ["Earthquake", "Outrage", "Stone Edge", "Swords Dance"] }]);
  const v = V.teamViability(t.members, { gen: 9, moveInfo: t.moveInfo, refBst: 570 });
  assert.equal(v.members[0].bst, 600);
  assert.ok(v.score > 80);
});

test("random sets only get items that help this Pokémon and its moves", () => {
  const moveInfo = {
    "flamethrower": { type: "fire", damageClass: "special", power: 90 },
    "toxic": { type: "poison", damageClass: "status", power: 0 },
    "protect": { type: "normal", damageClass: "status", power: 0 },
    "reflect": { type: "psychic", damageClass: "status", power: 0 }
  };
  const mon = { name: "arcanine", types: ["fire"], ability: "intimidate", moves: ["flamethrower", "toxic", "protect", null] };
  const ctx = { moveInfo };
  const fits = (it, m = mon, info = { nfe: false }) => V.suitsRandomSet(it, m, ctx, info);
  assert.ok(fits("leftovers"));
  assert.ok(fits("charcoal"));
  assert.ok(!fits("mystic-water"));     // no Water moves
  assert.ok(!fits("light-ball"));       // Pikachu only
  assert.ok(!fits("assault-vest"));     // has status moves
  assert.ok(!fits("choice-specs"));     // two status moves
  assert.ok(!fits("eviolite"));         // fully evolved
  assert.ok(fits("eviolite", { ...mon, name: "growlithe" }, { nfe: true }));
  assert.ok(!fits("eviolite", mon, null)); // unknown evolution data: never guess
  assert.ok(!fits("power-bracer") && !fits("iron-ball") && !fits("lagging-tail"));
  assert.ok(!fits("flame-orb") && fits("flame-orb", { ...mon, ability: "guts" }));
  assert.ok(!fits("black-sludge") && !fits("light-clay"));
  assert.ok(fits("light-clay", { ...mon, moves: ["reflect"] }));
  assert.ok(!fits("poke-ball") && !fits("potion"));
  // Items players don't use are never picked, and situational ones need their condition
  assert.ok(!fits("blue-scarf") && !fits("absorb-bulb") && !fits("everstone"));
  assert.ok(!fits("grip-claw") && fits("grip-claw", { ...mon, moves: ["fire-spin"] }));
  assert.ok(!fits("icy-rock") && !fits("throat-spray"));
  assert.ok(!fits("life-orb")); // only one damaging move
  // Resist berries only for a type the Pokémon is weak to
  assert.ok(V.suitsRandomSet("passho-berry", mon, { moveInfo, weakTo: t => t === "water" }, { nfe: false }));
  assert.ok(!V.suitsRandomSet("occa-berry", mon, { moveInfo, weakTo: t => t === "water" }, { nfe: false }));
  // Gems only in Gen 5
  assert.ok(!V.suitsRandomSet("fire-gem", mon, { moveInfo, gen: 9 }, null));
  assert.ok(V.suitsRandomSet("fire-gem", mon, { moveInfo, gen: 5 }, null));
});

test("random sets: strong STAB, coverage, useful utility; no filler or awkward attacks", () => {
  const mk = (type, damageClass, power, priority = 0) => ({ type, damageClass, power, priority });
  const moveInfo = {
    "earthquake": mk("ground", "physical", 100), "outrage": mk("dragon", "physical", 120), "dragon-claw": mk("dragon", "physical", 80),
    "stone-edge": mk("rock", "physical", 100), "fire-fang": mk("fire", "physical", 65), "draco-meteor": mk("dragon", "special", 130),
    "tackle": mk("normal", "physical", 40), "hyper-beam": mk("normal", "special", 150), "giga-impact": mk("normal", "physical", 150),
    "sand-attack": mk("ground", "status", 0), "swords-dance": mk("normal", "status", 0), "stealth-rock": mk("rock", "status", 0),
    "protect": mk("normal", "status", 0), "attract": mk("normal", "status", 0), "dig": mk("ground", "physical", 80)
  };
  const pool = Object.keys(moveInfo);
  const chomp = { types: ["dragon", "ground"], stats: { atk: 130, spa: 80, spe: 102 } };
  const C2 = require("../calibration/lib.js");
  for (let seed = 1; seed <= 30; seed++) {
    const { moves, category } = V.pickRandomMoves(pool, moveInfo, chomp, { rand: C2.rng(seed) });
    assert.equal(category, "physical");
    assert.equal(moves.length, 4);
    assert.equal(new Set(moves).size, 4);
    assert.ok(moves.some(n => ["earthquake", "dragon-claw"].includes(n)), `${moves}: needs a strong STAB`);
    ["tackle", "hyper-beam", "giga-impact", "sand-attack", "attract", "outrage", "dig"].forEach(bad => assert.ok(!moves.includes(bad), `${moves} has ${bad}`));
    assert.ok(moves.filter(n => moveInfo[n].damageClass !== "status").length >= 2, `${moves}: at least two attacks`);
  }
  // Doubles prefers Protect-style moves over hazards
  const dbl = Array.from({ length: 20 }, (_, i) => V.pickRandomMoves(pool, moveInfo, chomp, { doubles: true, rand: C2.rng(100 + i) }).moves);
  assert.ok(dbl.some(m => m.includes("protect")));
  assert.ok(!dbl.some(m => m.includes("stealth-rock")));
  // Gen 1-3: the type decides the category, so Ground/Rock attacks count as physical even when PokeAPI says special
  const old = V.pickRandomMoves(["earth-power", "rock-slide"], { "earth-power": mk("ground", "special", 90), "rock-slide": mk("rock", "physical", 75) }, chomp, { gen: 3, rand: C2.rng(1) });
  assert.ok(old.moves.includes("earth-power"));
});

test("random EV spread matches the attacking side and speed", () => {
  const fast = V.randomSpread("special", { spe: 110 }, () => 0.1);
  assert.deepEqual([fast.evs.spa, fast.evs.spe, fast.evs.hp], [252, 252, 4]);
  assert.equal(fast.nature, "timid");
  const slow = V.randomSpread("physical", { spe: 40 }, () => 0.9);
  assert.deepEqual([slow.evs.hp, slow.evs.atk, slow.evs.spe], [252, 252, 0]);
  assert.equal(slow.nature, "adamant");
  assert.equal(Object.values(slow.evs).reduce((a, b) => a + b, 0), 508);
});

test("median BST helper", () => {
  assert.equal(V.medianBst([500, 600, 0, 550]), 550);
  assert.equal(V.medianBst([500, 600]), 550);
  assert.equal(V.medianBst([]), null);
});
