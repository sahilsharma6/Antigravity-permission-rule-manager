import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreset, POLICIES, PRESETS, isKindAllowedInPolicy, buildKeywordMatcher } from "../src/presets.js";

test("POLICIES exposes the three documented tiers", () => {
  assert.deepEqual([...Object.values(POLICIES)].sort(), [
    "commands-and-edits",
    "commands-only",
    "everything",
  ]);
});

test("presets are priority-ordered and unique", () => {
  const priorities = PRESETS.map((p) => p.priority);
  const sorted = [...priorities].sort((a, b) => a - b);
  assert.deepEqual(priorities, sorted);
  assert.equal(new Set(priorities).size, priorities.length);
});

test("command preset applies to every policy", () => {
  for (const policy of Object.values(POLICIES)) {
    assert.equal(isKindAllowedInPolicy("command", policy), true, policy);
  }
});

test("edit preset is excluded from commands-only", () => {
  assert.equal(isKindAllowedInPolicy("edit", POLICIES.COMMANDS_ONLY), false);
  assert.equal(isKindAllowedInPolicy("edit", POLICIES.COMMANDS_AND_EDITS), true);
  assert.equal(isKindAllowedInPolicy("edit", POLICIES.EVERYTHING), true);
});

test("flow preset only in everything", () => {
  assert.equal(isKindAllowedInPolicy("flow", POLICIES.EVERYTHING), true);
  assert.equal(isKindAllowedInPolicy("flow", POLICIES.COMMANDS_ONLY), false);
  assert.equal(isKindAllowedInPolicy("flow", POLICIES.COMMANDS_AND_EDITS), false);
});

test("buildPreset copies arrays (caller mutations don't leak)", () => {
  const blocked = ["rm -rf"];
  const preset = buildPreset(blocked, []);
  blocked.push("shutdown");
  assert.equal(preset.commands.blocked.length, 1);
  assert.equal(preset.actions.length, PRESETS.length);
});

test("buildKeywordMatcher uses word boundaries", () => {
  const isRun = buildKeywordMatcher("run");
  assert.equal(isRun("Run"), true);
  assert.equal(isRun("Run Alt+d"), true);
  assert.equal(isRun("yarn run build"), false);
  assert.equal(isRun("accept-test.js"), false);
  const isAccept = buildKeywordMatcher("accept");
  assert.equal(isAccept("Accept"), true);
  assert.equal(isAccept("accept all"), true);
  assert.equal(isAccept("accept-test.js"), false);
});
