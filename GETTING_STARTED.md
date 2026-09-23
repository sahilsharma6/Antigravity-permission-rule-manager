# 🚀 Getting Started — Beginner Friendly

New here? This page takes you from **zero → working** in about 5 minutes.
No prior knowledge needed — just copy-paste the commands.

---

## What is this tool? (30 seconds)

When you use **Antigravity** (Google's AI coding IDE), the AI agent keeps
pausing and asking you to click **Run**, **Accept**, or **Allow** buttons.
This tool clicks those buttons for you — automatically — but **only** the
types you allow it to. You stay in control through a settings file.

---

## ✅ What you need before starting

| Requirement | How to check | Where to get it |
| --- | --- | --- |
| **Node.js v22 or newer** | Open a terminal and type `node --version` | [nodejs.org](https://nodejs.org) → download the **LTS** version |
| **Google Antigravity** installed | You can open and use it normally | [antigravity.google](https://antigravity.google) |
| A terminal | Windows: press `Win + R`, type `cmd`, press Enter — or use PowerShell / Git Bash | Built into your OS |

> 💡 If `node --version` shows **v22.x.x or higher** (like `v24.16.0`), you're good.
> If you get "command not found", install Node from the link above first.

---

## Step 1 — Download the project

Open a terminal, pick a folder you like, and run:

```bash
git clone https://github.com/<your-username>/antigravity-auto-accept.git
cd antigravity-auto-accept
```

> 💡 No Git installed? Click the green **Code** button on the GitHub page →
> **Download ZIP** → unzip it → open a terminal inside that folder instead.

---

## Step 2 — Install (one command)

```bash
npm install
```

This only installs developer tools (linters). The tool itself has **zero**
runtime dependencies — nothing heavy gets downloaded.

---

## Step 3 — Open Antigravity's "debug door" 🔑

Antigravity's approval buttons live in a part of the app that outside tools
normally can't touch. We ask Antigravity to open a **local debug port** so
this tool can reach those buttons. This is a standard developer feature of
Chromium/Electron apps — it only listens on your own computer.

### 🪟 Windows (do this once)

**Option A — make it permanent (recommended):**

1. Find the shortcut you use to open **Antigravity** (Desktop or Start Menu).
2. Right-click it → **Properties**.
3. Click inside the **Target** box, move the cursor to the very **end**, after
   the closing quote.
4. Add a space, then type: `--remote-debugging-port=9333`
   - Example of how it should look:
     ```
     "C:\Users\you\AppData\Local\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=9333
     ```
5. Click **OK**, then close **all** Antigravity windows and open it again
   using that shortcut.

**Option B — one-time launch (temporary):**

```powershell
& "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=9333
```

### 🍎 macOS

```bash
open -a "Antigravity" --args --remote-debugging-port=9333
```

### 🐧 Linux

```bash
antigravity --remote-debugging-port=9333
```

> ⚠️ Always use port **9333** (not 9222) — Antigravity's built-in browser
> feature already uses 9222, and sharing causes conflicts.

---

## Step 4 — Check that everything works

Back in your terminal, inside the project folder:

```bash
npm run doctor
```

**What you want to see:**

```
✓ CDP endpoint live on port 9333
✓ N debuggable target(s)
```

**If you see ✗ "No CDP endpoint found":** Antigravity wasn't started with the
debug flag. Close **all** its windows completely, then start it again using
the shortcut/command from Step 3, and run `npm run doctor` again.

---

## Step 5 — Try it SAFELY first (watch mode 👀)

```bash
npm run dry
```

This runs the tool in **dry-run mode**: it watches for approval prompts and
tells you what it *would* accept — but **clicks nothing**. Leave it running,
open an agent chat in Antigravity, give the agent a small task, and watch the
log messages appear. Press `Ctrl + C` to stop.

---

## Step 6 — Turn it on for real

```bash
npm start
```

That's it. The tool now:

1. Detects eligible approval prompts in your agent panel
2. Accepts only the types your policy allows (default: terminal commands + permission prompts — **file edits still need your click**)
3. Logs every decision to the screen and to `auto-accept.log`

**To stop:** press `Ctrl + C` in the terminal. Antigravity keeps working
normally — the tool is just a helper watching from outside.

---

## 🎛 Changing what it accepts (optional)

Copy the example config once:

```bash
cp config.example.json config.json
```

Then open `config.json` in any editor. The most useful options:

| I want to... | Do this |
| --- | --- |
| Turn the tool **off** temporarily | Set `"enabled": false` (or just Ctrl+C it) |
| Also auto-accept **file edits** | Set `"policy": "commands-and-edits"` |
| Never auto-run dangerous commands | Add them to `"commands": { "blocked": [...] }` |
| Only allow specific commands | Use `"commands": { "allowed": ["npm ", "git status"] }` |
| Watch without clicking | Set `"dryRun": true` |

Full option list: see the main [README](README.md#configuration).

---

## 🆘 Common beginner problems

<details>
<summary><b>Nothing is being accepted / tool is silent</b></summary>

- Did you **open an agent conversation** in Antigravity? The agent panel only
  exists after you start a chat with the agent.
- Run `npm run doctor` again — is the debug port still alive? If Antigravity
  restarted (e.g. after an update), the port is gone → redo Step 3.
- Try `npm start -- --verbose` to see detailed logs.
</details>

<details>
<summary><b>"No CDP endpoint found" error</b></summary>

Antigravity is not running with the debug port. Close **all** Antigravity
windows (check the system tray too), then relaunch it via the shortcut or
command from Step 3.
</details>

<details>
<summary><b>It accepted something I didn't want</b></summary>

Stop the tool (`Ctrl + C`). Then tighten your `config.json`:
- Keep the default `commands-only` policy (file edits stay manual)
- Add a `commands.blocked` list, or switch to an `allowed` whitelist
- Re-run with `npm run dry` first to preview decisions
</details>

<details>
<summary><b>Is my Google account safe? Should I worry about bans?</b></summary>

Honest answer: this tool works entirely inside the official IDE on your own
machine and doesn't extract tokens or talk to third-party servers, which is
very different from the tools Google actually banned people for. But no
third-party automation is ever 100% risk-free.

If you want **zero** risk, use Antigravity's built-in settings instead:
**Settings → Agent → Terminal Command Auto Execution → "Always Proceed"**.
This tool only adds value for prompts the built-in settings don't cover
(file-edit accepts, permission dialogs, clicking through agent sessions).
</details>

---

## 🧹 How to remove it completely

1. Stop the tool: `Ctrl + C` in its terminal.
2. (Windows) Remove `--remote-debugging-port=9333` from your Antigravity
   shortcut's Target field again.
3. Delete the project folder. That's everything — no leftover services,
   no background processes, no registry changes.

---

## Next steps

- Full configuration reference → [README](README.md)
- How it works internally → [README: How it works](README.md#how-it-works)
- Found a bug or want a feature? Open an issue on GitHub 🐛
