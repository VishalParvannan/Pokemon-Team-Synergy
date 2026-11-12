// Pure domain logic (no DOM, no network). Works in the browser and in Node tests.
// Rules modelled: Generation 6+ type chart (with Fairy), Gen 3+ stat formula.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PokeLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const ALL_TYPES = [
    "normal", "fire", "water", "electric", "grass", "ice",
    "fighting", "poison", "ground", "flying", "psychic", "bug",
    "rock", "ghost", "dark", "steel", "dragon", "fairy"
  ];

  // TYPE_CHART[attacking][defending]; missing entries mean 1x.
  const TYPE_CHART = {
    normal:   { rock: 0.5, ghost: 0, steel: 0.5 },
    fire:     { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
    water:    { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
    electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
    grass:    { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
    ice:      { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
    fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
    poison:   { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
    ground:   { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
    flying:   { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
    psychic:  { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
    bug:      { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
    rock:     { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
    ghost:    { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
    dragon:   { dragon: 2, steel: 0.5, fairy: 0 },
    dark:     { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
    steel:    { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
    fairy:    { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 }
  };

  const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"];
  const MAX_EV_TOTAL = 510;
  const MAX_EV_STAT = 252;
  const MAX_IV = 31;

  // nature: [raised, lowered]; neutral natures have null.
  const NATURES = {
    hardy: null, docile: null, serious: null, bashful: null, quirky: null,
    lonely: ["atk", "def"], brave: ["atk", "spe"], adamant: ["atk", "spa"], naughty: ["atk", "spd"],
    bold: ["def", "atk"], relaxed: ["def", "spe"], impish: ["def", "spa"], lax: ["def", "spd"],
    timid: ["spe", "atk"], hasty: ["spe", "def"], jolly: ["spe", "spa"], naive: ["spe", "spd"],
    modest: ["spa", "atk"], mild: ["spa", "def"], quiet: ["spa", "spe"], rash: ["spa", "spd"],
    calm: ["spd", "atk"], gentle: ["spd", "def"], sassy: ["spd", "spe"], careful: ["spd", "spa"]
  };

  function getDefensiveMultiplier(defendingTypes, attackingType) {
    const row = TYPE_CHART[attackingType];
    if (!row) return 1;
    return defendingTypes.reduce((m, dt) => m * (row[dt] !== undefined ? row[dt] : 1), 1);
  }

  function natureModifier(nature, statKey) {
    const n = NATURES[nature];
    if (!n || statKey === "hp") return 1;
    if (n[0] === statKey) return 1.1;
    if (n[1] === statKey) return 0.9;
    return 1;
  }

  function clampInt(v, min, max) {
    const n = parseInt(v, 10);
    return Math.min(Math.max(Number.isFinite(n) ? n : min, min), max);
  }

  // Gen 3+ stat formula. `base` is the species base stat.
  function calcStat(statKey, base, iv, ev, level, nature, isShedinja) {
    const core = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
    if (statKey === "hp") return isShedinja ? 1 : core + level + 10;
    return Math.floor((core + 5) * natureModifier(nature, statKey));
  }

  function calcAllStats(slot) {
    const out = {};
    STAT_KEYS.forEach(k => {
      out[k] = calcStat(k, slot.stats[k], slot.ivs[k], slot.evs[k], slot.level, slot.nature, slot.name === "shedinja");
    });
    return out;
  }

  function evTotal(evs) {
    return STAT_KEYS.reduce((a, k) => a + (evs[k] || 0), 0);
  }

  // Returns the EV value allowed for `statKey` given the other stats, plus a message when it was reduced.
  function clampEv(evs, statKey, requested) {
    const wanted = clampInt(requested, 0, MAX_EV_STAT);
    const others = evTotal(evs) - (evs[statKey] || 0);
    const room = Math.max(0, MAX_EV_TOTAL - others);
    if (wanted > room) {
      return { value: room, message: `Only ${room} EVs left: the total is capped at ${MAX_EV_TOTAL}.` };
    }
    if (parseInt(requested, 10) > MAX_EV_STAT) {
      return { value: wanted, message: `A single stat is capped at ${MAX_EV_STAT} EVs.` };
    }
    return { value: wanted, message: "" };
  }

  // Types that `moveTypes` hit super-effectively, per single defending type.
  function coveredTypes(moveTypes) {
    return ALL_TYPES.filter(target =>
      moveTypes.some(t => getDefensiveMultiplier([target], t) > 1));
  }

  // Dual-type targets (all unordered pairs) hit super-effectively by at least one of `moveTypes`.
  function dualTypeCoverage(moveTypes) {
    let hit = 0, total = 0;
    for (let i = 0; i < ALL_TYPES.length; i++) {
      for (let j = i + 1; j < ALL_TYPES.length; j++) {
        total++;
        if (moveTypes.some(t => getDefensiveMultiplier([ALL_TYPES[i], ALL_TYPES[j]], t) > 1)) hit++;
      }
    }
    return { hit, total };
  }

  // Per attacking type: how many members are weak, resist and are immune.
  function defensiveSummary(members) {
    const summary = {};
    ALL_TYPES.forEach(atk => {
      let weak = 0, resist = 0, immune = 0;
      members.forEach(m => {
        const mult = getDefensiveMultiplier(m.types, atk);
        if (mult === 0) immune++;
        else if (mult > 1) weak++;
        else if (mult < 1) resist++;
      });
      summary[atk] = { weak, resist, immune };
    });
    return summary;
  }

  return {
    ALL_TYPES, TYPE_CHART, STAT_KEYS, NATURES, MAX_EV_TOTAL, MAX_EV_STAT, MAX_IV,
    getDefensiveMultiplier, natureModifier, clampInt, calcStat, calcAllStats,
    evTotal, clampEv, coveredTypes, dualTypeCoverage, defensiveSummary
  };
});

// ---- Format filtering (pure) ----
// Scoped so these names do not clash with globals declared by other scripts.
(function () {
  // Which form kind a non-default Pokémon name is, or null if unrecognized.
  function formKind(name) {
    if (/-(mega|primal)(-|$)/.test(name)) return "mega";
    if (/-gmax(-|$)/.test(name)) return "gmax";
    const m = name.match(/-(alola|galar|hisui|paldea)(-|$)/);
    return m ? m[1] : null;
  }

  // Species a Pokémon name belongs to: the longest dash-prefix that is a known species.
  function ownerSpecies(name, allSpecies) {
    const parts = name.split("-");
    for (let n = parts.length; n > 0; n--) {
      const candidate = parts.slice(0, n).join("-");
      if (allSpecies.has(candidate)) return candidate;
    }
    return null;
  }

  // entries: [{ name, id }]. IDs of 10000+ are alternate forms in PokeAPI.
  function filterPokemon(entries, allSpecies, allowedSpecies, allowedForms) {
    return entries.filter(({ name, id }) => {
      if (!allowedSpecies.has(ownerSpecies(name, allSpecies))) return false;
      return id < 10000 || allowedForms.includes(formKind(name));
    }).map(e => e.name);
  }

  if (typeof module === "object" && module.exports) Object.assign(module.exports, { formKind, ownerSpecies, filterPokemon });
  else Object.assign(self.PokeLogic, { formKind, ownerSpecies, filterPokemon });
})();
