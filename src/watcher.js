import { CdpClient } from "./cdp.js";
import { buildPreset } from "./presets.js";
import { detectKind } from "./detector.js";
import { validateAction } from "./validator.js";
import { RateLimiter, DedupeStore } from "./dedupe.js";

const RECONNECT_JITTER = 0.2;

/**
 * Orchestrates the whole loop: discover CDP port, connect to the agent
 * webview, poll scans, validate candidates (policy + command rules), dedupe,
 * click, and log. Reconnects with jittered backoff when the IDE restarts.
 */
export class Watcher {
  constructor({ config, logger, cdp = CdpClient, clock = () => Date.now() }) {
    this.config = config;
    this.logger = logger;
    this.Cdp = cdp;
    this.clock = clock;
    this.preset = buildPreset(config.commands.blocked, config.commands.allowed);
    this.limiter = new RateLimiter(config.limits);
    this.dedupe = new DedupeStore({ cooldownMs: config.dedupe.perButtonCooldownMs });
    this._stopping = false;
    this._timer = null;
    this._client = new cdp({ host: config.cdp.host, logger, preset: this.preset });
    this.stats = { scanned: 0, detected: 0, accepted: 0, ignored: 0, failed: 0 };
  }

  async start() {
    const { enabled, policy, dryRun, cdp } = this.config;
    this.logger.info("watcher_start", { enabled, policy, dryRun, ports: cdp.ports, host: cdp.host });

    if (!enabled) {
      this.logger.info("watcher_idle", { reason: "auto-accept disabled in config" });
      return;
    }

    while (!this._stopping) {
      try {
        await this._connectOnce();
        await this._pollLoop();
      } catch (err) {
        this.logger.warn("watcher_cycle_failed", { error: String(err?.message || err) });
      }
      if (this._stopping) break;
      const delay = this._jitteredBackoff();
      this.logger.info("watcher_reconnect_wait", { delayMs: delay });
      await sleep(delay);
    }
  }

  async stop() {
    this._stopping = true;
    if (this._timer) clearTimeout(this._timer);
    if (this._client) this._client.close();
  }

  /** One connection + poll cycle. */
  async _connectOnce() {
    const { host, ports } = this.config.cdp;
    const found = await CdpClient.discover(host, ports);
    if (!found) {
      throw new Error(
        `no CDP endpoint on ${host}:${ports.join("/")} — start Antigravity with --remote-debugging-port=${ports[0]}`
      );
    }
    this.logger.info("cdp_discovered", { port: found.port, browser: found.version?.Browser });

    // Fresh client per cycle: the previous session's socket/target is dead by
    // definition when we get here (IDE restart, webview reload).
    this._client?.close();
    this._client = new this.Cdp({ host, logger: this.logger, preset: this.preset });
    const conn = await this._client.connect(ports);
    this.logger.info("cdp_connected", {
      port: conn.port,
      targetId: conn.targetId,
      targetUrl: conn.targetUrl,
    });
  }

  async _pollLoop() {
    const interval = this.config.scan.pollIntervalMs;
    while (!this._stopping) {
      const cycleStart = Date.now();
      try {
        await this._processOnce();
      } catch (err) {
        this.logger.warn("scan_cycle_failed", { error: String(err?.message || err) });
        // Session died (IDE restart, webview reload) — reconnect.
        break;
      }
      const elapsed = Date.now() - cycleStart;
      await sleep(Math.max(50, interval - elapsed));
    }
    this._client?.close();
    this._client = null;
  }

  /** One scan+decide+act pass. Exposed for tests. */
  async _processOnce() {
    const candidates = await this._client.scan();
    this.stats.scanned += 1;
    const prioritized = prioritizeCandidates(candidates);

    for (const cand of prioritized) {
      // Double-check kind client-side: the page scanner already matched, but
      // the Node side re-validates against the same presets (defense in depth).
      const detected = detectKind(cand.text, this.preset);
      const kind = detected?.kind || cand.kind;
      if (!kind) continue;

      const verdict = validateAction({
        kind,
        commandText: cand.command || "",
        policy: this.config.policy,
        commands: this.config.commands,
        limits: this.config.limits,
      });
      if (!verdict.ok) {
        this.stats.ignored += 1;
        this.logger.info("action_ignored", {
          kind,
          text: cand.text,
          reason: verdict.reason,
        });
        continue;
      }

      const dedupeKey = `${cand.kind}:${cand.path || cand.text}:${cand.text}`;
      if (!this.dedupe.shouldProcess(dedupeKey)) {
        this.stats.ignored += 1;
        this.logger.debug("action_deduped", { kind, text: cand.text });
        continue;
      }

      if (!this.limiter.tryAcquire()) {
        this.logger.warn("rate_limited", { kind, text: cand.text });
        continue;
      }

      await this._act(cand, kind);
      // Only one accept per scan pass keeps behavior predictable and gives
      // the UI time to re-render before the next pass.
      return;
    }
  }

  async _act(cand, kind) {
    const { dryRun } = this.config;
    this.logger.info("action_detected", { kind, text: cand.text, dryRun });
    try {
      if (dryRun) {
        this.logger.info("action_would_accept", { kind, text: cand.text });
        this.stats.accepted += 1;
        this.limiter.recordSuccess();
        return;
      }
      const result = await this._client.click(cand.key);
      if (result && result.ok) {
        this.stats.accepted += 1;
        this.limiter.recordSuccess();
        this.logger.info("action_accepted", { kind, text: cand.text });
      } else {
        throw new Error(result?.reason || "click reported failure");
      }
    } catch (err) {
      this.stats.failed += 1;
      const fatal = this.limiter.recordFailure();
      this.logger.error("action_failed", { kind, text: cand.text, error: String(err?.message || err) });
      if (fatal) {
        this.logger.error("watcher_giving_up", {
          consecutiveFailures: this.limiter.consecutiveFailures,
        });
        await this.stop();
      }
    }
  }

  _jitteredBackoff() {
    const base = this.config.cdp.reconnectMs;
    const jitter = base * RECONNECT_JITTER * Math.random();
    return Math.round(base + jitter);
  }
}

/** Stable ordering: highest priority (lowest number) first. */
export function prioritizeCandidates(candidates) {
  return [...candidates].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
