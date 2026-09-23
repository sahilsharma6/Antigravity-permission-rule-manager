import { test } from "node:test";
import assert from "node:assert/strict";
import { DedupeStore, RateLimiter } from "../src/dedupe.js";

test("dedupe: first sight passes, immediate repeat blocked", () => {
  const now = 1_000_000;
  const d = new DedupeStore({ cooldownMs: 5000 });
  assert.equal(d.shouldProcess("k1", now), true);
  assert.equal(d.shouldProcess("k1", now + 100), false);
  assert.equal(d.shouldProcess("k1", now + 4999), false);
  assert.equal(d.shouldProcess("k1", now + 5000), true);
});

test("dedupe: distinct keys are independent", () => {
  const now = 1_000_000;
  const d = new DedupeStore({ cooldownMs: 5000 });
  assert.equal(d.shouldProcess("a", now), true);
  assert.equal(d.shouldProcess("b", now), true);
  assert.equal(d.shouldProcess("a", now + 1), false);
});

test("dedupe: pruning keeps memory bounded", () => {
  const d = new DedupeStore({ cooldownMs: 1000, maxEntries: 10 });
  let now = 1_000_000;
  for (let i = 0; i < 100; i++) {
    d.shouldProcess("k" + i, now);
    now += 10;
  }
  assert.ok(d._last.size <= 10);
  d.reset();
  assert.equal(d._last.size, 0);
});

test("rate limiter: unlimited when maxActionsPerMinute is 0", () => {
  const r = new RateLimiter({ maxActionsPerMinute: 0 });
  for (let i = 0; i < 500; i++) assert.equal(r.tryAcquire(0), true);
});

test("rate limiter: enforces sliding window", () => {
  const r = new RateLimiter({ maxActionsPerMinute: 2 });
  assert.equal(r.tryAcquire(0), true);
  assert.equal(r.tryAcquire(1000), true);
  assert.equal(r.tryAcquire(2000), false);
  assert.equal(r.tryAcquire(60_001), true); // first slot expired
});

test("rate limiter: consecutive failure tracking", () => {
  const r = new RateLimiter({ maxConsecutiveFailures: 3 });
  assert.equal(r.recordFailure(), false);
  assert.equal(r.recordFailure(), false);
  assert.equal(r.recordFailure(), true); // fatal now
  r.recordSuccess();
  assert.equal(r.consecutiveFailures, 0);
  assert.equal(r.recordFailure(), false);
});
