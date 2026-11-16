import { execFile as nodeExecFile } from "node:child_process";
import { AWARENESS_LIMITS } from "./island-awareness.mjs";
import { isSensitiveName } from "./island-sensitive.mjs";

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
 * `"LSDisplayName"="Safari"`. Neither needs a privacy permission. The name is asked again only when the serial changes.
 * Other platforms have no such command: null. */
export function createFrontApp({ platform = process.platform, execFile = nodeExecFile } = {}) {
  let serial = null, name = null;
  return async function front() {
    if (platform !== "darwin") return null;
    const next = /ASN:[0-9a-fx-]+:/i.exec(await run(execFile, LSAPPINFO, ["front"]))?.[0];
    if (!next) { serial = null; name = null; return null; }
    if (next === serial) return name;
    const found = /"(?:LSDisplayName|name)"\s*=\s*"([^"\n]{1,200})"/.exec(await run(execFile, LSAPPINFO, ["info", "-only", "name", next]))?.[1];
    serial = next; name = found?.trim() || null;
    return name;
  };
}

export const frontApp = options => createFrontApp(options)();

/** What is around the screenshot. `describe()` gives the app in front and the names of open windows, front to back as the
 * system lists them; `describe({ windows: false })` gives only the app, which is what each captured frame needs. A name
 * that looks private (see island-sensitive.mjs) is never listed: a sensitive app in front sets `sensitive`, and a window
 * with such a title is left out. `ignore()` names windows that are this app's own overlays. */
export function createSurroundings({ desktopCapturer, platform = process.platform, execFile = nodeExecFile, ignore = () => [] }) {
  const front = createFrontApp({ platform, execFile });
  return async function describe({ windows: withWindows = true } = {}) {
    const [app, sources] = await Promise.all([
      front().catch(() => null),
      withWindows
        ? Promise.resolve().then(() => desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })).catch(() => [])
        : [],
    ]);
    const sensitive = isSensitiveName(app);
    const own = new Set(ignore());
    const windows = [];
    for (const source of Array.isArray(sources) ? sources : []) {
      const name = typeof source?.name === "string" ? source.name.trim() : "";
      if (!name || own.has(name) || windows.includes(name) || isSensitiveName(name)) continue;
      windows.push(name);
      if (windows.length === AWARENESS_LIMITS.windows) break;
    }
    return { ...(app && !sensitive ? { app } : {}), windows, sensitive };
  };
}
