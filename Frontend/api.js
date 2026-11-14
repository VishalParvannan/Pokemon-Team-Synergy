// PokeAPI access: retrying fetch, a persistent cache of processed results, and pure response parsers.
// Remote data is untrusted: callers must escape it before putting it into HTML.
(function (root, factory) {
  const req = typeof require === "function";
  const L = req ? require("./logic.js") : root.PokeLogic;
  const F = req ? require("./formats.js") : root.PokeFormats;
  const C = req ? require("./cache.js") : root.PokeCache;
  if (typeof module === "object" && module.exports) module.exports = factory(L, F, C);
  else root.PokeApi = factory(L, F, C);
})(typeof self !== "undefined" ? self : this, function (L, F, C) {
  const API = "https://pokeapi.co/api/v2";
  const API_STAT_MAP = { hp: "hp", attack: "atk", defense: "def", "special-attack": "spa", "special-defense": "spd", speed: "spe" };
  const GEN_NUMBER = { "generation-i": 1, "generation-ii": 2, "generation-iii": 3, "generation-iv": 4, "generation-v": 5, "generation-vi": 6, "generation-vii": 7, "generation-viii": 8, "generation-ix": 9 };

  // Item categories that hold battle items, plus berries (which PokeAPI files under medicine)
  const ITEM_CATEGORIES = ["held-items", "choice", "in-a-pinch", "picky-healing", "type-protection", "bad-held-items", "plates", "species-specific", "type-enhancement", "scarves", "jewels", "mega-stones", "z-crystals", "memories", "effort-training"];

  // `?cache=off` in the page URL bypasses every cache (browser HTTP cache included) to measure a first visit
  const CACHE_OFF = typeof location !== "undefined" && new URLSearchParams(location.search).get("cache") === "off";
  const persistent = C.createCache({ enabled: !CACHE_OFF });
  // Counters for performance measurement: network requests, JSON characters downloaded, persistent cache hits/misses
  const stats = { requests: 0, bytes: 0, cache: persistent.stats };

  async function fetchJson(url, retries = 2) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, CACHE_OFF ? { cache: "no-store" } : undefined);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const text = await res.text();
        stats.requests++;
        stats.bytes += text.length;
        return JSON.parse(text);
      } catch (err) {
        lastErr = err;
        if (attempt < retries) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  // ---- Pure parsers ----
  function parsePokemon(res) {
    const learn = {};
    (res.moves || []).forEach(m => {
      learn[m.move.name] = Array.from(new Set((m.version_group_details || []).map(d => d.version_group.name)));
    });
    const stats = {};
    (res.stats || []).forEach(s => { if (API_STAT_MAP[s.stat.name]) stats[API_STAT_MAP[s.stat.name]] = s.base_stat; });
    return {
      species: res.species && res.species.name ? res.species.name : res.name,
      sprite: res.sprites && typeof res.sprites.front_default === "string" && /^https:\/\//.test(res.sprites.front_default) ? res.sprites.front_default : "",
      types: (res.types || []).map(t => t.type.name),
      // Earlier typings: [{ gen, types }] where `types` applied up to and including `gen` (e.g. Clefable: Normal to Gen 5)
      pastTypes: (res.past_types || []).map(p => ({ gen: GEN_NUMBER[p.generation.name], types: p.types.map(t => t.type.name) })).filter(p => p.gen),
      // Base stats that changed (e.g. Gen 6 buffs, Gen 1's single Special): [{ gen, stats: { atk: 80, spc: 85 } }]
      pastStats: (res.past_stats || []).map(p => ({
        gen: GEN_NUMBER[p.generation.name],
        stats: Object.fromEntries(p.stats.map(x => [x.stat.name === "special" ? "spc" : API_STAT_MAP[x.stat.name], x.base_stat]).filter(([k]) => k))
      })).filter(p => p.gen),
      abilities: (res.abilities || []).map(a => ({ name: a.ability.name, hidden: !!a.is_hidden })),
      stats, learn
    };
  }

  // Moves learnable in any of the format's version groups (null = every move)
  function poolForFormat(learn, versionGroups) {
    const names = Object.keys(learn || {});
    const pool = versionGroups ? names.filter(m => learn[m].some(vg => versionGroups.includes(vg))) : names;
    return pool.sort();
  }

  function parseMove(m) {
    return { type: m.type.name, damageClass: m.damage_class.name, priority: m.priority || 0, power: m.power || 0, target: m.target ? m.target.name : null };
  }

  function minGeneration(gameIndices) {
    const gens = (gameIndices || []).map(g => GEN_NUMBER[g.generation.name]).filter(Boolean);
    return gens.length ? Math.min(...gens) : null;
  }

  // ---- Cached lookups (memory for this page, IndexedDB across visits) ----
  const memo = new Map(); // key -> Promise; failures are evicted so they can be retried

  function cached(key, producer) {
    if (!memo.has(key)) {
      const p = persistent.remember(key, producer);
      p.catch(() => memo.delete(key));
      memo.set(key, p);
    }
    return memo.get(key);
  }

  function getPokemon(name) {
    return cached(`pokemon:${name}`, async () => {
      const parsed = parsePokemon(await fetchJson(`${API}/pokemon/${encodeURIComponent(name)}`));
      // Alternate forms (e.g. Mega) can have an empty move list: fall back to the species' default form
      if (!Object.keys(parsed.learn).length) {
        try {
          const sp = await fetchJson(`${API}/pokemon-species/${encodeURIComponent(parsed.species)}`);
          const def = sp.varieties.find(v => v.is_default);
          if (def && def.pokemon.name !== name) parsed.learn = (await getPokemon(def.pokemon.name)).learn;
        } catch (err) { /* keep the empty learnset: validation reports it as unverified */ }
      }
      return parsed;
    });
  }

  // Move details; resolves to null (and is not cached) when the lookup fails
  const moveInfo = new Map();
  async function getMoveInfo(name) {
    try {
      const info = await cached(`move:${name}`, async () => parseMove(await fetchJson(`${API}/move/${encodeURIComponent(name)}`, 1)));
      moveInfo.set(name, info);
      return info;
    } catch (err) {
      return null;
    }
  }
  function cachedMoveInfo() {
    return Object.fromEntries(moveInfo);
  }

  // Generation an item/ability was introduced; null when unknown (validation then skips the check)
  async function cachedGeneration(key, url, pick) {
    try { return await cached(key, async () => pick(await fetchJson(url, 1))); } catch (err) { return null; }
  }
  const getItemGeneration = (name) => cachedGeneration(`item-gen:${name}`, `${API}/item/${encodeURIComponent(name)}`, j => minGeneration(j.game_indices));
  const getAbilityGeneration = (name) => cachedGeneration(`ability-gen:${name}`, `${API}/ability/${encodeURIComponent(name)}`, j => GEN_NUMBER[j.generation.name] || null);

  // ---- Lists ----
  // Every Pokémon and form, following pagination to the end; ids of 10000+ are alternate forms
  function fetchPokemonEntries() {
    return cached("pokemon-entries", async () => {
      const entries = [];
      let url = `${API}/pokemon?limit=500`;
      while (url) {
        const page = await fetchJson(url);
        page.results.forEach(r => entries.push({ name: r.name, id: parseInt(r.url.match(/(\d+)\/?$/)[1], 10) }));
        url = page.next;
      }
      return entries;
    });
  }

  const getGenerationSpecies = () => cached("generation-species", async () => {
    const gens = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => fetchJson(`${API}/generation/${n}`)));
    return gens.map(g => g.pokemon_species.map(s => s.name));
  });
  const getDexSpecies = (dex) => cached(`dex:${dex}`, async () =>
    (await fetchJson(`${API}/pokedex/${dex}`)).pokemon_entries.map(e => e.pokemon_species.name));

  // Names available under a format (species-list filter only, not full legality)
  async function loadPokemonForFormat(choice) {
    const format = F.findFormat(choice.id);
    const entries = await fetchPokemonEntries();
    if (!format.gen && !format.dexes) return entries.map(e => e.name).sort();

    const generationSpecies = await getGenerationSpecies();
    const allSpecies = new Set(generationSpecies.flat());
    let allowed;
    if (format.gen) {
      const picked = choice.introducedOnly ? [generationSpecies[format.gen - 1]] : generationSpecies.slice(0, format.gen);
      allowed = new Set(picked.flat());
    } else {
      const lists = await Promise.all(format.dexes.map(getDexSpecies));
      allowed = new Set(lists.flat());
    }
    return L.filterPokemon(entries, allSpecies, allowed, format.forms).sort();
  }

  // Battle-relevant held items (not balls, potions, key items, TMs).
  // Returns { items, megaStones, specialist } where specialist = species- or gimmick-specific items.
  function loadItems() {
    return cached("battle-items", async () => {
      const [cats, active] = await Promise.all([
        Promise.all(ITEM_CATEGORIES.map(c => fetchJson(`${API}/item-category/${c}`))),
        fetchJson(`${API}/item-attribute/holdable-active`)
      ]);
      const items = new Set();
      cats.forEach(c => c.items.forEach(i => items.add(i.name)));
      active.items.forEach(i => { if (i.name.endsWith("-berry")) items.add(i.name); });
      const namesIn = (cat) => cats[ITEM_CATEGORIES.indexOf(cat)].items.map(i => i.name);
      const specialist = ["mega-stones", "z-crystals", "memories", "species-specific"].flatMap(namesIn);
      return { items: Array.from(items).sort(), megaStones: namesIn("mega-stones"), specialist };
    });
  }

  // Forget everything stored across visits (e.g. after a PokeAPI data update)
  async function clearCache() {
    memo.clear();
    moveInfo.clear();
    await persistent.clear();
  }

  return {
    API, ITEM_CATEGORIES, CACHE_OFF, stats, fetchJson, parsePokemon, poolForFormat, parseMove, minGeneration,
    getPokemon, getMoveInfo, cachedMoveInfo, getItemGeneration, getAbilityGeneration,
    fetchPokemonEntries, loadPokemonForFormat, loadItems, clearCache
  };
});
