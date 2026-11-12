const {
  ALL_TYPES, STAT_KEYS, NATURES, MAX_EV_TOTAL, MAX_EV_STAT, MAX_IV,
  calcAllStats, clampInt, evTotal, clampEv,
  coveredTypes, dualTypeCoverage, defensiveSummary, filterPokemon
} = PokeLogic;
const { FORMATS, findFormat } = PokeFormats;

const API = "https://pokeapi.co/api/v2";
const STORAGE_KEY = "pokemonTeamSynergy";
const STORAGE_VERSION = 1;
const FORMAT_KEY = "pokemonTeamSynergyFormat";

const TYPE_COLORS = {
  normal:"#A8A878", fire:"#F08030", water:"#6890F0", electric:"#F8D030",
  grass:"#78C850", ice:"#98D8D8", fighting:"#C03028", poison:"#A040A0",
  ground:"#E0C068", flying:"#A890F0", psychic:"#F85888", bug:"#A8B820",
  rock:"#B8A038", ghost:"#705898", dark:"#705848", steel:"#B8B8D0",
  dragon:"#7038F8", fairy:"#EE99AC"
};

const STATS = [
  { key: "hp", label: "HP" },
  { key: "atk", label: "Atk" },
  { key: "def", label: "Def" },
  { key: "spa", label: "SpA" },
  { key: "spd", label: "SpD" },
  { key: "spe", label: "Spe" }
];

const API_STAT_MAP = { hp:"hp", attack:"atk", defense:"def", "special-attack":"spa", "special-defense":"spd", speed:"spe" };

// Track tab index where -1 is Overview and 0-5 are Pokémon slots
let activeTabIndex = -1;
const teamSlots = Array.from({ length: 6 }, () => createEmptySlot());

let pokemonCache = [];
let itemCache = [];
let loadError = false;
const moveCache = new Map(); // move name -> { type, damageClass } | null (failed)
const loadTokens = new Array(6).fill(0); // guards against stale responses overwriting newer picks

// Selected format; `introducedOnly` narrows Generation formats to that generation's species
let formatChoice = { id: "any", introducedOnly: false };
let listToken = 0; // guards against a slow list load overwriting a newer format choice
let pokemonEntries = null; // [{ name, id }] for every Pokémon and form, fetched once
let generationSpecies = null; // species names per generation, fetched once
const dexSpecies = new Map(); // pokedex name -> species names

// Helper function to return a default blank slot object
function createEmptySlot() {
  return {
    name: null,
    sprite: null,
    types: [],
    ability: null,
    abilities: [],
    item: null,
    level: 100,
    nature: "hardy",
    moves: [null, null, null, null],
    movePool: [],
    stats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 }, // base stats
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
  };
}

// Format raw string names into capitalized titles
function formatName(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/-/g, " ");
}

// API data is untrusted: escape before putting it into HTML
function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

function safeSprite(url) {
  return typeof url === "string" && /^https:\/\//.test(url) ? url : "";
}

function spriteImg(url, size, extra = "") {
  const src = safeSprite(url);
  return src
    ? `<img src="${esc(src)}" style="width:${size}px; height:${size}px; image-rendering:pixelated; ${extra}" alt="" loading="lazy" />`
    : `<div class="tab-icon-placeholder" style="width:${size}px; height:${size}px; ${extra}" aria-hidden="true"></div>`;
}

function setStatus(message) {
  const el = document.getElementById("statusMessage");
  if (el) el.textContent = message;
}

// ---- Persistence (local only, versioned) ----
function saveTeam() {
  try {
    const data = { version: STORAGE_VERSION, teamSlots, activeTabIndex };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) { /* storage unavailable: keep working in memory */ }
}

function loadTeam() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || data.version !== STORAGE_VERSION || !Array.isArray(data.teamSlots)) return;
    data.teamSlots.slice(0, 6).forEach((saved, i) => {
      if (!saved || typeof saved !== "object") return;
      const slot = createEmptySlot();
      if (typeof saved.name === "string") {
        slot.name = saved.name;
        slot.sprite = safeSprite(saved.sprite);
        slot.types = (saved.types || []).filter(t => ALL_TYPES.includes(t));
        slot.abilities = (saved.abilities || []).filter(a => typeof a === "string");
        slot.ability = typeof saved.ability === "string" ? saved.ability : null;
        slot.item = typeof saved.item === "string" ? saved.item : null;
        slot.movePool = (saved.movePool || []).filter(m => typeof m === "string");
        slot.moves = [0, 1, 2, 3].map(j => slot.movePool.includes((saved.moves || [])[j]) ? saved.moves[j] : null);
        slot.level = clampInt(saved.level, 1, 100);
        slot.nature = saved.nature in NATURES ? saved.nature : "hardy";
        STAT_KEYS.forEach(k => {
          slot.stats[k] = clampInt(saved.stats && saved.stats[k], 1, 255);
          slot.ivs[k] = clampInt(saved.ivs && saved.ivs[k], 0, MAX_IV);
          slot.evs[k] = clampInt(saved.evs && saved.evs[k], 0, MAX_EV_STAT);
        });
        if (evTotal(slot.evs) > MAX_EV_TOTAL) STAT_KEYS.forEach(k => { slot.evs[k] = 0; });
      }
      teamSlots[i] = slot;
    });
    if (Number.isInteger(data.activeTabIndex) && data.activeTabIndex >= -1 && data.activeTabIndex < 6) {
      activeTabIndex = data.activeTabIndex;
    }
  } catch (err) { /* corrupt data: start fresh */ }
}

// Any edit makes an existing report out of date: hide it and save
function onTeamEdited() {
  const section = document.getElementById("analysisSection");
  if (section && !section.hidden) {
    section.hidden = true;
    setStatus("Team changed. Run the analysis again to refresh the report.");
  }
  saveTeam();
}

// ---- Network ----
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

// Follow PokeAPI pagination until `next` is null; keep IDs to tell default Pokémon from alternate forms
async function fetchPokemonEntries() {
  const entries = [];
  let url = `${API}/pokemon?limit=500`;
  while (url) {
    const page = await fetchJson(url);
    page.results.forEach(r => entries.push({ name: r.name, id: parseInt(r.url.match(/(\d+)\/?$/)[1], 10) }));
    url = page.next;
  }
  return entries;
}

// Pokémon names available under a format (species-list filter only, not full legality)
async function loadPokemonForFormat(choice) {
  const format = findFormat(choice.id);
  if (!pokemonEntries) pokemonEntries = await fetchPokemonEntries();
  if (!format.gen && !format.dexes) return pokemonEntries.map(e => e.name).sort();

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
  return filterPokemon(pokemonEntries, allSpecies, allowed, format.forms).sort();
}

async function getMoveInfo(name) {
  if (moveCache.has(name) && moveCache.get(name)) return moveCache.get(name);
  try {
    const m = await fetchJson(`${API}/move/${encodeURIComponent(name)}`, 1);
    const info = { type: m.type.name, damageClass: m.damage_class.name };
    moveCache.set(name, info);
    return info;
  } catch (err) {
    moveCache.set(name, null);
    return null;
  }
}

function applyPokemonResponse(slot, name, res) {
  slot.name = name;
  slot.sprite = safeSprite(res.sprites && res.sprites.front_default);
  slot.types = res.types.map(t => t.type.name);
  slot.abilities = res.abilities.map(a => a.ability.name);
  slot.movePool = Array.from(new Set(res.moves.map(m => m.move.name))).sort();
  res.stats.forEach(s => {
    if (API_STAT_MAP[s.stat.name]) slot.stats[API_STAT_MAP[s.stat.name]] = s.base_stat;
  });
}

// Fetch initial data and setup the UI tabs
async function initApp() {
  loadTeam();
  loadFormatChoice();
  renderFormatControls();
  renderTabs();
  renderTabContent();
  await loadLists();
}

async function loadLists() {
  const token = ++listToken;
  loadError = false;
  pokemonCache = [];
  setStatus(`Loading Pokémon for ${formatLabel()} and item lists…`);
  renderTabContent();
  try {
    const [pokemon, holdable] = await Promise.all([
      loadPokemonForFormat(formatChoice),
      itemCache.length ? null : fetchJson(`${API}/item-attribute/holdable`)
    ]);
    if (token !== listToken) return; // the format changed while this was loading
    pokemonCache = pokemon;
    // Only items that can be held in battle, not key items, TMs or bag clutter
    if (holdable) itemCache = holdable.items.map(i => i.name).sort();
    setStatus(outOfFormatWarning());
  } catch (err) {
    if (token !== listToken) return;
    loadError = true;
    setStatus("Could not load the Pokémon database. Check your connection and retry.");
  }
  renderTabContent();
}

// ---- Format selection (saved locally) ----
function loadFormatChoice() {
  try {
    const saved = JSON.parse(localStorage.getItem(FORMAT_KEY));
    if (saved && typeof saved.id === "string") {
      formatChoice = { id: findFormat(saved.id).id, introducedOnly: saved.introducedOnly === true };
    }
  } catch (err) { /* keep the default */ }
}

function saveFormatChoice() {
  try { localStorage.setItem(FORMAT_KEY, JSON.stringify(formatChoice)); } catch (err) { /* in-memory only */ }
}

function formatLabel() {
  const f = findFormat(formatChoice.id);
  return f.gen && formatChoice.introducedOnly ? `${f.name} (introduced that generation only)` : f.name;
}

function outOfFormatWarning() {
  const outside = teamSlots.filter(s => s.name && !pokemonCache.includes(s.name)).map(s => formatName(s.name));
  return outside.length ? `Not in ${formatLabel()}: ${outside.join(", ")}. Replace them or pick another format.` : "";
}

function renderFormatControls() {
  const select = document.getElementById("formatSelect");
  const onlyLabel = document.getElementById("introducedOnlyLabel");
  const onlyBox = document.getElementById("introducedOnly");
  const format = findFormat(formatChoice.id);

  select.innerHTML = "";
  [...new Set(FORMATS.map(f => f.group))].forEach(group => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group;
    FORMATS.filter(f => f.group === group).forEach(f => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name;
      opt.selected = f.id === format.id;
      optgroup.appendChild(opt);
    });
    select.appendChild(optgroup);
  });

  onlyLabel.hidden = !format.gen;
  onlyBox.checked = formatChoice.introducedOnly;
  document.getElementById("formatNote").textContent = format.description;
}

function changeFormat(update) {
  Object.assign(formatChoice, update);
  saveFormatChoice();
  renderFormatControls();
  onTeamEdited(); // an open report was built for the old format
  loadLists();
}

document.getElementById("formatSelect").addEventListener("change", (e) => changeFormat({ id: e.target.value }));
document.getElementById("introducedOnly").addEventListener("change", (e) => changeFormat({ introducedOnly: e.target.checked }));

// Render navigation tab buttons for overview and individual slots
function renderTabs() {
  const tabsContainer = document.getElementById("teamTabs");
  tabsContainer.innerHTML = "";
  tabsContainer.setAttribute("role", "tablist");

  const makeTab = (label, iconHTML, isActive, onSelect) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(isActive));
    btn.className = `tab-btn ${isActive ? "active" : ""}`;
    btn.innerHTML = `${iconHTML} <span>${esc(label)}</span>`;
    btn.onclick = () => { onSelect(); renderTabs(); renderTabContent(); saveTeam(); };
    tabsContainer.appendChild(btn);
  };

  makeTab("Team Overview", "", activeTabIndex === -1, () => { activeTabIndex = -1; });

  teamSlots.forEach((slot, idx) => {
    const safe = safeSprite(slot.sprite);
    const iconHTML = safe
      ? `<img src="${esc(safe)}" class="tab-icon" alt="" />`
      : `<div class="tab-icon-placeholder"></div>`;
    makeTab(slot.name ? formatName(slot.name) : `Slot ${idx + 1}`, iconHTML, activeTabIndex === idx, () => { activeTabIndex = idx; });
  });

  const filledCount = teamSlots.filter(s => s.name).length;
  const counterEl = document.getElementById("slotCounter");
  if (counterEl) counterEl.textContent = `${filledCount}/6 slots filled`;
}

// Switch between overview layout and single slot editor
function renderTabContent() {
  const container = document.getElementById("tabContent");
  container.innerHTML = "";

  if (loadError) {
    const box = document.createElement("div");
    box.setAttribute("role", "alert");
    box.innerHTML = `<p>Could not load the Pokémon database.</p>`;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "submit-button";
    retry.textContent = "Retry";
    retry.onclick = loadLists;
    box.appendChild(retry);
    container.appendChild(box);
    return;
  }

  if (activeTabIndex === -1) {
    renderOverview(container);
  } else {
    renderPokemonEditor(container, activeTabIndex);
  }
}

// Render team grid preview
function renderOverview(container) {
  const grid = document.createElement("div");
  grid.className = "overview-grid";

  teamSlots.forEach((slot, idx) => {
    const card = document.createElement("button");
    card.type = "button";
    card.style.textAlign = "left";
    if (slot.name) {
      card.className = "overview-card";
      card.style.borderTop = `4px solid ${TYPE_COLORS[slot.types[0]] || "var(--accent)"}`;
      const calc = calcAllStats(slot);
      card.innerHTML = `
        <div style="display:flex; justify-content: space-between; align-items:center;">
          <div>
            <strong style="font-size: 16px;">${esc(formatName(slot.name))}</strong>
            <div style="margin-top: 4px;">
              ${slot.types.map(t => `<span class="type-badge" style="background:${TYPE_COLORS[t] || '#777'}">${esc(t)}</span>`).join(" ")}
            </div>
          </div>
          ${spriteImg(slot.sprite, 64)}
        </div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 10px;">
          <div><strong>Lv ${slot.level}</strong> · ${esc(formatName(slot.nature))} · Spe ${calc.spe}</div>
          <div><strong>Item:</strong> ${slot.item ? esc(formatName(slot.item)) : "None"}</div>
          <div><strong>Ability:</strong> ${slot.ability ? esc(formatName(slot.ability)) : "None"}</div>
          <div><strong>Moves:</strong> ${esc(slot.moves.filter(Boolean).map(formatName).join(", ")) || "None"}</div>
        </div>
      `;
    } else {
      card.className = "overview-card empty";
      card.innerHTML = `<span>+ Add Pokémon (Slot ${idx + 1})</span>`;
    }
    card.onclick = () => { activeTabIndex = idx; renderTabs(); renderTabContent(); saveTeam(); };
    grid.appendChild(card);
  });

  container.appendChild(grid);
}

let controlId = 0;

// Reusable dropdown select UI generator
function createDropdown(label, options, selectedValue, onChange) {
  const box = document.createElement("div");
  box.style.marginBottom = "12px";
  const id = `ctl-${++controlId}`;

  const lbl = document.createElement("label");
  lbl.className = "selector-label";
  lbl.htmlFor = id;
  lbl.textContent = label;
  box.appendChild(lbl);

  const select = document.createElement("select");
  select.id = id;
  select.className = "ev-input";
  select.style.cssText = "width: 100%; padding: 10px; font-size: 14px; text-align: left; background: var(--panel); cursor: pointer;";

  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = `-- Select ${label} --`;
  select.appendChild(defaultOpt);

  options.forEach(optVal => {
    const opt = document.createElement("option");
    opt.value = optVal;
    opt.textContent = formatName(optVal);
    if (optVal === selectedValue) opt.selected = true;
    select.appendChild(opt);
  });

  select.onchange = (e) => onChange(e.target.value);
  box.appendChild(select);
  return box;
}

// Rank options for a query: prefix matches first, then word-start, then substring
function searchOptions(options, query, limit = 5) {
  const q = query.trim().toLowerCase().replace(/\s+/g, "-");
  if (!q) return [];
  const scored = [];
  for (const opt of options) {
    const idx = opt.indexOf(q);
    if (idx === -1) continue;
    const rank = idx === 0 ? 0 : opt[idx - 1] === "-" ? 1 : 2;
    scored.push({ opt, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.opt.length - b.opt.length || a.opt.localeCompare(b.opt));
  return scored.slice(0, limit).map(x => x.opt);
}

// Empty text box that suggests the best 5 matches as you type
function createSearchBox(label, options, selectedValue, onChange, clearable = false) {
  const box = document.createElement("div");
  box.style.cssText = "margin-bottom: 12px; position: relative;";
  const id = `ctl-${++controlId}`;
  const listId = `${id}-list`;

  const lbl = document.createElement("label");
  lbl.className = "selector-label";
  lbl.htmlFor = id;
  lbl.textContent = label;
  box.appendChild(lbl);

  const input = document.createElement("input");
  input.id = id;
  input.type = "text";
  input.autocomplete = "off";
  input.className = "ev-input";
  input.placeholder = `Search ${label.toLowerCase()}…`;
  input.style.cssText = "width: 100%; padding: 10px; font-size: 14px; text-align: left; background: var(--panel);";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", listId);
  box.appendChild(input);

  const list = document.createElement("ul");
  list.id = listId;
  list.className = "search-results";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  box.appendChild(list);

  if (selectedValue) {
    const chip = document.createElement("div");
    chip.className = "search-selected";
    chip.appendChild(document.createTextNode(`Selected: ${formatName(selectedValue)}`));
    if (clearable) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "search-clear";
      clear.textContent = "Clear";
      clear.setAttribute("aria-label", `Clear ${label}`);
      clear.onclick = () => onChange("");
      chip.appendChild(clear);
    }
    box.appendChild(chip);
  }

  let matches = [];
  let active = -1;

  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  const choose = (val) => { close(); input.value = ""; onChange(val); };
  const highlight = () => {
    Array.from(list.children).forEach((li, i) => li.classList.toggle("active", i === active));
    if (active >= 0) input.setAttribute("aria-activedescendant", `${listId}-${active}`);
    else input.removeAttribute("aria-activedescendant");
  };

  const refresh = () => {
    matches = searchOptions(options, input.value);
    list.innerHTML = "";
    if (!input.value.trim()) { close(); return; }
    if (matches.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No matches";
      list.appendChild(li);
    }
    matches.forEach((m, i) => {
      const li = document.createElement("li");
      li.id = `${listId}-${i}`;
      li.setAttribute("role", "option");
      li.textContent = formatName(m);
      li.onmousedown = (e) => { e.preventDefault(); choose(m); };
      list.appendChild(li);
    });
    active = matches.length ? 0 : -1;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    highlight();
  };

  input.oninput = refresh;
  input.onblur = close;
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown" && matches.length) { e.preventDefault(); active = (active + 1) % matches.length; highlight(); }
    else if (e.key === "ArrowUp" && matches.length) { e.preventDefault(); active = (active - 1 + matches.length) % matches.length; highlight(); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(matches[active]); }
    else if (e.key === "Escape") { close(); }
  };
  return box;
}

function createNumberField(label, value, min, max, onChange) {
  const box = document.createElement("div");
  const id = `ctl-${++controlId}`;
  box.innerHTML = `
    <label class="selector-label" for="${id}">${esc(label)}</label>
    <input id="${id}" type="number" class="ev-input" style="width:100%; padding:10px;" min="${min}" max="${max}" value="${value}" />
  `;
  const input = box.querySelector("input");
  input.onchange = () => {
    const v = clampInt(input.value, min, max);
    input.value = v;
    onChange(v);
  };
  return box;
}

// Render slot configuration elements for selected Pokémon
function renderPokemonEditor(container, slotIdx) {
  const slot = teamSlots[slotIdx];

  const editor = document.createElement("div");
  editor.className = "pokemon-editor";

  // Render left column for general settings
  const leftCol = document.createElement("div");

  if (pokemonCache.length === 0) {
    const loading = document.createElement("p");
    loading.textContent = "Loading Pokémon list…";
    leftCol.appendChild(loading);
  }

  const pkmnSelect = createSearchBox("Pokémon", pokemonCache, slot.name, (val) => {
    if (val) loadPokemonData(slotIdx, val);
  });
  leftCol.appendChild(pkmnSelect);

  if (slot.name) {
    const preview = document.createElement("div");
    preview.style.cssText = "text-align:center; margin-bottom: 16px;";
    preview.innerHTML = `
      ${spriteImg(slot.sprite, 120, "margin: 0 auto;")}
      <div style="margin-top: 8px;">
        ${slot.types.map(t => `<span class="type-badge" style="background:${TYPE_COLORS[t] || '#777'}">${esc(t)}</span>`).join(" ")}
      </div>
    `;
    leftCol.appendChild(preview);

    leftCol.appendChild(createDropdown("Ability", slot.abilities, slot.ability, (val) => {
      slot.ability = val || null;
      onTeamEdited();
      renderTabContent();
    }));

    leftCol.appendChild(createSearchBox("Item", itemCache, slot.item, (val) => {
      slot.item = val || null;
      onTeamEdited();
      renderTabContent();
    }, true));

    leftCol.appendChild(createNumberField("Level", slot.level, 1, 100, (v) => {
      slot.level = v;
      onTeamEdited();
      renderTabContent();
    }));

    const natureBox = createDropdown("Nature", Object.keys(NATURES), slot.nature, (val) => {
      slot.nature = val || "hardy";
      onTeamEdited();
      renderTabContent();
    });
    const natureNote = document.createElement("div");
    natureNote.style.cssText = "font-size:12px; color: var(--text-muted); margin-top:4px;";
    const nat = NATURES[slot.nature];
    natureNote.textContent = nat ? `+${nat[0].toUpperCase()}, −${nat[1].toUpperCase()}` : "Neutral";
    natureBox.appendChild(natureNote);
    leftCol.appendChild(natureBox);
  }

  // Render right column for movesets and stat EV/IV adjustments
  const rightCol = document.createElement("div");
  if (slot.name) {
    const movesContainer = document.createElement("div");
    movesContainer.innerHTML = `<span class="selector-label">Moveset</span>`;
    const movesGrid = document.createElement("div");
    movesGrid.className = "moves-grid";

    slot.moves.forEach((move, moveIdx) => {
      // Exclude move choices selected in other dropdowns for this slot
      const selectedOtherMoves = slot.moves.filter((m, i) => i !== moveIdx && m !== null);
      const availableMoves = slot.movePool.filter(m => !selectedOtherMoves.includes(m));

      const moveBox = createSearchBox(`Move ${moveIdx + 1}`, availableMoves, move, (val) => {
        slot.moves[moveIdx] = val || null;
        if (val) getMoveInfo(val); // warm the cache for the analysis
        onTeamEdited();
        renderTabContent();
      }, true);
      movesGrid.appendChild(moveBox);
    });
    movesContainer.appendChild(movesGrid);

    const statsContainer = document.createElement("div");
    statsContainer.className = "stat-sliders";
    statsContainer.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
        <span class="selector-label" style="margin:0;">EVs, IVs and calculated stats (Lv ${slot.level})</span>
        <span data-ev-total style="font-size:12px; color:var(--text-faint)"></span>
      </div>
      <div style="display:grid; grid-template-columns: 40px 44px 44px 1fr 64px 56px; gap:6px; font-size:11px; color:var(--text-muted); margin-bottom:4px;" aria-hidden="true">
        <span></span><span>Base</span><span>Calc</span><span>EV</span><span></span><span>IV</span>
      </div>
      <div role="status" aria-live="polite" data-ev-msg style="font-size:12px; color:var(--accent); min-height:16px;"></div>
    `;
    const totalSpan = statsContainer.querySelector("[data-ev-total]");
    const msgEl = statsContainer.querySelector("[data-ev-msg]");

    const refreshTotals = () => {
      totalSpan.textContent = `${evTotal(slot.evs)} / ${MAX_EV_TOTAL} EVs used`;
    };
    refreshTotals();

    const calcCells = {};
    const refreshCalc = () => {
      const calc = calcAllStats(slot);
      STATS.forEach(s => { calcCells[s.key].textContent = calc[s.key]; });
    };

    STATS.forEach(s => {
      const row = document.createElement("div");
      row.className = "stat-row";
      row.style.gridTemplateColumns = "40px 44px 44px 1fr 64px 56px";
      row.innerHTML = `
        <span style="font-weight:600;">${s.label}</span>
        <span title="Base stat">${slot.stats[s.key]}</span>
        <span data-calc style="font-weight:600;" title="Calculated stat"></span>
        <input type="range" class="ev-slider" aria-label="${s.label} EVs" min="0" max="${MAX_EV_STAT}" step="4" value="${slot.evs[s.key]}" />
        <input type="number" class="ev-input" aria-label="${s.label} EVs value" min="0" max="${MAX_EV_STAT}" value="${slot.evs[s.key]}" />
        <input type="number" class="ev-input iv-input" aria-label="${s.label} IVs" min="0" max="${MAX_IV}" value="${slot.ivs[s.key]}" />
      `;
      calcCells[s.key] = row.querySelector("[data-calc]");

      const slider = row.querySelector(".ev-slider");
      const numInput = row.querySelector("input.ev-input:not(.iv-input)");
      const ivInput = row.querySelector(".iv-input");

      const updateEV = (val) => {
        const { value, message } = clampEv(slot.evs, s.key, val);
        slot.evs[s.key] = value;
        slider.value = value;
        numInput.value = value;
        msgEl.textContent = message;
        refreshTotals();
        refreshCalc();
        onTeamEdited();
      };

      slider.oninput = (e) => updateEV(e.target.value);
      numInput.oninput = (e) => { if (e.target.value !== "") updateEV(e.target.value); };
      numInput.onblur = () => updateEV(numInput.value);
      ivInput.onchange = () => {
        slot.ivs[s.key] = clampInt(ivInput.value, 0, MAX_IV);
        ivInput.value = slot.ivs[s.key];
        refreshCalc();
        onTeamEdited();
      };

      statsContainer.appendChild(row);
    });
    refreshCalc();

    rightCol.appendChild(movesContainer);
    rightCol.appendChild(statsContainer);
  }

  editor.appendChild(leftCol);
  editor.appendChild(rightCol);
  container.appendChild(editor);
}

// Fetch Pokémon stats and movepool data from API
async function loadPokemonData(slotIdx, name) {
  const token = ++loadTokens[slotIdx];
  setStatus(`Loading ${formatName(name)}…`);
  try {
    const res = await fetchJson(`${API}/pokemon/${encodeURIComponent(name)}`);
    if (token !== loadTokens[slotIdx]) return; // a newer selection superseded this one

    const slot = createEmptySlot();
    applyPokemonResponse(slot, name, res);
    slot.ability = slot.abilities[0] || null;
    teamSlots[slotIdx] = slot;

    setStatus("");
    onTeamEdited();
    renderTabs();
    renderTabContent();
  } catch (err) {
    if (token !== loadTokens[slotIdx]) return;
    console.error("Failed loading Pokémon details", err);
    setStatus(`Could not load ${formatName(name)}. Pick it again to retry.`);
  }
}

// Generate a randomized team. Species, abilities, moves and items are NOT checked
// against any format's legality rules.
async function generateRandomTeam() {
  if (pokemonCache.length === 0) return;
  if (teamSlots.some(s => s.name) && !confirm("Replace your current team with a random one?")) return;

  const btn = document.getElementById("randomTeamBtn");
  const origText = btn.textContent;
  btn.textContent = "⏳ Generating...";
  btn.disabled = true;

  const chosenNames = [...pokemonCache].sort(() => 0.5 - Math.random()).slice(0, 6);
  const generated = [];
  let failures = 0;

  for (let i = 0; i < 6; i++) {
    const name = chosenNames[i];
    try {
      const res = await fetchJson(`${API}/pokemon/${encodeURIComponent(name)}`);
      const slot = createEmptySlot();
      applyPokemonResponse(slot, name, res);
      slot.ability = slot.abilities[Math.floor(Math.random() * slot.abilities.length)] || null;
      if (itemCache.length > 0) slot.item = itemCache[Math.floor(Math.random() * itemCache.length)];

      const shuffledMoves = [...slot.movePool].sort(() => 0.5 - Math.random());
      slot.moves = [0, 1, 2, 3].map(j => shuffledMoves[j] || null);

      STATS.forEach(s => { slot.ivs[s.key] = Math.floor(Math.random() * 32); });

      let remaining = MAX_EV_TOTAL;
      for (const k of [...STAT_KEYS].sort(() => 0.5 - Math.random())) {
        if (remaining <= 0) break;
        const maxSteps = Math.floor(Math.min(MAX_EV_STAT, remaining) / 4);
        const ev = Math.floor(Math.random() * (maxSteps + 1)) * 4;
        slot.evs[k] = ev;
        remaining -= ev;
      }
      generated.push(slot);
    } catch (err) {
      failures++;
      console.error(`Failed to generate random Pokémon ${name}`, err);
    }
  }

  // Replace only once we know what succeeded; leave unfilled slots empty
  loadTokens.forEach((_, i) => { loadTokens[i]++; });
  for (let i = 0; i < 6; i++) teamSlots[i] = generated[i] || createEmptySlot();

  btn.textContent = origText;
  btn.disabled = false;
  setStatus(failures
    ? `${failures} Pokémon failed to load, so those slots are empty. Random teams are not checked for legality.`
    : "Random team generated. It is not checked for format legality.");
  onTeamEdited();
  renderTabs();
  renderTabContent();
}

// Bind button actions for generation and clear operations
document.getElementById("randomTeamBtn").addEventListener("click", generateRandomTeam);

document.getElementById("clearTeamBtn").addEventListener("click", () => {
  if (!teamSlots.some(s => s.name)) return;
  if (!confirm("Clear all six slots? This cannot be undone.")) return;
  loadTokens.forEach((_, i) => { loadTokens[i]++; });
  for (let i = 0; i < 6; i++) teamSlots[i] = createEmptySlot();
  onTeamEdited();
  renderTabs();
  renderTabContent();
});

// ---- Analysis ----
function pill(t, cls = "") {
  return `<span class="type-pill ${cls}" style="${cls ? "" : `background:${TYPE_COLORS[t] || '#777'}`}">${esc(t)}</span>`;
}

function listItems(entries, fmt, emptyText) {
  return entries.length ? entries.map(fmt).join("") : `<li>${emptyText}</li>`;
}

// Calculate team metrics and render the report
document.getElementById("analyzeBtn").addEventListener("click", async () => {
  const filled = teamSlots.filter(s => s.name);
  if (filled.length < 1) {
    setStatus("Add at least 1 Pokémon to analyze team synergy.");
    return;
  }

  const analyzeBtn = document.getElementById("analyzeBtn");
  analyzeBtn.disabled = true;
  setStatus("Looking up selected moves…");

  // Resolve type and damage class for every selected move
  const selectedMoves = Array.from(new Set(filled.flatMap(s => s.moves.filter(Boolean))));
  await Promise.all(selectedMoves.map(getMoveInfo));
  analyzeBtn.disabled = false;
  setStatus("");

  // Species check against the selected format's list; skipped while that list is unavailable
  const formatChecked = pokemonCache.length > 0;
  const outsideFormat = formatChecked ? filled.filter(s => !pokemonCache.includes(s.name)).map(s => formatName(s.name)) : [];
  document.getElementById("reportFormat").textContent = `Format: ${formatLabel()}`;

  const unresolvedMoves = selectedMoves.filter(m => !moveCache.get(m));
  const damagingTypes = new Set();
  filled.forEach(s => s.moves.filter(Boolean).forEach(m => {
    const info = moveCache.get(m);
    if (info && info.damageClass !== "status") damagingTypes.add(info.type);
  }));

  // Offensive coverage from selected damaging moves (ability/item effects and fixed-damage moves ignored)
  const moveTypes = Array.from(damagingTypes);
  const superEffectiveCovered = coveredTypes(moveTypes);
  const uncoveredTypes = ALL_TYPES.filter(t => !superEffectiveCovered.includes(t));
  const dual = dualTypeCoverage(moveTypes);

  // Defensive summary from types only (abilities and items such as Levitate are not modeled)
  const summary = defensiveSummary(filled);
  const weaknesses = ALL_TYPES.filter(t => summary[t].weak > 0).map(t => [t, summary[t].weak]).sort((a, b) => b[1] - a[1]);
  const resistances = ALL_TYPES.filter(t => summary[t].resist > 0).map(t => [t, summary[t].resist]).sort((a, b) => b[1] - a[1]);
  const immunities = ALL_TYPES.filter(t => summary[t].immune > 0).map(t => [t, summary[t].immune]);

  // Calculated speed at each slot's own level, nature, IVs and EVs
  const speedTiers = filled
    .map(p => ({ name: p.name, level: p.level, spe: calcAllStats(p).spe }))
    .sort((a, b) => b.spe - a.spe);

  // Heuristic component scores (see the explanation under the report)
  const scoreOffensive = Math.round((superEffectiveCovered.length / 18) * 100);
  const scoreCompleteness = Math.round((filled.length / 6) * 100);
  const filledMoveSlots = filled.reduce((a, s) => a + s.moves.filter(Boolean).length, 0);
  const scoreBuild = Math.round((filledMoveSlots / (filled.length * 4)) * 100);
  // Defense: penalize types that hit more members than the team can resist or ignore
  const exposedTypes = ALL_TYPES.filter(t => summary[t].weak >= 2 && summary[t].weak > summary[t].resist + summary[t].immune);
  const scoreDefensive = Math.max(0, 100 - exposedTypes.length * 12);
  const overallScore = Math.round((scoreOffensive + scoreDefensive + scoreCompleteness + scoreBuild) / 4);

  document.getElementById("overallScoreNum").textContent = overallScore;
  document.getElementById("gradeLabel").textContent = "Heuristic score (not a competitive rating)";

  const updateMetric = (barId, valId, score) => {
    const bar = document.getElementById(barId);
    bar.style.width = `${score}%`;
    bar.className = `bar-fill ${score < 40 ? 'red' : ''}`;
    document.getElementById(valId).textContent = score;
  };
  updateMetric("barOffensive", "valOffensive", scoreOffensive);
  updateMetric("barDefensive", "valDefensive", scoreDefensive);
  updateMetric("barCompleteness", "valCompleteness", scoreCompleteness);
  updateMetric("barBuild", "valBuild", scoreBuild);

  // Coverage
  document.getElementById("coverageTitle").textContent = "Offensive Coverage (from selected damaging moves)";
  const covNote = moveTypes.length
    ? `Move types: ${moveTypes.map(formatName).join(", ")}. Also hits ${dual.hit}/${dual.total} dual-type combinations super-effectively.`
    : "No damaging moves selected yet, so there is no coverage to show.";
  document.getElementById("superEffectiveText").textContent = `Types hit super-effectively (${superEffectiveCovered.length}/18). ${covNote}`;
  document.getElementById("coveredTypesGrid").innerHTML = superEffectiveCovered.map(t => pill(t)).join("");
  document.getElementById("uncoveredTypesGrid").innerHTML = uncoveredTypes.map(t => pill(t, "uncovered")).join("");

  // Defense
  document.getElementById("weaknessesList").innerHTML = listItems(weaknesses,
    ([t, n]) => `<li>${esc(formatName(t))} — ${n} member${n > 1 ? 's' : ''} weak</li>`, "No type weaknesses.");
  document.getElementById("resistancesList").innerHTML = listItems(resistances,
    ([t, n]) => `<li>${esc(formatName(t))} — ${n} member${n > 1 ? 's' : ''} resist</li>`, "No type resistances.");
  document.getElementById("immunitiesList").innerHTML = listItems(immunities,
    ([t, n]) => `<li>${esc(formatName(t))} — ${n} member${n > 1 ? 's' : ''} immune</li>`, "No type immunities.");

  document.getElementById("speedTiersList").innerHTML = speedTiers.map(st =>
    `<li>${esc(formatName(st.name))} — ${st.spe} Spe (Lv ${st.level})</li>`).join("");

  // Observations (rule-based, from the facts above)
  const recommendations = [];

  if (outsideFormat.length) {
    recommendations.push({ priority: "high", text: `Not in ${formatLabel()}: ${outsideFormat.join(", ")}.` });
  }
  if (!formatChecked) {
    recommendations.push({ priority: "medium", text: "The format's Pokémon list has not loaded, so the team was not checked against it." });
  }

  if (filled.length < 6) {
    recommendations.push({ priority: "high", text: `Only ${filled.length}/6 slots are filled.` });
  }
  weaknesses.forEach(([type, count]) => {
    if (count >= 3) {
      recommendations.push({
        priority: "high",
        text: `${count} Pokémon are weak to ${formatName(type)} (${summary[type].resist + summary[type].immune} resist or are immune by type).`
      });
    }
  });
  const unresisted = ALL_TYPES.filter(t => summary[t].resist + summary[t].immune === 0);
  if (unresisted.length >= 4) {
    recommendations.push({
      priority: "medium",
      text: `No member resists or is immune to ${unresisted.slice(0, 6).map(formatName).join(", ")}${unresisted.length > 6 ? ", …" : ""} by type.`
    });
  }
  if (moveTypes.length && uncoveredTypes.length > 0) {
    recommendations.push({
      priority: "medium",
      text: `Selected damaging moves do not hit ${uncoveredTypes.slice(0, 6).map(formatName).join(", ")}${uncoveredTypes.length > 6 ? ", …" : ""} super-effectively.`
    });
  }
  if (unresolvedMoves.length) {
    recommendations.push({
      priority: "medium",
      text: `Could not look up ${unresolvedMoves.map(formatName).join(", ")}; they are excluded from coverage.`
    });
  }

  filled.forEach(slot => {
    const name = formatName(slot.name);
    const picked = slot.moves.filter(Boolean);
    if (picked.length < 4) {
      recommendations.push({ priority: "high", text: `${name} has ${4 - picked.length} empty move slot(s).` });
    } else {
      const infos = picked.map(m => moveCache.get(m));
      if (infos.every(i => i && i.damageClass !== "status")) {
        recommendations.push({ priority: "low", text: `${name} runs four damaging moves and no status move. That can be fine for some sets.` });
      }
    }

    const nat = NATURES[slot.nature];
    if (nat && slot.evs[nat[1]] > 0) {
      recommendations.push({
        priority: "low",
        text: `${name}'s ${formatName(slot.nature)} nature lowers ${nat[1].toUpperCase()}, but ${slot.evs[nat[1]]} EVs are invested there.`
      });
    }
    if (!slot.ability) recommendations.push({ priority: "medium", text: `${name} has no ability selected.` });
    if (!slot.item) recommendations.push({ priority: "low", text: `${name} has no held item.` });
  });

  if (recommendations.length === 0) {
    recommendations.push({ priority: "low", text: "No issues found by these checks. They cover types, move types and set completeness only, not matchups or format rules." });
  }

  const priorityOrder = { high: 1, medium: 2, low: 3 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const recsContainer = document.getElementById("recommendationsList");
  recsContainer.innerHTML = recommendations.map(rec => `
    <div class="rec-card">
      <span class="rec-badge ${rec.priority}">● ${rec.priority.toUpperCase()}</span>
      <div class="rec-desc">${esc(rec.text)}</div>
    </div>`).join("");

  const section = document.getElementById("analysisSection");
  section.hidden = false;
  section.scrollIntoView({ behavior: "smooth" });
});

// Initialize Application
initApp();
