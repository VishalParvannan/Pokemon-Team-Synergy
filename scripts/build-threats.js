#!/usr/bin/env node
// Builds Frontend/data/threats/<format>.json: the most-used Pokémon in a Smogon format with their
// most common set, from Smogon usage statistics as republished by pkmn/smogon (data.pkmn.cc).
// The app reads these small snapshots instead of downloading the multi-megabyte stats files.
//
// Usage: node scripts/build-threats.js [formatId ...]   (default: gen1ou..gen9ou and gen9doublesou)
const fs = require("fs");
const path = require("path");

const TOP_N = 40;
const DEFAULT_FORMATS = ["gen9ou", "gen8ou", "gen7ou", "gen6ou", "gen5ou", "gen4ou", "gen3ou", "gen2ou", "gen1ou", "gen9doublesou"];
const OUT_DIR = path.join(__dirname, "..", "Frontend", "data", "threats");
const STAT_ORDER = ["hp", "atk", "def", "spa", "spd", "spe"];

const top = (obj, n = 1) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
const round = (x) => Math.round(x * 10000) / 10000;

// Turn usage stats for one Pokémon into a single representative set
function commonSet(p) {
  const [spread] = top(p.spreads);
  let nature = null, evs = {};
  if (spread) {
    const [nat, nums] = spread[0].split(":");
    nature = nat;
    nums.split("/").map(Number).forEach((v, i) => { if (v) evs[STAT_ORDER[i]] = v; });
  }
  const moves = top(p.moves, 8).map(([m]) => m).filter(m => m && m !== "Nothing" && m !== "").slice(0, 4);
  const [ability] = top(p.abilities);
  const [item] = top(p.items);
  return {
    ability: ability ? ability[0] : null,
    item: item && item[0] !== "Nothing" ? item[0] : null,
    nature, evs, moves,
    shares: { spread: spread ? round(spread[1]) : 0, item: item ? round(item[1]) : 0, moves: top(p.moves, 4).map(([, v]) => round(v)) }
  };
}

async function build(format) {
  const url = `https://data.pkmn.cc/stats/${format}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${format}: HTTP ${res.status}`);
  const data = await res.json();
  const ranked = Object.entries(data.pokemon)
    .map(([name, p]) => ({ name, usage: p.usage.weighted, p }))
    .sort((a, b) => b.usage - a.usage)
    .slice(0, TOP_N);
  const out = {
    format,
    source: "Smogon usage statistics via pkmn/smogon",
    sourceUrl: url,
    fetched: new Date().toISOString().slice(0, 10),
    lastModified: res.headers.get("last-modified"),
    battles: data.battles,
    threats: ranked.map(({ name, usage, p }) => ({ name, usage: round(usage), set: commonSet(p) }))
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${format}.json`);
  fs.writeFileSync(file, JSON.stringify(out) + "\n");
  return { format, file, count: out.threats.length, bytes: fs.statSync(file).size, battles: out.battles };
}

(async () => {
  const formats = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FORMATS;
  for (const f of formats) {
    try {
      const r = await build(f);
      console.log(`${r.format}: ${r.count} Pokémon, ${r.battles} battles, ${(r.bytes / 1024).toFixed(1)} KB`);
    } catch (err) {
      console.error(`${f}: failed (${err.message})`);
      process.exitCode = 1;
    }
  }
})();

module.exports = { commonSet };
