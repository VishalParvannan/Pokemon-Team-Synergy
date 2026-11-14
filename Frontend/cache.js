// Persistent cache for processed PokeAPI data. Stores parsed results (not raw responses) in
// IndexedDB so repeat visits skip both the network and JSON re-parsing. Entries expire after
// a TTL and are dropped when DATA_VERSION changes (bump it whenever a parser's output changes).
// Falls back to "no persistence" when IndexedDB is unavailable (private mode, Node tests).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PokeCache = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const DATA_VERSION = 4; // 2: move info gained `target`; 3: Pokémon gained `pastTypes`; 4: `pastStats`
  const TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const DB_NAME = "pokemon-team-synergy-cache";
  const STORE = "kv";

  // Backend: { get(key) -> Promise<record|undefined>, set(key, record) -> Promise, clear() -> Promise }
  function memoryBackend() {
    const map = new Map();
    return {
      get: async (k) => map.get(k),
      set: async (k, v) => { map.set(k, v); },
      clear: async () => { map.clear(); },
      size: () => map.size
    };
  }

  function indexedDbBackend() {
    if (typeof indexedDB === "undefined") return null;
    let dbPromise = null;
    const open = () => {
      if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = () => req.result.createObjectStore(STORE);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          req.onblocked = () => reject(new Error("IndexedDB blocked"));
        });
        dbPromise.catch(() => { dbPromise = null; });
      }
      return dbPromise;
    };
    const run = (mode, fn) => open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
    return {
      get: (k) => run("readonly", s => s.get(k)),
      set: (k, v) => run("readwrite", s => s.put(v, k)),
      clear: () => run("readwrite", s => s.clear())
    };
  }

  // opts: { backend, now, ttlMs, version, enabled }
  function createCache(opts = {}) {
    const backend = opts.backend === undefined ? indexedDbBackend() : opts.backend;
    const now = opts.now || (() => Date.now());
    const ttlMs = opts.ttlMs || TTL_MS;
    const version = opts.version || DATA_VERSION;
    const enabled = opts.enabled !== false && !!backend;
    const stats = { hits: 0, misses: 0, errors: 0 };
    const inflight = new Map(); // dedupe concurrent requests for the same key

    async function read(key) {
      if (!enabled) return undefined;
      try {
        const rec = await backend.get(key);
        if (rec && rec.v === version && now() - rec.t < ttlMs) return rec.data;
      } catch (err) { stats.errors++; }
      return undefined;
    }

    function write(key, data) {
      if (!enabled) return Promise.resolve();
      return Promise.resolve(backend.set(key, { v: version, t: now(), data })).catch(() => { stats.errors++; });
    }

    // Return the cached value for `key`, or run `producer`, store its result and return it.
    // Failed producers are not cached.
    function remember(key, producer) {
      if (inflight.has(key)) return inflight.get(key);
      const p = (async () => {
        const cached = await read(key);
        if (cached !== undefined) { stats.hits++; return cached; }
        stats.misses++;
        const value = await producer();
        if (value !== undefined && value !== null) write(key, value); // don't make the caller wait for the write
        return value;
      })();
      inflight.set(key, p);
      p.then(() => inflight.delete(key), () => inflight.delete(key));
      return p;
    }

    async function clear() {
      if (!backend) return;
      try { await backend.clear(); } catch (err) { stats.errors++; }
    }

    return { remember, clear, stats, enabled };
  }

  return { DATA_VERSION, TTL_MS, createCache, memoryBackend };
});
