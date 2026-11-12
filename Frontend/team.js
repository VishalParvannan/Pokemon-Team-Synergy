// Team model: slots, multi-team store (versioned, migratable), rule validation,
// Showdown text and JSON import/export. Pure (no DOM, no network).
(function (root, factory) {
  const L = typeof require === "function" ? require("./logic.js") : root.PokeLogic;
  if (typeof module === "object" && module.exports) module.exports = factory(L);
  else root.PokeTeam = factory(L);
})(typeof self !== "undefined" ? self : this, function (L) {
  const { ALL_TYPES, STAT_KEYS, NATURES, MAX_EV_TOTAL, MAX_EV_STAT, MAX_IV, clampInt, evTotal } = L;

  const STORE_VERSION = 2;
  const SLOT_COUNT = 6;
  const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const SHOWDOWN_STATS = { hp: "hp", atk: "atk", def: "def", spa: "spa", spd: "spd", spe: "spe", satk: "spa", sdef: "spd", spc: "spa" };

  function idName(v) { return typeof v === "string" && NAME_RE.test(v) ? v : null; }
  function safeSprite(url) { return typeof url === "string" && /^https:\/\//.test(url) ? url : ""; }

  function createEmptySlot() {
    return {
      name: null, species: null, sprite: "", types: [],
      abilities: [], hiddenAbilities: [], ability: null, item: null,
      level: 100, nature: "hardy", moves: [null, null, null, null],
      stats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 }, // base stats
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
      // Runtime-only (never saved): learn {move: [versionGroup]}, movePool [move], dataState
    };
  }

  // Validate untrusted slot data (storage, imports) into a well-formed slot
  function sanitizeSlot(saved) {
    const slot = createEmptySlot();
    if (!saved || typeof saved !== "object" || !idName(saved.name)) return slot;
    slot.name = saved.name;
    slot.species = idName(saved.species) || saved.name;
    slot.sprite = safeSprite(saved.sprite);
    slot.types = (Array.isArray(saved.types) ? saved.types : []).filter(t => ALL_TYPES.includes(t)).slice(0, 2);
    slot.abilities = (Array.isArray(saved.abilities) ? saved.abilities : []).map(idName).filter(Boolean).slice(0, 4);
    slot.hiddenAbilities = (Array.isArray(saved.hiddenAbilities) ? saved.hiddenAbilities : []).map(idName).filter(a => a && slot.abilities.includes(a));
    slot.ability = idName(saved.ability);
    slot.item = idName(saved.item);
    const moves = Array.isArray(saved.moves) ? saved.moves : [];
    slot.moves = [0, 1, 2, 3].map(j => idName(moves[j]));
    slot.level = clampInt(saved.level, 1, 100);
    slot.nature = typeof saved.nature === "string" && saved.nature in NATURES ? saved.nature : "hardy";
    STAT_KEYS.forEach(k => {
      slot.stats[k] = clampInt(saved.stats && saved.stats[k], 1, 255);
      slot.ivs[k] = clampInt(saved.ivs && saved.ivs[k], 0, MAX_IV);
      slot.evs[k] = clampInt(saved.evs && saved.evs[k], 0, MAX_EV_STAT);
    });
    if (evTotal(slot.evs) > MAX_EV_TOTAL) STAT_KEYS.forEach(k => { slot.evs[k] = 0; });
    return slot;
  }

  function serializeSlot(slot) {
    if (!slot.name) return createEmptySlot();
    const { learn, movePool, dataState, ...persisted } = slot;
    return JSON.parse(JSON.stringify(persisted));
  }

  function newId() {
    return "t" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
  }

  function cleanFormat(f, isFormatId) {
    const id = f && typeof f.id === "string" && (!isFormatId || isFormatId(f.id)) ? f.id : "any";
    return { id, introducedOnly: !!(f && f.introducedOnly === true) };
  }

  function createTeam(name, format) {
    return {
      id: newId(),
      name: cleanName(name) || "New team",
      format: cleanFormat(format),
      slots: Array.from({ length: SLOT_COUNT }, createEmptySlot),
      activeTab: -1
    };
  }

  function cleanName(name) {
    return typeof name === "string" ? name.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 40) : "";
  }

  function sanitizeTeam(raw, isFormatId) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.slots)) return null;
    const slots = Array.from({ length: SLOT_COUNT }, (_, i) => sanitizeSlot(raw.slots[i]));
    return {
      id: typeof raw.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ? raw.id : newId(),
      name: cleanName(raw.name) || "Untitled team",
      format: cleanFormat(raw.format, isFormatId),
      slots,
      activeTab: Number.isInteger(raw.activeTab) && raw.activeTab >= -1 && raw.activeTab < SLOT_COUNT ? raw.activeTab : -1
    };
  }

  function sanitizeStore(raw, isFormatId) {
    if (!raw || raw.version !== STORE_VERSION || !Array.isArray(raw.teams)) return null;
    const teams = raw.teams.map(t => sanitizeTeam(t, isFormatId)).filter(Boolean).slice(0, 50);
    if (!teams.length) return null;
    const seen = new Set();
    teams.forEach(t => { while (seen.has(t.id)) t.id = newId(); seen.add(t.id); });
    const active = teams.some(t => t.id === raw.activeTeamId) ? raw.activeTeamId : teams[0].id;
    return { version: STORE_VERSION, activeTeamId: active, teams };
  }

  // Version 1 stored a single team under one key plus the format under another
  function migrateV1(rawTeam, rawFormat, isFormatId) {
    if (!rawTeam || rawTeam.version !== 1 || !Array.isArray(rawTeam.teamSlots)) return null;
    const team = sanitizeTeam({
      name: "My team", slots: rawTeam.teamSlots, activeTab: rawTeam.activeTabIndex,
      format: rawFormat && typeof rawFormat === "object" ? rawFormat : null
    }, isFormatId);
    return team ? { version: STORE_VERSION, activeTeamId: team.id, teams: [team] } : null;
  }

  function serializeStore(store) {
    return {
      version: STORE_VERSION, activeTeamId: store.activeTeamId,
      teams: store.teams.map(t => ({ id: t.id, name: t.name, format: t.format, activeTab: t.activeTab, slots: t.slots.map(serializeSlot) }))
    };
  }

  // ---- Names ----
  function pretty(str) {
    if (!str) return "";
    return String(str).charAt(0).toUpperCase() + String(str).slice(1).replace(/-/g, " ");
  }

  // Normalize Showdown-style display names ("Mr. Mime", "King's Rock") to PokeAPI ids
  function normalizeId(str) {
    return String(str || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[.'’:%]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  // Resolve a normalized species id against PokeAPI entries ([{name, id}]); picks the lowest-id form when only a prefix matches
  function resolveSpecies(key, entries) {
    if (!key) return null;
    const exact = entries.find(e => e.name === key);
    if (exact) return exact.name;
    const prefixed = entries.filter(e => e.name.startsWith(key + "-")).sort((a, b) => a.id - b.id);
    return prefixed.length ? prefixed[0].name : null;
  }

  // ---- Showdown text ----
  function titleCaseParts(name, sep) {
    return name.split("-").map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(sep);
  }

  const SD_LABEL = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };

  function toShowdown(team) {
    return team.slots.filter(s => s.name).map(s => {
      const lines = [];
      lines.push(titleCaseParts(s.name, "-") + (s.item ? ` @ ${titleCaseParts(s.item, " ")}` : ""));
      if (s.ability) lines.push(`Ability: ${titleCaseParts(s.ability, " ")}`);
      if (s.level !== 100) lines.push(`Level: ${s.level}`);
      const evs = STAT_KEYS.filter(k => s.evs[k] > 0).map(k => `${s.evs[k]} ${SD_LABEL[k]}`);
      if (evs.length) lines.push(`EVs: ${evs.join(" / ")}`);
      lines.push(`${titleCaseParts(s.nature || "hardy", " ")} Nature`);
      const ivs = STAT_KEYS.filter(k => s.ivs[k] !== MAX_IV).map(k => `${s.ivs[k]} ${SD_LABEL[k]}`);
      if (ivs.length) lines.push(`IVs: ${ivs.join(" / ")}`);
      s.moves.filter(Boolean).forEach(m => lines.push(`- ${titleCaseParts(m, " ")}`));
      return lines.join("\n");
    }).join("\n\n");
  }

  function parseStatSpread(text) {
    const out = {};
    text.split("/").forEach(part => {
      const m = part.trim().match(/^(\d+)\s*([A-Za-z.]+)$/);
      if (!m) return;
      const key = SHOWDOWN_STATS[m[2].toLowerCase().replace(/\./g, "")];
      if (key) out[key] = parseInt(m[1], 10);
    });
    return out;
  }

  // Returns { team: [{ speciesKey, item, ability, level, nature, evs, ivs, moves }], warnings: [] }
  function parseShowdown(text) {
    const warnings = [];
    const blocks = String(text || "").replace(/\r/g, "").split(/\n\s*\n/)
      .map(b => b.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("===")))
      .filter(b => b.length);
    const mons = [];
    for (const lines of blocks) {
      const header = lines[0];
      if (header.startsWith("-") || /^(Ability|EVs|IVs|Level):/i.test(header)) { warnings.push(`Skipped a block with no Pokémon name: "${header.slice(0, 40)}"`); continue; }
      const [left, itemRaw] = header.split(/\s@\s/);
      let species = left.replace(/\s*\((M|F)\)\s*$/i, "").trim();
      const nick = species.match(/^(.*)\(([^()]+)\)\s*$/);
      if (nick && nick[2].trim()) species = nick[2].trim();
      const mon = { speciesKey: normalizeId(species), item: itemRaw ? normalizeId(itemRaw) : null, ability: null, level: 100, nature: null, evs: {}, ivs: {}, moves: [] };
      for (const line of lines.slice(1)) {
        let m;
        if ((m = line.match(/^Ability:\s*(.+)$/i))) mon.ability = normalizeId(m[1]);
        else if ((m = line.match(/^Level:\s*(\d+)/i))) mon.level = clampInt(m[1], 1, 100);
        else if ((m = line.match(/^EVs:\s*(.+)$/i))) mon.evs = parseStatSpread(m[1]);
        else if ((m = line.match(/^IVs:\s*(.+)$/i))) mon.ivs = parseStatSpread(m[1]);
        else if ((m = line.match(/^(\w+)\s+Nature$/i))) mon.nature = m[1].toLowerCase();
        else if (line.startsWith("-")) { const mv = normalizeId(line.slice(1).split("/")[0]); if (mv) mon.moves.push(mv); }
        else if (!/^(Shiny|Happiness|Tera Type|Gender|Dynamax Level|Gigantamax|Hidden Power|Nickname):/i.test(line)) warnings.push(`Ignored line: "${line.slice(0, 50)}"`);
      }
      mons.push(mon);
    }
    if (mons.length > SLOT_COUNT) warnings.push(`Only the first ${SLOT_COUNT} Pokémon were used (found ${mons.length}).`);
    return { mons: mons.slice(0, SLOT_COUNT), warnings };
  }

  // ---- JSON import/export ----
  function exportJson(team) {
    return JSON.stringify({
      app: "pokemon-team-synergy", version: STORE_VERSION,
      team: { name: team.name, format: team.format, slots: team.slots.map(serializeSlot) }
    }, null, 2);
  }

  function parseJson(text, isFormatId) {
    let data;
    try { data = JSON.parse(text); } catch (err) { return { error: "That is not valid JSON." }; }
    if (!data || data.app !== "pokemon-team-synergy" || !data.team) return { error: "That JSON is not a Pokémon Team Synergy export." };
    if (typeof data.version !== "number" || data.version > STORE_VERSION) return { error: "This export comes from a newer version of the app." };
    const team = sanitizeTeam({ ...data.team, id: undefined }, isFormatId);
    return team ? { team } : { error: "The export does not contain a usable team." };
  }

  // ---- Validation ----
  const UNCHECKED = [
    "Tier bans, restricted-legendary limits and other official-rule-set bans.",
    "Event-only or egg-move combinations, ability availability per species beyond hidden-ability and generation rules.",
    "Per-generation stat systems before Generation 3, Tera types, Dynamax and Z-moves.",
    "Whether an item can be obtained in the format's specific games: only the generation it was introduced is checked (e.g. Z-Crystals are not flagged in Generation 9)."
  ];

  // slots: team slots. ctx: { format, allowedNames: Set|null, facts: { itemGen, abilityGen, megaStones } }
  function validateTeam(slots, ctx) {
    const { format, allowedNames } = ctx;
    const facts = ctx.facts || {};
    const era = format && format.era ? format.era : null;
    const issues = [];
    const add = (slotIndex, severity, text) => issues.push({ slotIndex, severity, text });
    const filled = slots.map((s, i) => ({ s, i })).filter(x => x.s.name);

    filled.forEach(({ s, i }) => {
      const label = pretty(s.name);
      if (allowedNames && allowedNames.size && !allowedNames.has(s.name)) {
        add(i, "error", `${label} is not allowed in ${format.name}.`);
      }

      // EVs, IVs and level
      if (evTotal(s.evs) > MAX_EV_TOTAL) add(i, "error", `${label} has ${evTotal(s.evs)} EVs; the cap is ${MAX_EV_TOTAL}.`);
      STAT_KEYS.forEach(k => {
        if (s.evs[k] > MAX_EV_STAT) add(i, "error", `${label} has ${s.evs[k]} ${k.toUpperCase()} EVs; the cap is ${MAX_EV_STAT} per stat.`);
        if (s.ivs[k] < 0 || s.ivs[k] > MAX_IV) add(i, "error", `${label} has an invalid ${k.toUpperCase()} IV.`);
      });

      // Ability
      if (!s.ability) {
        if (era === null || era >= 3) add(i, "warning", `${label} has no ability selected.`);
      } else if (s.abilities.length && !s.abilities.includes(s.ability)) {
        add(i, "error", `${label} cannot have ${pretty(s.ability)}; it is not one of its abilities.`);
      } else {
        if (era !== null && era < 3) add(i, "error", `Abilities did not exist in Generation ${era}.`);
        else if (era !== null && era < 5 && s.hiddenAbilities.includes(s.ability)) add(i, "error", `${label}'s ${pretty(s.ability)} is a hidden ability, which is not available before Generation 5.`);
        const gen = facts.abilityGen && facts.abilityGen[s.ability];
        if (era !== null && gen && gen > era) add(i, "error", `${pretty(s.ability)} was introduced in Generation ${gen}, after ${format.name}.`);
      }

      // Item
      if (s.item) {
        if (era !== null && era < 2) add(i, "error", `Held items did not exist in Generation ${era}.`);
        const gen = facts.itemGen && facts.itemGen[s.item];
        if (era !== null && gen && gen > era) add(i, "error", `${pretty(s.item)} was introduced in Generation ${gen}, after ${format.name}.`);
        if (facts.itemList && facts.itemList.size && !facts.itemList.has(s.item)) add(i, "warning", `${pretty(s.item)} is not in the battle item list; it may not be a valid held item.`);
      }
      if (/-(mega|primal)(-|$)/.test(s.name) && facts.megaStones && facts.megaStones.size) {
        const needsOrb = /-primal/.test(s.name);
        if (!needsOrb && !facts.megaStones.has(s.item)) add(i, "warning", `${label} needs its Mega Stone as the held item.`);
      }

      // Moves
      const picked = s.moves.filter(Boolean);
      if (new Set(picked).size !== picked.length) add(i, "error", `${label} has a duplicate move.`);
      if (picked.length < 4) add(i, "warning", `${label} has ${4 - picked.length} empty move slot(s).`);
      if (s.movePool && s.movePool.length) {
        picked.forEach(m => {
          if (!s.movePool.includes(m)) add(i, "error", `${label} cannot learn ${pretty(m)} in ${format && format.name ? format.name : "this format"} (per PokeAPI learnsets).`);
        });
      } else if (picked.length) {
        add(i, "warning", s.dataState === "failed"
          ? `${label}'s learnset could not be loaded, so its moves were not verified.`
          : `${label}'s moves have not been verified against its learnset yet.`);
      }
    });

    // Team-level clauses
    if (format && format.clauses) {
      const speciesCount = new Map();
      const itemCount = new Map();
      filled.forEach(({ s, i }) => {
        const sp = s.species || s.name;
        speciesCount.set(sp, (speciesCount.get(sp) || []).concat(i));
        if (s.item) itemCount.set(s.item, (itemCount.get(s.item) || []).concat(i));
      });
      speciesCount.forEach((idx, sp) => { if (idx.length > 1) add(idx[1], "error", `Species Clause: ${pretty(sp)} appears ${idx.length} times.`); });
      itemCount.forEach((idx, it) => { if (idx.length > 1) add(idx[1], "warning", `Item Clause: ${pretty(it)} is held by ${idx.length} Pokémon.`); });
      if (era !== null && (era === 6 || era === 7)) {
        const megas = filled.filter(({ s }) => /-mega(-|$)/.test(s.name));
        if (megas.length > 1) add(null, "warning", `Only one Pokémon can Mega Evolve per battle; this team has ${megas.length} Mega forms.`);
      }
    }
    if (!filled.length) add(null, "info", "Add a Pokémon to see rule checks.");
    return { issues, errors: issues.filter(x => x.severity === "error").length, warnings: issues.filter(x => x.severity === "warning").length };
  }

  return {
    STORE_VERSION, SLOT_COUNT, UNCHECKED,
    createEmptySlot, sanitizeSlot, serializeSlot, createTeam, sanitizeTeam, sanitizeStore, migrateV1, serializeStore,
    pretty, normalizeId, resolveSpecies, toShowdown, parseShowdown, exportJson, parseJson, validateTeam, cleanName
  };
});
