// Renders an analysis result (from PokeAnalysis.analyzeTeam) into the report section. Browser-only.
const Report = (function () {
  const { esc, formatName, TYPE_COLORS } = UI;
  const A = PokeAnalysis;

  // Text colour with the higher WCAG contrast against the type colour (white fails on e.g. Fire orange)
  const textOn = UI.textOn;
  function pill(t, cls = "") {
    const bg = TYPE_COLORS[t] || "#777777";
    return `<span class="type-pill ${cls}" style="${cls ? "" : `background:${bg}; color:${textOn(bg)}`}">${esc(t)}</span>`;
  }

  const names = list => list.map(formatName).join(", ");

  // Attacking types down the side, team members across the top, multiplier in each cell
  const MULT_LABEL = { 0: "0", 0.25: "¼", 0.5: "½", 1: "", 2: "2×", 4: "4×" };
  const multClass = (m) => m === 0 ? "immune" : m >= 4 ? "quad" : m > 1 ? "weak" : m <= 0.25 ? "dresist" : m < 1 ? "resist" : "";
  function typeChart(result) {
    const members = result.members || [];
    const types = Object.keys(result.summary);
    const head = `<tr><th scope="col" class="tc-type">Type</th>${members.map(m =>
      `<th scope="col" title="${esc(formatName(m.name))}">${UI.spriteImg(m.sprite, 32)}<span class="tc-name">${esc(formatName(m.name))}</span></th>`).join("")}<th scope="col">Weak</th><th scope="col">Resist</th></tr>`;
    const rows = types.map(t => {
      const s = result.summary[t];
      const answered = s.resist + s.immune;
      const problem = s.weak >= 2 && answered === 0;
      const cells = (s.mults || []).map((m, i) => {
        const label = MULT_LABEL[m] !== undefined ? MULT_LABEL[m] : `${m}×`;
        const desc = m === 0 ? "immune" : m === 1 ? "neutral" : `takes ${m}×`;
        return `<td class="tc-cell ${multClass(m)}" aria-label="${esc(formatName(members[i] ? members[i].name : ""))}: ${desc}">${label}</td>`;
      }).join("");
      return `<tr class="${problem ? "tc-problem" : ""}"><th scope="row" class="tc-type">${pill(t)}</th>${cells}` +
        `<td class="tc-count ${s.weak >= 2 ? "bad" : ""}">${s.weak || ""}</td><td class="tc-count ${answered ? "good" : ""}">${answered || ""}</td></tr>`;
    }).join("");
    return `<table class="type-chart"><thead>${head}</thead><tbody>${rows}</tbody></table>
      <p class="tc-legend"><span class="tc-cell quad">4×</span><span class="tc-cell weak">2×</span><span class="tc-cell resist">½</span><span class="tc-cell dresist">¼</span><span class="tc-cell immune">0</span> blank = neutral · "Resist" counts resistances and immunities</p>`;
  }

  // Report tabs (arrow keys move between them, as in the editor)
  function selectTab(id, focus) {
    document.querySelectorAll(".report-tabs [role=tab]").forEach(tab => {
      const on = tab.id === id;
      tab.setAttribute("aria-selected", on);
      tab.tabIndex = on ? 0 : -1;
      document.getElementById(tab.getAttribute("aria-controls")).hidden = !on;
      if (on && focus) tab.focus();
    });
  }
  const tabs = () => Array.from(document.querySelectorAll(".report-tabs [role=tab]"));
  document.querySelectorAll(".report-tabs [role=tab]").forEach(tab => {
    tab.addEventListener("click", () => selectTab(tab.id));
    tab.addEventListener("keydown", (e) => {
      const list = tabs(), i = list.indexOf(tab);
      const next = e.key === "ArrowRight" ? list[(i + 1) % list.length] : e.key === "ArrowLeft" ? list[(i - 1 + list.length) % list.length]
        : e.key === "Home" ? list[0] : e.key === "End" ? list[list.length - 1] : null;
      if (next) { e.preventDefault(); selectTab(next.id, true); }
    });
  });

  function scoreColor(score) { return score < 40 ? "red" : score < 70 ? "amber" : ""; }

  function render(result, ctx) {
    const set = (id, html) => { document.getElementById(id).innerHTML = html; };
    const setText = (id, text) => { document.getElementById(id).textContent = text; };

    setText("reportFormat", `Format: ${ctx.formatLabel}. ${ctx.validationSummary}`);

    // Score
    const { overall, components } = result.score;
    setText("overallScoreNum", overall);
    document.getElementById("overallScoreCircle").className = `score-circle ${scoreColor(overall)}`;
    const ref = result.score.calibration && result.score.calibration.means;
    setText("gradeLabel", ref
      ? `For reference: expert teams average ${ref.expert}, random teams of popular sets ${ref.popular}, fully random teams ${ref.random}.`
      : "Calibrated team score (a rough signal, not a competitive rating)");
    set("scoreMetrics", components.map(c => `
      <div class="metric-row">
        <span>${esc(c.label)} <small>(${c.weight}%)</small></span>
        <div class="bar-track" role="img" aria-label="${esc(c.label)}: ${c.score} out of 100"><div class="bar-fill ${scoreColor(c.score)}" style="width:${c.score}%"></div></div>
        <span class="metric-val">${c.score}</span>
      </div>`).join(""));
    const cal = result.score.calibration;
    const pct = (x) => Math.round(x * 100);
    const calibrationNote = cal ? `<p><strong>How well it works:</strong> the weights were calibrated on ${cal.experts} Smogon sample teams, ${cal.popular.toLocaleString()} random teams of popular sets and ${cal.random.toLocaleString()} fully random teams. On held-out teams, an expert team outscores a fully random team ${pct(cal.vsRandom)}% of the time, but a random team of popular sets only ${pct(cal.vsPopular)}% of the time (95% interval ${pct(cal.vsPopularCi95[0])}–${pct(cal.vsPopularCi95[1])}%; 50% would be chance). So it reliably flags unviable teams and only roughly ranks strong ones.${result.score.threatsIncluded ? "" : " Threat matchups are not part of this score (no usage data for this format), so the other weights were scaled up."}</p>` : "";
    set("scoreExplain", calibrationNote + components.map(c => `
      <h4>${esc(c.label)} — ${c.score}/100 (weight ${c.weight}%)</h4>
      <p>${esc(c.explain)}</p>
      <ul>${c.details.map(d => `<li>${esc(d)}</li>`).join("")}</ul>`).join(""));

    // Coverage
    const cov = result.cov;
    setText("superEffectiveText", cov.moveTypes.length
      ? `Hit super-effectively by selected damaging moves: ${cov.covered.length}/${cov.typeCount} types, ${cov.dual.hit}/${cov.dual.total} dual-type combinations. Move types: ${names(cov.moveTypes)}.`
      : "No damaging moves are selected, so there is no coverage to show.");
    set("coveredTypesGrid", cov.covered.map(t => pill(t)).join("") || "<span class='sub-text'>None</span>");
    set("uncoveredTypesGrid", cov.uncovered.map(t => pill(t, "uncovered")).join(""));

    // Defense: one compact chart instead of separate weakness / resistance / immunity lists
    set("typeChart", typeChart(result));
    // The chart scrolls sideways on narrow screens: make the region focusable so keyboard users can scroll it
    const chart = document.getElementById("typeChart");
    chart.setAttribute("tabindex", "0");
    chart.setAttribute("role", "region");
    chart.setAttribute("aria-label", "Type matchup chart (scrolls sideways on narrow screens)");
    set("sharedWeakList", result.shared.length
      ? result.shared.map(s => `<li><strong>${esc(formatName(s.type))}</strong> hits ${s.weakNames.length}: ${esc(names(s.weakNames))}<span class="evidence">${s.answers.length ? "Can take it: " + esc(names(s.answers)) : "Nothing on the team resists or is immune to it."}</span></li>`).join("")
      : "<li>No type hits two or more members super-effectively.</li>");

    // Viability (per Pokémon, weakest first)
    const via = result.viability;
    if (via && via.members.length) {
      setText("viabilityIntro", `Team average ${via.score}/100. Each Pokémon is graded on base stats compared with the format's most-used Pokémon, being fully evolved (or holding Eviolite), its strongest attack, moves that earn their slot, an item that helps it, and EV investment.`);
      set("viabilityList", via.members.slice().sort((a, b) => a.score - b.score).map(p => `
        <li class="viability-row">
          <div class="viability-head">
            <strong>${esc(formatName(p.name))}</strong>
            <div class="bar-track" role="img" aria-label="${esc(formatName(p.name))}: ${p.score} out of 100"><div class="bar-fill ${scoreColor(p.score)}" style="width:${p.score}%"></div></div>
            <span class="metric-val">${p.score}</span>
          </div>
          <span class="evidence">${p.issues.length ? esc(p.issues.join("; ")) : "No problems found."}</span>
        </li>`).join(""));
    } else {
      setText("viabilityIntro", "");
      set("viabilityList", "");
    }

    // Speed
    set("speedTiersList", result.speed.map(st =>
      `<li>${esc(formatName(st.name))} — ${st.effective} Spe${st.note ? ` (${esc(st.note)})` : ""} <span class="evidence">Lv ${st.level}</span></li>`).join(""));

    // Roles
    document.getElementById("rolesTitle").textContent = `Team roles (${result.doubles ? "doubles" : "singles"}, from moves and abilities)`;
    const roleRows = result.roleKeys.map(r => {
      const who = result.roles[r];
      return `<li><strong>${esc(A.ROLE_LABELS[r])}</strong>: ${who.length ? esc(names(who)) : "<span class='none'>none</span>"}</li>`;
    });
    set("rolesList", roleRows.join(""));

    // Observations
    set("recommendationsList", result.observations.map(rec => `
      <div class="rec-card">
        <span class="rec-badge ${rec.priority}">● ${rec.priority.toUpperCase()}</span>
        <div class="rec-desc">${esc(rec.text)}</div>
        ${rec.evidence ? `<div class="rec-evidence">${esc(rec.evidence)}</div>` : ""}
      </div>`).join(""));

    set("assumptionsList", result.assumptions.concat(ctx.limitations).map(a => `<li>${esc(a)}</li>`).join(""));
    renderThreats(ctx.threats);
    // Show counts on the tabs so the important ones stand out, and start every new report on Summary
    const high = result.observations.filter(o => o.priority === "high").length;
    document.getElementById("rtab-summary").textContent = `Summary${result.observations.length ? ` (${result.observations.length})` : ""}`;
    document.getElementById("rtab-summary").classList.toggle("alert", high > 0);
    const t = ctx.threats && ctx.threats.result;
    document.getElementById("rtab-threats").textContent = t ? `Threats (${t.summary.high} high)` : "Threats";
    document.getElementById("rtab-threats").classList.toggle("alert", !!(t && t.summary.high));
    selectTab("rtab-summary");
  }

  const pct = (x) => `${Math.round(x * 1000) / 10}%`;

  function threatRow(e) {
    const set = e.set;
    const answer = e.bestAnswer
      ? `${esc(formatName(e.bestAnswer.name))}'s ${esc(formatName(e.bestAnswer.move))} does ${e.bestAnswer.minPct}–${e.bestAnswer.maxPct}%`
      : "none of your moves damage it";
    const faster = e.vs.filter(v => v.faster === "you").map(v => v.name);
    return `
      <li class="threat ${e.level}">
        <div class="threat-head">
          <span class="threat-level ${e.level}">${e.level}</span>
          <strong>${esc(e.name)}</strong>
          <span class="evidence-inline">${pct(e.usage)} usage</span>
        </div>
        ${e.reasons.length ? `<div class="threat-reasons">${esc(e.reasons.join("; "))}</div>` : ""}
        <div class="evidence">
          OHKOs: ${e.ohkoed.length ? esc(names(e.ohkoed)) : "none"} ·
          Safe switch-ins: ${e.safeSwitchIns.length ? esc(names(e.safeSwitchIns)) : "none"} ·
          Best answer: ${answer} ·
          Faster than it: ${faster.length ? esc(names(faster)) : "none"}
        </div>
        <details><summary>Assumed set and every matchup</summary>
          <div class="evidence">${esc([set.item, set.ability, set.nature, Object.entries(set.evs || {}).map(([k, v]) => `${v} ${k.toUpperCase()}`).join(" / ")].filter(Boolean).join(" · "))} · ${esc(set.moves.join(", "))}</div>
          <ul class="plain-list">${e.vs.map(v => `<li>${esc(formatName(v.name))}: takes ${v.incoming ? `${v.incoming.minPct}–${v.incoming.maxPct}% (${esc(v.incoming.move)})` : "no damage"}, deals ${v.outgoing ? `${v.outgoing.minPct}–${v.outgoing.maxPct}% (${esc(formatName(v.outgoing.move))})` : "no damage"}${v.faster ? `, ${v.faster === "you" ? "faster" : v.faster === "tie" ? "speed tie" : "slower"}` : ""}</li>`).join("")}</ul>
        </details>
      </li>`;
  }

  function renderThreats(t) {
    const intro = document.getElementById("threatsIntro");
    const list = document.getElementById("threatsList");
    const title = document.getElementById("threatsTitle");
    if (!t) { title.textContent = "Threats from usage statistics"; intro.textContent = ""; list.innerHTML = ""; return; }
    if (t.error) { intro.textContent = t.error; list.innerHTML = ""; return; }
    const { result, snapshot, label } = t;
    title.textContent = `Threats: the ${result.summary.considered} most-used ${label} Pokémon`;
    intro.textContent = `${result.summary.high} high and ${result.summary.medium} medium threats; ${result.summary.noSafeSwitch} have no safe switch-in on your team. ` +
      `Each threat uses its most common set from ${snapshot.source} (${snapshot.battles.toLocaleString()} battles, fetched ${snapshot.fetched}). ` +
      `Safe switch-in = takes at most ${result.thresholds.SAFE_SWITCH_MAX}% from its strongest move; damage uses your exact sets, ignores Tera, hazards, boosts and partial HP.`;
    const shown = result.entries.slice(0, 12);
    const rest = result.entries.slice(12);
    list.innerHTML = `<ul class="threat-list">${shown.map(threatRow).join("")}</ul>` +
      (rest.length ? `<details><summary>Show ${rest.length} more</summary><ul class="threat-list">${rest.map(threatRow).join("")}</ul></details>` : "");
  }

  return { render };
})();
