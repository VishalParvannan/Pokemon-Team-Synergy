// Competitive viability of each team member: is this a Pokémon and set that can pull its weight in
// the format? Criteria follow the VGCguide team-building chapters by Wolfe Glick and Aaron Traylor
// ("What Makes a Pokémon Good", "How to Pull it all Together") plus standard competitive practice:
//   - stats strong enough for the format, fully evolved unless holding Eviolite
//   - at least one damaging move that hurts, and moves that each earn their slot
//   - an item that does something for this Pokémon
//   - EV investment
// Pure: species data comes in through ctx.speciesInfo. See calibration/README.md for how much it helps.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PokeViability = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const TYPES = ["normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dark", "steel", "dragon", "fairy"];

  // Items that boost one type's moves (useless if the holder has no damaging move of that type)
  const TYPE_ITEMS = {
    "charcoal": "fire", "mystic-water": "water", "miracle-seed": "grass", "magnet": "electric", "never-melt-ice": "ice",
    "black-belt": "fighting", "poison-barb": "poison", "soft-sand": "ground", "sharp-beak": "flying", "twisted-spoon": "psychic",
    "silver-powder": "bug", "hard-stone": "rock", "spell-tag": "ghost", "dragon-fang": "dragon", "black-glasses": "dark",
    "metal-coat": "steel", "silk-scarf": "normal", "fairy-feather": "fairy",
    "sea-incense": "water", "wave-incense": "water", "rose-incense": "grass", "odd-incense": "psychic", "rock-incense": "rock",
    "flame-plate": "fire", "splash-plate": "water", "zap-plate": "electric", "meadow-plate": "grass", "icicle-plate": "ice",
    "fist-plate": "fighting", "toxic-plate": "poison", "earth-plate": "ground", "sky-plate": "flying", "mind-plate": "psychic",
    "insect-plate": "bug", "stone-plate": "rock", "spooky-plate": "ghost", "draco-plate": "dragon", "dread-plate": "dark",
    "iron-plate": "steel", "pixie-plate": "fairy"
  };
  TYPES.forEach(t => { TYPE_ITEMS[`${t}-gem`] = t; });

  // Items that only work for specific species (matched by name prefix, so forms count)
  const SPECIES_ITEMS = {
    "light-ball": ["pikachu"], "thick-club": ["cubone", "marowak"], "lucky-punch": ["chansey"], "leek": ["farfetchd", "sirfetchd"],
    "stick": ["farfetchd", "sirfetchd"], "metal-powder": ["ditto"], "quick-powder": ["ditto"], "soul-dew": ["latios", "latias"],
    "deep-sea-tooth": ["clamperl"], "deep-sea-scale": ["clamperl"], "adamant-orb": ["dialga"], "lustrous-orb": ["palkia"],
    "griseous-orb": ["giratina"], "rusted-sword": ["zacian"], "rusted-shield": ["zamazenta"], "red-orb": ["groudon"], "blue-orb": ["kyogre"]
  };
  TYPES.forEach(t => { SPECIES_ITEMS[`${t}-memory`] = ["silvally"]; });

  // Held items with no effect in battle (balls, medicine, evolution and collector items)
  const NO_BATTLE_EFFECT = /^(?!(iron|light)-ball$).*(^|-)ball$|potion|revive|(^|-)heal$|^(max-)?ether$|elixir|candy|repel|(^|-)(fire|water|thunder|leaf|moon|sun|shiny|dusk|dawn|ice|oval)-stone$|everstone|shard|(^|-)mail$|^(exp-share|amulet-coin|soothe-bell|cleanse-tag|lucky-egg|smoke-ball|pp-up|pp-max|nugget|big-nugget|pearl|big-pearl|stardust|star-piece|tiny-mushroom|big-mushroom|honey|escape-rope|fluffy-tail|poke-doll)$/;

  const CHOICE = ["choice-band", "choice-specs", "choice-scarf"];
  // Abilities that actively hold a Pokémon back
  const HANDICAP_ABILITIES = ["truant", "slow-start", "defeatist", "stall", "klutz"];

  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  // "light-ball" -> "Light Ball" for messages
  const nice = (id) => String(id).split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const SCORE_PARTS = { stats: 0.35, damage: 0.15, moves: 0.2, item: 0.15, investment: 0.15 };
  const NFE_FACTOR = 0.6; // not fully evolved without Eviolite
  const STAT_WINDOW = 160;
  const STRONG_HIT = 75; // power x STAB (1.5) needed for an attack to earn its slot (e.g. 75-power coverage, 50-power STAB) // base stat total this far below the format's reference scores 0

  // How well a held item suits this Pokémon and its moves: { value 0..1, issue | null }
  function itemFit(it, m, ctx, info) {
    const moves = (m.moves || []).filter(Boolean);
    const mi = (n) => ctx.moveInfo && ctx.moveInfo[n];
    const typeOf = TYPE_ITEMS[it];
    const owners = SPECIES_ITEMS[it];
    const statusMoves = moves.filter(n => mi(n) && mi(n).damageClass === "status");
    const damagingTypes = new Set(moves.map(mi).filter(x => x && x.damageClass !== "status").map(x => x.type));
    const nfe = !!(info && info.nfe);
    if (owners && !owners.some(o => m.name === o || m.name.startsWith(o + "-"))) return { value: 0, issue: `${nice(it)} only works for ${owners.map(nice).join("/")}` };
    if (NO_BATTLE_EFFECT.test(it) || (ctx.battleItems && ctx.battleItems.size && !ctx.battleItems.has(it))) return { value: 0, issue: `${nice(it)} has no effect in battle` };
    if (typeOf && !damagingTypes.has(typeOf)) return { value: 0.1, issue: `${nice(it)} boosts ${nice(typeOf)} moves, but it has none` };
    if (it === "eviolite" && !nfe && info) return { value: 0, issue: "Eviolite only works on Pokémon that can still evolve" };
    if (it === "assault-vest" && statusMoves.length) return { value: 0.2, issue: "Assault Vest blocks its status moves" };
    if (CHOICE.includes(it) && statusMoves.length >= 2) return { value: 0.3, issue: `${nice(it)} locks it into one move, but it carries status moves` };
    return { value: 1, issue: null };
  }

  // Items competitive players actually use, for the random team builder. Each maps to a condition under which
  // it helps this Pokémon and set (true = generally useful). Anything not listed (contest scarves, training
  // items, Iron Ball, evolution items...) is never picked. Type boosters and plates are handled by TYPE_ITEMS.
  const hasMove = (m, list) => (m.moves || []).some(n => list.includes(n));
  const hasAbility = (m, list) => list.includes(m.ability);
  const damagingCount = (m, ctx) => (m.moves || []).filter(n => n && ctx.moveInfo && ctx.moveInfo[n] && ctx.moveInfo[n].damageClass !== "status").length;
  const categoryCount = (m, ctx, cls) => (m.moves || []).filter(n => n && ctx.moveInfo && ctx.moveInfo[n] && ctx.moveInfo[n].damageClass === cls).length;
  const RESIST_BERRIES = {
    "occa-berry": "fire", "passho-berry": "water", "wacan-berry": "electric", "rindo-berry": "grass", "yache-berry": "ice",
    "chople-berry": "fighting", "kebia-berry": "poison", "shuca-berry": "ground", "coba-berry": "flying", "payapa-berry": "psychic",
    "tanga-berry": "bug", "charti-berry": "rock", "kasib-berry": "ghost", "haban-berry": "dragon", "colbur-berry": "dark",
    "babiri-berry": "steel", "roseli-berry": "fairy"
  };
  const RANDOM_ITEMS = {
    "leftovers": true, "sitrus-berry": true, "lum-berry": true, "rocky-helmet": true, "focus-sash": true, "heavy-duty-boots": true,
    "covert-cloak": true, "clear-amulet": true, "safety-goggles": true, "air-balloon": true, "mental-herb": true,
    "eject-button": true, "red-card": true, "quick-claw": true, "shell-bell": true, "bright-powder": true, "scope-lens": true,
    "weakness-policy": true, "custap-berry": true, "kings-rock": true, "focus-band": true,
    "life-orb": (m, ctx) => damagingCount(m, ctx) >= 2,
    "expert-belt": (m, ctx) => damagingCount(m, ctx) >= 3,
    "choice-band": (m, ctx) => categoryCount(m, ctx, "physical") >= 3,
    "choice-specs": (m, ctx) => categoryCount(m, ctx, "special") >= 3,
    "choice-scarf": (m, ctx) => damagingCount(m, ctx) >= 3,
    "assault-vest": (m, ctx) => damagingCount(m, ctx) === (m.moves || []).filter(Boolean).length,
    "muscle-band": (m, ctx) => categoryCount(m, ctx, "physical") >= 2,
    "wise-glasses": (m, ctx) => categoryCount(m, ctx, "special") >= 2,
    "liechi-berry": (m, ctx) => categoryCount(m, ctx, "physical") >= 2,
    "petaya-berry": (m, ctx) => categoryCount(m, ctx, "special") >= 2,
    "salac-berry": (m, ctx) => damagingCount(m, ctx) >= 2,
    "throat-spray": (m) => hasMove(m, ["hyper-voice", "boomburst", "bug-buzz", "overdrive", "snarl", "torch-song", "clanging-scales", "disarming-voice", "sparkling-aria", "psychic-noise", "alluring-voice"]),
    "loaded-dice": (m) => hasMove(m, ["bullet-seed", "icicle-spear", "rock-blast", "scale-shot", "population-bomb", "tail-slap", "pin-missile", "bone-rush", "arm-thrust", "water-shuriken"]),
    "punching-glove": (m) => hasAbility(m, ["iron-fist"]),
    "booster-energy": (m) => hasAbility(m, ["protosynthesis", "quark-drive"]),
    "white-herb": (m) => hasMove(m, ["shell-smash", "close-combat", "draco-meteor", "overheat", "leaf-storm", "make-it-rain", "superpower"]),
    "power-herb": (m) => hasMove(m, ["meteor-beam", "solar-beam", "solar-blade", "electro-shot", "skull-bash", "sky-attack", "geomancy"]),
    "big-root": (m) => hasMove(m, ["giga-drain", "drain-punch", "horn-leech", "leech-seed", "draining-kiss", "leech-life", "parabolic-charge", "bitter-blade"]),
    "binding-band": (m) => hasMove(m, ["wrap", "bind", "fire-spin", "whirlpool", "sand-tomb", "magma-storm", "infestation", "thunder-cage", "snap-trap"]),
    "grip-claw": (m) => hasMove(m, ["wrap", "bind", "fire-spin", "whirlpool", "sand-tomb", "magma-storm", "infestation", "thunder-cage", "snap-trap"]),
    "light-clay": (m) => hasMove(m, ["reflect", "light-screen", "aurora-veil"]),
    "heat-rock": (m) => hasMove(m, ["sunny-day"]) || hasAbility(m, ["drought"]),
    "damp-rock": (m) => hasMove(m, ["rain-dance"]) || hasAbility(m, ["drizzle"]),
    "smooth-rock": (m) => hasMove(m, ["sandstorm"]) || hasAbility(m, ["sand-stream"]),
    "icy-rock": (m) => hasMove(m, ["hail", "snowscape"]) || hasAbility(m, ["snow-warning"]),
    "terrain-extender": (m) => hasMove(m, ["electric-terrain", "grassy-terrain", "misty-terrain", "psychic-terrain"]) || hasAbility(m, ["electric-surge", "grassy-surge", "misty-surge", "psychic-surge"]),
    "room-service": (m) => hasMove(m, ["trick-room"]),
    "chesto-berry": (m) => hasMove(m, ["rest"]),
    "flame-orb": (m) => hasAbility(m, ["guts", "flare-boost", "marvel-scale", "quick-feet", "magic-guard"]),
    "toxic-orb": (m) => hasAbility(m, ["poison-heal", "toxic-boost", "guts", "marvel-scale", "quick-feet", "magic-guard"]),
    "black-sludge": (m) => (m.types || []).includes("poison"),
    "eviolite": (m, ctx, info) => !!(info && info.nfe) // only when we know it can still evolve
  };
  Object.entries(RESIST_BERRIES).forEach(([berry, type]) => {
    RANDOM_ITEMS[berry] = (m, ctx) => !!(ctx.weakTo && ctx.weakTo(type)); // only for a type it is weak to
  });

  // Stricter check for the random team builder: the item must be one players use, and it must help this set
  function suitsRandomSet(it, m, ctx, info) {
    const rule = RANDOM_ITEMS[it];
    const typeOf = TYPE_ITEMS[it];
    if (rule === undefined && !typeOf) return false;
    if (typeOf && /-gem$/.test(it) && ctx.gen && ctx.gen !== 5) return false; // gems are only obtainable for every type in Gen 5
    if (typeof rule === "function" && !rule(m, ctx, info)) return false;
    return itemFit(it, m, ctx, info).value === 1;
  }

  // ---- Random sets: sensible moves, EVs and nature ----
  // Attacks a player would not pick on a random set: recharge, two-turn, situational or self-defeating moves
  const BAD_ATTACKS = new Set(["hyper-beam", "giga-impact", "blast-burn", "frenzy-plant", "hydro-cannon", "roar-of-time", "rock-wrecker",
    "prismatic-laser", "eternabeam", "meteor-assault", "solar-beam", "solar-blade", "meteor-beam", "skull-bash", "sky-attack", "razor-wind",
    "freeze-shock", "ice-burn", "electro-shot", "focus-punch", "dream-eater", "last-resort", "belch", "snore", "fling", "natural-gift",
    "spit-up", "synchronoise", "endeavor", "self-destruct", "explosion", "misty-explosion", "memento", "final-gambit", "struggle",
    "future-sight", "doom-desire", "bide", "counter", "mirror-coat", "metal-burst", "comeuppance", "steel-roller", "dig", "fly", "dive", "bounce",
    "phantom-force", "shadow-force", "sky-drop", "outrage", "thrash", "petal-dance", "rollout", "ice-ball", "uproar", "fake-out", "first-impression",
    "false-swipe", "hold-back", "feint", "pursuit", "round", "echoed-voice", "fury-cutter", "magnitude", "present", "spit-up", "trump-card",
    "punishment", "wring-out", "crush-grip", "return", "frustration", "rage", "smelling-salts", "wake-up-slap", "venoshock", "hex", "beat-up"]);
  // Fixed-damage attacks that are good regardless of power
  const FIXED_DAMAGE = new Set(["seismic-toss", "night-shade"]);
  // Non-damaging moves worth a slot, best first. Setup moves are added by attacking category.
  const GOOD_STATUS_SINGLES = ["stealth-rock", "recover", "roost", "slack-off", "soft-boiled", "synthesis", "moonlight", "morning-sun", "shore-up",
    "strength-sap", "wish", "will-o-wisp", "toxic", "thunder-wave", "spikes", "toxic-spikes", "sticky-web", "defog", "rapid-spin", "u-turn",
    "volt-switch", "flip-turn", "parting-shot", "knock-off", "taunt", "spore", "sleep-powder", "yawn", "encore", "substitute", "protect",
    "trick", "leech-seed", "pain-split", "haze", "whirlwind", "roar", "reflect", "light-screen", "aurora-veil", "trick-room", "tailwind"];
  const GOOD_STATUS_DOUBLES = ["protect", "detect", "fake-out", "tailwind", "trick-room", "follow-me", "rage-powder", "helping-hand", "icy-wind",
    "electroweb", "snarl", "wide-guard", "spore", "sleep-powder", "will-o-wisp", "thunder-wave", "taunt", "encore", "parting-shot",
    "u-turn", "volt-switch", "recover", "roost", "reflect", "light-screen", "aurora-veil", "pollen-puff", "coaching", "ally-switch"];
  const SPECIAL_TYPES_OLD = ["fire", "water", "grass", "electric", "ice", "psychic", "dragon", "dark"];
  const SETUP_PHYSICAL = ["swords-dance", "dragon-dance", "bulk-up", "shift-gear", "victory-dance", "coil", "howl", "hone-claws"];
  const SETUP_SPECIAL = ["nasty-plot", "calm-mind", "quiver-dance", "tail-glow", "torch-song"];

  // pool: move names this Pokémon can learn in the format; moveInfo: data for (some of) them
  // mon: { types, stats }; opts: { doubles, rand }
  // Returns { moves (up to 4), category: "physical" | "special" }
  function pickRandomMoves(pool, moveInfo, mon, opts) {
    const rand = (opts && opts.rand) || Math.random;
    const doubles = !!(opts && opts.doubles);
    const stats = mon.stats || {};
    const category = (stats.spa || 0) > (stats.atk || 0) ? "special" : "physical";
    const types = mon.types || [];
    const randomTop = (list, n) => list.length ? list[Math.floor(rand() * Math.min(n, list.length))] : null;
    // Before Gen 4 the move's type decides physical or special
    const gen = opts && opts.gen;
    const classOf = (mi) => gen && gen <= 3 ? (SPECIAL_TYPES_OLD.includes(mi.type) ? "special" : "physical") : mi.damageClass;

    // Rate the attacks: STAB and the Pokémon's better attacking stat count; weak or awkward attacks are dropped
    const attacks = pool.map(name => ({ name, mi: moveInfo[name] }))
      .filter(a => a.mi && a.mi.damageClass !== "status" && !BAD_ATTACKS.has(a.name))
      .map(a => {
        const stab = types.includes(a.mi.type);
        const power = FIXED_DAMAGE.has(a.name) ? 80 : (a.mi.power || 0);
        const fit = FIXED_DAMAGE.has(a.name) || classOf(a.mi) === category ? 1 : 0.6;
        return { name: a.name, type: a.mi.type, stab, fits: fit === 1, priority: a.mi.priority > 0, score: power * (stab ? 1.5 : 1) * fit };
      })
      .filter(a => a.score >= 60 || (a.priority && a.stab))
      .sort((a, b) => b.score - a.score);

    const chosen = [];
    const usedTypes = new Set();
    const take = (a) => { if (a) { chosen.push(a.name); usedTypes.add(a.type); } return a; };
    // 1. a strong same-type attack, 2. coverage of another type
    // (attacks that use its better attacking stat first)
    take(randomTop(attacks.filter(a => a.stab && a.fits && !a.priority), 3) || randomTop(attacks.filter(a => a.stab && !a.priority), 2) || randomTop(attacks, 2));
    take(randomTop(attacks.filter(a => !usedTypes.has(a.type) && a.fits && !a.priority), 3) || randomTop(attacks.filter(a => !usedTypes.has(a.type) && !a.priority), 3));

    // 3-4. useful non-attacking moves (or setup that matches its attacks), else more coverage
    const statusPref = (doubles ? GOOD_STATUS_DOUBLES : GOOD_STATUS_SINGLES).concat(category === "physical" ? SETUP_PHYSICAL : SETUP_SPECIAL);
    const inPool = new Set(pool);
    const utility = statusPref.filter(n => inPool.has(n) && !chosen.includes(n));
    // Shuffle within the preference order a little so sets vary
    const utilityPick = () => {
      const left = utility.filter(n => !chosen.includes(n));
      return randomTop(left, 4);
    };
    const coveragePick = () => randomTop(attacks.filter(a => !chosen.includes(a.name) && !usedTypes.has(a.type) && a.fits), 3)
      || randomTop(attacks.filter(a => !chosen.includes(a.name) && !usedTypes.has(a.type)), 3)
      || randomTop(attacks.filter(a => !chosen.includes(a.name)), 3);

    let statusCount = 0;
    while (chosen.length < 4) {
      const wantUtility = statusCount < 2 && (chosen.length >= 2 ? rand() < 0.6 : false);
      let added = false;
      if (wantUtility) { const u = utilityPick(); if (u) { chosen.push(u); statusCount++; added = true; } }
      if (!added) { const a = coveragePick(); if (a) { take(a); added = true; } }
      if (!added && statusCount < 2) { const u = utilityPick(); if (u) { chosen.push(u); statusCount++; added = true; } }
      if (!added) break;
    }
    // Too few good moves: fill from anything else it learns rather than leave slots empty
    const rest = pool.filter(n => !chosen.includes(n) && !BAD_ATTACKS.has(n));
    while (chosen.length < 4 && rest.length) chosen.push(rest.splice(Math.floor(rand() * rest.length), 1)[0]);
    return { moves: chosen.slice(0, 4), category };
  }

  // EVs and nature to match: fast Pokémon max attack and speed, slower ones max HP and attack
  function randomSpread(category, stats, rand) {
    rand = rand || Math.random;
    const atk = category === "special" ? "spa" : "atk";
    const fast = (stats && stats.spe || 0) >= 80;
    const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    let nature;
    if (fast) {
      evs[atk] = 252; evs.spe = 252; evs.hp = 4;
      nature = rand() < 0.5 ? (atk === "atk" ? "jolly" : "timid") : (atk === "atk" ? "adamant" : "modest");
    } else {
      evs.hp = 252; evs[atk] = 252; evs[rand() < 0.5 ? "def" : "spd"] = 4;
      nature = atk === "atk" ? "adamant" : "modest";
    }
    return { evs, nature };
  }

  // ctx: { gen, refBst, moveInfo: {move: {type, damageClass, priority, power}}, utilityMoves: Set,
  //        speciesInfo(name) -> { bst, nfe } | null, battleItems: Set|null }
  function memberViability(m, ctx) {
    const issues = [];
    const info = (ctx.speciesInfo && ctx.speciesInfo(m.name)) || null;
    const bst = info ? info.bst : Object.values(m.stats || {}).reduce((a, b) => a + b, 0);
    const nfe = !!(info && info.nfe);
    const ref = ctx.refBst || 520;

    // Stats relative to the format's top Pokémon
    const stats = clamp01((bst - (ref - STAT_WINDOW)) / STAT_WINDOW);
    if (stats < 0.5) issues.push(`base stat total ${bst} is well below the format's top Pokémon (around ${ref})`);
    const unevolved = nfe && m.item !== "eviolite";
    if (unevolved) issues.push("not fully evolved (no Eviolite)");

    // Moves: a move earns its slot if it hits hard (STAB counted), has priority, or is recognised utility
    const moves = (m.moves || []).filter(Boolean);
    let useful = 0, bestHit = 0, damaging = 0;
    const weak = [];
    moves.forEach(name => {
      const mi = ctx.moveInfo && ctx.moveInfo[name];
      if (!mi) { useful += 0.5; return; } // unknown: neither credit nor blame
      if (mi.damageClass !== "status") {
        damaging++;
        const stab = (m.types || []).includes(mi.type);
        const power = mi.power > 0 ? mi.power : 80; // fixed or variable damage (Seismic Toss, Gyro Ball...)
        const eff = power * (stab ? 1.5 : 1);
        bestHit = Math.max(bestHit, eff);
        if (eff >= STRONG_HIT || mi.priority > 0 || (ctx.utilityMoves && ctx.utilityMoves.has(name))) useful++;
        else weak.push(name);
      } else if (ctx.utilityMoves && ctx.utilityMoves.has(name)) {
        useful++;
      } else {
        weak.push(name);
      }
    });
    const movesScore = clamp01(useful / 4);
    const damage = damaging ? clamp01(bestHit / 120) : 0;
    if (!damaging && moves.length) issues.push("no damaging move");
    else if (damaging && bestHit < STRONG_HIT) issues.push("no strong attack");
    if (weak.length) issues.push(`weak or low-value move${weak.length > 1 ? "s" : ""}: ${weak.map(nice).join(", ")}`);

    // Item
    let item = 0.5; // no item: neutral
    if (m.item) {
      const fit = itemFit(m.item, m, ctx, info);
      item = fit.value;
      if (fit.issue) issues.push(fit.issue);
    }

    // EV investment (Gen 1-2 sets are maxed by default)
    const evTotal = Object.values(m.evs || {}).reduce((a, b) => a + b, 0);
    const investment = ctx.gen && ctx.gen <= 2 ? 1 : clamp01(evTotal / 508);
    if (!(ctx.gen && ctx.gen <= 2) && evTotal === 0) issues.push("no EVs invested");

    let score = SCORE_PARTS.stats * stats + SCORE_PARTS.damage * damage + SCORE_PARTS.moves * movesScore + SCORE_PARTS.item * item + SCORE_PARTS.investment * investment;
    if (unevolved) score *= NFE_FACTOR;
    if (HANDICAP_ABILITIES.includes(m.ability)) { score *= 0.8; issues.push(`its ability ${nice(m.ability)} is a handicap`); }
    return { name: m.name, score: Math.round(score * 100), bst, unevolved, issues, parts: { stats, damage, moves: movesScore, item, investment } };
  }

  function teamViability(members, ctx) {
    if (!members.length) return { score: 0, members: [], unevolved: 0 };
    const per = members.map(m => memberViability(m, ctx));
    return {
      score: Math.round(per.reduce((a, p) => a + p.score, 0) / per.length),
      members: per,
      unevolved: per.filter(p => p.unevolved).length,
      weak: per.filter(p => p.score < 50).map(p => p.name)
    };
  }

  // Median base stat total of a usage snapshot's Pokémon (the format's reference strength)
  function medianBst(values) {
    const v = values.filter(x => x > 0).sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
  }

  return { TYPE_ITEMS, SPECIES_ITEMS, NO_BATTLE_EFFECT, SCORE_PARTS, NFE_FACTOR, HANDICAP_ABILITIES, RANDOM_ITEMS, itemFit, suitsRandomSet, pickRandomMoves, randomSpread, BAD_ATTACKS, GOOD_STATUS_SINGLES, GOOD_STATUS_DOUBLES, memberViability, teamViability, medianBst };
});
