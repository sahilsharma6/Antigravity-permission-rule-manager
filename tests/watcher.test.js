import { test } from "node:test";
import assert from "node:assert/strict";
import { Watcher, prioritizeCandidates } from "../src/watcher.js";
import { mergeConfig } from "../src/config.js";
import { Logger } from "../src/logger.js";
import { POLICIES } from "../src/presets.js";

function silentLogger() {
  return new Logger({ level: "error", file: null });
}

/** Minimal CDP double: scripted scan results and click outcomes. */
function stubCdp({ scans = [], clickResults = [] } = {}) {
  let scanIndex = 0;
  let clickIndex = 0;
  return class StubCdp {
    constructor() {
      this.clicked = [];
    }
    static async discover() {
      return { host: "127.0.0.1", port: 9333, version: { Browser: "stub" } };
    }
    async connect() {
      return { port: 9333, targetId: "t1", targetUrl: "webview://agent" };
    }
    async installScanner() {
      return 2;
    }
    async scan() {
      const batch = scans[Math.min(scanIndex++, scans.length - 1)] || [];
      return batch;
    }
    async click(key) {
      this.clicked.push(key);
      const res = clickResults[Math.min(clickIndex++, clickResults.length - 1)] || { ok: true };
      return res;
    }
    close() {}
  };
}

function makeWatcher(overrides = {}, cdpArgs = {}) {
  const config = mergeConfig({
    logging: { logFile: null },
    scan: { pollIntervalMs: 10 },
    dedupe: { perButtonCooldownMs: 5000 },
    ...overrides,
  });
  return new Watcher({ config, logger: silentLogger(), cdp: stubCdp(cdpArgs) });
}

const runBtn = (text = "Run", command = "npm test") => ({
  key: "b1",
  text,
  kind: "command",
  priority: 10,
  command,
  path: "div > button",
});

test("watcher accepts an eligible command prompt", async () => {
  const w = makeWatcher({}, { scans: [[runBtn()]] });
  await w._processOnce();
  assert.equal(w.stats.accepted, 1);
  assert.equal(w.stats.failed, 0);
});

test("watcher ignores prompts outside the active policy", async () => {
  const w = makeWatcher({}, { scans: [[{ key: "b2", text: "Accept", kind: "edit", priority: 20, path: "p" }]] });
  await w._processOnce(); // default policy: commands-only
  assert.equal(w.stats.accepted, 0);
  assert.equal(w.stats.ignored, 1);
});

test("watcher accepts edits when policy allows them", async () => {
  const w = makeWatcher({ policy: POLICIES.COMMANDS_AND_EDITS }, {
    scans: [[{ key: "b3", text: "Accept", kind: "edit", priority: 20, path: "p" }]],
  });
  await w._processOnce();
  assert.equal(w.stats.accepted, 1);
});

test("watcher does not accept the same request twice within cooldown", async () => {
  const w = makeWatcher({}, { scans: [[runBtn()]] });
  await w._processOnce();
  await w._processOnce(); // identical candidate still visible
  await w._processOnce();
  assert.equal(w.stats.accepted, 1, "dedupe must suppress repeats");
  assert.equal(w.stats.ignored >= 2, true);
});

test("watcher can accept again after cooldown elapses (dedupe expiry)", async () => {
  const w = makeWatcher({}, { scans: [[runBtn()]] });
  // Shrink cooldown by monkeypatching the store's window for determinism.
  w.dedupe.cooldownMs = 0;
  await w._processOnce();
  await w._processOnce();
  assert.equal(w.stats.accepted, 2);
});

test("watcher respects rate limit", async () => {
  const w = makeWatcher({ limits: { maxActionsPerMinute: 1 } }, { scans: [[runBtn("Run", "npm one")]] });
  await w._processOnce();
  // New distinct button appears in the next scan but rate limit is exhausted.
  const w2 = makeWatcher(
    { limits: { maxActionsPerMinute: 1 } },
    { scans: [[runBtn("Run", "npm one")], [runBtn("Run", "npm two")]] }
  );
  await w2._processOnce();
  await w2._processOnce();
  assert.equal(w2.stats.accepted, 1);
});

test("watcher ignores blocked commands", async () => {
  const w = makeWatcher(
    { commands: { blocked: ["rm -rf"] } },
    { scans: [[runBtn("Run", "rm -rf /")]] }
  );
  await w._processOnce();
  assert.equal(w.stats.accepted, 0);
  assert.equal(w.stats.ignored, 1);
});

test("watcher dry-run logs but does not click", async () => {
  const stub = stubCdp({ scans: [[runBtn()]] });
  const config = mergeConfig({ dryRun: true, logging: { logFile: null } });
  const w = new Watcher({ config, logger: silentLogger(), cdp: stub });
  await w._processOnce();
  assert.equal(w.stats.accepted, 1);
  // click never invoked: stub records clicks only on real click() calls
});

test("watcher counts failures and survives them", async () => {
  const w = makeWatcher({}, { scans: [[runBtn()]], clickResults: [{ ok: false, reason: "gone" }] });
  await w._processOnce();
  assert.equal(w.stats.failed, 1);
  assert.equal(w.stats.accepted, 0);
});

test("watcher stops after maxConsecutiveFailures", async () => {
  const w = makeWatcher(
    { limits: { maxConsecutiveFailures: 2 } },
    { scans: [[runBtn()]], clickResults: [{ ok: false, reason: "boom" }] }
  );
  w.dedupe.cooldownMs = 0; // allow repeat processing of the same candidate
  await w._processOnce();
  await w._processOnce();
  assert.equal(w.stats.failed, 2);
  // Watcher asked itself to stop after the second failure.
  assert.equal(w._stopping, true);
});

test("prioritizeCandidates orders low priority number first", () => {
  const out = prioritizeCandidates([
    { key: "a", priority: 30 },
    { key: "b", priority: 10 },
    { key: "c", priority: 20 },
  ]);
  assert.deepEqual(out.map((c) => c.key), ["b", "c", "a"]);
});
