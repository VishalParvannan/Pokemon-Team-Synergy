// App controller: state, persistence, team management, editor rendering, validation and analysis flow.
// Calculations live in logic.js / team.js / analysis.js, network access in api.js, widgets in controls.js.
const { ALL_TYPES, STAT_KEYS, NATURES, MAX_EV_TOTAL, MAX_EV_STAT, MAX_IV, calcAllStats, clampInt, evTotal, clampEv } = PokeLogic;
const { FORMATS, findFormat } = PokeFormats;
const { esc, spriteImg, typeBadge, setStatus, createDropdown, createSearchBox, createNumberField, formatName } = UI;

const STORE_KEY = "pokemonTeamSynergy.v2";
const LEGACY_TEAM_KEY = "pokemonTeamSynergy";
const LEGACY_FORMAT_KEY = "pokemonTeamSynergyFormat";

const STATS = [
  { key: "hp", label: "HP" }, { key: "atk", label: "Atk" }, { key: "def", label: "Def" },
  { key: "spa", label: "SpA" }, { key: "spd", label: "SpD" }, { key: "spe", label: "Spe" }
];

// ---- State ----
let store = null; // { version, activeTeamId, teams: [...] }
let team = null; // the active team (an element of store.teams)
let pokemonCache = []; // names allowed by the team's format
let pokemonSet = new Set();
let itemCache = [];
let megaStones = new Set();
let specialistItems = new Set(); // species- or gimmick-specific items, skipped by the randomizer
let loadError = false;
let listToken = 0; // a slow list load must not overwrite a newer format choice
let validationToken = 0;
let lastValidation = { issues: [], errors: 0, warnings: 0 };
const loadTokens = new Array(6).fill(0); // a slow Pokémon load must not overwrite a newer pick
let validationTimer = null;
let storageWarned = false;
let undoAction = null;

const isFormatId = (id) => FORMATS.some(f => f.id === id);
const slots = () => team.slots;
const currentFormat = () => findFormat(team.format.id);
// A slot's types in the current format's generation (e.g. Clefable is Normal before Gen 6)
const eraTypes = (slot) => PokeLogic.typesInGen(slot.types, slot.pastTypes, currentFormat().era);

// ---- Persistence (local only, versioned; the old single-team keys are read but never deleted) ----
function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = PokeTeam.sanitizeStore(JSON.parse(raw), isFormatId);
      if (s) return s;
    }
  } catch (err) { /* corrupt data: fall through to migration or a fresh start */ }
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_TEAM_KEY));
    let legacyFormat = null;
    try { legacyFormat = JSON.parse(localStorage.getItem(LEGACY_FORMAT_KEY)); } catch (err) { /* ignore */ }
    const migrated = PokeTeam.migrateV1(legacy, legacyFormat, isFormatId);
    if (migrated) return migrated;
  } catch (err) { /* nothing to migrate */ }
  const first = PokeTeam.createTeam("Team 1");
  return { version: PokeTeam.STORE_VERSION, activeTeamId: first.id, teams: [first] };
}

function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(PokeTeam.serializeStore(store)));
  } catch (err) {
    if (!storageWarned) { storageWarned = true; setStatus("Could not save to this browser (storage is full or disabled). Your team lives in memory only; use Export to keep it."); }
  }
}

function setActiveTeam(id) {
  team = store.teams.find(t => t.id === id) || store.teams[0];
  store.activeTeamId = team.id;
  loadTokens.forEach((_, i) => { loadTokens[i]++; });
  hideReport();
}

function hideReport() {
  const section = document.getElementById("analysisSection");
  if (section) section.hidden = true;
}

// Any edit makes an existing report out of date: hide it, save and re-check the rules
function onTeamEdited() {
  const section = document.getElementById("analysisSection");
  if (section && !section.hidden) {
    section.hidden = true;
    setStatus("Team changed. Run the analysis again to refresh the report.");
  }
  saveStore();
  scheduleValidation();
}

function renderAll() {
  renderTeamBar();
  renderFormatControls();
  renderTabs();
  renderTabContent();
  renderUndo();
  scheduleValidation();
}

// ---- Undo for destructive actions ----
function offerUndo(label, restore) {
  undoAction = { label, restore };
  renderUndo();
}
function renderUndo() {
  const btn = document.getElementById("undoBtn");
  btn.hidden = !undoAction;
  if (undoAction) btn.textContent = `↶ Undo: ${undoAction.label}`;
}
document.getElementById("undoBtn").addEventListener("click", () => {
  if (!undoAction) return;
  const { restore, label } = undoAction;
  undoAction = null;
  restore();
  saveStore();
  renderAll();
  hydrateTeam();
  setStatus(`Undid: ${label}.`);
});

// ---- Pokémon data on slots ----
function applyParsed(slot, parsed) {
  slot.species = parsed.species;
  slot.sprite = parsed.sprite;
  slot.types = parsed.types.filter(t => ALL_TYPES.includes(t));
  slot.pastTypes = parsed.pastTypes || [];
  slot.abilities = parsed.abilities.map(a => a.name);
  slot.hiddenAbilities = parsed.abilities.filter(a => a.hidden).map(a => a.name);
  STAT_KEYS.forEach(k => { if (parsed.stats[k]) slot.stats[k] = parsed.stats[k]; });
  slot.learn = parsed.learn;
  slot.dataState = "ready";
  recomputePool(slot);
}

function recomputePool(slot) {
  slot.movePool = slot.learn ? PokeApi.poolForFormat(slot.learn, currentFormat().versionGroups) : [];
}

// Reload species data (learnsets are not saved) for every filled slot
function hydrateTeam() {
  const t = team;
  return Promise.allSettled(slots().map((slot, i) => {
    if (!slot.name || slot.learn || slot.dataState === "loading") return null;
    slot.dataState = "loading";
    return PokeApi.getPokemon(slot.name).then(parsed => {
      if (team !== t || t.slots[i] !== slot) return;
      applyParsed(slot, parsed);
    }).catch(() => {
      if (team === t && t.slots[i] === slot) slot.dataState = "failed";
    }).finally(() => {
      if (team !== t) return;
      renderTabs();
      renderTabContent();
      scheduleValidation();
    });
  }));
}

// ---- Lists (Pokémon by format, battle items) ----
// Startup timings (ms since navigation) and network counters, readable as window.appPerf
const appPerf = { listsReadyMs: null, teamReadyMs: null, readyMs: null, network: PokeApi.stats };
window.appPerf = appPerf;
const sinceStart = () => Math.round(performance.now());

async function initApp() {
  store = loadStore();
  setActiveTeam(store.activeTeamId);
  const shareNotice = await openSharedTeam();
  const hydrated = hydrateTeam(); // marks slots as loading before the first render
  DamagePanel.init({
    getSlots: () => slots(),
    getGenNum: () => currentFormat().era || 9,
    getPokemonList: () => pokemonCache,
    isDoubles: () => isDoubles()
  });
  renderAll();
  await Promise.all([
    hydrated.then(() => { appPerf.teamReadyMs = sinceStart(); }),
    loadLists().then(() => { appPerf.listsReadyMs = sinceStart(); })
  ]);
  appPerf.readyMs = sinceStart();
  performance.mark("app-ready");
  if (shareNotice && !loadError) setStatus(shareNotice); // shown after loading so the loading message doesn't replace it
}

async function loadLists() {
  const token = ++listToken;
  loadError = false;
  pokemonCache = [];
  pokemonSet = new Set();
  setStatus(`Loading Pokémon for ${formatLabel()} and item lists…`);
  renderTabContent();
  try {
    const [pokemon, items] = await Promise.all([
      PokeApi.loadPokemonForFormat(team.format),
      itemCache.length ? null : PokeApi.loadItems()
    ]);
    if (token !== listToken) return; // the format or team changed while this was loading
    pokemonCache = pokemon;
    pokemonSet = new Set(pokemon);
    if (items) { itemCache = items.items; megaStones = new Set(items.megaStones); specialistItems = new Set(items.specialist); }
    setStatus("");
  } catch (err) {
    if (token !== listToken) return;
    loadError = true;
    setStatus("Could not load the Pokémon database. Check your connection and retry.");
  }
  renderTabContent();
  scheduleValidation();
}

// ---- Format selection ----
function formatLabel() {
  const f = currentFormat();
  return f.gen && team.format.introducedOnly ? `${f.name} (introduced that generation only)` : f.name;
}

function renderFormatControls() {
  const select = document.getElementById("formatSelect");
  const onlyLabel = document.getElementById("introducedOnlyLabel");
  const onlyBox = document.getElementById("introducedOnly");
  const format = currentFormat();

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
  onlyBox.checked = team.format.introducedOnly;
  document.getElementById("battleStyle").value = team.format.doubles ? "doubles" : "singles";
  document.getElementById("formatNote").textContent = format.description;
}

function changeFormat(update) {
  Object.assign(team.format, update);
  slots().forEach(recomputePool);
  renderFormatControls();
  onTeamEdited();
  renderTabs();
  loadLists();
}
document.getElementById("formatSelect").addEventListener("change", (e) => changeFormat({ id: e.target.value }));
document.getElementById("introducedOnly").addEventListener("change", (e) => changeFormat({ introducedOnly: e.target.checked }));
document.getElementById("battleStyle").addEventListener("change", (e) => {
  team.format.doubles = e.target.value === "doubles";
  onTeamEdited(); // the report's roles, score and threats depend on the battle style
  setStatus(team.format.doubles
    ? "Doubles: the report now checks doubles roles (speed control, Fake Out, Protect, spread moves) and Gen 9 Doubles OU threats."
    : "Singles: the report checks singles roles (hazards, removal, pivoting) and the format's OU threats.");
});

// ---- Team management ----
function renderTeamBar() {
  const select = document.getElementById("teamSelect");
  select.innerHTML = "";
  store.teams.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = `${t.name} (${t.slots.filter(s => s.name).length}/6)`;
    opt.selected = t.id === team.id;
    select.appendChild(opt);
  });
  document.getElementById("deleteTeamBtn").disabled = store.teams.length <= 1;
}

function switchTeam(id) {
  if (id === team.id) return;
  const formatChanged = store.teams.find(t => t.id === id).format.id !== team.format.id || store.teams.find(t => t.id === id).format.introducedOnly !== team.format.introducedOnly;
  setActiveTeam(id);
  undoAction = null;
  saveStore();
  renderAll();
  hydrateTeam();
  if (formatChanged || !pokemonCache.length) loadLists();
}

function addTeam(newTeam) {
  store.teams.push(newTeam);
  switchTeam(newTeam.id);
}

document.getElementById("teamSelect").addEventListener("change", (e) => switchTeam(e.target.value));
document.getElementById("newTeamBtn").addEventListener("click", () => {
  addTeam(PokeTeam.createTeam(`Team ${store.teams.length + 1}`, team.format));
});
document.getElementById("dupTeamBtn").addEventListener("click", () => {
  const copy = PokeTeam.sanitizeTeam({ name: `${team.name} copy`, format: team.format, activeTab: team.activeTab, slots: team.slots.map(PokeTeam.serializeSlot) }, isFormatId);
  addTeam(copy); // sanitizeTeam assigns a fresh id because none is passed
});
document.getElementById("renameTeamBtn").addEventListener("click", () => {
  const name = PokeTeam.cleanName(prompt("Team name:", team.name));
  if (!name) return;
  team.name = name;
  saveStore();
  renderTeamBar();
});
document.getElementById("deleteTeamBtn").addEventListener("click", () => {
  if (store.teams.length <= 1) return;
  if (!confirm(`Delete "${team.name}"? You can undo this right after.`)) return;
  const removed = team;
  const index = store.teams.indexOf(team);
  store.teams.splice(index, 1);
  setActiveTeam(store.teams[Math.min(index, store.teams.length - 1)].id);
  saveStore();
  renderAll();
  hydrateTeam();
  loadLists();
  offerUndo(`deleted "${removed.name}"`, () => {
    store.teams.splice(Math.min(index, store.teams.length), 0, removed);
    setActiveTeam(removed.id);
    loadLists();
  });
});

// ---- Tabs ----
function renderTabs() {
  const tabsContainer = document.getElementById("teamTabs");
  tabsContainer.innerHTML = "";
  const entries = [{ index: -1, label: "Team Overview", icon: "" }].concat(slots().map((slot, idx) => ({
    index: idx,
    label: slot.name ? formatName(slot.name) : `Slot ${idx + 1}`,
    icon: UI.safeSprite(slot.sprite) ? `<img src="${esc(slot.sprite)}" class="tab-icon" alt="" />` : `<div class="tab-icon-placeholder"></div>`
  })));

  const select = (index) => { team.activeTab = index; renderTabs(); renderTabContent(); saveStore(); };
  entries.forEach((entry, pos) => {
    const active = team.activeTab === entry.index;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = `tab-${entry.index}`;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(active));
    btn.setAttribute("aria-controls", "tabContent");
    btn.tabIndex = active ? 0 : -1;
    btn.className = `tab-btn ${active ? "active" : ""}`;
    btn.innerHTML = `${entry.icon} <span>${esc(entry.label)}</span>`;
    btn.onclick = () => select(entry.index);
    btn.onkeydown = (e) => {
      let target = null;
      if (e.key === "ArrowRight") target = (pos + 1) % entries.length;
      else if (e.key === "ArrowLeft") target = (pos - 1 + entries.length) % entries.length;
      else if (e.key === "Home") target = 0;
      else if (e.key === "End") target = entries.length - 1;
      if (target === null) return;
      e.preventDefault();
      select(entries[target].index);
      document.getElementById(`tab-${entries[target].index}`).focus();
    };
    tabsContainer.appendChild(btn);
  });
  document.getElementById("tabContent").setAttribute("aria-labelledby", `tab-${team.activeTab}`);
  document.getElementById("slotCounter").textContent = `${slots().filter(s => s.name).length}/6 slots filled`;
  renderTeamBar();
}

function renderTabContent() {
  const container = document.getElementById("tabContent");
  container.innerHTML = "";

  if (loadError) {
    const box = document.createElement("div");
    box.setAttribute("role", "alert");
    box.innerHTML = `<p>Could not load the Pokémon database. Your saved team is still available above.</p>`;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "submit-button";
    retry.textContent = "Retry";
    retry.onclick = loadLists;
    box.appendChild(retry);
    container.appendChild(box);
    return;
  }
  if (team.activeTab === -1) renderOverview(container);
  else renderPokemonEditor(container, team.activeTab);
}

function slotIssueBadge(idx) {
  const mine = lastValidation.issues.filter(i => i.slotIndex === idx);
  const errors = mine.filter(i => i.severity === "error").length;
  const warns = mine.filter(i => i.severity === "warning").length;
  if (errors) return `<span class="issue-badge error">${errors} problem${errors > 1 ? "s" : ""}</span>`;
  if (warns) return `<span class="issue-badge warning">${warns} warning${warns > 1 ? "s" : ""}</span>`;
  return "";
}

function renderOverview(container) {
  const grid = document.createElement("div");
  grid.className = "overview-grid";
  slots().forEach((slot, idx) => {
    const card = document.createElement("button");
    card.type = "button";
    if (slot.name) {
      card.className = "overview-card";
      card.style.borderTop = `4px solid ${UI.TYPE_COLORS[slot.types[0]] || "var(--accent)"}`;
      const calc = calcAllStats(slot);
      card.innerHTML = `
        <div class="card-head">
          <div>
            <strong>${esc(formatName(slot.name))}</strong> ${slotIssueBadge(idx)}
            <div class="card-types">${eraTypes(slot).map(typeBadge).join(" ")}</div>
          </div>
          ${spriteImg(slot.sprite, 64)}
        </div>
        <div class="card-body">
          <div><strong>Lv ${slot.level}</strong> · ${esc(formatName(slot.nature))} · Spe ${calc.spe}</div>
          <div><strong>Item:</strong> ${slot.item ? esc(formatName(slot.item)) : "None"}</div>
          <div><strong>Ability:</strong> ${slot.ability ? esc(formatName(slot.ability)) : "None"}</div>
          <div><strong>Moves:</strong> ${esc(slot.moves.filter(Boolean).map(formatName).join(", ")) || "None"}</div>
        </div>`;
    } else {
      card.className = "overview-card empty";
      card.innerHTML = `<span>+ Add Pokémon (Slot ${idx + 1})</span>`;
    }
    card.onclick = () => { team.activeTab = idx; renderTabs(); renderTabContent(); saveStore(); };
    grid.appendChild(card);
  });
  container.appendChild(grid);
}

// ---- Editor ----
function renderPokemonEditor(container, slotIdx) {
  const slot = slots()[slotIdx];
  const era = currentFormat().era;
  const editor = document.createElement("div");
  editor.className = "pokemon-editor";

  const leftCol = document.createElement("div");
  if (pokemonCache.length === 0) {
    const loading = document.createElement("p");
    loading.className = "field-hint";
    loading.textContent = "Loading Pokémon list…";
    leftCol.appendChild(loading);
  }
  leftCol.appendChild(createSearchBox("Pokémon", pokemonCache, slot.name, (val) => { if (val) loadPokemonData(slotIdx, val); }, false,
    currentFormat().id === "any" ? "" : `Limited to ${formatLabel()}. Forms such as Mega or regional variants appear when the format allows them.`));

  if (slot.name) {
    const preview = document.createElement("div");
    preview.className = "preview";
    preview.innerHTML = `${spriteImg(slot.sprite, 120, "margin: 0 auto;")}<div class="card-types">${eraTypes(slot).map(typeBadge).join(" ")}</div>
      ${slot.species && slot.species !== slot.name ? `<div class="field-hint">Form of ${esc(formatName(slot.species))}</div>` : ""}`;
    leftCol.appendChild(preview);

    leftCol.appendChild(createDropdown("Ability", slot.abilities, slot.ability, (val) => { slot.ability = val || null; onTeamEdited(); renderTabContent(); }, { hidden: slot.hiddenAbilities }));
    leftCol.appendChild(createSearchBox("Item", itemCache, slot.item, (val) => { slot.item = val || null; onTeamEdited(); renderTabContent(); }, true,
      itemCache.length ? "Battle items only (held items, berries, stones, plates, orbs)." : "Item list is still loading."));
    leftCol.appendChild(createNumberField("Level", slot.level, 1, 100, (v) => { slot.level = v; onTeamEdited(); renderTabContent(); }));

    const natureBox = createDropdown("Nature", Object.keys(NATURES), slot.nature, (val) => { slot.nature = val || "hardy"; onTeamEdited(); renderTabContent(); });
    const natureNote = document.createElement("div");
    natureNote.className = "field-hint";
    const nat = NATURES[slot.nature];
    natureNote.textContent = nat ? `+${nat[0].toUpperCase()}, −${nat[1].toUpperCase()}` : "Neutral";
    natureBox.appendChild(natureNote);
    leftCol.appendChild(natureBox);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "link-button";
    del.textContent = "Remove from team";
    del.onclick = () => {
      const snapshot = PokeTeam.serializeSlot(slot);
      loadTokens[slotIdx]++;
      slots()[slotIdx] = PokeTeam.createEmptySlot();
      onTeamEdited();
      renderTabs();
      renderTabContent();
      const t = team;
      offerUndo(`removed ${formatName(snapshot.name)}`, () => { t.slots[slotIdx] = PokeTeam.sanitizeSlot(snapshot); });
    };
    leftCol.appendChild(del);
  }

  const rightCol = document.createElement("div");
  if (slot.name) {
    const movesContainer = document.createElement("div");
    movesContainer.innerHTML = `<span class="selector-label">Moveset</span>`;
    const stateNote = document.createElement("p");
    stateNote.className = "field-hint";
    if (slot.dataState === "loading" || (!slot.learn && slot.dataState !== "failed")) stateNote.textContent = "Loading this Pokémon's move data…";
    else if (slot.dataState === "failed") stateNote.textContent = "Move data could not be loaded. Check your connection, then reselect the Pokémon.";
    else if (era !== null) stateNote.textContent = `Moves are limited to what ${formatName(slot.name)} can learn in ${currentFormat().name} games (${slot.movePool.length} moves).`;
    movesContainer.appendChild(stateNote);

    const movesGrid = document.createElement("div");
    movesGrid.className = "moves-grid";
    slot.moves.forEach((move, moveIdx) => {
      const others = slot.moves.filter((m, i) => i !== moveIdx && m !== null);
      const available = slot.movePool.filter(m => !others.includes(m));
      movesGrid.appendChild(createSearchBox(`Move ${moveIdx + 1}`, available, move, (val) => {
        slot.moves[moveIdx] = val || null;
        if (val) PokeApi.getMoveInfo(val);
        onTeamEdited();
        renderTabContent();
      }, true));
    });
    movesContainer.appendChild(movesGrid);

    const statsContainer = document.createElement("div");
    statsContainer.className = "stat-sliders";
    statsContainer.innerHTML = `
      <div class="stats-head">
        <span class="selector-label">EVs, IVs and calculated stats (Lv ${slot.level})</span>
        <span data-ev-total class="ev-total"></span>
      </div>
      <div class="stat-row stat-head" aria-hidden="true">
        <span></span><span>Base</span><span>Calc</span><span>EV</span><span></span><span>IV</span>
      </div>
      <div role="status" aria-live="polite" data-ev-msg class="ev-msg"></div>`;
    const totalSpan = statsContainer.querySelector("[data-ev-total]");
    const msgEl = statsContainer.querySelector("[data-ev-msg]");
    const refreshTotals = () => { totalSpan.textContent = `${evTotal(slot.evs)} / ${MAX_EV_TOTAL} EVs used`; };
    refreshTotals();

    const calcCells = {};
    const refreshCalc = () => {
      const calc = calcAllStats(slot);
      STATS.forEach(s => { calcCells[s.key].textContent = calc[s.key]; });
    };

    STATS.forEach(s => {
      const row = document.createElement("div");
      row.className = "stat-row";
      row.innerHTML = `
        <span class="stat-name">${s.label}</span>
        <span title="Base stat">${slot.stats[s.key]}</span>
        <span data-calc class="stat-calc" title="Calculated stat"></span>
        <input type="range" class="ev-slider" aria-label="${s.label} EVs slider" min="0" max="${MAX_EV_STAT}" step="4" value="${slot.evs[s.key]}" />
        <input type="number" class="ev-input" aria-label="${s.label} EVs" min="0" max="${MAX_EV_STAT}" value="${slot.evs[s.key]}" />
        <input type="number" class="ev-input iv-input" aria-label="${s.label} IVs" min="0" max="${MAX_IV}" value="${slot.ivs[s.key]}" />`;
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

function newSlotFrom(name, parsed) {
  const slot = PokeTeam.createEmptySlot();
  slot.name = name;
  applyParsed(slot, parsed);
  const visible = slot.abilities.filter(a => !slot.hiddenAbilities.includes(a));
  slot.ability = visible[0] || slot.abilities[0] || null;
  return slot;
}

async function loadPokemonData(slotIdx, name) {
  const token = ++loadTokens[slotIdx];
  const t = team;
  setStatus(`Loading ${formatName(name)}…`);
  try {
    const parsed = await PokeApi.getPokemon(name);
    if (token !== loadTokens[slotIdx] || team !== t) return; // superseded by a newer selection
    t.slots[slotIdx] = newSlotFrom(name, parsed);
    setStatus("");
    onTeamEdited();
    renderTabs();
    renderTabContent();
  } catch (err) {
    if (token !== loadTokens[slotIdx] || team !== t) return;
    console.error("Failed loading Pokémon details", err);
    setStatus(`Could not load ${formatName(name)}. Pick it again to retry.`);
  }
}

// ---- Random team: drawn from the format's species and learnsets, then run through the same rule checks ----
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffled = (arr) => [...arr].sort(() => 0.5 - Math.random());

// Battle-only transformations need a specific item or mechanic, so random teams use the base form instead
// (Mega/Primal/Gigantamax, Zen Mode, Terastal, Ultra Necrozma, Crowned, Aegislash Blade, Schooling, etc.)
const BATTLE_ONLY_FORM = /-(mega|primal|gmax|eternamax|zen|terastal|stellar|ultra|crowned|blade|school|pirouette|noice|hangry|busted|gulping|gorging|sunshine|complete|hero|totem)(-|$)/;
const MAX_RANDOM_CANDIDATES = 60;
const MOVE_SAMPLE = 40; // attacks looked up per Pokémon when building a random set

async function generateRandomTeam() {
  if (pokemonCache.length === 0) {
    setStatus(loadError
      ? "The Pokémon list did not load, so a random team cannot be drawn. Use Retry first."
      : `The Pokémon list for ${formatLabel()} is still loading. Try again in a moment.`);
    return;
  }
  const t = team;
  const format = currentFormat();
  const formatKey = JSON.stringify(t.format);
  const label = formatLabel();
  const pool = pokemonCache.slice(); // snapshot of the species allowed by this format
  const allowed = new Set(pool);
  const stillSameFormat = () => team === t && JSON.stringify(t.format) === formatKey;

  const btn = document.getElementById("randomTeamBtn");
  const origText = btn.textContent;
  btn.textContent = "⏳ Generating…";
  btn.disabled = true;
  setStatus(format.id === "any" ? "Drawing a random team from all Pokémon…" : `Drawing a random team from ${label}…`);
  const era = format.era;
  const previous = t.slots.map(PokeTeam.serializeSlot);

  // Evolution data (for Eviolite) comes from the calculator bundle; random teams work without it
  let speciesLookup = null;
  try {
    await CalcLoader.ensure();
    if (window.PokeDamage) speciesLookup = (n) => window.PokeDamage.speciesInfo(era || 9, n);
  } catch (err) { /* no Eviolite in random sets */ }

  const generated = [];
  const usedSpecies = new Set();
  const usedItems = new Set();
  let failures = 0;
  const candidates = shuffled(pool.filter(n => !BATTLE_ONLY_FORM.test(n))).slice(0, MAX_RANDOM_CANDIDATES);
  for (let c = 0; c < candidates.length && generated.length < 6 && failures < 8; c++) {
    if (!stillSameFormat()) break;
    const name = candidates[c];
    try {
      const parsed = await PokeApi.getPokemon(name);
      if (usedSpecies.has(parsed.species)) continue;
      const slot = newSlotFrom(name, parsed);
      if (!slot.movePool.length) continue; // no learnset in this format's games: skip rather than build an unverifiable set

      // Ability: one this species can have, none before Gen 3, no hidden abilities before Gen 5,
      // none introduced after the format's generation; abilities that hold it back only as a last resort
      slot.ability = null;
      if (era === null || era >= 3) {
        const legal = slot.abilities.filter(a => era === null || era >= 5 || !slot.hiddenAbilities.includes(a));
        const ordered = [...shuffled(legal.filter(a => !PokeViability.HANDICAP_ABILITIES.includes(a))), ...legal.filter(a => PokeViability.HANDICAP_ABILITIES.includes(a))];
        for (const a of ordered) {
          const gen = era === null ? null : await PokeApi.getAbilityGeneration(a);
          if (gen && gen > era) continue;
          slot.ability = a;
          break;
        }
      }
      // Moves: a strong same-type attack, coverage and useful utility, from what it learns in this format.
      // Move data is fetched for the recognised utility moves plus a sample of the rest (cached after the first time).
      const utilityNames = new Set([...PokeViability.GOOD_STATUS_SINGLES, ...PokeViability.GOOD_STATUS_DOUBLES]);
      const sample = [...slot.movePool.filter(n => utilityNames.has(n)),
        ...shuffled(slot.movePool.filter(n => !utilityNames.has(n) && !PokeViability.BAD_ATTACKS.has(n))).slice(0, MOVE_SAMPLE)];
      const moveData = {};
      await Promise.all(sample.map(async n => { const mi = await PokeApi.getMoveInfo(n); if (mi) moveData[n] = mi; }));
      const picked = PokeViability.pickRandomMoves(sample, moveData, { types: eraTypes(slot), stats: slot.stats }, { doubles: !!t.format.doubles, gen: era });
      slot.moves = [0, 1, 2, 3].map(j => picked.moves[j] || null);

      // Item: none in Gen 1, unique across the team (Item Clause), not introduced after the format's generation,
      // and one that does something for this Pokémon and its moves (no plates without matching moves, etc.)
      slot.item = null;
      if (era === null || era >= 2) {
        const info = speciesLookup ? speciesLookup(name) : null;
        const types = eraTypes(slot);
        const fitCtx = { moveInfo: moveData, gen: era, weakTo: (type) => PokeLogic.getDefensiveMultiplier(types, type, era || undefined) >= 2 };
        const fitting = shuffled(itemCache.filter(i => !specialistItems.has(i) && !megaStones.has(i) && !usedItems.has(i)
          && PokeViability.suitsRandomSet(i, slot, fitCtx, info)));
        for (const item of fitting.slice(0, 8)) {
          const gen = era === null ? null : await PokeApi.getItemGeneration(item);
          if (gen && gen > era) continue;
          slot.item = item;
          break;
        }
      }
      // EVs and nature that match the attacks: fast Pokémon max attack and Speed, slower ones HP and attack
      const spread = PokeViability.randomSpread(picked.category, slot.stats);
      slot.nature = spread.nature;
      STAT_KEYS.forEach(k => { slot.ivs[k] = 31; slot.evs[k] = spread.evs[k] || 0; });

      // Keep the set only if it passes the same rule checks the builder shows
      const facts = { itemList: new Set(itemCache), megaStones, itemGen: {}, abilityGen: {} };
      if (era !== null) {
        if (slot.item) facts.itemGen[slot.item] = await PokeApi.getItemGeneration(slot.item);
        if (slot.ability) facts.abilityGen[slot.ability] = await PokeApi.getAbilityGeneration(slot.ability);
      }
      const check = PokeTeam.validateTeam([slot, ...Array.from({ length: 5 }, PokeTeam.createEmptySlot)], { format, allowedNames: allowed, facts });
      if (check.errors) continue;

      usedSpecies.add(parsed.species);
      if (slot.item) usedItems.add(slot.item);
      generated.push(slot);
    } catch (err) {
      failures++;
      console.error(`Failed to generate random Pokémon ${name}`, err);
    }
  }

  btn.textContent = origText;
  btn.disabled = false;
  if (!stillSameFormat()) {
    if (team === t) setStatus("The format changed while the random team was being drawn, so it was discarded. Try again.");
    return;
  }
  loadTokens.forEach((_, i) => { loadTokens[i]++; });
  for (let i = 0; i < 6; i++) t.slots[i] = generated[i] || PokeTeam.createEmptySlot();
  offerUndo("random team", () => { t.slots = previous.map(PokeTeam.sanitizeSlot); });
  onTeamEdited();
  renderTabs();
  renderTabContent();
  const source = format.id === "any" ? "all Pokémon" : label;
  setStatus(generated.length < 6
    ? `Only ${generated.length} Pokémon from ${source} could be generated (network errors or too few with ${format.id === "any" ? "move data" : "learnsets in this format"}). Undo restores your previous team.`
    : `Random team drawn from ${source}. Each set passed the rule checks below. Moves, items, EVs and natures follow simple competitive rules, but the team itself is random, so analyze it before relying on it.`);
}
document.getElementById("randomTeamBtn").addEventListener("click", generateRandomTeam);

document.getElementById("clearTeamBtn").addEventListener("click", () => {
  const t = team;
  if (!t.slots.some(s => s.name)) return;
  const previous = t.slots.map(PokeTeam.serializeSlot);
  loadTokens.forEach((_, i) => { loadTokens[i]++; });
  t.slots = Array.from({ length: 6 }, PokeTeam.createEmptySlot);
  offerUndo("cleared team", () => { t.slots = previous.map(PokeTeam.sanitizeSlot); });
  onTeamEdited();
  renderTabs();
  renderTabContent();
  setStatus("Team cleared. Use Undo to bring it back.");
});

// ---- Rule validation (shown continuously; never claims a team is "legal") ----
function scheduleValidation() {
  clearTimeout(validationTimer);
  validationTimer = setTimeout(runValidation, 250);
}

async function gatherFacts() {
  const filled = slots().filter(s => s.name);
  const era = currentFormat().era;
  const facts = { itemList: itemCache.length ? new Set(itemCache) : null, megaStones, itemGen: {}, abilityGen: {} };
  if (era !== null) {
    const items = [...new Set(filled.map(s => s.item).filter(Boolean))];
    const abilities = [...new Set(filled.map(s => s.ability).filter(Boolean))];
    await Promise.all([
      ...items.map(async i => { const g = await PokeApi.getItemGeneration(i); if (g) facts.itemGen[i] = g; }),
      ...abilities.map(async a => { const g = await PokeApi.getAbilityGeneration(a); if (g) facts.abilityGen[a] = g; })
    ]);
  }
  return facts;
}

function validateNow(facts) {
  return PokeTeam.validateTeam(slots(), { format: currentFormat(), allowedNames: pokemonSet.size ? pokemonSet : null, facts });
}

async function runValidation() {
  const token = ++validationToken;
  const t = team;
  let facts;
  try { facts = await gatherFacts(); } catch (err) { facts = {}; }
  if (token !== validationToken || team !== t) return;
  lastValidation = validateNow(facts);
  renderValidation();
  if (team.activeTab === -1) renderTabContent(); // refresh issue badges on the overview
}

function renderValidation() {
  const panel = document.getElementById("validationList");
  const summary = document.getElementById("validationSummary");
  const filled = slots().filter(s => s.name).length;
  const real = lastValidation.issues.filter(i => i.severity !== "info");
  if (!filled) summary.textContent = "Add Pokémon to see rule checks.";
  else if (!real.length) summary.textContent = "No problems found by the checks listed below. This is not a guarantee of legality.";
  else summary.textContent = `${lastValidation.errors} problem(s) and ${lastValidation.warnings} warning(s) found.`;
  panel.innerHTML = real.map(i => `<li class="${i.severity}"><span class="sev">${i.severity === "error" ? "Problem" : "Warning"}</span> ${i.slotIndex !== null ? `<em>Slot ${i.slotIndex + 1}:</em> ` : ""}${esc(i.text)}</li>`).join("");
  document.getElementById("uncheckedList").innerHTML = PokeFormats.limitations(currentFormat()).concat(PokeTeam.UNCHECKED).map(x => `<li>${esc(x)}</li>`).join("");
  DamagePanel.render(); // runs after every edit, data load and format change, like the checks above
}

// ---- Import / export ----
const ioDialog = document.getElementById("ioDialog");
const ioText = document.getElementById("ioText");
const ioMessage = document.getElementById("ioMessage");
const ioNote = (text) => { ioMessage.textContent = text; };

document.getElementById("ioBtn").addEventListener("click", () => {
  ioText.value = "";
  ioNote("");
  ioDialog.showModal();
});
document.getElementById("ioClose").addEventListener("click", () => ioDialog.close());
document.getElementById("exportShowdown").addEventListener("click", () => {
  ioText.value = PokeTeam.toShowdown(team) || "(The team is empty.)";
  ioNote("Showdown text export. Paste it into Pokémon Showdown's teambuilder.");
});
document.getElementById("exportJson").addEventListener("click", () => {
  ioText.value = PokeTeam.exportJson(team);
  ioNote("JSON export. Re-import it here to restore the team, including EVs, IVs and natures.");
});
document.getElementById("copyIo").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(ioText.value); ioNote("Copied to the clipboard."); }
  catch (err) { ioText.select(); ioNote("Could not copy automatically. The text is selected; press Ctrl+C."); }
});

async function importShowdown(text) {
  const { mons, warnings } = PokeTeam.parseShowdown(text);
  if (!mons.length) return { error: "No Pokémon found in that text." };
  const entries = await PokeApi.fetchPokemonEntries();
  const imported = PokeTeam.createTeam("Imported team", team.format);
  const notes = warnings.slice();
  let used = 0;
  for (const mon of mons) {
    const name = PokeTeam.resolveSpecies(mon.speciesKey, entries);
    if (!name) { notes.push(`Unknown Pokémon "${mon.speciesKey}" was skipped.`); continue; }
    let parsed;
    try { parsed = await PokeApi.getPokemon(name); } catch (err) { notes.push(`Could not load ${formatName(name)}; skipped.`); continue; }
    const slot = newSlotFrom(name, parsed);
    slot.item = mon.item;
    if (mon.ability) {
      if (slot.abilities.includes(mon.ability)) slot.ability = mon.ability;
      else notes.push(`${formatName(name)} cannot have ${formatName(mon.ability)}; kept ${formatName(slot.ability)}.`);
    }
    slot.level = mon.level;
    if (mon.nature) {
      if (mon.nature in NATURES) slot.nature = mon.nature;
      else notes.push(`Unknown nature "${mon.nature}" ignored for ${formatName(name)}.`);
    }
    STAT_KEYS.forEach(k => {
      if (k in mon.evs) slot.evs[k] = clampInt(mon.evs[k], 0, MAX_EV_STAT);
      if (k in mon.ivs) slot.ivs[k] = clampInt(mon.ivs[k], 0, MAX_IV);
    });
    if (evTotal(slot.evs) > MAX_EV_TOTAL) { STAT_KEYS.forEach(k => { slot.evs[k] = 0; }); notes.push(`${formatName(name)} had more than ${MAX_EV_TOTAL} EVs; EVs were reset.`); }
    slot.moves = [0, 1, 2, 3].map(j => mon.moves[j] || null);
    imported.slots[used++] = slot;
  }
  if (!used) return { error: "None of the Pokémon could be matched.", notes };
  return { team: imported, notes };
}

document.getElementById("importIo").addEventListener("click", async () => {
  const text = ioText.value.trim();
  if (!text) { ioNote("Paste a team (Showdown text or JSON) first."); return; }
  ioNote("Importing…");
  try {
    let result;
    if (text.startsWith("{")) {
      result = PokeTeam.parseJson(text, isFormatId);
      if (result.team) result.notes = [];
    } else {
      result = await importShowdown(text);
    }
    if (result.error) { ioNote(result.error + (result.notes && result.notes.length ? " " + result.notes.join(" ") : "")); return; }
    addTeam(result.team);
    ioDialog.close();
    setStatus(`Imported "${result.team.name}" as a new team.` + (result.notes.length ? " " + result.notes.join(" ") : "") + " Moves, abilities and items are checked against the format below.");
  } catch (err) {
    console.error(err);
    ioNote("Import failed. Check your connection and the text, then try again.");
  }
});

// ---- Threats from usage statistics (small dated snapshots in data/threats/) ----
const snapshotCache = new Map();
function loadSnapshot(id) {
  if (!snapshotCache.has(id)) {
    const p = fetch(`data/threats/${id}.json`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
    p.catch(() => snapshotCache.delete(id));
    snapshotCache.set(id, p);
  }
  return snapshotCache.get(id);
}

const SNAPSHOT_LABELS = { gen9doublesou: "Gen 9 Doubles OU" };
async function computeThreats(members) {
  try { await CalcLoader.ensure(); } catch (err) { /* reported below */ }
  if (!window.PokeThreats || !CalcLoader.ready()) return { error: "The damage calculator did not load, so threats were not analyzed." };
  const id = window.PokeThreats.snapshotFor(currentFormat(), isDoubles());
  if (!id) return { error: "Doubles usage data is only available for Generation 9, so threats were not analyzed for this format." };
  const label = SNAPSHOT_LABELS[id] || id.replace(/^gen(\d)ou$/, "Gen $1 OU");
  try {
    const snapshot = await loadSnapshot(id);
    const started = performance.now();
    const result = window.PokeThreats.analyzeThreats(currentFormat().era || 9, snapshot, members, { doubles: isDoubles() });
    appPerf.lastThreatAnalysisMs = Math.round(performance.now() - started);
    return { result, snapshot, label };
  } catch (err) {
    console.error(err);
    return { error: `Could not load ${label} usage data, so threats were not analyzed.` };
  }
}
// The format's singles usage snapshot, used as viability's reference strength even when the threat
// list itself can't run (e.g. Doubles in an older generation)
async function loadViabilitySnapshot() {
  const id = window.PokeThreats ? window.PokeThreats.snapshotFor(currentFormat(), false) : null;
  try { return id ? await loadSnapshot(id) : null; } catch (err) { return null; }
}
const isDoubles = () => !!(team && team.format.doubles);

// ---- Analysis ----
document.getElementById("analyzeBtn").addEventListener("click", async () => {
  const t = team;
  const filled = t.slots.filter(s => s.name);
  if (filled.length < 1) { setStatus("Add at least 1 Pokémon to analyze team synergy."); return; }

  const analyzeBtn = document.getElementById("analyzeBtn");
  analyzeBtn.disabled = true;
  setStatus("Looking up selected moves and rules…");
  try {
    const selectedMoves = Array.from(new Set(filled.flatMap(s => s.moves.filter(Boolean))));
    const [facts] = await Promise.all([gatherFacts(), Promise.all(selectedMoves.map(PokeApi.getMoveInfo))]);
    if (team !== t) return;
    lastValidation = validateNow(facts);
    renderValidation();

    setStatus("Checking matchups against the most-used Pokémon…");
    const threats = await computeThreats(filled);
    if (team !== t) return;
    // The threat-matchup score component needs the threat results; without usage data it is left out
    const threat = threats.result ? window.PokeThreats.threatScore(threats.result, threats.snapshot) : null;
    // Type analysis uses the format's generation chart and each Pokémon's types in that generation
    const members = filled.map(s => ({ ...s, types: eraTypes(s) }));
    // Viability compares each Pokémon with the format's most-used ones (species data from the calculator)
    const genNum = currentFormat().era || 9;
    const D = window.PokeDamage && window.PokeDamage.available ? window.PokeDamage : null;
    const refSnapshot = threats.snapshot || await loadViabilitySnapshot();
    const refBst = refSnapshot && window.PokeThreats ? window.PokeThreats.referenceBst(genNum, refSnapshot) : null;
    const result = PokeAnalysis.analyzeTeam(members, PokeApi.cachedMoveInfo(), {
      validation: lastValidation, doubles: isDoubles(), threat, gen: currentFormat().era,
      refBst, speciesInfo: D ? (name) => D.speciesInfo(genNum, name) : null
    });
    if (threats.result) {
      const s = threats.result.summary;
      const top = threats.result.entries.filter(e => e.level === "high").slice(0, 3).map(e => e.name);
      if (s.high) result.observations.unshift({ priority: s.high >= 5 ? "high" : "medium", text: `${s.high} of the ${s.considered} most-used ${threats.label} Pokémon ${s.high === 1 ? "is a high-level threat" : "are high-level threats"} to this team${top.length ? ` (e.g. ${top.join(", ")})` : ""}.`, evidence: "See the Threats section: each is checked with damage calculations against your exact sets." });
    }
    const real = lastValidation.issues.filter(i => i.severity !== "info");
    Report.render(result, {
      formatLabel: formatLabel() + (isDoubles() ? " (Doubles)" : " (Singles)"),
      validationSummary: real.length ? `${lastValidation.errors} rule problem(s), ${lastValidation.warnings} warning(s).` : "No rule problems found by the listed checks.",
      limitations: PokeFormats.limitations(currentFormat()),
      threats
    });
    setStatus("");
    const section = document.getElementById("analysisSection");
    section.hidden = false;
    section.scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    console.error(err);
    setStatus("The analysis failed. Check your connection and try again.");
  } finally {
    analyzeBtn.disabled = false;
  }
});

// ---- Share links (team encoded in the URL fragment, which browsers never send to a server) ----
document.getElementById("shareBtn").addEventListener("click", async () => {
  if (!slots().some(s => s.name)) { setStatus("Add a Pokémon before sharing."); return; }
  const url = `${location.origin}${location.pathname}#team=${await PokeTeam.encodeShare(team)}`;
  try {
    await navigator.clipboard.writeText(url);
    setStatus(`Share link copied (${url.length} characters). Anyone opening it gets a copy of "${team.name}" as a new team.`);
  } catch (err) {
    prompt("Copy this share link:", url);
  }
});

// Opening a share link adds the team as a new saved team (never overwrites one)
async function openSharedTeam() {
  const m = location.hash.match(/^#team=([A-Za-z0-9_-]+)$/);
  if (!m) return "";
  history.replaceState(null, "", location.pathname + location.search); // reloading should not import it twice
  const shared = await PokeTeam.decodeShare(m[1], isFormatId);
  if (!shared) return "That share link is damaged or incomplete, so no team was opened.";
  shared.name = PokeTeam.cleanName(`${shared.name} (shared)`);
  store.teams.push(shared);
  setActiveTeam(shared.id);
  saveStore();
  return `Opened shared team "${shared.name}". It is saved as a new team in this browser.`;
}

document.getElementById("clearCacheBtn").addEventListener("click", async () => {
  await PokeApi.clearCache();
  setStatus("Cached PokeAPI data cleared. It will be downloaded again as needed. Your teams are not affected.");
});

initApp();
