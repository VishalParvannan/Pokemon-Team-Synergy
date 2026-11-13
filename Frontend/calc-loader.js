// Loads the damage calculator (~490 KB, the most expensive script on the page) only when it is
// needed: when the calculator panel scrolls into view or an analysis runs. Then creates
// window.PokeDamage and window.PokeThreats. Browser-only.
const CalcLoader = (function () {
  const FILES = ["vendor/smogon-calc/data.min.js", "vendor/smogon-calc/calc.min.js"];
  let pending = null;

  function load(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(s);
    });
  }

  // Resolves to window.PokeDamage once the calculator is ready; failures can be retried
  function ensure() {
    if (window.PokeDamage && window.PokeDamage.available) return Promise.resolve(window.PokeDamage);
    if (!pending) {
      pending = FILES.reduce((p, f) => p.then(() => load(f)), Promise.resolve()).then(() => {
        window.PokeDamage = createPokeDamage(window.calc);
        window.PokeThreats = createPokeThreats(window.PokeDamage);
        return window.PokeDamage;
      });
      pending.catch(() => { pending = null; });
    }
    return pending;
  }

  const ready = () => !!(window.PokeDamage && window.PokeDamage.available);

  // Start loading when `el` is about to scroll into view, or on the first user interaction
  // (a fallback for when visibility callbacks don't run, e.g. a page rendered in a hidden frame)
  function loadWhenVisible(el, onReady) {
    let started = false;
    const INPUTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"];
    const start = () => {
      if (started) return;
      started = true;
      if (io) io.disconnect();
      INPUTS.forEach(t => window.removeEventListener(t, start, true));
      ensure().then(onReady, onReady);
    };
    const io = el && typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => { if (entries.some(e => e.isIntersecting)) start(); }, { rootMargin: "200px" })
      : null;
    if (io) io.observe(el);
    else if (!el) { start(); return; }
    INPUTS.forEach(t => window.addEventListener(t, start, { capture: true, passive: true }));
  }

  return { ensure, ready, loadWhenVisible };
})();
