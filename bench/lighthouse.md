# Lighthouse audit

**Setup:** Lighthouse 13.6.0 run against Microsoft Edge 157 (headless, Chromium) on Windows, with the repo served locally (`python -m http.server 8090`). Default mobile settings (simulated slow 4G and 4× CPU slowdown) and `--preset=desktop`. First visit with an empty profile, so no saved teams and no cache.

    lighthouse http://localhost:8090/Frontend/index.html --only-categories=performance,accessibility,best-practices,seo [--preset=desktop]

## Results (13 Nov 2026)

| Page | Before (perf / a11y / best practices / SEO) | After, run 1 | After, run 2 |
|---|---|---|---|
| Builder, mobile | 89 / 95 / 100 / 91 | 99 / 100 / 100 / 100 | 99 / 100 / 100 / 100 |
| Builder, desktop | 98 / 95 / 100 / 91 | 100 / 100 / 100 / 100 | 98 / 100 / 100 / 100 |
| Saved teams, mobile | 99 / 92 / 100 / 90 | 99 / 100 / 100 / 100 | 99 / 100 / 100 / 100 |
| Saved teams, desktop | 100 / 92 / 100 / 90 | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |

Builder on mobile: Total Blocking Time **410 ms → 20 ms**, Largest Contentful Paint 1.7 s (unchanged), Cumulative Layout Shift 0 → 0.025.

## What was fixed
- **Total Blocking Time:** the damage calculator bundle (`vendor/smogon-calc`, ~490 KB) took about 0.6 s of main-thread time on the simulated phone. It now loads on demand (`Frontend/calc-loader.js`), when the calculator panel nears the viewport, on the first user interaction, or when an analysis runs.
- **Color contrast:** white text on the red buttons was 3.76:1. The accent is now `#dc2626` (4.83:1, WCAG AA). Links, which defaulted to dark blue on the dark background, are now `#93c5fd` (10.8:1).
- **Landmarks:** page content is wrapped in `<main>`.
- **SEO:** meta descriptions on both pages.

## Caveats
- Lighthouse scores vary between runs (the desktop builder scored 100 and then 98), so both runs are listed.
- The audit covers the first load. Lighthouse doesn't measure analysis or the threat list, which run when you press Analyze (about 0.8 s on a desktop CPU for a 3–4 Pokémon team).
- A score of 100 for accessibility means the automated checks pass. It doesn't replace screen-reader testing, which hasn't been done.
