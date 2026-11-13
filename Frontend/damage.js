// Damage calculation adapter: maps this app's sets (PokeAPI names) onto @smogon/calc, the engine
// behind Pokémon Showdown's damage calculator. Pure apart from the calc library it is given.
// Browser: needs vendor/smogon-calc/*.min.js loaded first (window.calc). Node: createDamage(calcLib).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.PokeDamage = factory(root.calc);
})(typeof self !== "undefined" ? self : this, function createDamage(calc) {
  const available = !!(calc && calc.calculate && calc.Generations);
  const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"];

  // Defender assumptions when the target is not one of your own sets
  const DEFENDER_SPREADS = [
    { id: "none", label: "No investment (0 EVs, neutral nature)", evs: {}, nature: "Hardy" },
    { id: "physical", label: "Max physical bulk (252 HP / 252+ Def)", evs: { hp: 252, def: 252 }, nature: "Bold" },
    { id: "special", label: "Max special bulk (252 HP / 252+ SpD)", evs: { hp: 252, spd: 252 }, nature: "Calm" },
    { id: "hp", label: "Max HP only (252 HP)", evs: { hp: 252 }, nature: "Hardy" }
  ];

  const toID = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  function generation(num) {
    return calc.Generations.get(Math.min(9, Math.max(1, num || 9)));
  }

  // PokeAPI names often carry a default-form suffix Showdown omits ("tornadus-incarnate" -> "Tornadus",
  // "tauros-paldea-combat-breed" -> "Tauros-Paldea-Combat"): try the full name, then drop trailing parts.
  function resolveSpecies(gen, apiName) {
    const parts = String(apiName || "").split("-");
    for (let n = parts.length; n > 0; n--) {
      const s = gen.species.get(toID(parts.slice(0, n).join("")));
      if (s) return s.name;
    }
    return null;
  }
  const lookup = (table, apiName) => { const x = apiName && table.get(toID(apiName)); return x ? x.name : null; };
  const resolveMove = (gen, m) => lookup(gen.moves, m);
  const resolveItem = (gen, i) => lookup(gen.items, i);
  const resolveAbility = (gen, a) => lookup(gen.abilities, a);

  // slot: this app's slot. Returns { pokemon, notes } or { error }
  function toCalcPokemon(gen, slot, overrides = {}) {
    const species = resolveSpecies(gen, slot.name);
    if (!species) return { error: `${slot.name} is not in the calculator's Generation ${gen.num} data.` };
    const notes = [];
    const opts = { level: slot.level || 100 };
    if (gen.num >= 3) {
      opts.nature = capitalize(overrides.nature || slot.nature || "hardy");
      if (slot.ability) {
        const a = resolveAbility(gen, slot.ability);
        if (a) opts.ability = a; else notes.push(`Ability ${slot.ability} is unknown to the calculator and was ignored.`);
      }
    }
    if (slot.item && gen.num >= 2) {
      const i = resolveItem(gen, slot.item);
      if (i) opts.item = i; else notes.push(`Item ${slot.item} is unknown to the calculator and was ignored.`);
    }
    const evs = overrides.evs || slot.evs || {};
    const ivs = slot.ivs || {};
    opts.evs = {}; opts.ivs = {};
    STAT_KEYS.forEach(k => {
      if (evs[k] !== undefined) opts.evs[k] = evs[k];
      if (ivs[k] !== undefined) opts.ivs[k] = ivs[k];
    });
    try {
      return { pokemon: new calc.Pokemon(gen, species, opts), notes };
    } catch (err) {
      return { error: `The calculator could not build ${species}: ${err.message}` };
    }
  }

  // A Pokémon outside your team with an assumed spread (first listed ability, no item)
  function hypotheticalSlot(apiName, spreadId, level) {
    const spread = DEFENDER_SPREADS.find(s => s.id === spreadId) || DEFENDER_SPREADS[0];
    const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread.evs };
    return { name: apiName, level: level || 100, nature: spread.nature.toLowerCase(), ability: null, item: null, evs, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } };
  }

  function isDamaging(gen, apiMove) {
    const name = resolveMove(gen, apiMove);
    if (!name) return false;
    return new calc.Move(gen, name).category !== "Status"; // fixed-damage moves (Seismic Toss, ...) count as damaging
  }

  // Returns { minPct, maxPct, min, max, maxHP, ko, desc, notes } or { error }
  function calculate(genNum, attackerSlot, apiMove, defenderSlot, opts = {}) {
    if (!available) return { error: "The damage calculator did not load." };
    const gen = generation(genNum);
    const a = toCalcPokemon(gen, attackerSlot);
    if (a.error) return { error: a.error };
    const d = toCalcPokemon(gen, defenderSlot);
    if (d.error) return { error: d.error };
    const moveName = resolveMove(gen, apiMove);
    if (!moveName) return { error: `${apiMove} is not in the calculator's Generation ${gen.num} data.` };
    const move = new calc.Move(gen, moveName, { isCrit: !!opts.crit });
    if (move.category === "Status") return { error: `${moveName} is a status move and deals no direct damage.` };
    const field = new calc.Field({ weather: opts.weather || undefined, gameType: opts.doubles ? "Doubles" : "Singles" });
    try {
      const r = calc.calculate(gen, a.pokemon, d.pokemon, move, field);
      const range = r.range();
      const maxHP = d.pokemon.maxHP();
      const pct = (x) => Math.floor((x * 1000) / maxHP) / 10; // rounds down to 0.1%, like Showdown's calculator
      let ko = "";
      let desc = "";
      try { desc = r.desc(); } catch (err) { desc = ""; }
      try { ko = range[1] > 0 ? r.kochance().text : ""; } catch (err) { ko = ""; }
      return {
        min: range[0], max: range[1], maxHP, minPct: pct(range[0]), maxPct: pct(range[1]),
        ko, desc: desc || `${moveName}: ${range[0]}-${range[1]} (${pct(range[0])} - ${pct(range[1])}%)`,
        notes: a.notes.concat(d.notes)
      };
    } catch (err) {
      return { error: `Calculation failed: ${err.message}` };
    }
  }

  // Best damaging move (by max %) from attacker against defender
  function bestMove(genNum, attackerSlot, defenderSlot, opts = {}) {
    let best = null;
    for (const m of (attackerSlot.moves || []).filter(Boolean)) {
      const r = calculate(genNum, attackerSlot, m, defenderSlot, opts);
      if (r.error) continue;
      if (!best || r.maxPct > best.maxPct) best = { move: m, ...r };
    }
    return best;
  }

  return { available, DEFENDER_SPREADS, generation, resolveSpecies, resolveMove, resolveItem, resolveAbility, toCalcPokemon, hypotheticalSlot, isDamaging, calculate, bestMove };
});
