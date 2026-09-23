/**
 * Action presets: which button texts each policy tier accepts, and how matched
 * elements are validated (including terminal command allow/block rules).
 *
 * `matches` entries are matched case-insensitively against the element's full
 * visible text using word boundaries, so "accept-test.js" never matches
 * "accept". `commands.prefixes` are extra button texts that additionally go
 * through command filtering (terminal Run prompts).
 */

export const POLICIES = Object.freeze({
  COMMANDS_ONLY: "commands-only",
  COMMANDS_AND_EDITS: "commands-and-edits",
  EVERYTHING: "everything",
});

const ACTION_KINDS = Object.freeze({
  COMMAND: "command",
  EDIT: "edit",
  PERMISSION: "permission",
  FLOW: "flow",
});

/**
 * Priority-ordered presets. Lower `priority` wins when several texts could
 * match the same element, mirroring Antigravity's own precedence (Run before
 * Accept before Allow) so we never click a weaker sibling button first.
 */
export const PRESETS = Object.freeze([
  {
    kind: ACTION_KINDS.COMMAND,
    priority: 10,
    // "Run Alt+d" style buttons: exact-ish match handled by the scanner.
    matches: ["run", "run command"],
    commands: true,
    policies: [POLICIES.COMMANDS_ONLY, POLICIES.COMMANDS_AND_EDITS, POLICIES.EVERYTHING],
  },
  {
    kind: ACTION_KINDS.EDIT,
    priority: 20,
    matches: ["accept", "accept all", "accept edit", "accept changes", "keep"],
    commands: false,
    policies: [POLICIES.COMMANDS_AND_EDITS, POLICIES.EVERYTHING],
  },
  {
    kind: ACTION_KINDS.PERMISSION,
    priority: 30,
    matches: [
      // Antigravity permission dialogs phrase options as "Yes, allow this
      // time" / "Yes, and always allow ...". We deliberately match ONLY the
      // per-time grant: auto-clicking "always allow" would hand out standing
      // permissions without review. Note these are prefix matches, so the
      // order matters less than exact wording.
      "yes, allow this time",
      "allow this time",
      "always allow",
      "allow this conversation",
      "allow once",
      "allow",
      "trust this domain",
      "open browser",
    ],
    commands: false,
    policies: [POLICIES.COMMANDS_ONLY, POLICIES.COMMANDS_AND_EDITS, POLICIES.EVERYTHING],
  },
  {
    kind: ACTION_KINDS.FLOW,
    priority: 40,
    matches: ["retry", "continue"],
    commands: false,
    policies: [POLICIES.EVERYTHING],
  },
]);

export function presetForKind(kind) {
  return PRESETS.find((p) => p.kind === kind) || null;
}

/**
 * Compact preset payload handed to the in-page scanner. The scanner reports
 * ALL candidate buttons it recognizes (with their kind); policy filtering,
 * command filtering and rate limits are enforced in Node, keeping the page
 * script dumb and auditable.
 */
export function buildPreset(blockedCommands = [], allowedCommands = []) {
  return {
    version: 1,
    actions: PRESETS.map((p) => ({
      kind: p.kind,
      priority: p.priority,
      matches: [...p.matches],
      commands: Boolean(p.commands),
    })),
    commands: { blocked: [...blockedCommands], allowed: [...allowedCommands] },
  };
}

export function isKindAllowedInPolicy(kind, policy) {
  const preset = presetForKind(kind);
  return Boolean(preset && preset.policies.includes(policy));
}

/** Escape a string for literal use inside a RegExp. */
export function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Prefix matcher: the visible text must START with the keyword, followed by a
 * word edge. Hyphen/underscore count as part of the word, so a filename like
 * "accept-test.js" never matches "accept", and "yarn run build" never
 * matches "run". Real buttons are short labels ("Accept", "Allow this
 * conversation"), so prefix matching is both stricter and predictable.
 */
export function buildKeywordMatcher(keyword) {
  const pattern = new RegExp(`^${escapeRegExp(keyword)}($|[^a-z0-9_-])`, "i");
  return (text) => pattern.test(String(text || ""));
}

/** True when the visible text exactly equals one of the keywords. */
export function isExactKeywordText(keywords, text) {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return keywords.some((k) => k.toLowerCase() === normalized);
}
