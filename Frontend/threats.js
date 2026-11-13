// Threat list: how your team fares against the most-used Pokémon of a Smogon format, each with its
// most common set (from Frontend/data/threats/*.json). Uses the damage module for every matchup.
// Pure apart from the damage module it is given.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.PokeThreats = factory(root.PokeDamage);
})(typeof self !== "undefined" ? self : this, function createThreats(D) {
  // Thresholds, stated in the UI next to the results
  const SAFE_SWITCH_MAX = 50; // a member is a safe switch-in if the threat's best move does at most this % (max roll)
  const STRONG_HIT_MIN = 50; // "hits it hard" = your best move does at least this % (min roll)

  // Which usage snapshot fits a format: singles OU of the format's generation, or Gen 9 Doubles OU.
  // Returns null when no snapshot fits (doubles in older generations).
  function snapshotFor(format, doubles) {
    const era = format && format.era ? format.era : 9;
    if (doubles) return era === 9 ? "gen9doublesou" : null;
    return `gen${era}ou`;
  }

  // Usage-stats set (Showdown names) -> the slot shape the damage module reads
  function threatSlot(t) {
    const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...(t.set.evs || {}) };
    return {
      name: t.name, level: 100, nature: (t.set.nature || "hardy").toLowerCase(),
      ability: t.set.ability && t.set.ability !== "No Ability" ? t.set.ability : null,
      item: t.set.item, moves: t.set.moves.slice(0, 4), evs,
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }
    };
  }

  function speedOf(gen, slot) {
    const built = D.toCalcPokemon(gen, slot);
    if (built.error) return null;
    const scarf = built.pokemon.item === "Choice Scarf";
    return Math.floor(built.pokemon.stats.spe * (scarf ? 1.5 : 1));
  }

  // members: your filled slots. Returns { entries, summary }
  function analyzeThreats(genNum, snapshot, members, opts = {}) {
    if (!D || !D.available) return { error: "The damage calculator did not load." };
    const gen = D.generation(genNum);
    const entries = [];
    const skipped = [];
    for (const t of snapshot.threats) {
      const ts = threatSlot(t);
      if (!D.resolveSpecies(gen, t.name)) { skipped.push(t.name); continue; }
      const threatSpeed = speedOf(gen, ts);
      const vs = members.map(m => {
        const incoming = D.bestMove(genNum, ts, m, opts);
        const outgoing = D.bestMove(genNum, m, ts, opts);
        const mySpeed = speedOf(gen, m);
        return {
          name: m.name,
          incoming: incoming ? { move: incoming.move, minPct: incoming.minPct, maxPct: incoming.maxPct } : null,
          outgoing: outgoing ? { move: outgoing.move, minPct: outgoing.minPct, maxPct: outgoing.maxPct } : null,
          faster: mySpeed !== null && threatSpeed !== null ? (mySpeed > threatSpeed ? "you" : mySpeed < threatSpeed ? "threat" : "tie") : null
        };
      });
      const ohkoed = vs.filter(v => v.incoming && v.incoming.minPct >= 100).map(v => v.name);
      const safeSwitchIns = vs.filter(v => !v.incoming || v.incoming.maxPct <= SAFE_SWITCH_MAX).map(v => v.name);
      const hardHitters = vs.filter(v => v.outgoing && v.outgoing.minPct >= STRONG_HIT_MIN).map(v => v.name);
      const revengeKillers = vs.filter(v => v.outgoing && v.outgoing.minPct >= 100 && v.faster === "you").map(v => v.name);
      const best = vs.filter(v => v.outgoing).sort((a, b) => b.outgoing.maxPct - a.outgoing.maxPct)[0] || null;

      let level = "low";
      const reasons = [];
      if (ohkoed.length >= 2) reasons.push(`OHKOs ${ohkoed.length} of your Pokémon`);
      if (!safeSwitchIns.length) reasons.push("no safe switch-in");
      if (!hardHitters.length) reasons.push(`none of your moves reliably does ${STRONG_HIT_MIN}%+`);
      if (ohkoed.length >= 3 || (!safeSwitchIns.length && !hardHitters.length)) level = "high";
      else if (ohkoed.length >= 2 || !safeSwitchIns.length || !hardHitters.length) level = "medium";

      entries.push({
        name: t.name, usage: t.usage, set: t.set, level, reasons, vs,
        ohkoed, safeSwitchIns, hardHitters, revengeKillers,
        bestAnswer: best ? { name: best.name, move: best.outgoing.move, minPct: best.outgoing.minPct, maxPct: best.outgoing.maxPct } : null,
        threatSpeed
      });
    }
    const order = { high: 0, medium: 1, low: 2 };
    entries.sort((a, b) => order[a.level] - order[b.level] || b.usage - a.usage);
    const summary = {
      considered: entries.length,
      high: entries.filter(e => e.level === "high").length,
      medium: entries.filter(e => e.level === "medium").length,
      noSafeSwitch: entries.filter(e => !e.safeSwitchIns.length).length,
      skipped
    };
    return { entries, summary, thresholds: { SAFE_SWITCH_MAX, STRONG_HIT_MIN } };
  }

  return { SAFE_SWITCH_MAX, STRONG_HIT_MIN, snapshotFor, threatSlot, analyzeThreats };
});
