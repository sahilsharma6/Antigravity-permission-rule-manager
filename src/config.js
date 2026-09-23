import fs from "node:fs";
import path from "node:path";
import { buildPreset, POLICIES } from "./presets.js";

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export const DEFAULTS = Object.freeze({
  enabled: true,
  dryRun: false,
  policy: POLICIES.COMMANDS_ONLY,
  cdp: Object.freeze({ ports: [9333, 9222], host: "127.0.0.1", reconnectMs: 3000 }),
  scan: Object.freeze({ pollIntervalMs: 1000 }),
  dedupe: Object.freeze({ perButtonCooldownMs: 5000 }),
  commands: Object.freeze({ blocked: [], allowed: [] }),
  limits: Object.freeze({ maxActionsPerMinute: 0, maxConsecutiveFailures: 10 }),
  logging: Object.freeze({ logLevel: "info", logFile: "auto-accept.log" }),
});

/**
 * Shallow-merge user config over defaults, validating types and value ranges.
 * Unknown keys are dropped; missing keys fall back to defaults. Throws on
 * structurally invalid input rather than guessing.
 */
export function mergeConfig(raw = {}, defaults = DEFAULTS) {
  const out = {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : defaults.enabled,
    dryRun: typeof raw.dryRun === "boolean" ? raw.dryRun : defaults.dryRun,
    policy: Object.values(POLICIES).includes(raw.policy) ? raw.policy : defaults.policy,
    cdp: {
      ports: validatePorts(raw.cdp?.ports, defaults.cdp.ports),
      host: nonEmptyString(raw.cdp?.host, defaults.cdp.host),
      reconnectMs: positiveInt(raw.cdp?.reconnectMs, defaults.cdp.reconnectMs, 250),
    },
    scan: {
      pollIntervalMs: positiveInt(raw.scan?.pollIntervalMs, defaults.scan.pollIntervalMs, 100),
    },
    dedupe: {
      perButtonCooldownMs: positiveInt(
        raw.dedupe?.perButtonCooldownMs,
        defaults.dedupe.perButtonCooldownMs,
        250
      ),
    },
    commands: {
      blocked: stringList(raw.commands?.blocked),
      allowed: stringList(raw.commands?.allowed),
    },
    limits: {
      maxActionsPerMinute: nonNegativeInt(
        raw.limits?.maxActionsPerMinute,
        defaults.limits.maxActionsPerMinute
      ),
      maxConsecutiveFailures: positiveInt(
        raw.limits?.maxConsecutiveFailures,
        defaults.limits.maxConsecutiveFailures,
        1
      ),
    },
    logging: {
      logLevel: Object.keys(LOG_LEVELS).includes(raw.logging?.logLevel)
        ? raw.logging.logLevel
        : defaults.logging.logLevel,
      logFile: raw.logging?.logFile === null ? null : nonEmptyString(raw.logging?.logFile, defaults.logging.logFile),
    },
  };

  const presetKeys = Object.keys(buildPreset(out.commands.blocked, out.commands.allowed));
  if (presetKeys.length === 0) {
    throw new Error("internal error: preset built with no keyword sets");
  }
  return out;
}

function nonEmptyString(value, fallback) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

function positiveInt(value, fallback, min) {
  const n = Number(value);
  if (Number.isInteger(n) && n >= min) return n;
  return fallback;
}

function nonNegativeInt(value, fallback) {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 0) return n;
  return fallback;
}

function validatePorts(value, fallback) {
  if (!Array.isArray(value) || value.length === 0) return [...fallback];
  const ports = value
    .map((p) => Number(p))
    .filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535);
  return ports.length > 0 ? [...new Set(ports)] : [...fallback];
}

/** Load config.json if present; returns { config, loadedPath } */
export function loadConfig({ file = "config.json", cwd = process.cwd() } = {}) {
  const p = path.isAbsolute(file) ? file : path.join(cwd, file);
  let raw = {};
  if (fs.existsSync(p)) {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Config file ${p} must contain a JSON object`);
    }
    // Strip "//" comment keys used in config.example.json
    raw = Object.fromEntries(Object.entries(parsed).filter(([k]) => !k.startsWith("//")));
  }
  return { config: mergeConfig(raw), loadedPath: fs.existsSync(p) ? p : null };
}

export { LOG_LEVELS };
