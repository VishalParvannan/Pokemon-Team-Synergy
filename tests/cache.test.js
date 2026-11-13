const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../Frontend/cache.js");

function setup(extra = {}) {
  let clock = 1000;
  const backend = C.memoryBackend();
  const make = (opts = {}) => C.createCache({ backend, now: () => clock, ttlMs: 100, ...extra, ...opts });
  return { backend, make, tick: (ms) => { clock += ms; } };
}

test("second request is served from the cache without calling the producer", async () => {
  const { make } = setup();
  const cache = make();
  let calls = 0;
  const producer = async () => { calls++; return { a: 1 }; };
  assert.deepEqual(await cache.remember("k", producer), { a: 1 });
  // A new cache instance over the same store models a page reload
  const reloaded = make();
  assert.deepEqual(await reloaded.remember("k", producer), { a: 1 });
  assert.equal(calls, 1);
  assert.equal(reloaded.stats.hits, 1);
  assert.equal(cache.stats.misses, 1);
});

test("entries expire after the TTL", async () => {
  const { make, tick } = setup();
  let calls = 0;
  const producer = async () => ++calls;
  await make().remember("k", producer);
  tick(99);
  assert.equal(await make().remember("k", producer), 1);
  tick(2);
  assert.equal(await make().remember("k", producer), 2);
});

test("a data version change invalidates old entries", async () => {
  const { make } = setup();
  let calls = 0;
  const producer = async () => ++calls;
  await make({ version: 1 }).remember("k", producer);
  assert.equal(await make({ version: 2 }).remember("k", producer), 2);
});

test("failures and empty results are not cached", async () => {
  const { make, backend } = setup();
  const cache = make();
  await assert.rejects(cache.remember("bad", async () => { throw new Error("offline"); }));
  assert.equal(await backend.get("bad"), undefined);
  assert.equal(await cache.remember("bad", async () => "recovered"), "recovered");
  await cache.remember("nothing", async () => null);
  assert.equal(await backend.get("nothing"), undefined);
});

test("concurrent requests for one key share a single producer call", async () => {
  const { make } = setup();
  const cache = make();
  let calls = 0;
  const producer = () => new Promise(r => setTimeout(() => r(++calls), 10));
  const [a, b, c] = await Promise.all([cache.remember("k", producer), cache.remember("k", producer), cache.remember("k", producer)]);
  assert.deepEqual([a, b, c], [1, 1, 1]);
  assert.equal(calls, 1);
});

test("disabled cache and broken storage fall back to the producer", async () => {
  const off = C.createCache({ backend: C.memoryBackend(), enabled: false });
  let calls = 0;
  await off.remember("k", async () => ++calls);
  await off.remember("k", async () => ++calls);
  assert.equal(calls, 2);

  const broken = { get: async () => { throw new Error("quota"); }, set: async () => { throw new Error("quota"); }, clear: async () => {} };
  const cache = C.createCache({ backend: broken });
  assert.equal(await cache.remember("k", async () => "ok"), "ok");
  await new Promise(r => setTimeout(r, 0));
  assert.ok(cache.stats.errors >= 1);
});

test("no IndexedDB (Node) means caching is simply off", () => {
  assert.equal(C.createCache().enabled, false);
});

test("clear removes stored entries", async () => {
  const { make, backend } = setup();
  const cache = make();
  await cache.remember("k", async () => 1);
  await cache.clear();
  assert.equal(backend.size(), 0);
});
