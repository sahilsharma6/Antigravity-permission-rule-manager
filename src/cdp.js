import { SCANNER_SOURCE_BUILDER, SCANNER_VERSION } from "./scripts/injected-scanner.js";

const EVAL_TIMEOUT_MS = 10_000;

/**
 * Minimal Chrome DevTools Protocol client. Uses Node's built-in WebSocket
 * (Node >= 22) so the project has zero runtime dependencies.
 *
 * Design: the Node side polls `scan()` on each webview target; the page-side
 * script only finds candidates and clicks on explicit request. No events or
 * bindings — fewer moving parts, easier to reason about and to test.
 */
export class CdpClient {
  constructor({ host = "127.0.0.1", logger = null, preset = null } = {}) {
    this.host = host;
    this.logger = logger;
    this.preset = preset;
    this._ws = null;
    this._nextId = 1;
    this._pending = new Map();
    this._closed = false;
    this.port = null;
    this.targetId = null;
    this.targetUrl = "";
  }

  /** Probe a CDP HTTP endpoint; returns version info or null. */
  static async probe(host, port, timeoutMs = 800) {
    try {
      const res = await fetch(`http://${host}:${port}/json/version`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /** Find the first live port among candidates. */
  static async discover(host, ports) {
    for (const port of ports) {
      const version = await CdpClient.probe(host, port);
      if (version) return { host, port, version };
    }
    return null;
  }

  /** List targets from a CDP HTTP endpoint. */
  static async listTargets(host, port, timeoutMs = 1500) {
    const res = await fetch(`http://${host}:${port}/json/list`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from /json/list on port ${port}`);
    const targets = await res.json();
    return Array.isArray(targets) ? targets : [];
  }

  /**
   * Rank targets by likelihood of being the agent panel webview: explicit
   * webview types first, then webview-ish URLs, then ordinary pages (the main
   * workbench is still useful — the panel may live in an iframe-free layer
   * depending on version).
   */
  static rankTargets(targets) {
    if (!Array.isArray(targets)) return [];
    const score = (t) => {
      if (t.type === "webview") return 0;
      if (/webview|cascade|agent/i.test(t.url || "")) return 1;
      if (t.type === "page") return 2;
      return 3;
    };
    return [...targets].sort((a, b) => score(a) - score(b));
  }

  /** Kept for diagnostics/doctor: most plausible single target or null. */
  static pickTarget(targets) {
    return CdpClient.rankTargets(targets)[0] || null;
  }

  /**
   * Connect to the first reachable port with a plausible target. Tries every
   * candidate target per port (preferred order from pickTarget) so a single
   * dead or unattachable target cannot break the whole port.
   * Returns { port, targetId, targetUrl } or throws.
   */
  async connect(ports) {
    for (const port of ports) {
      let targets = [];
      try {
        targets = await CdpClient.listTargets(this.host, port);
      } catch (err) {
        this.logger?.debug?.("cdp_list_failed", { port, error: String(err?.message || err) });
        continue;
      }
      for (const target of CdpClient.rankTargets(targets)) {
        if (!target.webSocketDebuggerUrl) continue;
        try {
          await this._open(target.webSocketDebuggerUrl);
          this.port = port;
          this.targetId = target.id;
          this.targetUrl = target.url || "";
          await this.installScanner();
          return { port, targetId: target.id, targetUrl: this.targetUrl };
        } catch (err) {
          this.logger?.debug?.("cdp_connect_failed", {
            port,
            url: String(target.url || "").slice(0, 80),
            error: String(err?.message || err),
          });
          this._closeSocket();
        }
      }
    }
    throw new Error(`no reachable CDP target on ports ${ports.join(", ")}`);
  }

  _open(wsUrl, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => fail(new Error("WebSocket open timeout")), timeoutMs);
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };
      ws.addEventListener("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._ws = ws;
        resolve();
      });
      ws.addEventListener("error", () => fail(new Error("WebSocket connection error")));
      ws.addEventListener("close", () => {
        this._ws = null;
        if (!settled) fail(new Error("WebSocket closed before open"));
        else if (!this._closed) this.logger?.warn?.("cdp_disconnected", {});
      });
      ws.addEventListener("message", (ev) => this._onMessage(ev.data));
    });
  }

  _closeSocket() {
    if (this._ws) {
      try {
        this._ws.close();
      } catch {
        /* ignore */
      }
      this._ws = null;
    }
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.id && this._pending.has(msg.id)) {
      const { resolve, reject } = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || "CDP protocol error"));
      else resolve(msg.result);
    }
  }

  /** Send a CDP command and resolve with its result. Rejects on timeout. */
  send(method, params = {}) {
    if (!this._ws || this._ws.readyState !== 1) {
      return Promise.reject(new Error("CDP WebSocket is not open"));
    }
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`CDP call timed out: ${method}`));
      }, EVAL_TIMEOUT_MS);
      this._pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this._ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate an expression; returns the JSON-serializable result value. */
  async evaluate(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res?.exceptionDetails) {
      const text =
        res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        "page evaluation failed";
      throw new Error(text.split("\n")[0]);
    }
    return res?.result?.value;
  }

  /** Inject (or verify) the page-side scanner. Safe to call repeatedly. */
  async installScanner() {
    const source = SCANNER_SOURCE_BUILDER(this.preset || { actions: [], commands: {} });
    // The source is a self-contained IIFE that ends with ';'; just append the
    // version probe. Wrapping it in extra parens would be a syntax error.
    const version = await this.evaluate(
      `${source} typeof window.__agAutoAccept === "object" ? window.__agAutoAccept.version : -1`
    );
    if (version !== SCANNER_VERSION) {
      throw new Error(`scanner version mismatch after injection: got ${version}`);
    }
    return version;
  }

  /** Run one scan pass; returns candidate descriptors from the page. */
  async scan() {
    const ok = await this.evaluate(
      'window.__agAutoAccept && window.__agAutoAccept.version === ' + SCANNER_VERSION
    );
    if (!ok) {
      await this.installScanner();
    }
    const candidates = await this.evaluate("window.__agAutoAccept.scan()");
    return Array.isArray(candidates) ? candidates : [];
  }

  /** Click a candidate by key. Returns the page's click result object. */
  async click(key) {
    const safeKey = String(key).replace(/[^a-z0-9-]/gi, "");
    return this.evaluate(`window.__agAutoAccept.click(${JSON.stringify(safeKey)})`);
  }

  close() {
    this._closed = true;
    this._closeSocket();
    for (const { reject } of this._pending.values()) {
      reject(new Error("CDP client closed"));
    }
    this._pending.clear();
  }
}
