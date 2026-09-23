import fs from "node:fs";
import { LOG_LEVELS } from "./config.js";

const LEVEL_PAD = { debug: "DEBUG", info: "INFO ", warn: "WARN ", error: "ERROR" };

/** Keys whose values are never written to logs. */
const REDACT_KEYS = /token|secret|password|authorization|cookie|api[-_]?key/i;

function redact(value, depth = 0) {
  if (depth > 4) return "[depth]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Structured logger: one JSON line per event to stderr and (optionally) a
 * log file. Sensitive values (tokens, cookies, authorization headers) are
 * redacted before serialization.
 */
export class Logger {
  constructor({ level = "info", file = null } = {}) {
    this.levelValue = LOG_LEVELS[level] ?? LOG_LEVELS.info;
    this.level = level;
    this.file = file;
    this._stream = null;
    if (file) {
      try {
        this._stream = fs.createWriteStream(file, { flags: "a" });
        this._stream.on("error", () => {
          this._stream = null; // never crash the watcher over logging
        });
      } catch {
        this._stream = null;
      }
    }
  }

  log(level, event, data = {}) {
    if ((LOG_LEVELS[level] ?? 0) < this.levelValue) return;
    const record = redact({
      ts: new Date().toISOString(),
      level: LEVEL_PAD[level] || level.toUpperCase(),
      event,
      ...data,
    });
    let line;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({ ts: record.ts, level: record.level, event, error: "unserializable" });
    }
    process.stderr.write(line + "\n");
    if (this._stream) this._stream.write(line + "\n");
  }

  debug(event, data) {
    this.log("debug", event, data);
  }
  info(event, data) {
    this.log("info", event, data);
  }
  warn(event, data) {
    this.log("warn", event, data);
  }
  error(event, data) {
    this.log("error", event, data);
  }

  close() {
    if (this._stream) {
      try {
        this._stream.end();
      } catch {
        /* ignore */
      }
      this._stream = null;
    }
  }
}
