/**
 * Rate limiter with sliding 60s window + consecutive-failure tracking.
 * Used by the watcher to throttle click volume and to bail out when the
 * environment is clearly broken (e.g. stale CDP session clicking nothing).
 */
export class RateLimiter {
  constructor({ maxActionsPerMinute = 0, maxConsecutiveFailures = 10 } = {}) {
    this.maxActionsPerMinute = maxActionsPerMinute;
    this.maxConsecutiveFailures = maxConsecutiveFailures;
    this._timestamps = [];
    this._consecutiveFailures = 0;
  }

  /** True when another action fits inside the current 60s window. */
  tryAcquire(now = Date.now()) {
    this._prune(now);
    if (this.maxActionsPerMinute === 0) return true;
    if (this._timestamps.length >= this.maxActionsPerMinute) return false;
    this._timestamps.push(now);
    return true;
  }

  recordSuccess() {
    this._consecutiveFailures = 0;
  }

  recordFailure() {
    this._consecutiveFailures += 1;
    return this._consecutiveFailures >= this.maxConsecutiveFailures;
  }

  get consecutiveFailures() {
    return this._consecutiveFailures;
  }

  _prune(now) {
    const cutoff = now - 60_000;
    while (this._timestamps.length > 0 && this._timestamps[0] < cutoff) {
      this._timestamps.shift();
    }
  }
}

/**
 * Dedupe store: prevents re-clicking the same logical element (or a
 * re-rendered twin with identical text) within a cooldown window. Backed by
 * a Map with periodic pruning so memory stays bounded in long sessions.
 */
export class DedupeStore {
  constructor({ cooldownMs = 5000, maxEntries = 2000 } = {}) {
    this.cooldownMs = cooldownMs;
    this.maxEntries = maxEntries;
    this._last = new Map(); // key -> timestamp
  }

  /**
   * Returns true the FIRST time a key is seen inside the cooldown window.
   * @param {string} key stable identifier for the logical action
   */
  shouldProcess(key, now = Date.now()) {
    const prev = this._last.get(key);
    if (prev !== undefined && now - prev < this.cooldownMs) return false;
    this._last.set(key, now);
    if (this._last.size > this.maxEntries) this._prune(now);
    return true;
  }

  reset() {
    this._last.clear();
  }

  _prune(now) {
    const cutoff = now - this.cooldownMs;
    for (const [k, ts] of this._last) {
      if (ts < cutoff) this._last.delete(k);
    }
    // Still over capacity? Evict oldest entries (Map preserves insertion
    // order) so long sessions can't grow memory unbounded.
    while (this._last.size > this.maxEntries) {
      const oldest = this._last.keys().next().value;
      this._last.delete(oldest);
    }
  }
}
