// Format definitions. To add a format, add an entry here:
//   gen / dexes   which species are allowed (generation lists or PokeAPI pokedex names)
//   forms         allowed alternate-form kinds
//   era           game generation whose rules apply (drives ability/item/mechanic checks)
//   versionGroups PokeAPI version groups whose learnsets define legal moves (null = no restriction)
//   clauses       whether Species/Item Clause style team checks apply
// These are species-list and learnset filters, not official regulation rule sets: tier bans,
// restricted-legendary limits and event-only move combinations are not modelled.
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

  const FORMATS = [
    { id: "any", group: "Open", name: "All Pokémon", description: "No restrictions. Every Pokémon, form, move, ability and item is allowed; only basic limits (EVs, duplicate moves) are checked.", era: null, versionGroups: null, clauses: false },
    { id: "sv-paldea", group: "Regional dex", name: "Scarlet/Violet: Paldea Dex", description: "Species in the Paldea regional dex; moves from Scarlet/Violet.", dexes: ["paldea"], forms: ["paldea"], era: 9, versionGroups: ["scarlet-violet"], clauses: true },
    { id: "sv-full", group: "Regional dex", name: "Scarlet/Violet: Paldea + DLC", description: "Paldea, Kitakami and Blueberry dexes; moves from Scarlet/Violet and both DLC packs.", dexes: ["paldea", "kitakami", "blueberry"], forms: ["paldea", "alola", "galar", "hisui"], era: 9, versionGroups: GEN_VERSION_GROUPS[9], clauses: true },
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
    if (format.era !== null && format.era !== undefined) {
      if (format.era <= 2) out.push("Generation 1–2 used a different stat system (DVs and stat experience); calculated stats here use the Generation 3+ formula.");
      if (format.era <= 5) out.push("The type chart includes Fairy (Generation 6+); older generations had no Fairy type and some different matchups.");
    }
    out.push("Tier bans, restricted-legendary limits, event-only move combinations and level or species restrictions of official rule sets are not checked.");
    return out;
  }

  return { FORMATS, findFormat, GEN_VERSION_GROUPS, limitations };
});
