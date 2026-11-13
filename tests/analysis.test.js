const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../Frontend/analysis.js");
const T = require("../Frontend/team.js");

function mon(name, types, over = {}) {
  const s = T.createEmptySlot();
  Object.assign(s, { name, species: name, types, ability: null, item: null, moves: [null, null, null, null] }, over);
  return s;
}

// Move info the page would have fetched from PokeAPI
const INFO = {
  earthquake: { type: "ground", damageClass: "physical", priority: 0 },
  "dragon-claw": { type: "dragon", damageClass: "physical", priority: 0 },
  "stealth-rock": { type: "rock", damageClass: "status", priority: 0 },
  "swords-dance": { type: "normal", damageClass: "status", priority: 0 },
  "body-press": { type: "fighting", damageClass: "physical", priority: 0 },
  "iron-head": { type: "steel", damageClass: "physical", priority: 0 },
  "defog": { type: "flying", damageClass: "status", priority: 0 },
  roost: { type: "flying", damageClass: "status", priority: 0 },
  "u-turn": { type: "bug", damageClass: "physical", priority: 0 },
  moonblast: { type: "fairy", damageClass: "special", priority: 0 },
  "soft-boiled": { type: "normal", damageClass: "status", priority: 0 },
  "calm-mind": { type: "psychic", damageClass: "status", priority: 0 },
  "flamethrower": { type: "fire", damageClass: "special", priority: 0 },
  "knock-off": { type: "dark", damageClass: "physical", priority: 0 },
  "volt-switch": { type: "electric", damageClass: "special", priority: 0 },
  "hydro-pump": { type: "water", damageClass: "special", priority: 0 },
  "will-o-wisp": { type: "fire", damageClass: "status", priority: 0 },
  "pain-split": { type: "normal", damageClass: "status", priority: 0 },
  "thunder-wave": { type: "electric", damageClass: "status", priority: 0 },
  "ice-beam": { type: "ice", damageClass: "special", priority: 0 },
  "shadow-ball": { type: "ghost", damageClass: "special", priority: 0 },
  "extreme-speed": { type: "normal", damageClass: "physical", priority: 2 },
  "tackle": { type: "normal", damageClass: "physical", priority: 0 },
  "flare-blitz": { type: "fire", damageClass: "physical", priority: 0 },
  "ember": { type: "fire", damageClass: "special", priority: 0 },
  "fire-blast": { type: "fire", damageClass: "special", priority: 0 }
};

const base = (o) => ({ level: 100, nature: "hardy", ...o });

const BALANCED = [
  mon("garchomp", ["dragon", "ground"], base({ ability: "rough-skin", item: "life-orb", moves: ["earthquake", "dragon-claw", "swords-dance", "stealth-rock"] })),
  mon("corviknight", ["flying", "steel"], base({ ability: "pressure", item: "leftovers", moves: ["body-press", "defog", "roost", "u-turn"] })),
  mon("clefable", ["fairy"], base({ ability: "magic-guard", item: "leftovers", moves: ["moonblast", "soft-boiled", "calm-mind", "flamethrower"] })),
  mon("rotom-wash", ["electric", "water"], base({ ability: "levitate", item: "choice-scarf", moves: ["hydro-pump", "volt-switch", "will-o-wisp", "pain-split"] })),
  mon("tyranitar", ["rock", "dark"], base({ ability: "sand-stream", item: "leftovers", moves: ["knock-off", "ice-beam", "thunder-wave", "extreme-speed"] })),
  mon("heatran", ["fire", "steel"], base({ ability: "flash-fire", item: "air-balloon", moves: ["flamethrower", "shadow-ball", "iron-head", "earthquake"] }))
];
const MONO = Array.from({ length: 6 }, (_, i) => mon("charmander" + i, ["fire"], base({ moves: ["ember", "flare-blitz", "fire-blast", null] })));

test("abilities and Air Balloon change defensive results", () => {
  const rotom = mon("rotom-wash", ["electric", "water"], { ability: "levitate" });
  assert.equal(A.defensiveMultiplier(rotom, "ground").mult, 0);
  assert.equal(A.defensiveMultiplier(rotom, "ground").source, "ability");
  assert.equal(A.defensiveMultiplier(mon("x", ["fire"], { ability: "flash-fire" }), "fire").mult, 0);
  assert.equal(A.defensiveMultiplier(mon("x", ["grass"], { ability: "thick-fat" }), "fire").mult, 1); // 2x weakness halved
  assert.equal(A.defensiveMultiplier(mon("x", ["normal"], { item: "air-balloon" }), "ground").source, "item");
  assert.equal(A.defensiveMultiplier(mon("x", ["normal"], { ability: "wonder-guard" }), "normal").mult, 0);
  assert.equal(A.defensiveMultiplier(mon("x", ["normal"], { ability: "wonder-guard" }), "fighting").mult, 2);
  assert.equal(A.defensiveMultiplier(mon("x", ["fire"]), "water").mult, 2); // no ability: by type
});

test("defensive summary lists members and counts ability immunities", () => {
  const s = A.defensiveSummary(BALANCED);
  assert.ok(s.ground.immuneNames.includes("rotom-wash"));
  assert.ok(s.ground.immuneNames.includes("heatran")); // Air Balloon
  assert.ok(s.ground.viaAbilityOrItem >= 2);
  assert.ok(s.fire.immuneNames.includes("heatran")); // Flash Fire
  assert.deepEqual(s.ice.quadNames, ["garchomp"]); // Dragon/Ground is 4x weak to Ice
  const quad = A.defensiveSummary([mon("a", ["grass", "flying"])]);
  assert.deepEqual(quad.ice.quadNames, ["a"]);
});

test("shared weaknesses report answers", () => {
  const members = [mon("a", ["fire"]), mon("b", ["bug"]), mon("c", ["water"])];
  const shared = A.sharedWeaknesses(A.defensiveSummary(members));
  const rock = shared.find(s => s.type === "rock");
  assert.deepEqual(rock.weakNames.sort(), ["a", "b"]);
  assert.deepEqual(rock.answers, []);
});

test("role detection from moves, abilities and priority data", () => {
  const roles = A.teamRoles(BALANCED, INFO);
  assert.deepEqual(roles.hazards, ["garchomp"]);
  assert.deepEqual(roles.removal, ["corviknight"]);
  assert.ok(roles.recovery.includes("corviknight") && roles.recovery.includes("clefable"));
  assert.ok(roles.pivot.includes("corviknight") && roles.pivot.includes("rotom-wash"));
  assert.ok(roles.priority.includes("tyranitar"));
  assert.ok(roles.speedControl.includes("rotom-wash")); // Choice Scarf
  assert.ok(roles.weather.includes("tyranitar")); // Sand Stream
  assert.ok(roles.physical.includes("garchomp") && roles.special.includes("clefable"));
});

test("priority uses move data, falling back to names when unknown", () => {
  const unknown = mon("a", ["normal"], { moves: ["extreme-speed", null, null, null] });
  assert.ok(A.memberRoles(unknown, {}).has("priority"));
  const slow = mon("a", ["normal"], { moves: ["tackle", null, null, null] });
  assert.ok(!A.memberRoles(slow, INFO).has("priority"));
});

test("speed tiers use calculated stats and Choice Scarf", () => {
  const fast = mon("a", ["normal"], { stats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 100 }, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 252 }, nature: "jolly" });
  const scarf = mon("b", ["normal"], { item: "choice-scarf", stats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 100 } });
  const tiers = A.speedTiers([scarf, fast]);
  // a: 100 base, 252 EVs, Jolly = 328. b: 236 x 1.5 = 354 with the scarf
  assert.equal(tiers[0].name, "b");
  assert.equal(tiers[0].effective, 354);
  assert.equal(tiers[1].effective, 328);
  assert.equal(tiers.find(t => t.name === "b").note, "with Choice Scarf");
});

test("coverage comes from damaging moves only", () => {
  const cov = A.coverage([mon("a", ["normal"], { moves: ["stealth-rock", "swords-dance", null, null] })], INFO);
  assert.deepEqual(cov.moveTypes, []);
  assert.equal(cov.covered.length, 0);
  const cov2 = A.coverage([mon("a", ["normal"], { moves: ["earthquake", "mystery-move", null, null] })], INFO);
  assert.deepEqual(cov2.moveTypes, ["ground"]);
  assert.deepEqual(cov2.unresolved, ["mystery-move"]);
});

test("score: components are bounded and weighted to 100", () => {
  assert.equal(A.SCORE_COMPONENTS.reduce((a, c) => a + c.weight, 0), 100);
  const r = A.analyzeTeam(BALANCED, INFO);
  r.score.components.forEach(c => assert.ok(c.score >= 0 && c.score <= 100, c.id));
  assert.ok(r.score.overall >= 0 && r.score.overall <= 100);
});

test("score calibration: representative teams order sensibly", () => {
  const empty = A.analyzeTeam([], INFO).score.overall;
  const mono = A.analyzeTeam(MONO, INFO).score;
  const balanced = A.analyzeTeam(BALANCED, INFO).score;
  assert.equal(empty, 0);
  assert.ok(balanced.overall > mono.overall + 25, `balanced ${balanced.overall} vs mono ${mono.overall}`);
  const get = (s, id) => s.components.find(c => c.id === id).score;
  assert.ok(get(balanced, "defense") > get(mono, "defense"));
  assert.ok(get(balanced, "roles") > get(mono, "roles"));
  assert.ok(get(balanced, "offense") > get(mono, "offense"));
  assert.equal(get(mono, "roles"), 15); // only "both attacking kinds" applies
});

test("a one-Pokemon team scores lower than a full balanced one", () => {
  const one = A.analyzeTeam([BALANCED[0]], INFO).score.overall;
  assert.ok(one < A.analyzeTeam(BALANCED, INFO).score.overall);
});

test("observations carry evidence and flag clear problems", () => {
  const r = A.analyzeTeam(MONO, INFO);
  const text = r.observations.map(o => o.text).join("|");
  assert.match(text, /weak to Water/);
  assert.match(text, /No entry hazard/);
  const high = r.observations.filter(o => o.priority === "high");
  assert.ok(high.length >= 1);
  high.filter(o => /weak to/.test(o.text)).forEach(o => assert.ok(o.evidence.includes("Weak:")));
  const sorted = r.observations.map(o => ({ high: 1, medium: 2, low: 3 }[o.priority]));
  assert.deepEqual(sorted, [...sorted].sort((a, b) => a - b));
});

test("observations include rule problems from validation", () => {
  const validation = { issues: [{ severity: "error", text: "Garchomp cannot learn X." }] };
  const r = A.analyzeTeam(BALANCED, INFO, { validation });
  assert.ok(r.observations[0].text.includes("rule problem"));
});

// A typical doubles core: speed control, Fake Out, redirection, spread moves, Protect everywhere
const DOUBLES_INFO = {
  ...INFO,
  "fake-out": { type: "normal", damageClass: "physical", priority: 3, target: "selected-pokemon" },
  "tailwind": { type: "flying", damageClass: "status", priority: 0, target: "users-field" },
  "follow-me": { type: "normal", damageClass: "status", priority: 2, target: "user" },
  "protect": { type: "normal", damageClass: "status", priority: 4, target: "user" },
  "heat-wave": { type: "fire", damageClass: "special", priority: 0, target: "all-opponents" },
  "rock-slide": { type: "rock", damageClass: "physical", priority: 0, target: "all-opponents" },
  "helping-hand": { type: "normal", damageClass: "status", priority: 5, target: "an-ally" }
};
const DOUBLES_TEAM = [
  mon("incineroar", ["fire", "dark"], base({ ability: "intimidate", item: "sitrus-berry", moves: ["fake-out", "flare-blitz", "knock-off", "protect"] })),
  mon("tornadus", ["flying"], base({ ability: "prankster", item: "covert-cloak", moves: ["tailwind", "heat-wave", "protect", "helping-hand"] })),
  mon("amoonguss", ["grass", "poison"], base({ ability: "regenerator", item: "rocky-helmet", moves: ["follow-me", "protect", "earthquake", "moonblast"] })),
  mon("landorus", ["ground", "flying"], base({ ability: "sheer-force", item: "life-orb", moves: ["rock-slide", "earthquake", "protect", "ice-beam"] }))
];

test("doubles: roles include speed control, Fake Out, Protect, spread moves and redirection", () => {
  const roles = A.teamRoles(DOUBLES_TEAM, DOUBLES_INFO);
  assert.deepEqual(roles.fakeOut, ["incineroar"]);
  assert.ok(roles.speedControl.includes("tornadus"));
  assert.equal(roles.protect.length, 4);
  assert.ok(roles.spread.includes("tornadus") && roles.spread.includes("landorus"));
  assert.deepEqual(roles.redirection, ["amoonguss"]);
  assert.deepEqual(roles.support, ["tornadus"]);
  assert.deepEqual(roles.intimidate, ["incineroar"]);
});

test("doubles: spread detection uses move targets, falling back to names", () => {
  const single = mon("a", ["normal"], { moves: ["flamethrower", null, null, null] });
  assert.ok(!A.memberRoles(single, DOUBLES_INFO).has("spread"));
  const unknown = mon("a", ["normal"], { moves: ["dazzling-gleam", null, null, null] });
  assert.ok(A.memberRoles(unknown, {}).has("spread"));
});

test("doubles: the roles score rewards doubles roles, singles rewards singles roles", () => {
  const roleScore = (team, doubles) => A.analyzeTeam(team, DOUBLES_INFO, { doubles }).score.components.find(c => c.id === "roles").score;
  assert.ok(roleScore(DOUBLES_TEAM, true) >= 90, `doubles team in doubles: ${roleScore(DOUBLES_TEAM, true)}`);
  assert.ok(roleScore(DOUBLES_TEAM, true) > roleScore(DOUBLES_TEAM, false));
  assert.ok(roleScore(BALANCED, false) > roleScore(BALANCED, true));
  const r = A.analyzeTeam(DOUBLES_TEAM, DOUBLES_INFO, { doubles: true });
  assert.equal(r.score.components.find(c => c.id === "roles").label, "Team roles (doubles)");
  assert.ok(r.roleKeys.includes("fakeOut") && !r.roleKeys.includes("hazards"));
  assert.match(r.assumptions.join(" "), /doubles play/);
});

test("doubles: observations swap hazard advice for doubles advice", () => {
  const noTools = [mon("a", ["water"], base({ moves: ["hydro-pump", "ice-beam", null, null] })), mon("b", ["fire"], base({ moves: ["flamethrower", null, null, null] }))];
  const d = A.analyzeTeam(noTools, INFO, { doubles: true }).observations.map(o => o.text).join("|");
  const s = A.analyzeTeam(noTools, INFO, { doubles: false }).observations.map(o => o.text).join("|");
  assert.match(d, /No speed control/);
  assert.doesNotMatch(d, /entry hazard/);
  assert.match(s, /entry hazard/);
  assert.doesNotMatch(s, /Fake Out/);
});

test("report always lists its assumptions", () => {
  const r = A.analyzeTeam(BALANCED, INFO);
  assert.ok(r.assumptions.length >= 5);
  assert.match(r.assumptions.join(" "), /not a competitive rating/);
});
