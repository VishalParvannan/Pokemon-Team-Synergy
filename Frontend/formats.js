// Format definitions. To add a format, add an entry here:
//   gen / dexes   which species are allowed (generation lists or PokeAPI pokedex names)
//   forms         allowed alternate-form kinds
//   era           game generation whose rules apply (drives ability/item/mechanic checks)
//   versionGroups PokeAPI version groups whose learnsets define legal moves (null = no restriction)
//   clauses       whether Species/Item Clause style team checks apply
// Official rule sets (VGC) also use:
//   doubles       battle style is fixed to doubles
//   levelCap      Pokémon above this level are scaled down to it; defaultLevel for new Pokémon
//   bring / minTeam  bring 6, pick `bring` at team preview; teams need at least `minTeam` Pokémon
//   restricted    { max, species }: at most `max` restricted legendaries
//   bannedSpecies species not allowed (mythicals)
//   itemClauseError  duplicate items are an error rather than a warning
//   needsLearnset Pokémon with no learnset in the format's games are flagged as probably not obtainable
//   usage         usage-statistics snapshot used for threats (Frontend/data/threats/<usage>.json)
// Tier bans and event-only move combinations are not modelled.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PokeFormats = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function genForms(n) {
    const forms = [];
    if (n === 6 || n === 7) forms.push("mega");
    if (n >= 7) forms.push("alola");
    if (n >= 8) forms.push("galar", "hisui");
    if (n === 8) forms.push("gmax");
    if (n >= 9) forms.push("paldea");
    return forms;
  }

  // Main-series games that define each generation's legal learnsets
  const GEN_VERSION_GROUPS = {
    1: ["red-blue", "yellow"],
    2: ["gold-silver", "crystal"],
    3: ["ruby-sapphire", "emerald", "firered-leafgreen"],
    4: ["diamond-pearl", "platinum", "heartgold-soulsilver"],
    5: ["black-white", "black-2-white-2"],
    6: ["x-y", "omega-ruby-alpha-sapphire"],
    7: ["sun-moon", "ultra-sun-ultra-moon"],
    8: ["sword-shield", "the-isle-of-armor", "the-crown-tundra"],
    9: ["scarlet-violet", "the-teal-mask", "the-indigo-disk"]
  };

  // Restricted legendaries and mythicals (base species, PokeAPI names) as in Scarlet/Violet VGC rules
  const RESTRICTED = ["mewtwo", "lugia", "ho-oh", "kyogre", "groudon", "rayquaza", "dialga", "palkia", "giratina", "reshiram", "zekrom",
    "kyurem", "xerneas", "yveltal", "zygarde", "cosmog", "cosmoem", "solgaleo", "lunala", "necrozma", "zacian", "zamazenta", "eternatus",
    "calyrex", "koraidon", "miraidon", "terapagos"];
  const MYTHICAL = ["mew", "celebi", "jirachi", "deoxys", "phione", "manaphy", "darkrai", "shaymin", "arceus", "victini", "keldeo", "meloetta",
    "genesect", "diancie", "hoopa", "volcanion", "magearna", "marshadow", "zeraora", "meltan", "melmetal", "zarude", "pecharunt"];

  const FORMATS = [
    { id: "any", group: "Open", name: "All Pokémon", description: "No restrictions. Every Pokémon, form, move, ability and item is allowed; only basic limits (EVs, duplicate moves) are checked.", era: null, versionGroups: null, clauses: false },
    { id: "sv-paldea", group: "Regional dex", name: "Scarlet/Violet: Paldea Dex", description: "Species in the Paldea regional dex; moves from Scarlet/Violet.", dexes: ["paldea"], forms: ["paldea"], era: 9, versionGroups: ["scarlet-violet"], clauses: true },
    { id: "sv-full", group: "Regional dex", name: "Scarlet/Violet: Paldea + DLC", description: "Paldea, Kitakami and Blueberry dexes; moves from Scarlet/Violet and both DLC packs.", dexes: ["paldea", "kitakami", "blueberry"], forms: ["paldea", "alola", "galar", "hisui"], era: 9, versionGroups: GEN_VERSION_GROUPS[9], clauses: true },
    {
      id: "sv-vgc2026", group: "Official rules", name: "VGC 2026 (Scarlet/Violet)",
      description: "Scarlet/Violet Video Game Championships rules as on Pokémon Showdown's VGC 2026 ladder: doubles, level 50, bring 6 pick 4, up to 2 restricted legendaries, no mythicals, Species and Item Clause. Tera is not modelled. The official 2026 circuit moved to Pokémon Champions, which this app does not support.",
      gen: 9, forms: genForms(9), era: 9, versionGroups: GEN_VERSION_GROUPS[9], clauses: true,
      doubles: true, levelCap: 50, defaultLevel: 50, bring: 4, minTeam: 4,
      restricted: { max: 2, species: RESTRICTED }, bannedSpecies: MYTHICAL, itemClauseError: true, needsLearnset: true, usage: "gen9vgc2026"
    },
    { id: "swsh-full", group: "Regional dex", name: "Sword/Shield: Galar + DLC", description: "Galar, Isle of Armor and Crown Tundra dexes; moves from Sword/Shield and both DLC packs.", dexes: ["galar", "isle-of-armor", "crown-tundra"], forms: ["galar", "alola", "gmax"], era: 8, versionGroups: GEN_VERSION_GROUPS[8], clauses: true }
  ];
  for (let n = 9; n >= 1; n--) {
    FORMATS.push({
      id: `gen${n}`, group: "Generation", name: `Generation ${n}`,
      description: (n === 1 ? "Species from Generation 1." : `Species from Generations 1–${n}.`) + ` Moves learnable in the Generation ${n} games.`,
      gen: n, forms: genForms(n), era: n, versionGroups: GEN_VERSION_GROUPS[n], clauses: true
    });
  }

  function findFormat(id) {
    return FORMATS.find(f => f.id === id) || FORMATS[0];
  }

  // Rule-set caveats the analysis cannot honour for this format, shown next to results
  function limitations(format) {
    const out = [];
    if (format.era !== null && format.era !== undefined && format.era <= 2) {
      out.push(`Generation ${format.era} stats use that generation's system (DVs, stat experience, ${format.era === 1 ? "one Special stat" : "a shared Special stat experience and DV"}), checked against Pokémon Showdown's calculator.`);
    }
    if (format.levelCap) {
      out.push(`${format.name}: Tera, Dynamax and team-preview choices are not modelled. The analysis covers all six Pokémon, but you bring 6 and pick ${format.bring} each game.`);
      out.push("Tier bans beyond restricted and mythical Pokémon, and event-only move combinations, are not checked.");
    } else {
      out.push("Tier bans, restricted-legendary limits, event-only move combinations and level or species restrictions of official rule sets are not checked.");
    }
    return out;
  }

  return { FORMATS, findFormat, GEN_VERSION_GROUPS, RESTRICTED, MYTHICAL, limitations };
});
