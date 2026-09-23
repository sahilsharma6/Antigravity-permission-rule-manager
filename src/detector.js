import { buildKeywordMatcher, isExactKeywordText } from "./presets.js";

/**
 * Decide which action kind (if any) a candidate button represents.
 *
 * @param {string} text  Visible text of the element.
 * @param {object} preset  Preset payload from buildPreset().
 * @returns {null | { kind: string, priority: number, action: object }}
 */
export function detectKind(text, preset) {
  const cleaned = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const action = preset.actions.find((a) => {
    // Exact-text actions (e.g. "Run Alt+d") use exact match; others use
    // word-boundary prefix matching so "Run" matches "Run Alt+d" but a
    // filename like "accept-test.js" never matches "accept".
    if (a.kind === "command" && isExactKeywordText(a.matches, cleaned)) return true;
    if (a.kind === "command") {
      const firstWord = cleaned.split(" ")[0].toLowerCase();
      return a.matches.some((m) => m === firstWord);
    }
    return a.matches.some((m) => buildKeywordMatcher(m)(cleaned));
  });
  if (!action) return null;
  return { kind: action.kind, priority: action.priority, action };
}

/**
 * Order candidates so the highest-priority (lowest number) action wins when
 * one element could match multiple actions; ties fall back to DOM order.
 */
export function prioritize(candidates) {
  return [...candidates].sort((a, b) => a.priority - b.priority);
}
