#!/usr/bin/env node
// Downloads the calibration data into calibration/data/ so results can be reproduced offline:
//   <format>-teams.json  Smogon sample teams (expert-built, full sets) via pkmn/smogon
//   <format>-pool.json   the 120 most-used Pokémon of the format with their most common set
//                        (used to assemble the random baseline teams)
// Usage: node calibration/build-data.js
const fs = require("fs");
const path = require("path");
const { commonSet } = require("../scripts/build-threats.js");

const FORMATS = ["gen9ou", "gen8ou", "gen7ou", "gen6ou", "gen5ou", "gen4ou", "gen3ou", "gen2ou", "gen1ou", "gen9doublesou", "gen9vgc2024regg", "gen9vgc2025regi"];
const POOL_SIZE = 120;
const OUT = path.join(__dirname, "data");

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return { json: await res.json(), lastModified: res.headers.get("last-modified") };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = { fetched: new Date().toISOString().slice(0, 10), source: "pkmn/smogon (data.pkmn.cc): Smogon sample teams and usage statistics", formats: {} };
  for (const f of FORMATS) {
    try {
      const teams = await getJson(`https://data.pkmn.cc/teams/${f}.json`);
      const full = teams.json.filter(t => Array.isArray(t.data) && t.data.length === 6);
      fs.writeFileSync(path.join(OUT, `${f}-teams.json`), JSON.stringify(full.map(t => ({ name: t.name, author: t.author, data: t.data }))) + "\n");
      let stats;
      try { stats = await getJson(`https://data.pkmn.cc/stats/${f}.json`); } catch (err) {
        // VGC formats publish sample teams but no usage file: their baseline comes from gen9doublesou
        manifest.formats[f] = { teams: full.length, pool: 0, teamsLastModified: teams.lastModified };
        console.log(`${f}: ${full.length} sample teams (no usage stats; baseline uses gen9doublesou)`);
        continue;
      }
      const pool = Object.entries(stats.json.pokemon)
        .sort((a, b) => b[1].usage.weighted - a[1].usage.weighted)
        .slice(0, POOL_SIZE)
        .map(([name, p]) => ({ name, usage: p.usage.weighted, set: commonSet(p) }));
      fs.writeFileSync(path.join(OUT, `${f}-pool.json`), JSON.stringify(pool) + "\n");
      manifest.formats[f] = { teams: full.length, pool: pool.length, battles: stats.json.battles, teamsLastModified: teams.lastModified, statsLastModified: stats.lastModified };
      console.log(`${f}: ${full.length} sample teams, pool of ${pool.length}`);
    } catch (err) {
      console.error(`${f}: skipped (${err.message})`);
    }
  }
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
})();
