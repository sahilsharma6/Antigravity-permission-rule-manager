import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeConfig, loadConfig, DEFAULTS } from "../src/config.js";
import { POLICIES } from "../src/presets.js";

test("mergeConfig: empty input yields defaults", () => {
  const c = mergeConfig({});
  assert.equal(c.enabled, DEFAULTS.enabled);
  assert.equal(c.policy, "commands-only");
  assert.deepEqual(c.cdp.ports, [9333, 9222]);
});

test("mergeConfig: drops unknown keys and ignores comment keys", () => {
  const c = mergeConfig({ bogus: 1, "//": "comment", policy: "everything" });
  assert.equal(c.policy, "everything");
  assert.equal("bogus" in c, false);
});

test("mergeConfig: invalid values fall back to defaults", () => {
  const c = mergeConfig({
    policy: "yolo",
    cdp: { ports: [70000, 9333], reconnectMs: -1 },
    scan: { pollIntervalMs: 10 }, // below minimum 100
    limits: { maxConsecutiveFailures: 0 },
  });
  assert.equal(c.policy, "commands-only");
  assert.deepEqual(c.cdp.ports, [9333]);
  assert.equal(c.cdp.reconnectMs, 3000);
  assert.equal(c.scan.pollIntervalMs, 1000);
  assert.equal(c.limits.maxConsecutiveFailures, 10);
});

test("mergeConfig: valid overrides apply", () => {
  const c = mergeConfig({
    enabled: false,
    dryRun: true,
    policy: POLICIES.COMMANDS_AND_EDITS,
    commands: { blocked: ["git push"], allowed: ["npm"] },
    logging: { logLevel: "debug", logFile: null },
  });
  assert.equal(c.enabled, false);
  assert.equal(c.dryRun, true);
  assert.equal(c.policy, POLICIES.COMMANDS_AND_EDITS);
  assert.deepEqual(c.commands.blocked, ["git push"]);
  assert.deepEqual(c.commands.allowed, ["npm"]);
  assert.equal(c.logging.logFile, null);
});

test("loadConfig: reads config.json with // comment keys stripped", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ag-aa-"));
  const file = path.join(dir, "config.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ "//": "comment", dryRun: true, logging: { logFile: null } })
  );
  const { config, loadedPath } = loadConfig({ file, cwd: dir });
  assert.equal(config.dryRun, true);
  assert.equal(loadedPath, file);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadConfig: missing file yields defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ag-aa-"));
  const { config, loadedPath } = loadConfig({ cwd: dir });
  assert.equal(config.enabled, true);
  assert.equal(loadedPath, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadConfig: non-object JSON throws", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ag-aa-"));
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, "[1,2,3]");
  assert.throws(() => loadConfig({ file, cwd: dir }), /must contain a JSON object/);
  fs.rmSync(dir, { recursive: true, force: true });
});
