// Renders an analysis result (from PokeAnalysis.analyzeTeam) into the report section. Browser-only.
const Report = (function () {
  const { esc, formatName, TYPE_COLORS } = UI;
  const A = PokeAnalysis;

  function pill(t, cls = "") {
    const dark = ["electric", "ground", "ice", "steel", "fairy", "normal", "grass", "bug", "flying"].includes(t);
    return `<span class="type-pill ${cls}" style="${cls ? "" : `background:${TYPE_COLORS[t] || "#777"}; color:${dark ? "#111827" : "#fff"}`}">${esc(t)}</span>`;
  }

  const names = list => list.map(formatName).join(", ");

  function typeList(entries, verb, emptyText) {
    if (!entries.length) return `<li>${emptyText}</li>`;
    return entries.map(e => `<li><strong>${esc(formatName(e.type))}</strong> — ${e.count} member${e.count > 1 ? "s" : ""} ${verb}<span class="evidence">${esc(names(e.names))}</span></li>`).join("");
  }

  function scoreColor(score) { return score < 40 ? "red" : score < 70 ? "amber" : ""; }

  function render(result, ctx) {
    const set = (id, html) => { document.getElementById(id).innerHTML = html; };
    const setText = (id, text) => { document.getElementById(id).textContent = text; };

    setText("reportFormat", `Format: ${ctx.formatLabel}. ${ctx.validationSummary}`);

    // Score
    const { overall, components } = result.score;
    setText("overallScoreNum", overall);
    document.getElementById("overallScoreCircle").className = `score-circle ${scoreColor(overall)}`;
    setText("gradeLabel", "Checklist score (not a competitive rating)");
    set("scoreMetrics", components.map(c => `
      <div class="metric-row">
        <span>${esc(c.label)} <small>(${c.weight}%)</small></span>
        <div class="bar-track" role="img" aria-label="${esc(c.label)}: ${c.score} out of 100"><div class="bar-fill ${scoreColor(c.score)}" style="width:${c.score}%"></div></div>
        <span class="metric-val">${c.score}</span>
      </div>`).join(""));
    set("scoreExplain", components.map(c => `
      <h4>${esc(c.label)} — ${c.score}/100 (weight ${c.weight}%)</h4>
      <p>${esc(c.explain)}</p>
      <ul>${c.details.map(d => `<li>${esc(d)}</li>`).join("")}</ul>`).join(""));

    // Coverage
    const cov = result.cov;
    setText("superEffectiveText", cov.moveTypes.length
      ? `Hit super-effectively by selected damaging moves: ${cov.covered.length}/18 types, ${cov.dual.hit}/${cov.dual.total} dual-type combinations. Move types: ${names(cov.moveTypes)}.`
      : "No damaging moves are selected, so there is no coverage to show.");
    set("coveredTypesGrid", cov.covered.map(t => pill(t)).join("") || "<span class='sub-text'>None</span>");
    set("uncoveredTypesGrid", cov.uncovered.map(t => pill(t, "uncovered")).join(""));

    // Defense
    set("weaknessesList", typeList(result.weaknesses, "weak", "No weaknesses."));
    set("resistancesList", typeList(result.resistances, "resist", "No resistances."));
    set("immunitiesList", result.immunities.length
      ? result.immunities.map(e => `<li><strong>${esc(formatName(e.type))}</strong> — ${e.count} immune${result.summary[e.type].viaAbilityOrItem ? ` (${result.summary[e.type].viaAbilityOrItem} via ability or item)` : ""}<span class="evidence">${esc(names(e.names))}</span></li>`).join("")
      : "<li>No immunities.</li>");
    set("sharedWeakList", result.shared.length
      ? result.shared.map(s => `<li><strong>${esc(formatName(s.type))}</strong> hits ${s.weakNames.length}: ${esc(names(s.weakNames))}<span class="evidence">${s.answers.length ? "Can take it: " + esc(names(s.answers)) : "Nothing on the team resists or is immune to it."}</span></li>`).join("")
      : "<li>No type hits two or more members super-effectively.</li>");

    // Speed
    set("speedTiersList", result.speed.map(st =>
      `<li>${esc(formatName(st.name))} — ${st.effective} Spe${st.note ? ` (${esc(st.note)})` : ""} <span class="evidence">Lv ${st.level}</span></li>`).join(""));

    // Roles
    const roleRows = Object.keys(A.ROLE_LABELS).map(r => {
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
  }

  return { render };
})();
