// Benchmark fixture: paste into the browser console on the builder page (or run via the
// browser automation used for the README numbers). It saves a fixed six-Pokémon Gen 9 team
// so every measured load does the same work, then reloads the page.
(function () {
  const names = ["garchomp", "corviknight", "clefable", "rotom-wash", "tyranitar", "heatran"];
  const slot = (name) => ({
    name, species: name, sprite: "", types: [], abilities: [], hiddenAbilities: [], ability: null, item: null,
    level: 100, nature: "hardy", moves: [null, null, null, null],
    stats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
  });
  const store = {
    version: 2, activeTeamId: "bench",
    teams: [{ id: "bench", name: "Benchmark team", format: { id: "gen9", introducedOnly: false }, activeTab: -1, slots: names.map(slot) }]
  };
  localStorage.setItem("pokemonTeamSynergy.v2", JSON.stringify(store));
  location.reload();
})();
