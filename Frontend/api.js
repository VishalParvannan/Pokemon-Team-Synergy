// PokeAPI access: retrying fetch, cached lookups and pure response parsers.
// Remote data is untrusted: callers must escape it before putting it into HTML.
(function (root, factory) {
  const L = typeof require === "function" ? require("./logic.js") : root.PokeLogic;
  const F = typeof require === "function" ? require("./formats.js") : root.PokeFormats;
  if (typeof module === "object" && module.exports) module.exports = factory(L, F);
  else root.PokeApi = factory(L, F);
})(typeof self !== "undefined" ? self : this, function (L, F) {
  const API = "https://pokeapi.co/api/v2";
  const API_STAT_MAP = { hp: "hp", attack: "atk", defense: "def", "special-attack": "spa", "special-defense": "spd", speed: "spe" };
  const GEN_NUMBER = { "generation-i": 1, "generation-ii": 2, "generation-iii": 3, "generation-iv": 4, "generation-v": 5, "generation-vi": 6, "generation-vii": 7, "generation-viii": 8, "generation-ix": 9 };

  // Item categories that hold battle items, plus berries (which PokeAPI files under medicine)
  const ITEM_CATEGORIES = ["held-items", "choice", "in-a-pinch", "picky-healing", "type-protection", "bad-held-items", "plates", "species-specific", "type-enhancement", "scarves", "jewels", "mega-stones", "z-crystals", "memories", "effort-training"];

  async function fetchJson(url, retries = 2) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.json();
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
    return { type: m.type.name, damageClass: m.damage_class.name, priority: m.priority || 0, power: m.power || 0 };
  }

  function minGeneration(gameIndices) {
    const gens = (gameIndices || []).map(g => GEN_NUMBER[g.generation.name]).filter(Boolean);
    return gens.length ? Math.min(...gens) : null;
  }

  // ---- Cached lookups ----
  const pokemonCache = new Map(); // name -> Promise<parsed>
  const moveCache = new Map(); // name -> info | null
  const itemGenCache = new Map(); // name -> generation | null
  const abilityGenCache = new Map(); // name -> generation | null

  function getPokemon(name) {
    if (!pokemonCache.has(name)) {
      const p = (async () => {
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
      })();
      p.catch(() => pokemonCache.delete(name));
      pokemonCache.set(name, p);
    }
    return pokemonCache.get(name);
  }

  async function getMoveInfo(name) {
    if (moveCache.get(name)) return moveCache.get(name);
    try {
      const info = parseMove(await fetchJson(`${API}/move/${encodeURIComponent(name)}`, 1));
      moveCache.set(name, info);
      return info;
    } catch (err) {
      moveCache.set(name, null);
      return null;
    }
  }
  function cachedMoveInfo() {
    const out = {};
    moveCache.forEach((v, k) => { if (v) out[k] = v; });
    return out;
  }

  async function cachedGeneration(cache, url, pick, name) {
    if (cache.has(name) && cache.get(name) !== undefined) return cache.get(name);
    try {
      const gen = pick(await fetchJson(url, 1));
      cache.set(name, gen);
      return gen;
    } catch (err) {
      return null; // unknown: do not cache failures, validation just skips the check
    }
  }
  const getItemGeneration = (name) => cachedGeneration(itemGenCache, `${API}/item/${encodeURIComponent(name)}`, j => minGeneration(j.game_indices), name);
  const getAbilityGeneration = (name) => cachedGeneration(abilityGenCache, `${API}/ability/${encodeURIComponent(name)}`, j => GEN_NUMBER[j.generation.name] || null, name);

  // ---- Lists ----
  let entriesPromise = null;
  let generationSpecies = null;
  const dexSpecies = new Map();

  // Follow pagination to the end; ids of 10000+ are alternate forms
  function fetchPokemonEntries() {
    if (!entriesPromise) {
      entriesPromise = (async () => {
        const entries = [];
        let url = `${API}/pokemon?limit=500`;
        while (url) {
          const page = await fetchJson(url);
          page.results.forEach(r => entries.push({ name: r.name, id: parseInt(r.url.match(/(\d+)\/?$/)[1], 10) }));
          url = page.next;
        }
        return entries;
      })();
      entriesPromise.catch(() => { entriesPromise = null; });
    }
    return entriesPromise;
  }

  // Names available under a format (species-list filter only, not full legality)
  async function loadPokemonForFormat(choice) {
    const format = F.findFormat(choice.id);
    const entries = await fetchPokemonEntries();
    if (!format.gen && !format.dexes) return entries.map(e => e.name).sort();

    if (!generationSpecies) {
      const gens = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => fetchJson(`${API}/generation/${n}`)));
      generationSpecies = gens.map(g => g.pokemon_species.map(s => s.name));
    }
    const allSpecies = new Set(generationSpecies.flat());

    let allowed;
    if (format.gen) {
      const picked = choice.introducedOnly ? [generationSpecies[format.gen - 1]] : generationSpecies.slice(0, format.gen);
      allowed = new Set(picked.flat());
    } else {
      for (const dex of format.dexes) {
        if (!dexSpecies.has(dex)) {
          const data = await fetchJson(`${API}/pokedex/${dex}`);
          dexSpecies.set(dex, data.pokemon_entries.map(e => e.pokemon_species.name));
        }
      }
      allowed = new Set(format.dexes.flatMap(dex => dexSpecies.get(dex)));
    }
    return L.filterPokemon(entries, allSpecies, allowed, format.forms).sort();
  }

  // Battle-relevant held items (not balls, potions, key items, TMs). Returns { items: [...], megaStones: [...] }
  async function loadItems() {
    const [cats, active] = await Promise.all([
      Promise.all(ITEM_CATEGORIES.map(c => fetchJson(`${API}/item-category/${c}`))),
      fetchJson(`${API}/item-attribute/holdable-active`)
    ]);
    const items = new Set();
    cats.forEach(c => c.items.forEach(i => items.add(i.name)));
    active.items.forEach(i => { if (i.name.endsWith("-berry")) items.add(i.name); });
    const namesIn = (cat) => cats[ITEM_CATEGORIES.indexOf(cat)].items.map(i => i.name);
    // Items tied to one species or a past-generation gimmick: valid to hold, but poor random picks
    const specialist = ["mega-stones", "z-crystals", "memories", "species-specific"].flatMap(namesIn);
    return { items: Array.from(items).sort(), megaStones: namesIn("mega-stones"), specialist };
  }

  return {
    API, ITEM_CATEGORIES, fetchJson, parsePokemon, poolForFormat, parseMove, minGeneration,
    getPokemon, getMoveInfo, cachedMoveInfo, getItemGeneration, getAbilityGeneration,
    fetchPokemonEntries, loadPokemonForFormat, loadItems
  };
});
