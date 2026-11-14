const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../Frontend/team.js");
const F = require("../Frontend/formats.js");
const A = require("../Frontend/api.js");

function mon(name, over = {}) {
  const s = T.createEmptySlot();
  Object.assign(s, { name, species: name, types: ["normal"], abilities: ["pressure"], ability: "pressure", item: null, moves: ["tackle", null, null, null], movePool: ["tackle", "growl"] }, over);
  return s;
}
const gen9 = F.findFormat("gen9");

test("sanitizeSlot rejects bad data and clamps numbers", () => {
  assert.equal(T.sanitizeSlot({ name: "<script>" }).name, null);
  assert.equal(T.sanitizeSlot(null).name, null);
  const s = T.sanitizeSlot({ name: "garchomp", level: 999, nature: "nope", evs: { hp: 9999 }, types: ["fire", "bogus"], sprite: "http://x/y.png", moves: ["Earthquake!", "earthquake"] });
  assert.equal(s.level, 100);
  assert.equal(s.nature, "hardy");
  assert.equal(s.evs.hp, 252);
  assert.deepEqual(s.types, ["fire"]);
  assert.equal(s.sprite, "");
  assert.deepEqual(s.moves, [null, "earthquake", null, null]);
});

test("EV totals above 510 are kept on load (legal in Gen 1-2) and flagged by the rule checks from Gen 3", () => {
  const s = T.sanitizeSlot({ name: "x", evs: { hp: 252, atk: 252, def: 252, spa: 300 } });
  assert.equal(Object.values(s.evs).reduce((a, b) => a + b, 0), 1008); // per-stat cap of 252 still applies
  const slot = mon("snorlax", { evs: { hp: 252, atk: 252, def: 252, spa: 252, spd: 252, spe: 252 } });
  const fmt = (era) => ({ name: `Generation ${era}`, era, clauses: true });
  const errors = (era) => T.validateTeam([slot], { format: fmt(era), allowedNames: null }).issues.filter(i => /EVs; the cap/.test(i.text));
  assert.equal(errors(2).length, 0);
  assert.equal(errors(3).length, 1);
});

test("Gen 1-2 rule checks: natures ignored, Special Attack and Special Defense must match", () => {
  const slot = mon("snorlax", { nature: "adamant", evs: { hp: 252, atk: 252, def: 252, spa: 252, spd: 100, spe: 252 } });
  const text = T.validateTeam([slot], { format: { name: "Generation 2", era: 2, clauses: true }, allowedNames: null }).issues.map(i => i.text).join(" ");
  assert.match(text, /Natures did not exist in Generation 2/);
  assert.match(text, /share one stat experience and DV/);
});

test("slots restored from storage have an empty move pool until data loads (editor must not crash)", () => {
  const s = T.sanitizeSlot({ name: "garchomp", moves: ["earthquake"] });
  assert.deepEqual(s.movePool, []);
  assert.equal(T.serializeSlot(T.createEmptySlot()).movePool, undefined);
});

test("serializeSlot drops runtime-only fields", () => {
  const s = mon("pikachu", { learn: { tackle: ["x-y"] } });
  const out = T.serializeSlot(s);
  assert.equal(out.learn, undefined);
  assert.equal(out.movePool, undefined);
  assert.equal(out.name, "pikachu");
});

test("store: v1 data migrates into a v2 store without losing the team", () => {
  const v1 = { version: 1, teamSlots: [{ name: "pikachu", types: ["electric"], ability: "static", abilities: ["static"], moves: ["thunderbolt"] }], activeTabIndex: 0 };
  const store = T.migrateV1(v1, { id: "gen9", introducedOnly: true }, id => !!F.findFormat(id));
  assert.equal(store.version, 2);
  assert.equal(store.teams.length, 1);
  assert.equal(store.teams[0].slots[0].name, "pikachu");
  assert.equal(store.teams[0].slots.length, 6);
  assert.equal(store.teams[0].format.id, "gen9");
  assert.equal(store.teams[0].activeTab, 0);
  assert.equal(T.migrateV1({ version: 3 }, null), null);
});

test("store: sanitize rejects junk and repairs duplicate ids", () => {
  assert.equal(T.sanitizeStore({ version: 2, teams: [] }), null);
  assert.equal(T.sanitizeStore("x"), null);
  const t = T.createTeam("A");
  const raw = { version: 2, activeTeamId: "missing", teams: [JSON.parse(JSON.stringify(t)), JSON.parse(JSON.stringify(t))] };
  const store = T.sanitizeStore(raw);
  assert.equal(store.teams.length, 2);
  assert.notEqual(store.teams[0].id, store.teams[1].id);
  assert.equal(store.activeTeamId, store.teams[0].id);
});

test("normalizeId and resolveSpecies handle Showdown names", () => {
  assert.equal(T.normalizeId("Mr. Mime"), "mr-mime");
  assert.equal(T.normalizeId("Farfetch’d"), "farfetchd");
  assert.equal(T.normalizeId("Flabébé"), "flabebe");
  assert.equal(T.normalizeId("Type: Null"), "type-null");
  assert.equal(T.normalizeId("King's Rock"), "kings-rock");
  const entries = [{ name: "tornadus-incarnate", id: 641 }, { name: "tornadus-therian", id: 10019 }, { name: "garchomp", id: 445 }, { name: "garchomp-mega", id: 10058 }];
  assert.equal(T.resolveSpecies("tornadus", entries), "tornadus-incarnate");
  assert.equal(T.resolveSpecies("garchomp", entries), "garchomp");
  assert.equal(T.resolveSpecies("garchomp-mega", entries), "garchomp-mega");
  assert.equal(T.resolveSpecies("missingno", entries), null);
});

const SAMPLE = `Garchomp @ Life Orb
Ability: Rough Skin
Level: 50
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
IVs: 0 SpA
- Earthquake
- Dragon Claw
- Swords Dance
- Stealth Rock

Rotom-Wash @ Leftovers
Ability: Levitate
EVs: 252 HP / 4 Def / 252 SpD
Bold Nature
- Hydro Pump
- Volt Switch
- Will-O-Wisp
- Pain Split`;

test("parseShowdown reads sets", () => {
  const { mons, warnings } = T.parseShowdown(SAMPLE);
  assert.equal(mons.length, 2);
  assert.deepEqual(warnings, []);
  const g = mons[0];
  assert.equal(g.speciesKey, "garchomp");
  assert.equal(g.item, "life-orb");
  assert.equal(g.ability, "rough-skin");
  assert.equal(g.level, 50);
  assert.deepEqual(g.evs, { hp: 4, atk: 252, spe: 252 });
  assert.deepEqual(g.ivs, { spa: 0 });
  assert.equal(g.nature, "jolly");
  assert.deepEqual(g.moves, ["earthquake", "dragon-claw", "swords-dance", "stealth-rock"]);
  assert.equal(mons[1].speciesKey, "rotom-wash");
  assert.equal(mons[1].moves[2], "will-o-wisp");
});

test("parseShowdown handles nicknames, genders, headers and extras", () => {
  const { mons, warnings } = T.parseShowdown(`=== [gen9ou] Folder/My Team ===\n\nSparky (Pikachu) (F) @ Light Ball\nAbility: Static\nTera Type: Electric\nShiny: Yes\n- Thunderbolt\n- Grass Knot / Surf\nBogus line`);
  assert.equal(mons.length, 1);
  assert.equal(mons[0].speciesKey, "pikachu");
  assert.equal(mons[0].item, "light-ball");
  assert.deepEqual(mons[0].moves, ["thunderbolt", "grass-knot"]);
  assert.equal(warnings.length, 1);
});

test("parseShowdown limits to six and survives garbage", () => {
  const many = Array.from({ length: 8 }, (_, i) => `Mon${i}\n- Tackle`).join("\n\n");
  assert.equal(T.parseShowdown(many).mons.length, 6);
  assert.equal(T.parseShowdown("").mons.length, 0);
  assert.equal(T.parseShowdown("- Tackle\n- Growl").mons.length, 0);
});

test("toShowdown round-trips through parseShowdown", () => {
  const team = T.createTeam("rt");
  team.slots[0] = mon("garchomp", { item: "life-orb", ability: "rough-skin", nature: "jolly", level: 50, moves: ["earthquake", "dragon-claw", "swords-dance", "stealth-rock"], evs: { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 0, spd: 31, spe: 31 } });
  const text = T.toShowdown(team);
  const { mons } = T.parseShowdown(text);
  assert.equal(mons.length, 1);
  assert.equal(mons[0].speciesKey, "garchomp");
  assert.equal(mons[0].item, "life-orb");
  assert.equal(mons[0].level, 50);
  assert.equal(mons[0].nature, "jolly");
  assert.deepEqual(mons[0].evs, { hp: 4, atk: 252, spe: 252 });
  assert.deepEqual(mons[0].ivs, { spa: 0 });
  assert.deepEqual(mons[0].moves, ["earthquake", "dragon-claw", "swords-dance", "stealth-rock"]);
});

test("JSON export/import round-trips and rejects bad input", () => {
  const team = T.createTeam("Mine", { id: "gen9", introducedOnly: false });
  team.slots[2] = mon("pikachu", { types: ["electric"], learn: { x: [] } });
  const out = T.parseJson(T.exportJson(team), id => !!F.findFormat(id));
  assert.equal(out.team.name, "Mine");
  assert.equal(out.team.slots[2].name, "pikachu");
  assert.equal(out.team.slots[2].learn, undefined);
  assert.ok(T.parseJson("nope").error);
  assert.ok(T.parseJson('{"hello":1}').error);
  assert.ok(T.parseJson(JSON.stringify({ app: "pokemon-team-synergy", version: 99, team: {} })).error);
});

test("share links round-trip a full team and stay short", async () => {
  const team = T.createTeam("Rain team", { id: "gen9", introducedOnly: false });
  ["pelipper", "barraskewda", "kingdra", "ferrothorn", "toxapex", "zapdos"].forEach((n, i) => {
    team.slots[i] = mon(n, { item: "leftovers", ability: "drizzle", nature: "bold", level: 50 + i, moves: ["hurricane", "scald", "u-turn", "roost"], evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 } });
  });
  const code = await T.encodeShare(team);
  assert.equal(code[0], "z"); // compressed in Node 18+ / modern browsers
  assert.ok(code.length < 700, `code length ${code.length}`);
  assert.match(code, /^[A-Za-z0-9_-]+$/); // URL-safe
  const back = await T.decodeShare(code, id => !!F.findFormat(id));
  assert.equal(back.name, "Rain team");
  assert.equal(back.format.id, "gen9");
  assert.equal(back.slots[3].name, "ferrothorn");
  assert.equal(back.slots[5].level, 55);
  assert.deepEqual(back.slots[0].moves, ["hurricane", "scald", "u-turn", "roost"]);
  assert.equal(back.slots[0].evs.def, 252);
});

test("battle style (doubles) is kept through storage, JSON export and share links", async () => {
  const team = T.createTeam("VGC", { id: "gen9", doubles: true });
  team.slots[0] = mon("incineroar");
  assert.equal(team.format.doubles, true);
  assert.equal(T.parseJson(T.exportJson(team)).team.format.doubles, true);
  assert.equal((await T.decodeShare(await T.encodeShare(team))).format.doubles, true);
  const store = T.sanitizeStore(T.serializeStore({ version: 2, activeTeamId: team.id, teams: [team] }));
  assert.equal(store.teams[0].format.doubles, true);
  assert.equal(T.createTeam("x").format.doubles, false);
});

test("share links: empty slots, plain fallback and bad input", async () => {
  const team = T.createTeam("One");
  team.slots[2] = mon("pikachu");
  const back = await T.decodeShare(await T.encodeShare(team));
  assert.equal(back.slots[0].name, null);
  assert.equal(back.slots[2].name, "pikachu");
  const plain = "j" + Buffer.from(JSON.stringify(T.toShareable(team))).toString("base64url");
  assert.equal((await T.decodeShare(plain)).slots[2].name, "pikachu");
  assert.equal(await T.decodeShare("zgarbage!!"), null);
  assert.equal(await T.decodeShare("xabc"), null);
  assert.equal(await T.decodeShare(""), null);
  const evil = "j" + Buffer.from(JSON.stringify({ v: 1, n: "<img src=x>", s: [{ name: "<script>" }] })).toString("base64url");
  const t = await T.decodeShare(evil);
  assert.equal(t.slots[0].name, null); // invalid names are dropped by the same sanitizer as imports
});

test("validateTeam: EV cap, duplicate moves, unlearnable moves", () => {
  const slots = Array.from({ length: 6 }, T.createEmptySlot);
  slots[0] = mon("a", { evs: { hp: 252, atk: 252, def: 252, spa: 0, spd: 0, spe: 0 }, moves: ["tackle", "tackle", "flamethrower", null] });
  const r = T.validateTeam(slots, { format: gen9, allowedNames: null });
  const texts = r.issues.map(i => i.text).join("|");
  assert.match(texts, /756 EVs/);
  assert.match(texts, /duplicate move/);
  assert.match(texts, /cannot learn Flamethrower/);
  assert.ok(r.errors >= 3);
});

test("validateTeam: species outside the format, abilities and clauses", () => {
  const slots = Array.from({ length: 6 }, T.createEmptySlot);
  slots[0] = mon("a", { item: "leftovers" });
  slots[1] = mon("a", { item: "leftovers", ability: "levitate" });
  slots[2] = mon("b", { ability: "overgrow", hiddenAbilities: ["overgrow"], abilities: ["overgrow"] });
  const r = T.validateTeam(slots, { format: gen9, allowedNames: new Set(["a"]) });
  const texts = r.issues.map(i => i.text).join("|");
  assert.match(texts, /B is not allowed in Generation 9/);
  assert.match(texts, /Species Clause: A appears 2 times/);
  assert.match(texts, /Item Clause: Leftovers/);
  assert.match(texts, /cannot have Levitate/);
});

test("validateTeam: generation-based ability and item rules", () => {
  const gen4 = F.findFormat("gen4");
  const slots = Array.from({ length: 6 }, T.createEmptySlot);
  slots[0] = mon("a", { abilities: ["pressure", "unnerve"], hiddenAbilities: ["unnerve"], ability: "unnerve", item: "choice-scarf" });
  const r = T.validateTeam(slots, { format: gen4, allowedNames: null, facts: { abilityGen: { unnerve: 5 }, itemGen: { "choice-scarf": 4 } } });
  const texts = r.issues.map(i => i.text).join("|");
  assert.match(texts, /hidden ability/);
  assert.match(texts, /introduced in Generation 5/);
  assert.doesNotMatch(texts, /Choice Scarf was introduced/);
  const gen1 = T.validateTeam([mon("a", { item: "leftovers" }), ...Array.from({ length: 5 }, T.createEmptySlot)], { format: F.findFormat("gen1"), allowedNames: null });
  assert.match(gen1.issues.map(i => i.text).join("|"), /Held items did not exist in Generation 1/);
});

test("validateTeam: 'any' format only runs basic checks, unverified moves are flagged not failed", () => {
  const s = mon("a", { movePool: [], dataState: "failed" });
  const r = T.validateTeam([s, ...Array.from({ length: 5 }, T.createEmptySlot)], { format: F.findFormat("any"), allowedNames: null });
  assert.equal(r.errors, 0);
  assert.match(r.issues.map(i => i.text).join("|"), /could not be loaded/);
});

test("validateTeam: clean team has no errors", () => {
  const s = mon("a", { moves: ["tackle", "growl", null, null] });
  const r = T.validateTeam([s, ...Array.from({ length: 5 }, T.createEmptySlot)], { format: gen9, allowedNames: new Set(["a"]) });
  assert.equal(r.errors, 0);
});

test("formats: version groups and eras", () => {
  assert.equal(F.findFormat("any").versionGroups, null);
  assert.deepEqual(F.findFormat("gen9").versionGroups, F.GEN_VERSION_GROUPS[9]);
  assert.equal(F.findFormat("swsh-full").era, 8);
  assert.equal(F.findFormat("unknown-id").id, "any");
  const gen1 = F.limitations(F.findFormat("gen1")).join(" ");
  assert.match(gen1, /that generation's system/); // Gen 1-2 stats are described
  assert.doesNotMatch(gen1, /Fairy/); // type charts are now per generation, so no Fairy caveat
});

test("api parsers: learnsets, pools by version group, move and generation info", () => {
  const parsed = A.parsePokemon({
    name: "charizard-mega-x", species: { name: "charizard" },
    sprites: { front_default: "https://img/x.png" },
    types: [{ type: { name: "fire" } }, { type: { name: "dragon" } }],
    abilities: [{ ability: { name: "tough-claws" }, is_hidden: false }, { ability: { name: "solar-power" }, is_hidden: true }],
    stats: [{ stat: { name: "speed" }, base_stat: 100 }, { stat: { name: "special-attack" }, base_stat: 130 }],
    moves: [
      { move: { name: "flamethrower" }, version_group_details: [{ version_group: { name: "x-y" } }, { version_group: { name: "x-y" } }] },
      { move: { name: "hurricane" }, version_group_details: [{ version_group: { name: "scarlet-violet" } }] }
    ]
  });
  assert.equal(parsed.species, "charizard");
  assert.deepEqual(parsed.types, ["fire", "dragon"]);
  assert.deepEqual(parsed.pastTypes, []);
  const clef = A.parsePokemon({ name: "clefable", types: [{ type: { name: "fairy" } }], past_types: [{ generation: { name: "generation-v" }, types: [{ type: { name: "normal" } }] }], moves: [] });
  assert.deepEqual(clef.pastTypes, [{ gen: 5, types: ["normal"] }]);
  assert.equal(parsed.abilities[1].hidden, true);
  assert.equal(parsed.stats.spe, 100);
  assert.equal(parsed.stats.spa, 130);
  assert.deepEqual(parsed.learn.flamethrower, ["x-y"]);
  assert.deepEqual(A.poolForFormat(parsed.learn, null), ["flamethrower", "hurricane"]);
  assert.deepEqual(A.poolForFormat(parsed.learn, F.GEN_VERSION_GROUPS[6]), ["flamethrower"]);
  assert.deepEqual(A.poolForFormat(parsed.learn, ["sword-shield"]), []);
  assert.equal(A.parsePokemon({ name: "a", sprites: { front_default: "javascript:alert(1)" }, moves: [] }).sprite, "");
  assert.deepEqual(A.parseMove({ type: { name: "fire" }, damage_class: { name: "special" }, priority: 0, power: 90, target: { name: "all-opponents" } }), { type: "fire", damageClass: "special", priority: 0, power: 90, target: "all-opponents" });
  assert.equal(A.minGeneration([{ generation: { name: "generation-v" } }, { generation: { name: "generation-iii" } }]), 3);
  assert.equal(A.minGeneration([]), null);
});

test("VGC rules: restricted limit, mythicals, Item Clause error, minimum team size, SV learnset", () => {
  const vgc = F.findFormat("sv-vgc2026");
  assert.equal(vgc.levelCap, 50);
  assert.equal(vgc.doubles, true);
  const check = (slots) => T.validateTeam(slots, { format: vgc, allowedNames: null });
  const text = (slots) => check(slots).issues.map(i => i.text).join(" | ");
  const r = (name, species = name, item = null) => mon(name, { species, item });
  // Two restricted are fine, three are not (forms count by species)
  const two = [r("miraidon"), r("calyrex-shadow", "calyrex"), r("incineroar"), r("rillaboom")];
  assert.doesNotMatch(text(two), /restricted/);
  assert.match(text([...two, r("kyogre")]), /at most 2 restricted legendary Pokémon; this team has 3 \(Miraidon, Calyrex shadow, Kyogre\)/);
  assert.match(text([r("mew"), r("a"), r("b"), r("c")]), /Mew is a mythical Pokémon and is banned/);
  const dupes = check([r("a", "a", "leftovers"), r("b", "b", "leftovers"), r("c"), r("d")]).issues.find(i => /Item Clause/.test(i.text));
  assert.equal(dupes.severity, "error");
  assert.match(text([r("a"), r("b")]), /need at least 4 Pokémon/);
  // A loaded Pokémon with no Scarlet/Violet learnset is flagged
  assert.match(text([mon("x", { learn: { tackle: ["sword-shield"] }, movePool: [] })]), /no learnset/);
  // Ordinary generation formats keep duplicate items as a warning and have no team-size rule
  const g9 = T.validateTeam([r("a", "a", "leftovers"), r("b", "b", "leftovers")], { format: gen9, allowedNames: null }).issues;
  assert.equal(g9.find(i => /Item Clause/.test(i.text)).severity, "warning");
  assert.ok(!g9.some(i => /at least/.test(i.text)));
});
