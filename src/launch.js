/**
 * Helpers for starting Antigravity with the Chrome DevTools Protocol debug
 * port enabled. Used by `npm run doctor` output and documented in README.
 */

export function launchCommand(port = 9333) {
  return {
    windows: `"${process.env.LOCALAPPDATA || "%LOCALAPPDATA%"}\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=${port}`,
    macOS: "/Applications/Antigravity.app/Contents/MacOS/Antigravity --remote-debugging-port=" + port,
    linux: "antigravity --remote-debugging-port=" + port,
  };
}

export function launchHelper(port = 9333) {
  const cmds = launchCommand(port);
  return [
    "Start Antigravity with the CDP debug port enabled:",
    "",
    `  Windows:  ${cmds.windows}`,
    `  macOS:    ${cmds.macOS}`,
    `  Linux:    ${cmds.linux}`,
    "",
    "On Windows you can also edit the Antigravity shortcut once and append",
    `  --remote-debugging-port=${port}`,
    "to the Target field so every launch has the debug port enabled.",
  ].join("\n");
}
