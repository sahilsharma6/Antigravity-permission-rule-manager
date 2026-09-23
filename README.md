# antigravity-auto-accept

Standalone, zero-dependency watcher that automatically accepts eligible
**Accept / Approve / Run / Allow** prompts from [Google Antigravity](https://antigravity.google)
(and the separately distributed "Antigravity IDE") agent panels, so long agent
sessions don't stall waiting for a manual click.

It works by talking **Chrome DevTools Protocol (CDP)** to Antigravity's agent
webview — the same approach Antigravity itself uses for debugging — and clicking
only the buttons you have explicitly allow-listed by policy. All decision logic
(policy, command filtering, dedupe, rate limiting) runs in Node where it can be
logged, tested and audited; the page-side script only finds candidates.

## What it does

- Detects approval prompts rendered inside the agent panel webview:
  - terminal command prompts (`Run` buttons) — filtered by block/allow lists
  - file-edit prompts (`Accept` buttons) — opt-in via policy
  - permission prompts (`Allow`, `Always allow`, ...)
  - flow prompts (`Retry`, `Continue`) — opt-in via policy
- Accepts them without manual interaction
- Refuses unrelated or unexpected buttons (word-boundary matching, so
  `accept-test.js` never matches `Accept`)
- Never accepts the same prompt twice in a row (dedupe + cooldown)
- Degrades gracefully: reconnects when the IDE restarts, gives up safely after
  repeated failures, never crashes over logging problems

## How it works

1. Start Antigravity with its DevTools debug port (see below).
2. The watcher discovers the port, lists CDP targets and attaches to the one
   that looks like the agent panel webview.
3. It injects a small scanner script that knows your current button keywords.
4. Node polls `scan()` at a configurable interval, re-checks every candidate
   against the same presets, applies policy + command rules + rate limits,
   then asks the page to click a single button per pass.
5. Reconnects with jittered backoff whenever the session dies.

Nothing is auto-clicked that you have not allow-listed by policy, and terminal
commands can be constrained by a block list (default) or an allow list.

## Requirements

- **Node.js ≥ 22** (uses the built-in WebSocket client; no npm packages needed)
- Antigravity or Antigravity IDE running locally

## Installation / setup

```bash
git clone <this-repo> antigravity-auto-accept
cd antigravity-auto-accept
npm install            # dev tooling only (eslint, prettier); no runtime deps
cp config.example.json config.json
```

## Start Antigravity with the debug port

The agent panel runs in an isolated Chromium process; the debug port is the
only reliable way to reach its buttons.

**Windows** — edit your Antigravity shortcut once and append to *Target*:

```
--remote-debugging-port=9333
```

or launch directly:

```powershell
& "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=9333
```

**macOS**

```bash
open -a "Antigravity" --args --remote-debugging-port=9333
```

**Linux**

```bash
antigravity --remote-debugging-port=9333
```

> Use **9333**, not 9222 — Antigravity's built-in browser control already uses
> 9222, and sharing it causes conflicts.

Then verify connectivity:

```bash
npm run doctor
```

## Configuration

Copy `config.example.json` to `config.json` (already git-ignored) and edit.
Every key is optional. CLI flags override the file.

| Key | Default | Description |
| --- | ------- | ----------- |
| `enabled` | `true` | Master switch. `false` idles the watcher (no clicks). |
| `dryRun` | `false` | Log what would be accepted without clicking. |
| `policy` | `commands-only` | Which prompt kinds may be auto-accepted. |
| `cdp.ports` | `[9333, 9222]` | Ports probed in order for the debug endpoint. |
| `cdp.host` | `127.0.0.1` | CDP host. Keep localhost — the port exposes full IDE control. |
| `cdp.reconnectMs` | `3000` | Base wait between reconnect attempts. |
| `scan.pollIntervalMs` | `1000` | Idle scan cadence (≥100ms). |
| `dedupe.perButtonCooldownMs` | `5000` | Min time before the same logical prompt is clicked again. |
| `commands.blocked` | `[]` | Substrings that veto a `Run` prompt (case-insensitive). |
| `commands.allowed` | `[]` | If non-empty, **only** these prefixes may run (allow-list mode). |
| `limits.maxActionsPerMinute` | `0` | Cap accept rate; `0` = unlimited. |
| `limits.maxConsecutiveFailures` | `10` | Watcher stops after this many failures in a row. |
| `logging.logLevel` | `info` | `debug` \| `info` \| `warn` \| `error`. |
| `logging.logFile` | `auto-accept.log` | Log path; `null` = stderr only. |

### Policies

| Policy | Terminal `Run` | Edit `Accept` | Permissions (`Allow`) | Flow (`Retry`/`Continue`) |
| --- | :-: | :-: | :-: | :-: |
| `commands-only` *(default)* | ✅ filtered | ❌ | ✅ | ❌ |
| `commands-and-edits` | ✅ filtered | ✅ | ✅ | ❌ |
| `everything` | ✅ filtered | ✅ | ✅ | ✅ |

The default is deliberately conservative: file edits still require your review.

## How to run it

```bash
# 1. Start Antigravity with --remote-debugging-port=9333
# 2. Then:
npm start

# Recommended first run — watch what it would do:
npm run dry            # same as: node src/cli.js --dry-run

# Diagnostics:
npm run doctor

# Different policy for one session:
node src/cli.js --policy commands-and-edits
```

## How to enable / disable auto-accept

- **Off (temporary):** Ctrl+C the watcher, or press Ctrl+C any time — it logs
  final stats on shutdown.
- **Off (config):** set `"enabled": false` in `config.json`.
- **Dry-run mode:** `"dryRun": true` or `--dry-run` — detects and logs but
  never clicks.
- **Per-policy:** `--policy commands-only | commands-and-edits | everything`.

## Logging and debugging

Every decision is a single JSON line (stderr + `auto-accept.log`):

```json
{"ts":"2026-09-23T10:00:00.000Z","level":"INFO ","event":"action_accepted","kind":"command","text":"Run"}
{"ts":"2026-09-23T10:00:01.000Z","level":"INFO ","event":"action_ignored","kind":"edit","reason":"policy \"commands-only\" does not allow kind \"edit\""}
```

Key events: `watcher_start`, `cdp_discovered`, `cdp_connected`,
`cdp_disconnected`, `action_detected`, `action_accepted`, `action_ignored`,
`action_deduped`, `rate_limited`, `action_failed`, `watcher_giving_up`.

Values whose keys look sensitive (`token`, `password`, `authorization`,
`cookie`, `api key`, ...) are redacted before writing.

## Troubleshooting

**`npm run doctor` finds no CDP endpoint**
Antigravity wasn't started with the debug port, or was restarted without it
(auto-updates can do this). Close all windows and relaunch with the flag.

**Watcher connects but never accepts anything**
- Run `npm run doctor` and check the listed targets — if none looks like the
  agent panel, open an agent conversation first so the webview exists.
- Try `--verbose` to see scans and dedupe decisions.
- Button labels changed in an update? Extend `matches` in `src/presets.js`.

**Accepts the same thing repeatedly**
Increase `dedupe.perButtonCooldownMs`; the dedupe key is
`kind + DOM path + text`, so identical twins re-rendered by React count as the
same logical prompt.

**Clicks land but nothing happens**
The button was likely re-rendered between scan and click. The next scan will
retry; if it loops, raise `scan.pollIntervalMs` to `2000`.

**High CPU**
Raise `scan.pollIntervalMs` (the scanner is DOM-walk based and cheap, but
polling too fast is wasteful).

## Known limitations

- **Only the visible conversation is reachable.** Antigravity's Agent Manager
  renders one shared webview — background conversations are unmounted, so the
  watcher cannot accept prompts in them. Duplicate the workspace to parallelize.
- **UI-dependent.** Buttons are found by visible text; an Antigravity update
  that renames them requires a preset tweak. Word-boundary matching keeps this
  safe but not future-proof.
- **English labels only.** Add your localized texts via `src/presets.js`.
- **Not a security boundary.** Auto-accepting an agent's actions is a trust
  decision; keep the block list current and prefer allow-list mode for
  high-value machines.
- **The debug port exposes the whole IDE** on localhost. Do not forward it,
  and keep `cdp.host` at `127.0.0.1`.

## Development

```bash
npm test        # unit + integration tests (node:test)
npm run lint    # eslint
npm run format  # prettier
```

Project layout:

```
src/
  cli.js               CLI entry (run | doctor | launch)
  watcher.js           Orchestrator: scan → validate → dedupe → click
  cdp.js               Minimal CDP client (native WebSocket)
  scripts/
    injected-scanner.js  Browser-side scanner source (string, injected)
  presets.js           Policies + button keyword presets
  detector.js          Pure candidate → kind matching
  validator.js         Policy + command-rule validation
  dedupe.js            Rate limiter + dedupe store
  config.js            Defaults, validation, config.json loading
  logger.js            JSON-lines logger with redaction
  launch.js            Per-OS launch instructions
tests/                 node:test suites mirroring src/
```

## Security notes

- No telemetry, no network calls other than localhost CDP.
- No secrets read or stored; logs are redacted.
- The watcher can only click buttons you allow-listed by policy — it never
  types, never approves OS-level dialogs, and never touches merge/conflict
  resolution buttons by design.

## License

MIT — see [LICENSE](LICENSE).
