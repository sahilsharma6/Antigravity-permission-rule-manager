import { test } from "node:test";
import assert from "node:assert/strict";
import { detectKind, prioritize } from "../src/detector.js";
import { buildPreset, POLICIES } from "../src/presets.js";

const preset = buildPreset([], []);

test("detectKind maps button text to action kinds", () => {
  assert.equal(detectKind("Run", preset)?.kind, "command");
  assert.equal(detectKind("Run Alt+d", preset)?.kind, "command");
  assert.equal(detectKind("Accept", preset)?.kind, "edit");
  assert.equal(detectKind("Accept all", preset)?.kind, "edit");
  assert.equal(detectKind("Allow", preset)?.kind, "permission");
  assert.equal(detectKind("Always allow", preset)?.kind, "permission");
  assert.equal(detectKind("Retry", preset)?.kind, "flow");
});

test("detectKind recognizes Antigravity's real permission dialog wording", () => {
  // Real texts observed in Antigravity permission dialogs.
  assert.equal(detectKind("Yes, allow this time", preset)?.kind, "permission");
  assert.equal(
    detectKind("Yes, allow this time \n powershell -Command Copy-Item", preset)?.kind,
    "permission"
  );
  // Permanent grants must NOT be auto-clicked.
  assert.equal(
    detectKind("Yes, and always allow powershell -Command Copy-Item ...", preset),
    null
  );
});

test("detectKind returns null for unrelated or adversarial text", () => {
  assert.equal(detectKind("", preset), null);
  assert.equal(detectKind("accept-test.js", preset), null);
  assert.equal(detectKind("yarn run build", preset), null);
  assert.equal(detectKind("Random dialog text", preset), null);
  assert.equal(detectKind(null, preset), null);
});

test("detectKind with empty preset never matches", () => {
  const empty = { actions: [], commands: {} };
  assert.equal(detectKind("Accept", empty), null);
});

test("prioritize orders by priority ascending", () => {
  const input = [
    { text: "Allow", kind: "permission", priority: 30 },
    { text: "Run", kind: "command", priority: 10 },
    { text: "Accept", kind: "edit", priority: 20 },
  ];
  const out = prioritize(input);
  assert.deepEqual(out.map((c) => c.kind), ["command", "edit", "permission"]);
});

test("every preset policy is a known policy", () => {
  for (const p of preset.actions) {
    assert.ok(p.kind, "action has kind");
    assert.ok(Array.isArray(p.matches) && p.matches.length > 0);
  }
  assert.ok(Object.values(POLICIES).includes("commands-only"));
});
