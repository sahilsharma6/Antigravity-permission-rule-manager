#!/usr/bin/env node
import { loadConfig, DEFAULTS } from "./config.js";
import { Logger } from "./logger.js";
import { Watcher } from "./watcher.js";
import { CdpClient } from "./cdp.js";
import { POLICIES } from "./presets.js";
import { launchHelper } from "./launch.js";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--policy") args.policy = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--config") args.config = argv[++i];
    else if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--log-file") args.logFile = argv[++i];
    else if (a === "--no-log-file") args.logFile = null;
    else args._.push(a);
  }
  return args;
}

function usage() {
  console.log(`antigravity-auto-accept — auto-accept Antigravity agent approval prompts

Usage:
  node src/cli.js [command] [options]

Commands:
  (default)          Run the watcher until Ctrl+C
  doctor             Diagnose CDP connectivity and report what would happen
  launch             Show how to start Antigravity with the debug port

Options:
  --config <path>    Path to config.json (default: ./config.json)
  --policy <name>    Override policy: ${Object.values(POLICIES).join(" | ")}
  --port <n>         Override CDP port (adds to the probe list)
  --dry-run          Log what would be accepted without clicking
  --verbose          Debug-level logging
  --log-file <path>  Override log file path
  --no-log-file      Disable log file, stderr only
  -h, --help         Show this help
`);
}

async function doctor({ config }) {
  console.log("antigravity-auto-accept doctor");
  console.log("-------------------------------");
  console.log(`policy:            ${config.policy}`);
  console.log(`dryRun:            ${config.dryRun}`);
  console.log(`enabled:           ${config.enabled}`);
  console.log(`cdp host:          ${config.cdp.host}`);
  console.log(`cdp ports:         ${config.cdp.ports.join(", ")}`);
  console.log(`poll interval:     ${config.scan.pollIntervalMs}ms`);
  console.log(`dedupe cooldown:   ${config.dedupe.perButtonCooldownMs}ms`);
  console.log(`blocked commands:  ${config.commands.blocked.length}`);
  console.log(`allowed commands:  ${config.commands.allowed.length === 0 ? "(none — block-list mode)" : config.commands.allowed.length + " (allow-list mode)"}`);

  const found = await CdpClient.discover(config.cdp.host, config.cdp.ports);
  if (!found) {
    console.log("");
    console.log("✗ No CDP endpoint found. Antigravity must be started with the debug port:");
    console.log(launchHelper(config.cdp.ports[0]));
    process.exitCode = 1;
    return;
  }
  console.log("");
  console.log(`✓ CDP endpoint live on port ${found.port} (${found.version?.Browser || "unknown"})`);

  try {
    const targets = await CdpClient.listTargets(config.cdp.host, found.port);
    console.log(`✓ ${targets.length} debuggable target(s)`);
    const picked = CdpClient.pickTarget(targets);
    if (picked) {
      console.log(`  agent panel candidate: type=${picked.type} url=${String(picked.url).slice(0, 100)}`);
    } else {
      console.log("  ! no plausible agent panel target found — open an agent conversation in Antigravity");
    }
    for (const t of targets.slice(0, 10)) {
      console.log(`    - [${t.type}] ${String(t.url || t.title || "").slice(0, 90)}`);
    }
  } catch (err) {
    console.log(`✗ listing targets failed: ${err.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args._.includes("-h") || args._.includes("--help")) {
    usage();
    return;
  }
  const command = args._.find((c) => !c.startsWith("-")) || "run";

  let loaded;
  try {
    loaded = loadConfig({ file: args.config || "config.json" });
  } catch (err) {
    console.error(`config error: ${err.message}`);
    process.exitCode = 2;
    return;
  }

  // CLI overrides
  const overrides = {};
  if (args.policy) {
    if (!Object.values(POLICIES).includes(args.policy)) {
      console.error(`invalid --policy: ${args.policy} (expected one of ${Object.values(POLICIES).join(", ")})`);
      process.exitCode = 2;
      return;
    }
    overrides.policy = args.policy;
  }
  if (typeof args.dryRun === "boolean") overrides.dryRun = args.dryRun;
  if (Number.isInteger(args.port)) overrides.cdp = { ...DEFAULTS.cdp, ports: [args.port, ...DEFAULTS.cdp.ports] };

  const config = { ...loaded.config, ...overrides, cdp: { ...loaded.config.cdp, ...overrides.cdp } };
  if (overrides.policy || overrides.dryRun !== undefined || overrides.cdp) {
    console.log(`overridden: policy=${config.policy} dryRun=${config.dryRun} ports=[${config.cdp.ports.join(", ")}]`);
  }

  const logger = new Logger({
    level: args.verbose ? "debug" : config.logging.logLevel,
    file: args.logFile === null ? null : args.logFile || config.logging.logFile,
  });

  if (command === "doctor") {
    await doctor({ config, logger });
    logger.close();
    return;
  }
  if (command === "launch") {
    console.log(launchHelper(config.cdp.ports[0]));
    return;
  }
  if (command !== "run") {
    console.error(`unknown command: ${command}`);
    usage();
    process.exitCode = 2;
    return;
  }

  const watcher = new Watcher({ config, logger });
  const shutdown = async () => {
    logger.info("shutdown", { stats: watcher.stats });
    await watcher.stop();
    logger.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logger.info("startup", { configPath: loaded.loadedPath, node: process.version });
  await watcher.start();
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
