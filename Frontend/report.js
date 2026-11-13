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
    setText("gradeLabel", "Calibrated team score (a rough signal, not a competitive rating)");
    set("scoreMetrics", components.map(c => `
      <div class="metric-row">
        <span>${esc(c.label)} <small>(${c.weight}%)</small></span>
        <div class="bar-track" role="img" aria-label="${esc(c.label)}: ${c.score} out of 100"><div class="bar-fill ${scoreColor(c.score)}" style="width:${c.score}%"></div></div>
        <span class="metric-val">${c.score}</span>
      </div>`).join(""));
    const cal = result.score.calibration;
    const calibrationNote = cal ? `<p><strong>How well it works:</strong> the weights were calibrated on ${cal.experts} Smogon sample teams against ${cal.baselines.toLocaleString()} random teams built from the same formats' most common sets. On held-out teams, an expert team outscores a random one ${Math.round(cal.testAuc * 100)}% of the time (95% interval ${Math.round(cal.ci95[0] * 100)}–${Math.round(cal.ci95[1] * 100)}%; 50% would be chance, ${Math.round(cal.before * 100)}% before calibration). Treat it as a rough signal.${result.score.threatsIncluded ? "" : " Threat matchups are not part of this score (no usage data for this format), so the other weights were scaled up."}</p>` : "";
    set("scoreExplain", calibrationNote + components.map(c => `
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
