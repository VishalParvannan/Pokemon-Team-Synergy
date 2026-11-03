// Format definitions. To add a format, add an entry here: `gen` uses species by
// generation, `dexes` uses PokeAPI pokedex names, and `forms` lists allowed form kinds.
// These are species-list filters, not official regulation rule sets.
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

  const FORMATS = [
    { id: "any", group: "Open", name: "All Pokémon", description: "No restrictions. Every Pokémon and form is available." },
    { id: "sv-paldea", group: "Regional dex", name: "Scarlet/Violet: Paldea Dex", description: "Species in the Paldea regional dex.", dexes: ["paldea"], forms: ["paldea"] },
    { id: "sv-full", group: "Regional dex", name: "Scarlet/Violet: Paldea + DLC", description: "Paldea, Kitakami and Blueberry dexes.", dexes: ["paldea", "kitakami", "blueberry"], forms: ["paldea", "alola", "galar", "hisui"] },
    { id: "swsh-full", group: "Regional dex", name: "Sword/Shield: Galar + DLC", description: "Galar, Isle of Armor and Crown Tundra dexes.", dexes: ["galar", "isle-of-armor", "crown-tundra"], forms: ["galar", "alola", "gmax"] }
  ];
  for (let n = 9; n >= 1; n--) {
    FORMATS.push({ id: `gen${n}`, group: "Generation", name: `Generation ${n}`, description: n === 1 ? "Species from Generation 1." : `Species from Generations 1–${n}.`, gen: n, forms: genForms(n) });
  }

  function findFormat(id) {
    return FORMATS.find(f => f.id === id) || FORMATS[0];
  }

  return { FORMATS, findFormat };
});
