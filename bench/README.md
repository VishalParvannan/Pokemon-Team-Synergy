# Performance benchmark: persistent API cache

Measures page startup: time until the format's Pokémon list, the item list and all six team members' data are loaded (`window.appPerf.readyMs`, milliseconds since navigation start), plus PokeAPI requests and JSON characters downloaded (`window.appPerf.network`).

## Setup
1. Serve the repo root (`python -m http.server 8090`) and open http://localhost:8090/Frontend/.
2. Run `bench/fixture.js` in the browser console. It saves a fixed six-Pokémon Generation 9 team (Garchomp, Corviknight, Clefable, Rotom-Wash, Tyranitar, Heatran) and reloads.

## Scenarios (5 runs each, median reported)
- **First visit**: `index.html?cache=off`. Bypasses the persistent cache and the browser HTTP cache (`fetch(..., { cache: "no-store" })`).
- **Repeat visit, before**: plain reload with the previous code. Only the browser HTTP cache helps (PokeAPI sends `max-age=86400`).
- **Repeat visit, after**: plain reload with the IndexedDB cache filled by one earlier load.

## Results (12 Nov 2026, Chromium-based browser pane on Windows, home broadband)

| Scenario | PokeAPI requests | JSON downloaded/parsed | Ready (median) | Runs (ms) |
|---|---|---|---|---|
| First visit, before | 34 | 1.70 MB | 292 ms | 261, 279, 292, 331, 364 |
| First visit, after | 34 | 1.70 MB | 270 ms | 239, 246, 270, 303, 396 |
| Repeat visit, before (HTTP cache) | 34 (from HTTP cache) | 1.70 MB | 206 ms | 180, 195, 206, 209, 217 |
| **Repeat visit, after (IndexedDB)** | **0** | **0** | **110 ms** | 98, 109, 110, 111, 117 |

**Summary:** repeat visits make 0 PokeAPI requests instead of 34, parse no JSON instead of 1.7 MB, and are ready 47% sooner (206 → 110 ms median). First visits are unchanged within noise.

## Caveats
- Absolute times depend on the connection. On a fast connection with PokeAPI's CDN, the network is not the bottleneck, so the saving in milliseconds is modest. Slower or offline connections would gain more, but that was not measured here.
- The browser's HTTP cache expires after a day and can be evicted. The IndexedDB cache keeps data for 7 days (`Frontend/cache.js`) and survives HTTP cache eviction. That isn't reflected in the table, which reloads within minutes.
- Sprite images are not included. They are served and cached by the browser as normal.
- Five runs per scenario is a small sample; the individual runs are listed so you can judge the spread.
