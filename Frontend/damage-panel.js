// Damage calculator panel: attacker and move from your team, defender from your team or any
// Pokémon with an assumed spread. Recalculates on every change. Browser-only.
const DamagePanel = (function () {
  const { esc, formatName, createSearchBox } = UI;
  let D = null; // window.PokeDamage, available once calc-loader.js has loaded the calculator
  let loadFailed = false;
  let deps = null; // { getSlots, getGenNum, getPokemonList, isDoubles }
  const state = { attacker: 0, move: null, defender: "team:1", other: null, spread: "none", crit: false, weather: "" };

  // The calculator bundle loads when this panel is about to scroll into view
  function init(d) {
    deps = d;
    render();
    CalcLoader.loadWhenVisible(document.querySelector(".damage-panel"), () => {
      loadFailed = !CalcLoader.ready();
      render();
    });
  }

  function select(id, label, options, value, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    wrap.innerHTML = `<label class="selector-label" for="${id}">${esc(label)}</label>`;
    const sel = document.createElement("select");
    sel.id = id;
    sel.className = "ev-input wide-input";
    options.forEach(o => {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      opt.selected = o.value === value;
      sel.appendChild(opt);
    });
    sel.onchange = () => onChange(sel.value);
    wrap.appendChild(sel);
    return wrap;
  }

  // Re-rendering replaces the controls; put keyboard focus back on the control that had it
  function render() {
    const focused = document.activeElement && document.activeElement.id;
    build();
    if (focused && focused.startsWith("dmg")) {
      const el = document.getElementById(focused);
      if (el) el.focus();
    }
  }

  function build() {
    const panel = document.getElementById("damageControls");
    const out = document.getElementById("damageResult");
    if (!panel || !deps) return;
    panel.innerHTML = "";
    D = window.PokeDamage;
    if (!D || !D.available) {
      out.textContent = loadFailed ? "The damage calculator failed to load. Reload the page to try again." : "Loading the damage calculator…";
      return;
    }

    const slots = deps.getSlots();
    const filled = slots.map((s, i) => ({ s, i })).filter(x => x.s.name);
    if (!filled.length) { out.textContent = "Add a Pokémon with at least one damaging move to calculate damage."; return; }

    const gen = D.generation(deps.getGenNum());
    if (!slots[state.attacker] || !slots[state.attacker].name) state.attacker = filled[0].i;
    const attacker = slots[state.attacker];
    const moves = attacker.moves.filter(Boolean).filter(m => D.isDamaging(gen, m));
    if (!moves.includes(state.move)) state.move = moves[0] || null;

    // Default defender: another team member, else a hypothetical Pokémon
    const teamDefenders = filled.filter(x => x.i !== state.attacker);
    const validTeamDefender = state.defender.startsWith("team:") && slots[+state.defender.slice(5)] && slots[+state.defender.slice(5)].name;
    if (!validTeamDefender && state.defender !== "other") state.defender = teamDefenders.length ? `team:${teamDefenders[0].i}` : "other";

    panel.appendChild(select("dmgAttacker", "Attacker (your team)", filled.map(x => ({ value: String(x.i), label: formatName(x.s.name) })), String(state.attacker), v => { state.attacker = +v; render(); }));
    panel.appendChild(select("dmgMove", "Move", moves.length ? moves.map(m => ({ value: m, label: formatName(m) })) : [{ value: "", label: "No damaging moves selected" }], state.move || "", v => { state.move = v; render(); }));
    panel.appendChild(select("dmgDefender", "Defender", filled.map(x => ({ value: `team:${x.i}`, label: `${formatName(x.s.name)} (your team)` })).concat([{ value: "other", label: "Another Pokémon…" }]), state.defender, v => { state.defender = v; render(); }));

    if (state.defender === "other") {
      panel.appendChild(createSearchBox("Defending Pokémon", deps.getPokemonList(), state.other, v => { state.other = v || null; render(); }, false));
      panel.appendChild(select("dmgSpread", "Defender spread (assumed)", D.DEFENDER_SPREADS.map(s => ({ value: s.id, label: s.label })), state.spread, v => { state.spread = v; render(); }));
    }
    panel.appendChild(select("dmgWeather", "Weather", [
      { value: "", label: "None" }, { value: "Sun", label: "Sun" }, { value: "Rain", label: "Rain" },
      { value: "Sand", label: "Sandstorm" }, { value: gen.num >= 9 ? "Snow" : "Hail", label: gen.num >= 9 ? "Snow" : "Hail" }
    ], state.weather, v => { state.weather = v; render(); }));
    const critWrap = document.createElement("label");
    critWrap.className = "format-option field";
    critWrap.innerHTML = `<input type="checkbox" id="dmgCrit" ${state.crit ? "checked" : ""}/> Critical hit`;
    critWrap.querySelector("input").onchange = (e) => { state.crit = e.target.checked; render(); };
    panel.appendChild(critWrap);

    // Calculate
    if (!state.move) { out.innerHTML = `<p>${esc(formatName(attacker.name))} has no damaging moves selected.</p>`; return; }
    let defender;
    if (state.defender === "other") {
      if (!state.other) { out.innerHTML = "<p>Search for a defending Pokémon.</p>"; return; }
      defender = D.hypotheticalSlot(state.other, state.spread, 100);
    } else {
      defender = slots[+state.defender.slice(5)];
    }
    const r = D.calculate(gen.num, attacker, state.move, defender, { crit: state.crit, weather: state.weather, doubles: deps.isDoubles() });
    if (r.error) { out.innerHTML = `<p class="calc-error">${esc(r.error)}</p>`; return; }
    const width = Math.min(100, r.maxPct);
    out.innerHTML = `
      <div class="calc-headline"><strong>${r.minPct} – ${r.maxPct}%</strong> <span>${esc(r.ko || (r.max === 0 ? "No damage" : ""))}</span></div>
      <div class="calc-bar" role="img" aria-label="Damage ${r.minPct} to ${r.maxPct} percent of HP"><div class="calc-bar-min" style="width:${Math.min(100, r.minPct)}%"></div><div class="calc-bar-max" style="width:${width}%"></div></div>
      <p class="calc-desc">${esc(r.desc)}</p>
      ${state.defender === "other" ? `<p class="field-hint">Defender assumptions: ${esc(D.DEFENDER_SPREADS.find(s => s.id === state.spread).label)}, its first listed ability, no item.</p>` : ""}
      ${r.notes.length ? `<p class="field-hint">${esc(r.notes.join(" "))}</p>` : ""}`;
  }

  return { init, render };
})();
