import { execFile as nodeExecFile } from "node:child_process";
import { AWARENESS_LIMITS } from "./island-awareness.mjs";

const LSAPPINFO = "/usr/bin/lsappinfo";

function run(execFile, file, args) {
  return new Promise(resolve => {
    try {
      execFile(file, args, { encoding: "utf8", timeout: 1_000, killSignal: "SIGKILL", maxBuffer: 16_384 },
        (error, stdout) => resolve(error ? "" : String(stdout ?? "")));
    } catch { resolve(""); }
  });
}

/** macOS: `lsappinfo front` prints the front app's serial ("ASN:0x0-0x1b01b:"), and `lsappinfo info -only name` prints
 * `"LSDisplayName"="Safari"`. Neither needs a privacy permission. Other platforms have no such command: null. */
export async function frontApp({ platform = process.platform, execFile = nodeExecFile } = {}) {
  if (platform !== "darwin") return null;
  const serial = /ASN:[0-9a-fx-]+:/i.exec(await run(execFile, LSAPPINFO, ["front"]))?.[0];
  if (!serial) return null;
  const name = /"(?:LSDisplayName|name)"\s*=\s*"([^"\n]{1,200})"/.exec(await run(execFile, LSAPPINFO, ["info", "-only", "name", serial]))?.[1];
  return name?.trim() || null;
}

/** What is around the screenshot: the app in front and the names of open windows, front to back as the system lists
 * them. `ignore()` names windows that are this app's own overlays. A part that cannot be read is left out. */
export function createSurroundings({ desktopCapturer, platform = process.platform, execFile = nodeExecFile, ignore = () => [] }) {
  return async function describe() {
    const [app, sources] = await Promise.all([
      frontApp({ platform, execFile }).catch(() => null),
      Promise.resolve().then(() => desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })).catch(() => []),
    ]);
    const own = new Set(ignore());
    const windows = [];
    for (const source of Array.isArray(sources) ? sources : []) {
      const name = typeof source?.name === "string" ? source.name.trim() : "";
      if (!name || own.has(name) || windows.includes(name)) continue;
      windows.push(name);
      if (windows.length === AWARENESS_LIMITS.windows) break;
    }
    return { ...(app ? { app } : {}), windows };
  };
}
