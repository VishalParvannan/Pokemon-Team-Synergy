// Team analysis: ability/item-aware defense, coverage from selected moves, roles, speed,
// a documented checklist score and evidence-backed observations. Pure (no DOM, no network).
//
// Everything here is a heuristic oriented to singles play. Rules (type chart, damage
// multipliers) are kept apart from strategy (roles, score) in the output.
(function (root, factory) {
  const L = typeof require === "function" ? require("./logic.js") : root.PokeLogic;
  const T = typeof require === "function" ? require("./team.js") : root.PokeTeam;
  if (typeof module === "object" && module.exports) module.exports = factory(L, T);
  else root.PokeAnalysis = factory(L, T);
})(typeof self !== "undefined" ? self : this, function (L, T) {
  const { ALL_TYPES, getDefensiveMultiplier, coveredTypes, dualTypeCoverage, calcAllStats } = L;
  const pretty = T.pretty;

  // ---- Defense: abilities and items that change type matchups (rules, not strategy) ----
  const ABILITY_DEFENSE = {
    "levitate": { immune: ["ground"] },
    "earth-eater": { immune: ["ground"] },
    "flash-fire": { immune: ["fire"] },
    "well-baked-body": { immune: ["fire"] },
    "water-absorb": { immune: ["water"] },
    "storm-drain": { immune: ["water"] },
    "dry-skin": { immune: ["water"], mult: { fire: 1.25 } },
    "volt-absorb": { immune: ["electric"] },
    "lightning-rod": { immune: ["electric"] },
    "motor-drive": { immune: ["electric"] },
    "sap-sipper": { immune: ["grass"] },
    "thick-fat": { mult: { fire: 0.5, ice: 0.5 } },
    "heatproof": { mult: { fire: 0.5 } },
    "water-bubble": { mult: { fire: 0.5 } },
    "purifying-salt": { mult: { ghost: 0.5 } },
    "fluffy": { mult: { fire: 2 } }
  };

  // Returns { mult, source: "type" | "ability" | "item" } for one attacking type
  function defensiveMultiplier(member, atkType) {
    const base = getDefensiveMultiplier(member.types || [], atkType);
    if (member.item === "air-balloon" && atkType === "ground") return { mult: 0, source: "item" };
    const ab = ABILITY_DEFENSE[member.ability];
    if (ab) {
      if (ab.immune && ab.immune.includes(atkType)) return { mult: 0, source: "ability" };
      if (ab.mult && ab.mult[atkType]) return { mult: base * ab.mult[atkType], source: "ability" };
    }
    if (member.ability === "wonder-guard" && base <= 1) return { mult: 0, source: "ability" };
    return { mult: base, source: "type" };
  }

  // Per attacking type: counts and which members are weak / resist / immune
  function defensiveSummary(members) {
    const summary = {};
    ALL_TYPES.forEach(atk => {
      const s = { weak: 0, resist: 0, immune: 0, viaAbilityOrItem: 0, weakNames: [], resistNames: [], immuneNames: [], quadNames: [] };
      members.forEach(m => {
        const { mult, source } = defensiveMultiplier(m, atk);
        if (mult === 0) { s.immune++; s.immuneNames.push(m.name); if (source !== "type") s.viaAbilityOrItem++; }
        else if (mult > 1) { s.weak++; s.weakNames.push(m.name); if (mult >= 4) s.quadNames.push(m.name); }
        else if (mult < 1) { s.resist++; s.resistNames.push(m.name); }
      });
      summary[atk] = s;
    });
    return summary;
  }

  // Types that hit 2+ members, with the members that can take the hit
  function sharedWeaknesses(summary) {
    return ALL_TYPES.filter(t => summary[t].weak >= 2).map(t => ({
      type: t, weakNames: summary[t].weakNames,
      answers: summary[t].resistNames.concat(summary[t].immuneNames)
    })).sort((a, b) => (b.weakNames.length - b.answers.length) - (a.weakNames.length - a.answers.length));
  }

  // ---- Roles (name-based heuristics) ----
  const MOVE_ROLES = {
    hazards: ["stealth-rock", "spikes", "toxic-spikes", "sticky-web", "ceaseless-edge", "stone-axe"],
    removal: ["rapid-spin", "defog", "mortal-spin", "tidy-up", "court-change"],
    recovery: ["recover", "roost", "soft-boiled", "slack-off", "synthesis", "moonlight", "morning-sun", "wish", "shore-up", "strength-sap", "milk-drink", "heal-order", "rest", "life-dew", "lunar-blessing", "jungle-healing", "healing-wish", "lunar-dance", "swallow", "floral-healing", "heal-pulse", "pain-split", "leech-seed"],
    pivot: ["u-turn", "volt-switch", "flip-turn", "parting-shot", "teleport", "baton-pass", "chilly-reception", "shed-tail"],
    setup: ["swords-dance", "nasty-plot", "calm-mind", "dragon-dance", "bulk-up", "quiver-dance", "shell-smash", "belly-drum", "agility", "coil", "work-up", "curse", "iron-defense", "amnesia", "growth", "hone-claws", "shift-gear", "tail-glow", "geomancy", "victory-dance", "no-retreat", "autotomize", "rock-polish", "cosmic-power", "cotton-guard", "acid-armor", "barrier", "stockpile", "howl", "bulk-up", "clangorous-soul", "filet-away"],
    screens: ["reflect", "light-screen", "aurora-veil"],
    speedControl: ["trick-room", "tailwind", "icy-wind", "electroweb", "thunder-wave", "glare", "bulldoze", "rock-tomb", "scary-face", "string-shot", "sticky-web", "cotton-spore", "low-sweep"],
    phazing: ["roar", "whirlwind", "dragon-tail", "circle-throw", "haze", "clear-smog"],
    status: ["toxic", "will-o-wisp", "thunder-wave", "spore", "sleep-powder", "hypnosis", "glare", "yawn", "stun-spore", "poison-powder", "lovely-kiss", "sing", "dark-void", "nuzzle", "toxic-thread", "taunt", "encore", "trick", "switcheroo", "disable", "imprison", "haze", "leech-seed", "perish-song", "destiny-bond", "substitute", "protect", "detect", "spiky-shield", "kings-shield", "baneful-bunker", "obstruct", "silk-trap", "burning-bulwark", "strength-sap"],
    weatherMoves: ["sunny-day", "rain-dance", "sandstorm", "snowscape", "hail", "electric-terrain", "grassy-terrain", "misty-terrain", "psychic-terrain"]
  };
  const PRIORITY_FALLBACK = ["extreme-speed", "fake-out", "aqua-jet", "bullet-punch", "ice-shard", "mach-punch", "shadow-sneak", "sucker-punch", "quick-attack", "vacuum-wave", "water-shuriken", "accelerock", "jet-punch", "first-impression", "thunderclap", "upper-hand"];
  const WEATHER_ABILITIES = ["drought", "drizzle", "sand-stream", "snow-warning", "orichalcum-pulse", "hadron-engine", "electric-surge", "grassy-surge", "psychic-surge", "misty-surge", "desolate-land", "primordial-sea", "delta-stream", "sand-spit", "seed-sower"];

  const ROLE_LABELS = {
    hazards: "Entry hazards", removal: "Hazard removal", recovery: "Recovery", pivot: "Pivoting",
    priority: "Priority moves", setup: "Setup moves", screens: "Screens", speedControl: "Speed control",
    phazing: "Phazing / haze", status: "Status & disruption", weather: "Weather / terrain",
    intimidate: "Intimidate", physical: "Physical attackers", special: "Special attackers"
  };

  function memberRoles(member, moveInfo) {
    const moves = member.moves.filter(Boolean);
    const info = m => (moveInfo && moveInfo[m]) || null;
    const roles = new Set();
    Object.keys(MOVE_ROLES).forEach(role => {
      const key = role === "weatherMoves" ? "weather" : role;
      if (moves.some(m => MOVE_ROLES[role].includes(m))) roles.add(key);
    });
    if (WEATHER_ABILITIES.includes(member.ability)) roles.add("weather");
    if (member.ability === "intimidate") roles.add("intimidate");
    if (moves.some(m => { const i = info(m); return i ? i.priority > 0 && i.damageClass !== "status" : PRIORITY_FALLBACK.includes(m); })) roles.add("priority");
    if (member.item === "choice-scarf") roles.add("speedControl");
    if (moves.some(m => { const i = info(m); return i && i.damageClass === "physical"; })) roles.add("physical");
    if (moves.some(m => { const i = info(m); return i && i.damageClass === "special"; })) roles.add("special");
    return roles;
  }

  function teamRoles(members, moveInfo) {
    const out = {};
    Object.keys(ROLE_LABELS).forEach(r => { out[r] = []; });
    members.forEach(m => memberRoles(m, moveInfo).forEach(r => out[r].push(m.name)));
    return out;
  }

  // ---- Speed ----
  function speedTiers(members) {
    return members.map(m => {
      const spe = calcAllStats(m).spe;
      const scarf = m.item === "choice-scarf";
      return { name: m.name, level: m.level, spe, effective: scarf ? Math.floor(spe * 1.5) : spe, note: scarf ? "with Choice Scarf" : "" };
    }).sort((a, b) => b.effective - a.effective);
  }

  // ---- Coverage ----
  function coverage(members, moveInfo) {
    const picked = Array.from(new Set(members.flatMap(m => m.moves.filter(Boolean))));
    const unresolved = picked.filter(m => !(moveInfo && moveInfo[m]));
    const moveTypes = Array.from(new Set(picked.map(m => moveInfo && moveInfo[m]).filter(i => i && i.damageClass !== "status").map(i => i.type)));
    const covered = coveredTypes(moveTypes);
    return { moveTypes, covered, uncovered: ALL_TYPES.filter(t => !covered.includes(t)), dual: dualTypeCoverage(moveTypes), unresolved };
  }

  // ---- Score: weighted checklist (documented in SCORE_COMPONENTS, not a competitive rating) ----
  const SCORE_COMPONENTS = [
    { id: "offense", label: "Offensive coverage", weight: 30, explain: "40% share of the 18 types hit super-effectively by at least one selected damaging move, 60% share of the 153 dual-type combinations hit super-effectively." },
    { id: "defense", label: "Defensive balance", weight: 30, explain: "Starts at 100. Subtracts 7 for every extra member weak to a type beyond those that resist or are immune to it (abilities and Air Balloon included), and 4 per 4x weakness." },
    { id: "roles", label: "Team roles (singles)", weight: 25, explain: "Checklist from selected moves and abilities: entry hazards 15, hazard removal 15, recovery 15 (8 for one user), pivoting 10, speed control or priority 15, physical and special attackers 15 (8 for one kind), setup/screens/status 15." },
    { id: "completeness", label: "Set completeness", weight: 15, explain: "60% filled slots out of six, 40% how complete each set is (ability, item and four moves)." }
  ];

  function scoreTeam(members, ctx) {
    const { cov, summary, roles } = ctx;
    if (!members.length) {
      return { overall: 0, components: SCORE_COMPONENTS.map(c => ({ ...c, score: 0, details: [] })) };
    }
    // Offense
    const offense = Math.round(100 * (0.4 * cov.covered.length / 18 + 0.6 * cov.dual.hit / cov.dual.total));
    const offenseDetails = [`${cov.covered.length}/18 types and ${cov.dual.hit}/${cov.dual.total} dual-type combinations hit super-effectively.`];
    // Defense
    let excess = 0, quad = 0;
    ALL_TYPES.forEach(t => {
      const s = summary[t];
      excess += Math.max(0, s.weak - (s.resist + s.immune));
      quad += s.quadNames.length;
    });
    const defense = Math.max(0, 100 - 7 * excess - 4 * quad);
    const defenseDetails = [`${excess} uncovered weakness point(s) and ${quad} 4x weakness(es).`];
    // Roles
    const r = roles;
    const pts = [];
    const add = (cond, n, text) => { if (cond) pts.push([n, text]); };
    add(r.hazards.length >= 1, 15, "has entry hazards");
    add(r.removal.length >= 1, 15, "has hazard removal");
    add(r.recovery.length >= 2, 15, "has recovery on 2+ members");
    add(r.recovery.length === 1, 8, "has recovery on 1 member");
    add(r.pivot.length >= 1, 10, "has a pivot move");
    add(r.speedControl.length + r.priority.length >= 1, 15, "has speed control or priority");
    add(r.physical.length >= 1 && r.special.length >= 1, 15, "has both physical and special attackers");
    add((r.physical.length >= 1) !== (r.special.length >= 1), 8, "has only one attacking kind");
    add(r.setup.length + r.screens.length + r.status.length >= 1, 15, "has setup, screens or status/disruption");
    const roleScore = Math.min(100, pts.reduce((a, p) => a + p[0], 0));
    const roleDetails = pts.length ? pts.map(p => `+${p[0]}: ${p[1]}`) : ["No roles found in the selected moves and abilities."];
    // Completeness
    const setFill = members.reduce((a, m) => a + ((m.ability ? 1 : 0) + (m.item ? 1 : 0) + m.moves.filter(Boolean).length) / 6, 0) / members.length;
    const completeness = Math.round(100 * (0.6 * members.length / 6 + 0.4 * setFill));
    const completeDetails = [`${members.length}/6 slots filled; sets are ${Math.round(setFill * 100)}% complete on average.`];

    const scores = { offense, defense, roles: roleScore, completeness };
    const details = { offense: offenseDetails, defense: defenseDetails, roles: roleDetails, completeness: completeDetails };
    const components = SCORE_COMPONENTS.map(c => ({ ...c, score: scores[c.id], details: details[c.id] }));
    const overall = Math.round(components.reduce((a, c) => a + c.score * c.weight, 0) / 100);
    return { overall, components };
  }

  // ---- Observations: each states the evidence it rests on ----
  function observations(members, ctx) {
    const { summary, cov, roles, shared, validation } = ctx;
    const out = [];
    const add = (priority, text, evidence) => out.push({ priority, text, evidence: evidence || "" });
    const names = list => list.map(pretty).join(", ");

    if (validation) {
      const errors = validation.issues.filter(i => i.severity === "error");
      if (errors.length) add("high", `${errors.length} rule problem(s) found in the team builder checks.`, errors.slice(0, 3).map(e => e.text).join(" "));
    }
    if (members.length < 6) add("high", `Only ${members.length}/6 slots are filled.`);

    shared.forEach(({ type, weakNames, answers }) => {
      if (weakNames.length >= 3 && answers.length < weakNames.length) {
        add("high", `${weakNames.length} members are weak to ${pretty(type)} and only ${answers.length} can resist or ignore it.`, `Weak: ${names(weakNames)}. Answers: ${answers.length ? names(answers) : "none"}.`);
      } else if (weakNames.length === 2 && answers.length === 0) {
        add("medium", `${pretty(type)} hits two members super-effectively and nothing on the team resists or is immune to it.`, `Weak: ${names(weakNames)}.`);
      }
    });
    const quads = ALL_TYPES.filter(t => summary[t].quadNames.length);
    quads.forEach(t => add("low", `${names(summary[t].quadNames)} take 4x damage from ${pretty(t)} moves.`));

    const unanswered = ALL_TYPES.filter(t => summary[t].resist + summary[t].immune === 0);
    if (members.length >= 3 && unanswered.length >= 4) {
      add("medium", `No member resists or is immune to ${names(unanswered.slice(0, 6))}${unanswered.length > 6 ? ", …" : ""}.`);
    }
    if (cov.moveTypes.length === 0) add("high", "No damaging moves are selected, so offensive coverage cannot be assessed.");
    else if (cov.uncovered.length) add("medium", `Selected damaging moves do not hit ${names(cov.uncovered.slice(0, 6))}${cov.uncovered.length > 6 ? ", …" : ""} super-effectively.`, `Move types used: ${names(cov.moveTypes)}.`);
    if (cov.unresolved.length) add("medium", `Could not look up ${names(cov.unresolved)}; they are left out of coverage and role detection.`);

    if (!roles.hazards.length) add("low", "No entry hazard move is selected (in singles, hazards such as Stealth Rock are commonly used).");
    if (roles.hazards.length && !roles.removal.length) add("low", "The team sets hazards but has no hazard removal (Rapid Spin, Defog and similar).");
    if (!roles.recovery.length && members.length >= 4) add("low", "No recovery move is selected on any member.");
    if (!roles.physical.length && !roles.special.length && cov.moveTypes.length) add("low", "No physical or special attacker could be identified from the selected moves.");

    members.forEach(m => {
      const n = pretty(m.name);
      const picked = m.moves.filter(Boolean);
      if (picked.length < 4) add("medium", `${n} has ${4 - picked.length} empty move slot(s).`);
      if (!m.ability) add("medium", `${n} has no ability selected.`);
      if (!m.item) add("low", `${n} has no held item.`);
      const nat = L.NATURES[m.nature];
      if (nat && m.evs[nat[1]] > 0) add("low", `${n}'s ${pretty(m.nature)} nature lowers ${nat[1].toUpperCase()}, but ${m.evs[nat[1]]} EVs are invested there.`);
    });

    if (!out.length) add("low", "No issues found by these checks. They cover types, abilities, selected moves and set completeness only, not specific matchups or format meta.");
    const order = { high: 1, medium: 2, low: 3 };
    return out.sort((a, b) => order[a.priority] - order[b.priority]);
  }

  // Assumptions shown with every report
  const ASSUMPTIONS = [
    "Type chart is Generation 6+ (with Fairy); the report does not switch charts per format.",
    "Defense accounts for typing, the abilities listed in the code (e.g. Levitate, Flash Fire, Thick Fat) and Air Balloon. Mold Breaker, weather, Tera types and other effects are not modelled.",
    "Coverage uses the type of each selected damaging move. Move power, accuracy, STAB, fixed-damage and variable-type moves are not modelled.",
    "Roles are detected from move and ability names and assume singles play. Doubles and VGC value other roles (Fake Out, redirection, spread moves).",
    "Speed uses each set's own level, nature, IVs and EVs, with Choice Scarf. Stat stages, weather and paralysis are ignored.",
    "The score is a weighted checklist whose weights are judgement calls, tested only for sensible ordering on example teams. It is not a competitive rating."
  ];

  // One call for the whole report. members: filled slots. moveInfo: { move: {type, damageClass, priority} }
  function analyzeTeam(members, moveInfo, opts) {
    const summary = defensiveSummary(members);
    const list = (key) => ALL_TYPES.filter(t => summary[t][key] > 0).map(t => ({ type: t, count: summary[t][key], names: summary[t][key + "Names"] })).sort((a, b) => b.count - a.count);
    const roles = teamRoles(members, moveInfo);
    const cov = coverage(members, moveInfo);
    const shared = sharedWeaknesses(summary);
    const score = scoreTeam(members, { cov, summary, roles });
    return {
      summary, weaknesses: list("weak"), resistances: list("resist"), immunities: list("immune"),
      shared, roles, cov, speed: speedTiers(members), score,
      observations: observations(members, { summary, cov, roles, shared, validation: opts && opts.validation }),
      assumptions: ASSUMPTIONS
    };
  }

  return {
    ABILITY_DEFENSE, ROLE_LABELS, SCORE_COMPONENTS, ASSUMPTIONS,
    defensiveMultiplier, defensiveSummary, sharedWeaknesses, memberRoles, teamRoles, speedTiers,
    coverage, scoreTeam, observations, analyzeTeam
  };
});
