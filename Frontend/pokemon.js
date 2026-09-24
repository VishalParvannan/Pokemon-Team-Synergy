const TYPE_COLORS = {
  normal:"#A8A878", fire:"#F08030", water:"#6890F0", electric:"#F8D030",
  grass:"#78C850", ice:"#98D8D8", fighting:"#C03028", poison:"#A040A0",
  ground:"#E0C068", flying:"#A890F0", psychic:"#F85888", bug:"#A8B820",
  rock:"#B8A038", ghost:"#705898", dark:"#705848", steel:"#B8B8D0", fairy:"#EE99AC"
};

const ALL_TYPES = [
  "normal", "fire", "water", "electric", "grass", "ice",
  "fighting", "poison", "ground", "flying", "psychic", "bug",
  "rock", "ghost", "dark", "steel", "dragon", "fairy"
];

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
  steel:    { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 }
};

const STATS = [
  { key: "hp", label: "HP" },
  { key: "atk", label: "Atk" },
  { key: "def", label: "Def" },
  { key: "spa", label: "SpA" },
  { key: "spd", label: "SpD" },
  { key: "spe", label: "Spe" }
];

const MAX_EV_TOTAL = 510;
const MAX_EV_STAT = 252;

// Track tab index where -1 is Overview and 0-5 are Pokémon slots
let activeTabIndex = -1;
const teamSlots = Array.from({ length: 6 }, () => createEmptySlot());

let pokemonCache = [];
let itemCache = [];

// Helper function to return a default blank slot object
function createEmptySlot() {
  return {
    name: null,
    sprite: null,
    types: [],
    ability: null,
    abilities: [],
    item: null,
    moves: [null, null, null, null],
    movePool: [],
    stats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
  };
}

// Format raw string names into capitalized titles
function formatName(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/-/g, " ");
}

// Update DOM text showing filled slot count
function updateSlotCounter() {
  const filledCount = teamSlots.filter(s => s.name).length;
  const counterEl = document.getElementById("slotCounter");
  if (counterEl) counterEl.textContent = `${filledCount}/6 slots filled`;
}

// Fetch initial data and setup the UI tabs
async function initApp() {
  renderTabs();
  renderTabContent();

  try {
    const [pRes, iRes] = await Promise.all([
      fetch("https://pokeapi.co/api/v2/pokemon?limit=900").then(r => r.json()),
      fetch("https://pokeapi.co/api/v2/item?limit=1000").then(r => r.json())
    ]);

    pokemonCache = pRes.results.map(p => p.name).sort();
    itemCache = iRes.results.map(i => i.name).sort();
    renderTabContent();
  } catch (err) {
    document.getElementById("subtitle").textContent = "Could not load database. Check network connection.";
  }
}

// Render navigation tab buttons for overview and individual slots
function renderTabs() {
  const tabsContainer = document.getElementById("teamTabs");
  tabsContainer.innerHTML = "";

  const overviewBtn = document.createElement("button");
  overviewBtn.className = `tab-btn ${activeTabIndex === -1 ? "active" : ""}`;
  overviewBtn.innerHTML = `<span>Team Overview</span>`;
  overviewBtn.onclick = () => { activeTabIndex = -1; renderTabs(); renderTabContent(); };
  tabsContainer.appendChild(overviewBtn);

  teamSlots.forEach((slot, idx) => {
    const btn = document.createElement("button");
    btn.className = `tab-btn ${activeTabIndex === idx ? "active" : ""}`;
    const iconHTML = slot.sprite 
      ? `<img src="${slot.sprite}" class="tab-icon" alt="" />`
      : `<div class="tab-icon-placeholder"></div>`;
    
    btn.innerHTML = `${iconHTML} <span>${slot.name ? formatName(slot.name) : `Slot ${idx + 1}`}</span>`;
    btn.onclick = () => { activeTabIndex = idx; renderTabs(); renderTabContent(); };
    tabsContainer.appendChild(btn);
  });

  updateSlotCounter();
}

// Switch between overview layout and single slot editor
function renderTabContent() {
  const container = document.getElementById("tabContent");
  container.innerHTML = "";

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
    const card = document.createElement("div");
    if (slot.name) {
      card.className = "overview-card";
      card.style.borderTop = `4px solid ${TYPE_COLORS[slot.types[0]] || "var(--accent)"}`;
      card.innerHTML = `
        <div style="display:flex; justify-content: space-between; align-items:center;">
          <div>
            <strong style="font-size: 16px;">${formatName(slot.name)}</strong>
            <div style="margin-top: 4px;">
              ${slot.types.map(t => `<span class="type-badge" style="background:${TYPE_COLORS[t] || '#777'}">${t}</span>`).join(" ")}
            </div>
          </div>
          <img src="${slot.sprite}" style="width:64px; height:64px; image-rendering:pixelated;" alt="" />
        </div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 10px;">
          <div><strong>Item:</strong> ${slot.item ? formatName(slot.item) : "None"}</div>
          <div><strong>Ability:</strong> ${slot.ability ? formatName(slot.ability) : "None"}</div>
          <div><strong>Moves:</strong> ${slot.moves.filter(Boolean).map(formatName).join(", ") || "None"}</div>
        </div>
      `;
    } else {
      card.className = "overview-card empty";
      card.innerHTML = `<span>+ Add Pokémon (Slot ${idx + 1})</span>`;
    }
    card.onclick = () => { activeTabIndex = idx; renderTabs(); renderTabContent(); };
    grid.appendChild(card);
  });

  container.appendChild(grid);
}

// Reusable dropdown select UI generator
function createDropdown(label, options, selectedValue, onChange) {
  const box = document.createElement("div");
  box.style.marginBottom = "12px";

  const lbl = document.createElement("label");
  lbl.className = "selector-label";
  lbl.textContent = label;
  box.appendChild(lbl);

  const select = document.createElement("select");
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

// Render slot configuration elements for selected Pokémon
function renderPokemonEditor(container, slotIdx) {
  const slot = teamSlots[slotIdx];

  const editor = document.createElement("div");
  editor.className = "pokemon-editor";

  // Render left column for general settings
  const leftCol = document.createElement("div");
  
  const pkmnSelect = createDropdown("Pokémon", pokemonCache, slot.name, (val) => {
    if (val) loadPokemonData(slotIdx, val);
  });
  leftCol.appendChild(pkmnSelect);

  if (slot.name) {
    const preview = document.createElement("div");
    preview.style.cssText = "text-align:center; margin-bottom: 16px;";
    preview.innerHTML = `
      <img src="${slot.sprite}" style="width: 120px; height: 120px; image-rendering: pixelated;" alt="" />
      <div style="margin-top: 8px;">
        ${slot.types.map(t => `<span class="type-badge" style="background:${TYPE_COLORS[t] || '#777'}">${t}</span>`).join(" ")}
      </div>
    `;
    leftCol.appendChild(preview);

    const abSelect = createDropdown("Ability", slot.abilities, slot.ability, (val) => {
      slot.ability = val;
      renderTabs();
      renderTabContent();
    });
    leftCol.appendChild(abSelect);

    const itemSelect = createDropdown("Item", itemCache, slot.item, (val) => {
      slot.item = val;
      renderTabContent();
    });
    leftCol.appendChild(itemSelect);
  }

  // Render right column for movesets and stat EV adjustments
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

      const moveBox = createDropdown(`Move ${moveIdx + 1}`, availableMoves, move, (val) => {
        slot.moves[moveIdx] = val || null;
        renderTabContent();
      });
      movesGrid.appendChild(moveBox);
    });
    movesContainer.appendChild(movesGrid);

    const evTotal = Object.values(slot.evs).reduce((a, b) => a + b, 0);
    const statsContainer = document.createElement("div");
    statsContainer.className = "stat-sliders";
    statsContainer.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
        <span class="selector-label" style="margin:0;">Effort Values (EVs)</span>
        <span style="font-size:12px; color:${evTotal > MAX_EV_TOTAL ? 'var(--accent)' : 'var(--text-faint)'}">
          ${evTotal} / ${MAX_EV_TOTAL} Used
        </span>
      </div>
    `;

    STATS.forEach(s => {
      const row = document.createElement("div");
      row.className = "stat-row";
      row.innerHTML = `
        <span style="font-weight:600;">${s.label}</span>
        <span>${slot.stats[s.key]}</span>
        <input type="range" class="ev-slider" min="0" max="${MAX_EV_STAT}" step="4" value="${slot.evs[s.key]}" />
        <input type="number" class="ev-input" min="0" max="${MAX_EV_STAT}" value="${slot.evs[s.key]}" />
      `;

      const slider = row.querySelector(".ev-slider");
      const numInput = row.querySelector(".ev-input");

      const updateEV = (val) => {
        let clamped = Math.min(Math.max(parseInt(val, 10) || 0, 0), MAX_EV_STAT);
        slot.evs[s.key] = clamped;
        slider.value = clamped;
        numInput.value = clamped;
        
        const newTotal = Object.values(slot.evs).reduce((a, b) => a + b, 0);
        const totalSpan = statsContainer.querySelector("span[style*='font-size:12px']");
        if (totalSpan) {
          totalSpan.textContent = `${newTotal} / ${MAX_EV_TOTAL} Used`;
          totalSpan.style.color = newTotal > MAX_EV_TOTAL ? 'var(--accent)' : 'var(--text-faint)';
        }
      };

      slider.oninput = (e) => updateEV(e.target.value);
      numInput.oninput = (e) => updateEV(e.target.value);
      numInput.onblur = () => updateEV(numInput.value);

      statsContainer.appendChild(row);
    });

    rightCol.appendChild(movesContainer);
    rightCol.appendChild(statsContainer);
  }

  editor.appendChild(leftCol);
  editor.appendChild(rightCol);
  container.appendChild(editor);
}

// Fetch Pokémon stats and movepool data from API
async function loadPokemonData(slotIdx, name) {
  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${name}`).then(r => r.json());
    const slot = teamSlots[slotIdx];

    slot.name = name;
    slot.sprite = res.sprites.front_default || "";
    slot.types = res.types.map(t => t.type.name);
    slot.abilities = res.abilities.map(a => a.ability.name);
    slot.ability = slot.abilities[0] || null;
    slot.movePool = res.moves.map(m => m.move.name).sort();
    slot.moves = [null, null, null, null];

    res.stats.forEach(s => {
      const map = { hp:"hp", attack:"atk", defense:"def", "special-attack":"spa", "special-defense":"spd", speed:"spe" };
      if (map[s.stat.name]) slot.stats[map[s.stat.name]] = s.base_stat;
    });

    renderTabs();
    renderTabContent();
  } catch (err) {
    console.error("Failed loading Pokémon details", err);
  }
}

// Generate fully populated randomized team
async function generateRandomValidTeam() {
  if (pokemonCache.length === 0) return;

  const btn = document.getElementById("randomTeamBtn");
  const origText = btn.textContent;
  btn.textContent = "⏳ Generating...";
  btn.disabled = true;

  const shuffled = [...pokemonCache].sort(() => 0.5 - Math.random());
  const chosenNames = shuffled.slice(0, 6);

  for (let i = 0; i < 6; i++) {
    const name = chosenNames[i];
    try {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${name}`).then(r => r.json());
      const slot = createEmptySlot();

      slot.name = name;
      slot.sprite = res.sprites.front_default || "";
      slot.types = res.types.map(t => t.type.name);
      
      slot.abilities = res.abilities.map(a => a.ability.name);
      slot.ability = slot.abilities[Math.floor(Math.random() * slot.abilities.length)] || null;

      if (itemCache.length > 0) {
        slot.item = itemCache[Math.floor(Math.random() * itemCache.length)];
      }

      slot.movePool = res.moves.map(m => m.move.name).sort();
      const uniqueMoves = Array.from(new Set(slot.movePool)).sort(() => 0.5 - Math.random());
      slot.moves = [
        uniqueMoves[0] || null,
        uniqueMoves[1] || null,
        uniqueMoves[2] || null,
        uniqueMoves[3] || null
      ];

      res.stats.forEach(s => {
        const map = { hp:"hp", attack:"atk", defense:"def", "special-attack":"spa", "special-defense":"spd", speed:"spe" };
        if (map[s.stat.name]) slot.stats[map[s.stat.name]] = s.base_stat;
      });

      STATS.forEach(s => {
        slot.ivs[s.key] = Math.floor(Math.random() * 32);
      });

      let remainingEVs = 510;
      const statKeys = [...STATS.map(s => s.key)].sort(() => 0.5 - Math.random());

      for (const k of statKeys) {
        if (remainingEVs <= 0) break;
        const maxGive = Math.min(252, remainingEVs);
        const steps = Math.floor(maxGive / 4);
        const giveSteps = Math.floor(Math.random() * (steps + 1));
        const evVal = giveSteps * 4;
        slot.evs[k] = evVal;
        remainingEVs -= evVal;
      }

      teamSlots[i] = slot;
    } catch (err) {
      console.error(`Failed to generate random Pokémon for slot ${i + 1}`, err);
    }
  }

  btn.textContent = origText;
  btn.disabled = false;
  renderTabs();
  renderTabContent();
}

// Bind button actions for generation and clear operations
document.getElementById("randomTeamBtn").addEventListener("click", generateRandomValidTeam);

document.getElementById("clearTeamBtn").addEventListener("click", () => {
  for (let i = 0; i < 6; i++) {
    teamSlots[i] = createEmptySlot();
  }
  renderTabs();
  renderTabContent();
});

// Calculate damage type multipliers across typing
function getDefensiveMultiplier(defendingTypes, attackingType) {
  let mult = 1;
  defendingTypes.forEach(dt => {
    if (TYPE_CHART[attackingType] && TYPE_CHART[attackingType][dt] !== undefined) {
      mult *= TYPE_CHART[attackingType][dt];
    }
  });
  return mult;
}

// Calculate team performance metrics and trigger full report render
document.getElementById("analyzeBtn").addEventListener("click", () => {
  const filled = teamSlots.filter(s => s.name);
  if (filled.length < 1) {
    alert("Add at least 1 Pokémon to analyze team synergy.");
    return;
  }

  // Calculate offensive coverage
  const teamTypes = new Set(filled.flatMap(s => s.types));
  const superEffectiveCovered = new Set();
  
  ALL_TYPES.forEach(targetType => {
    for (const atkType of teamTypes) {
      if (TYPE_CHART[atkType] && TYPE_CHART[atkType][targetType] === 2) {
        superEffectiveCovered.add(targetType);
        break;
      }
    }
  });

  const uncoveredTypes = ALL_TYPES.filter(t => !superEffectiveCovered.has(t));

  // Compute team weaknesses and resistances
  const weaknessesCount = {};
  const resistancesCount = {};

  ALL_TYPES.forEach(atkType => {
    let weakMembers = 0;
    let resistMembers = 0;

    filled.forEach(pkmn => {
      const mult = getDefensiveMultiplier(pkmn.types, atkType);
      if (mult > 1) weakMembers++;
      if (mult < 1) resistMembers++;
    });

    if (weakMembers > 0) weaknessesCount[atkType] = weakMembers;
    if (resistMembers > 0) resistancesCount[atkType] = resistMembers;
  });

  // Calculate speed stat rankings
  const speedTiers = filled.map(pkmn => {
    const baseSpe = pkmn.stats.spe || 80;
    const evSpe = pkmn.evs.spe || 0;
    const ivSpe = pkmn.ivs ? pkmn.ivs.spe : 31;
    const totalSpe = Math.floor(Math.floor((2 * baseSpe + ivSpe + Math.floor(evSpe / 4)) * 100 / 100) + 5);
    return { name: pkmn.name, spe: totalSpe };
  }).sort((a, b) => b.spe - a.spe);

  // Compute evaluation metric percentages
  const scoreOffensive = Math.round((superEffectiveCovered.size / 18) * 100);
  const scoreCompleteness = Math.round((filled.length / 6) * 100);
  const avgSpeed = Math.round(speedTiers.reduce((a, b) => a + b.spe, 0) / speedTiers.length);
  const scoreSpeed = Math.min(100, Math.round((avgSpeed / 350) * 100));
  
  let validMovesTotal = 0;
  filled.forEach(s => validMovesTotal += s.moves.filter(Boolean).length);
  const scoreBuild = Math.round((validMovesTotal / (filled.length * 4)) * 100);
  
  const scoreDefensive = Math.max(20, 100 - (Object.keys(weaknessesCount).length * 5));
  const overallScore = Math.round((scoreOffensive + scoreDefensive + scoreCompleteness + scoreSpeed + scoreBuild) / 5);

  // Update header grade labels
  document.getElementById("overallScoreNum").textContent = overallScore;
  const gradeLabel = document.getElementById("gradeLabel");
  if (overallScore >= 85) gradeLabel.textContent = "S — Outstanding";
  else if (overallScore >= 75) gradeLabel.textContent = "A — Strong";
  else if (overallScore >= 60) gradeLabel.textContent = "B — Decent";
  else gradeLabel.textContent = "C — Needs Improvement";

  const updateMetric = (barId, valId, score) => {
    const bar = document.getElementById(barId);
    const val = document.getElementById(valId);
    bar.style.width = `${score}%`;
    bar.className = `bar-fill ${score < 40 ? 'red' : ''}`;
    val.textContent = score;
  };

  updateMetric("barOffensive", "valOffensive", scoreOffensive);
  updateMetric("barDefensive", "valDefensive", scoreDefensive);
  updateMetric("barCompleteness", "valCompleteness", scoreCompleteness);
  updateMetric("barSpeed", "valSpeed", scoreSpeed);
  updateMetric("barBuild", "valBuild", scoreBuild);

  // Display coverage badges
  document.getElementById("superEffectiveText").textContent = `Types you hit super-effectively (${superEffectiveCovered.size}/18):`;
  
  const coveredGrid = document.getElementById("coveredTypesGrid");
  coveredGrid.innerHTML = Array.from(superEffectiveCovered).map(t => 
    `<span class="type-pill" style="background:${TYPE_COLORS[t] || '#777'}">${t}</span>`
  ).join("");

  const uncoveredGrid = document.getElementById("uncoveredTypesGrid");
  uncoveredGrid.innerHTML = uncoveredTypes.map(t => 
    `<span class="type-pill uncovered">${t}</span>`
  ).join("");

  // Display weaknesses and resistances lists
  const weaknessesList = document.getElementById("weaknessesList");
  const sortedWeaknesses = Object.entries(weaknessesCount).sort((a, b) => b[1] - a[1]);
  weaknessesList.innerHTML = sortedWeaknesses.length ? sortedWeaknesses.map(([type, count]) => 
    `<li>${formatName(type)} — ${count} member${count > 1 ? 's' : ''} weak</li>`
  ).join("") : "<li>No structural weaknesses!</li>";

  const resistancesList = document.getElementById("resistancesList");
  const sortedResistances = Object.entries(resistancesCount).sort((a, b) => b[1] - a[1]);
  resistancesList.innerHTML = sortedResistances.length ? sortedResistances.map(([type, count]) => 
    `<li>${formatName(type)} — ${count} member${count > 1 ? 's' : ''} resist</li>`
  ).join("") : "<li>No major resistances found.</li>";

  // Display speed tiers list
  const speedList = document.getElementById("speedTiersList");
  speedList.innerHTML = speedTiers.map(st => 
    `<li>${formatName(st.name)} — ${st.spe} Spe</li>`
  ).join("");

  // Generate actionable suggestion cards
  const recsContainer = document.getElementById("recommendationsList");
  recsContainer.innerHTML = "";

  const recommendations = [];

  // Check team slots count
  if (filled.length < 6) {
    recommendations.push({
      priority: "high",
      text: `Your team only has ${filled.length}/6 slots filled. Add ${6 - filled.length} more Pokémon to maximize balance.`
    });
  }

  // Check total weaknesses count per type
  sortedWeaknesses.forEach(([type, count]) => {
    if (count >= 3) {
      recommendations.push({
        priority: "high",
        text: `${count} of your Pokémon are weak to ${formatName(type)}. Swap one in for a ${formatName(type)} resist or add a counter.`
      });
    }
  });

  // Check unresisted type vulnerabilities
  const unresistedTypes = ALL_TYPES.filter(t => !resistancesCount[t]);
  if (unresistedTypes.length >= 4) {
    recommendations.push({
      priority: "medium",
      text: `Nothing on the team resists ${unresistedTypes.slice(0, 5).map(formatName).join(", ")}. A single defensive pivot can patch most of this.`
    });
  }

  // Check missing offensive type coverage
  if (uncoveredTypes.length > 0) {
    recommendations.push({
      priority: "medium",
      text: `No super-effective answer to ${uncoveredTypes.slice(0, 6).map(formatName).join(", ")}. Add a damaging move that hits those types hard.`
    });
  }

  // Run individual checks per populated slot
  filled.forEach(slot => {
    const pkmnName = formatName(slot.name);
    const validMoves = slot.moves.filter(Boolean);

    // Validate move slot completeness
    if (validMoves.length < 4) {
      recommendations.push({
        priority: "high",
        text: `${pkmnName} has ${4 - validMoves.length} empty move slot(s). Every Pokémon should carry 4 moves.`
      });
    } else {
      // Validate utility and status options within move choices
      const hasStatusOrSetup = slot.moves.some(m => 
        m && (m.includes("dance") || m.includes("swords") || m.includes("toxic") || 
              m.includes("spikes") || m.includes("roost") || m.includes("protect") || 
              m.includes("stealth") || m.includes("substitute") || m.includes("will-o-wisp"))
      );
      if (!hasStatusOrSetup) {
        recommendations.push({
          priority: "low",
          text: `${pkmnName} runs four attacks. A status or setup move (recovery, hazards, boosts) often adds more value.`
        });
      }
    }

    // Validate EV distributions against base stats
    const baseAtk = slot.stats.atk || 80;
    const baseSpa = slot.stats.spa || 80;

    if (baseSpa > baseAtk + 25 && slot.evs.atk > 0) {
      recommendations.push({
        priority: "medium",
        text: `${pkmnName} has physical moves or Attack investment, but a much higher Special Attack. Move to special attacks or fix the EVs.`
      });
    } else if (baseAtk > baseSpa + 25 && slot.evs.spa > 0) {
      recommendations.push({
        priority: "medium",
        text: `${pkmnName} has special moves or Special Attack investment, but a much higher Attack stat. Move to physical attacks or fix the EVs.`
      });
    }

    // Validate Nature stat penalties against positive EV investments
    if (slot.nature && slot.nature.lowered) {
      const loweredStat = slot.nature.lowered;
      const investedEVs = slot.evs[loweredStat] || 0;
      if (investedEVs > 0) {
        recommendations.push({
          priority: "low",
          text: `${pkmnName}'s ${slot.nature.name} nature lowers ${loweredStat.toUpperCase()} but you invested ${investedEVs} EVs there.`
        });
      }
    }

    // Validate essential slots carry items and abilities
    if (!slot.ability) {
      recommendations.push({
        priority: "medium",
        text: `${pkmnName} is missing an ability selection.`
      });
    }

    if (!slot.item) {
      recommendations.push({
        priority: "medium",
        text: `${pkmnName} has no held item equipped.`
      });
    }
  });

  // Provide optimistic feedback when no suggestions trigger
  if (recommendations.length === 0) {
    recommendations.push({
      priority: "low",
      text: "Your team is fully built and optimized with strong offensive and defensive coverage!"
    });
  }

  // Sort recommendation cards by priority rank
  const priorityOrder = { high: 1, medium: 2, low: 3 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Append calculated recommendation cards to the DOM
  recommendations.forEach(rec => {
    const card = document.createElement("div");
    card.className = "rec-card";
    card.innerHTML = `
      <span class="rec-badge ${rec.priority}">● ${rec.priority.toUpperCase()}</span>
      <div class="rec-desc">${rec.text}</div>
    `;
    recsContainer.appendChild(card);
  });

  const section = document.getElementById("analysisSection");
  section.hidden = false;
  section.scrollIntoView({ behavior: "smooth" });
});

// Initialize Application
initApp();