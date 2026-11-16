const MAC_SYMBOLS = Object.freeze({ CommandOrControl: "⌘", Alt: "⌥", Shift: "⇧" });
const OTHER_NAMES = Object.freeze({ CommandOrControl: "Ctrl" });

export const ISLAND_SHORTCUTS = Object.freeze({
  voice: "CommandOrControl+Shift+Space",
  capture: "CommandOrControl+Alt+Shift+S",
  stop: "CommandOrControl+Alt+Shift+X",
  expand: "CommandOrControl+Alt+Shift+I",
});

export function shortcutLabel(accelerator, platform = process.platform) {
  const keys = accelerator.split("+");
  return platform === "darwin" ? keys.map(key => MAC_SYMBOLS[key] ?? key).join("") : keys.map(key => OTHER_NAMES[key] ?? key).join("+");
}

/** Registers each island action whose key no other application holds. `labels` names only those, so the island never
 * advertises a key that does nothing. */
export function createIslandShortcuts({ globalShortcut, actions, platform = process.platform }) {
  const held = [], labels = {};
  for (const [name, accelerator] of Object.entries(ISLAND_SHORTCUTS)) {
    const run = actions[name];
    // Electron: a throw inside a globalShortcut callback reaches no caller.
    const press = () => { try { void Promise.resolve(run()).catch(() => {}); } catch {} };
    let registered = false;
    try { registered = Boolean(globalShortcut?.register(accelerator, press)); } catch {}
    if (!registered) continue;
    held.push(accelerator);
    labels[name] = shortcutLabel(accelerator, platform);
  }
  return { labels: Object.freeze(labels), close() { for (const accelerator of held.splice(0)) globalShortcut.unregister(accelerator); } };
}
