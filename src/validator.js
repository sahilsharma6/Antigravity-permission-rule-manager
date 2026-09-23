import { isKindAllowedInPolicy } from "./presets.js";

/**
 * Decide whether a detected action may be auto-accepted under the current
 * configuration. Pure function: no I/O, no side effects — fully unit-testable.
 *
 * @returns {{ ok: boolean, reason: string }}
 */
export function validateAction({ kind, commandText, policy, commands = {}, limits = {} }) {
  if (!isKindAllowedInPolicy(kind, policy)) {
    return { ok: false, reason: `policy "${policy}" does not allow kind "${kind}"` };
  }

  if (kind === "command") {
    const blocked = commands.blocked || [];
    const allowed = commands.allowed || [];
    const text = String(commandText || "").toLowerCase();

    // Allow-list mode: when non-empty, ONLY whitelisted prefixes are accepted.
    if (allowed.length > 0 && !allowed.some((a) => text.startsWith(a.toLowerCase()))) {
      return { ok: false, reason: "command not in allow-list" };
    }
    const hit = blocked.find((b) => text.includes(b.toLowerCase()));
    if (hit) {
      return { ok: false, reason: `command matches block-list entry "${hit}"` };
    }
  }

  const maxPerMin = limits.maxActionsPerMinute ?? 0;
  if (maxPerMin > 0) {
    // Rate limiting itself is enforced by the watcher (needs timestamps);
    // here we only reject statically invalid configs.
    if (!Number.isInteger(maxPerMin)) {
      return { ok: false, reason: "invalid maxActionsPerMinute" };
    }
  }

  return { ok: true, reason: "policy check passed" };
}
