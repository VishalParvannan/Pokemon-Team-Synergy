// Team analysis: ability/item-aware defense, coverage from selected moves, roles, speed,
// a documented checklist score and evidence-backed observations. Pure (no DOM, no network).
//
// Everything here is a heuristic oriented to singles play. Rules (type chart, damage
// multipliers) are kept apart from strategy (roles, score) in the output.
(function (root, factory) {
  const L = typeof require === "function" ? require("./logic.js") : root.PokeLogic;
  const T = typeof require === "function" ? require("./team.js") : root.PokeTeam;
  const V = typeof require === "function" ? require("./viability.js") : root.PokeViability;
  if (typeof module === "object" && module.exports) module.exports = factory(L, T, V);
  else root.PokeAnalysis = factory(L, T, V);
})(typeof self !== "undefined" ? self : this, function (L, T, V) {
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
  // gen: the format's generation (selects the type chart); omitted = current chart
  function defensiveMultiplier(member, atkType, gen) {
    const base = getDefensiveMultiplier(member.types || [], atkType, gen);
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
  function defensiveSummary(members, gen) {
    const summary = {};
    L.typesFor(gen).forEach(atk => {
      // mults: each member's multiplier, in team order (for the report's type chart)
      const s = { weak: 0, resist: 0, immune: 0, viaAbilityOrItem: 0, weakNames: [], resistNames: [], immuneNames: [], quadNames: [], mults: [] };
      members.forEach(m => {
        const { mult, source } = defensiveMultiplier(m, atk, gen);
        s.mults.push(mult);
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
    return Object.keys(summary).filter(t => summary[t].weak >= 2).map(t => ({
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
    weatherMoves: ["sunny-day", "rain-dance", "sandstorm", "snowscape", "hail", "electric-terrain", "grassy-terrain", "misty-terrain", "psychic-terrain"],
    // Doubles-specific
    fakeOut: ["fake-out"],
    redirection: ["follow-me", "rage-powder", "ally-switch", "spotlight"],
    protect: ["protect", "detect", "spiky-shield", "kings-shield", "baneful-bunker", "obstruct", "silk-trap", "burning-bulwark"],
    support: ["helping-hand", "wide-guard", "quick-guard", "coaching", "decorate", "pollen-puff", "after-you", "instruct", "beat-up", "snarl", "breaking-swipe", "struggle-bug"]
  };
  // Moves that hit more than one target in doubles (PokeAPI move targets); names are the fallback when move data is missing
  const SPREAD_TARGETS = ["all-other-pokemon", "all-opponents"];
  const SPREAD_FALLBACK = ["earthquake", "rock-slide", "heat-wave", "dazzling-gleam", "hyper-voice", "surf", "discharge", "blizzard", "icy-wind", "electroweb", "bulldoze", "snarl", "make-it-rain", "eruption", "water-spout", "muddy-water", "sludge-wave", "glacial-lance", "astral-barrage", "boomburst", "parabolic-charge", "lava-plume", "bleakwind-storm", "springtide-storm", "sandsear-storm", "wildbolt-storm"];
  const PRIORITY_FALLBACK = ["extreme-speed", "fake-out", "aqua-jet", "bullet-punch", "ice-shard", "mach-punch", "shadow-sneak", "sucker-punch", "quick-attack", "vacuum-wave", "water-shuriken", "accelerock", "jet-punch", "first-impression", "thunderclap", "upper-hand"];
  // Moves that earn a slot without dealing damage (every role list above), for the viability check
  const UTILITY_MOVES = () => new Set(Object.values(MOVE_ROLES).flat().concat(PRIORITY_FALLBACK));
  const WEATHER_ABILITIES = ["drought", "drizzle", "sand-stream", "snow-warning", "orichalcum-pulse", "hadron-engine", "electric-surge", "grassy-surge", "psychic-surge", "misty-surge", "desolate-land", "primordial-sea", "delta-stream", "sand-spit", "seed-sower"];

  const ROLE_LABELS = {
    hazards: "Entry hazards", removal: "Hazard removal", recovery: "Recovery", pivot: "Pivoting",
    priority: "Priority moves", setup: "Setup moves", screens: "Screens", speedControl: "Speed control",
    phazing: "Phazing / haze", status: "Status & disruption", weather: "Weather / terrain",
    intimidate: "Intimidate", physical: "Physical attackers", special: "Special attackers",
    fakeOut: "Fake Out", redirection: "Redirection", protect: "Protect / Detect", spread: "Spread moves", support: "Ally support"
  };
  // Which roles the report lists in each battle style
  const ROLE_KEYS = {
    singles: ["hazards", "removal", "recovery", "pivot", "priority", "setup", "screens", "speedControl", "phazing", "status", "weather", "intimidate", "physical", "special"],
    doubles: ["speedControl", "fakeOut", "protect", "spread", "redirection", "support", "intimidate", "weather", "priority", "screens", "setup", "recovery", "physical", "special"]
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
    if (moves.some(m => { const i = info(m); return i && i.target ? i.damageClass !== "status" && SPREAD_TARGETS.includes(i.target) : SPREAD_FALLBACK.includes(m); })) roles.add("spread");
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
  // gen: the format's generation (Gen 1-2 use the old stat system)
  function speedTiers(members, gen) {
    return members.map(m => {
      const spe = calcAllStats(m, gen).spe;
      const scarf = m.item === "choice-scarf";
      return { name: m.name, level: m.level, spe, effective: scarf ? Math.floor(spe * 1.5) : spe, note: scarf ? "with Choice Scarf" : "" };
    }).sort((a, b) => b.effective - a.effective);
  }

  // ---- Coverage ----
  function coverage(members, moveInfo, gen) {
    const picked = Array.from(new Set(members.flatMap(m => m.moves.filter(Boolean))));
    const unresolved = picked.filter(m => !(moveInfo && moveInfo[m]));
    const moveTypes = Array.from(new Set(picked.map(m => moveInfo && moveInfo[m]).filter(i => i && i.damageClass !== "status").map(i => i.type)));
    const covered = coveredTypes(moveTypes, gen);
    const types = L.typesFor(gen);
    return { moveTypes, covered, uncovered: types.filter(t => !covered.includes(t)), typeCount: types.length, dual: dualTypeCoverage(moveTypes, gen), unresolved };
  }

  // ---- Score: weighted checklist (documented in SCORE_COMPONENTS, not a competitive rating) ----
  const ROLES_EXPLAIN = {
    singles: "Checklist from selected moves and abilities: entry hazards 15, hazard removal 15, recovery 15 (8 for one user), pivoting 10, speed control or priority 15, physical and special attackers 15 (8 for one kind), setup/screens/status 15.",
    doubles: "Checklist from selected moves and abilities: speed control (Tailwind, Trick Room, Icy Wind, ...) 20, Fake Out 15, Protect on 4+ members 15 (8 for 2-3), spread moves 15, redirection or ally support 10, Intimidate 10, physical and special attackers 15 (8 for one kind)."
  };
  // Component weights (sum 100), calibrated per battle style against Smogon sample teams vs random
  // teams of popular sets; see calibration/README.md (run: node calibration/run.js).
  const CALIBRATED_WEIGHTS = {
    singles: { offense: 20, defense: 20, roles: 5, completeness: 15, threats: 20, viability: 20 },
    doubles: { offense: 0, defense: 5, roles: 5, completeness: 15, threats: 40, viability: 35 }
  };
  const CALIBRATION = {
    // Held-out AUC vs each baseline, and mean test scores of each kind of team (reference points for the report)
    singles: { vsPopular: 0.648, vsPopularCi95: [0.571, 0.714], vsRandom: 0.995, vsRandomCi95: [0.989, 0.998],
      experts: 207, popular: 1680, random: 844, means: { expert: 85, popular: 83, random: 66 } },
    doubles: { vsPopular: 0.775, vsPopularCi95: [0.58, 0.93], vsRandom: 1, vsRandomCi95: [1, 1],
      experts: 33, popular: 312, random: 156, means: { expert: 91, popular: 88, random: 63 } }
  };
  const DEFAULT_WEIGHTS = CALIBRATED_WEIGHTS.singles;
  // withThreats: include the threat-matchup component (only when usage data and the calculator ran;
  // otherwise the remaining weights are renormalized)
  function scoreComponents(doubles, weights, withThreats) {
    const w = { ...CALIBRATED_WEIGHTS[doubles ? "doubles" : "singles"], ...(weights || {}) };
    const list = [
      { id: "offense", label: "Offensive coverage", weight: w.offense, explain: "40% share of the format's types (18 from Gen 6, 17 in Gen 2-5, 15 in Gen 1) hit super-effectively by at least one selected damaging move, 60% share of all dual-type combinations hit super-effectively." },
      { id: "defense", label: "Defensive balance", weight: w.defense, explain: "Starts at 100. Subtracts 7 for every extra member weak to a type beyond those that resist or are immune to it (abilities and Air Balloon included), and 4 per 4x weakness." },
      { id: "roles", label: doubles ? "Team roles (doubles)" : "Team roles (singles)", weight: w.roles, explain: (doubles ? ROLES_EXPLAIN.doubles : ROLES_EXPLAIN.singles) + (w.roles === 0 ? " Shown for information only: in calibration it did not separate expert teams from random ones, so it carries no weight." : "") },
      { id: "completeness", label: "Set completeness", weight: w.completeness, explain: "60% filled slots out of six, 40% how complete each set is (ability, item and four moves)." }
    ];
    if (w.viability > 0) {
      list.push({ id: "viability", label: "Competitive viability", weight: w.viability, explain: "Average per Pokémon: base stat total vs the format's most-used Pokémon (35%), its strongest attack counting STAB (15%), how many moves earn their slot (20%), whether its item does anything for it (15%) and EV investment (15%); x0.6 if not fully evolved without Eviolite. Criteria from the VGCguide team-building chapters (Wolfe Glick, Aaron Traylor) and standard competitive practice." });
    }
    if (withThreats && w.threats > 0) {
      list.push({ id: "threats", label: "Threat matchups", weight: w.threats, explain: "Against the 20 most-used Pokémon of the format with their most common sets (damage calculations): half the share that are not high-level threats, half how rarely they OHKO your Pokémon." });
    }
    return list;
  }
  const SCORE_COMPONENTS = scoreComponents(false);

  function scoreTeam(members, ctx) {
    const { cov, summary, roles, doubles } = ctx;
    const threat = ctx.threat && typeof ctx.threat.score === "number" ? ctx.threat : null;
    const COMPONENTS = scoreComponents(!!doubles, ctx.weights, !!threat);
    if (!members.length) {
      return { overall: 0, components: COMPONENTS.map(c => ({ ...c, score: 0, details: [] })), calibration: CALIBRATION[doubles ? "doubles" : "singles"], threatsIncluded: !!threat };
    }
    // Offense
    const offense = Math.round(100 * (0.4 * cov.covered.length / cov.typeCount + 0.6 * cov.dual.hit / cov.dual.total));
    const offenseDetails = [`${cov.covered.length}/${cov.typeCount} types and ${cov.dual.hit}/${cov.dual.total} dual-type combinations hit super-effectively.`];
    // Defense
    let excess = 0, quad = 0;
    Object.keys(summary).forEach(t => {
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
    if (doubles) {
      add(r.speedControl.length >= 1, 20, "has speed control");
      add(r.fakeOut.length >= 1, 15, "has Fake Out");
      add(r.protect.length >= 4, 15, "has Protect on 4+ members");
      add(r.protect.length >= 2 && r.protect.length < 4, 8, "has Protect on 2-3 members");
      add(r.spread.length >= 1, 15, "has spread moves");
      add(r.redirection.length + r.support.length >= 1, 10, "has redirection or ally support");
      add(r.intimidate.length >= 1, 10, "has Intimidate");
    } else {
      add(r.hazards.length >= 1, 15, "has entry hazards");
      add(r.removal.length >= 1, 15, "has hazard removal");
      add(r.recovery.length >= 2, 15, "has recovery on 2+ members");
      add(r.recovery.length === 1, 8, "has recovery on 1 member");
      add(r.pivot.length >= 1, 10, "has a pivot move");
      add(r.speedControl.length + r.priority.length >= 1, 15, "has speed control or priority");
      add(r.setup.length + r.screens.length + r.status.length >= 1, 15, "has setup, screens or status/disruption");
    }
    add(r.physical.length >= 1 && r.special.length >= 1, 15, "has both physical and special attackers");
    add((r.physical.length >= 1) !== (r.special.length >= 1), 8, "has only one attacking kind");
    const roleScore = Math.min(100, pts.reduce((a, p) => a + p[0], 0));
    const roleDetails = pts.length ? pts.map(p => `+${p[0]}: ${p[1]}`) : ["No roles found in the selected moves and abilities."];
    // Completeness
    const setFill = members.reduce((a, m) => a + ((m.ability ? 1 : 0) + (m.item ? 1 : 0) + m.moves.filter(Boolean).length) / 6, 0) / members.length;
    const completeness = Math.round(100 * (0.6 * members.length / 6 + 0.4 * setFill));
    const completeDetails = [`${members.length}/6 slots filled; sets are ${Math.round(setFill * 100)}% complete on average.`];

    const via = ctx.viability;
    const scores = { offense, defense, roles: roleScore, completeness, threats: threat ? threat.score : 0, viability: via ? via.score : 0 };
    const details = { offense: offenseDetails, defense: defenseDetails, roles: roleDetails, completeness: completeDetails,
      viability: via ? via.members.map(p => `${pretty(p.name)}: ${p.score}${p.issues.length ? ` (${p.issues[0]})` : ""}`) : [],
      threats: threat ? [`${Math.round(threat.notHighShare * threat.considered)}/${threat.considered} top threats are not high-level threats; on average they OHKO ${Math.round((1 - threat.ohkoAvoidance) * 100)}% of your team.`] : [] };
    // Weights are renormalized over the components present (threats are absent without usage data)
    const totalWeight = COMPONENTS.reduce((a, c) => a + c.weight, 0) || 1;
    // Displayed weights: percentages that sum to exactly 100 (largest-remainder rounding)
    const raw = COMPONENTS.map(c => (c.weight / totalWeight) * 100);
    const shown = raw.map(Math.floor);
    raw.map((x, i) => [x - shown[i], i]).sort((a, b) => b[0] - a[0]).slice(0, 100 - shown.reduce((a, b) => a + b, 0)).forEach(([, i]) => { shown[i]++; });
    const components = COMPONENTS.map((c, i) => ({ ...c, weight: shown[i], score: scores[c.id], details: details[c.id] }));
    const overall = Math.round(COMPONENTS.reduce((a, c) => a + scores[c.id] * c.weight, 0) / totalWeight);
    return { overall, components, calibration: CALIBRATION[doubles ? "doubles" : "singles"], threatsIncluded: !!threat };
  }

  // ---- Observations: each states the evidence it rests on ----
  function observations(members, ctx) {
    const { summary, cov, roles, shared, validation, viability } = ctx;
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
    const quads = Object.keys(summary).filter(t => summary[t].quadNames.length);
    quads.forEach(t => add("low", `${names(summary[t].quadNames)} take 4x damage from ${pretty(t)} moves.`));

    const unanswered = Object.keys(summary).filter(t => summary[t].resist + summary[t].immune === 0);
    if (members.length >= 3 && unanswered.length >= 4) {
      add("medium", `No member resists or is immune to ${names(unanswered.slice(0, 6))}${unanswered.length > 6 ? ", …" : ""}.`);
    }
    if (cov.moveTypes.length === 0) add("high", "No damaging moves are selected, so offensive coverage cannot be assessed.");
    else if (cov.uncovered.length) add("medium", `Selected damaging moves do not hit ${names(cov.uncovered.slice(0, 6))}${cov.uncovered.length > 6 ? ", …" : ""} super-effectively.`, `Move types used: ${names(cov.moveTypes)}.`);
    if (viability && viability.members.length) {
      const unevolved = viability.members.filter(p => p.unevolved).map(p => p.name);
      if (unevolved.length >= 2) add(unevolved.length >= 3 ? "high" : "medium", `${unevolved.length} of your Pokémon are not fully evolved and hold no Eviolite. They can work in specific roles, but a team of them is usually outclassed.`, `Not fully evolved: ${names(unevolved)}.`);
      viability.members.filter(p => p.score < 50).forEach(p => add("medium", `${pretty(p.name)} looks weak for this format (viability ${p.score}/100).`, p.issues.join("; ") + "."));
      viability.members.filter(p => p.score >= 50 && p.issues.some(i => /item|Eviolite|Vest|locks it/.test(i))).forEach(p => add("low", `${pretty(p.name)}'s item does little for it.`, p.issues.filter(i => /item|Eviolite|Vest|locks it|only works|boosts|no effect/.test(i)).join("; ") + "."));
    }
    if (cov.unresolved.length) add("medium", `Could not look up ${names(cov.unresolved)}; they are left out of coverage and role detection.`);

    if (ctx.doubles) {
      if (!roles.speedControl.length) add("medium", "No speed control (Tailwind, Trick Room, Icy Wind, Electroweb, Choice Scarf and similar), which most doubles teams rely on.");
      if (!roles.fakeOut.length) add("low", "No Fake Out user. It is a common way to take a free turn in doubles.");
      if (roles.protect.length < 2 && members.length >= 4) add("low", `Only ${roles.protect.length} member(s) carry Protect or Detect; in doubles most sets do.`);
      if (!roles.spread.length && cov.moveTypes.length) add("low", "No spread moves (Earthquake, Rock Slide, Heat Wave and similar) that hit both opponents.");
    } else {
      if (!roles.hazards.length) add("low", "No entry hazard move is selected (in singles, hazards such as Stealth Rock are commonly used).");
      if (roles.hazards.length && !roles.removal.length) add("low", "The team sets hazards but has no hazard removal (Rapid Spin, Defog and similar).");
      if (!roles.recovery.length && members.length >= 4) add("low", "No recovery move is selected on any member.");
    }
    if (!roles.physical.length && !roles.special.length && cov.moveTypes.length) add("low", "No physical or special attacker could be identified from the selected moves.");

    members.forEach(m => {
      const n = pretty(m.name);
      const picked = m.moves.filter(Boolean);
      if (picked.length < 4) add("medium", `${n} has ${4 - picked.length} empty move slot(s).`);
      // Abilities and natures arrived in Gen 3, held items in Gen 2
      const oldGen = ctx.gen && ctx.gen <= 2;
      if (!m.ability && !oldGen) add("medium", `${n} has no ability selected.`);
      if (!m.item && !(ctx.gen === 1)) add("low", `${n} has no held item.`);
      const nat = oldGen ? null : L.NATURES[m.nature];
      if (nat && m.evs[nat[1]] > 0) add("low", `${n}'s ${pretty(m.nature)} nature lowers ${nat[1].toUpperCase()}, but ${m.evs[nat[1]]} EVs are invested there.`);
    });

    if (!out.length) add("low", "No issues found by these checks. They cover types, abilities, selected moves and set completeness only, not specific matchups or format meta.");
    const order = { high: 1, medium: 2, low: 3 };
    return out.sort((a, b) => order[a.priority] - order[b.priority]);
  }

  // Assumptions shown with every report
  function assumptions(doubles) {
    return [
      "Type matchups use the format's generation chart (no Fairy before Gen 6, no Dark or Steel in Gen 1, and Gen 1's Ghost/Psychic, Bug/Poison and Ice/Fire quirks) and each Pokémon's types in that generation. The 'All Pokémon' format uses the current chart.",
      "Defense accounts for typing, the abilities listed in the code (e.g. Levitate, Flash Fire, Thick Fat) and Air Balloon. Mold Breaker, weather, Tera types and other effects are not modelled.",
      "Coverage uses the type of each selected damaging move. Move power, accuracy and STAB are covered by the damage calculator and threat list, not by the coverage summary.",
      doubles
        ? "Roles are detected from move and ability names for doubles play (speed control, Fake Out, Protect, spread moves, redirection). VGC-specific rules (level 50, bring six pick four, restricted Pokémon) are not applied."
        : "Roles are detected from move and ability names and assume singles play. Switch to Doubles to evaluate doubles roles.",
      "Speed uses each set's own level, nature, IVs and EVs, with Choice Scarf. Stat stages, weather and paralysis are ignored.",
      `The score's weights were calibrated so that Smogon sample teams outscore both random teams of popular sets and fully random teams. On held-out teams an expert team outscores the first ${Math.round(CALIBRATION[doubles ? "doubles" : "singles"].vsPopular * 100)}% of the time and the second ${Math.round(CALIBRATION[doubles ? "doubles" : "singles"].vsRandom * 100)}% (50% would be chance). It reliably spots unviable teams but only weakly ranks good teams against each other; it is not a competitive rating.`
    ];
  }
  const ASSUMPTIONS = assumptions(false);

  // One call for the whole report. members: filled slots. moveInfo: { move: {type, damageClass, priority} }
  function analyzeTeam(members, moveInfo, opts) {
    const gen = opts && opts.gen ? opts.gen : null;
    const summary = defensiveSummary(members, gen);
    const list = (key) => Object.keys(summary).filter(t => summary[t][key] > 0).map(t => ({ type: t, count: summary[t][key], names: summary[t][key + "Names"] })).sort((a, b) => b.count - a.count);
    const roles = teamRoles(members, moveInfo);
    const cov = coverage(members, moveInfo, gen);
    const shared = sharedWeaknesses(summary);
    const doubles = !!(opts && opts.doubles);
    const viability = V.teamViability(members, {
      gen, moveInfo, utilityMoves: UTILITY_MOVES(),
      refBst: opts && opts.refBst, speciesInfo: opts && opts.speciesInfo, battleItems: opts && opts.battleItems
    });
    const score = scoreTeam(members, { cov, summary, roles, doubles, viability, weights: opts && opts.weights, threat: opts && opts.threat });
    return {
      members: members.map(m => ({ name: m.name, sprite: m.sprite || null })),
      summary, weaknesses: list("weak"), resistances: list("resist"), immunities: list("immune"),
      gen, viability, shared, roles, roleKeys: doubles ? ROLE_KEYS.doubles : ROLE_KEYS.singles, cov, speed: speedTiers(members, gen), score, doubles,
      observations: observations(members, { gen, summary, cov, roles, shared, doubles, viability, validation: opts && opts.validation }),
      assumptions: assumptions(doubles)
    };
  }

  return {
    ABILITY_DEFENSE, ROLE_LABELS, ROLE_KEYS, SCORE_COMPONENTS, ASSUMPTIONS, DEFAULT_WEIGHTS, CALIBRATED_WEIGHTS, CALIBRATION, scoreComponents,
    defensiveMultiplier, defensiveSummary, sharedWeaknesses, memberRoles, teamRoles, speedTiers,
    coverage, scoreTeam, observations, analyzeTeam
  };
});
