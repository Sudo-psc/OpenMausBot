import assert from "node:assert/strict";
import test from "node:test";
import { createIslandShortcuts, ISLAND_SHORTCUTS, shortcutLabel } from "./island-shortcuts.mjs";

function keys({ taken = [] } = {}) {
  const held = new Map();
  return { held, register(accelerator, press) { if (taken.includes(accelerator)) return false; held.set(accelerator, press); return true; },
    unregister(accelerator) { held.delete(accelerator); } };
}

test("each island action gets its own key, named for the platform", () => {
  const globalShortcut = keys(), pressed = [];
  const actions = Object.fromEntries(Object.keys(ISLAND_SHORTCUTS).map(name => [name, () => pressed.push(name)]));
  const shortcuts = createIslandShortcuts({ globalShortcut, actions, platform: "darwin" });
  assert.deepEqual(shortcuts.labels, { voice: "⌘⇧Space", dictate: "⌘⌥⇧D", capture: "⌘⌥⇧S", stop: "⌘⌥⇧X", expand: "⌘⌥⇧I" });
  for (const press of globalShortcut.held.values()) press();
  assert.deepEqual(pressed, ["voice", "dictate", "capture", "stop", "expand"]);
  assert.equal(new Set(Object.values(ISLAND_SHORTCUTS)).size, 5);
  assert.equal(shortcutLabel(ISLAND_SHORTCUTS.capture, "win32"), "Ctrl+Alt+Shift+S");
  shortcuts.close();
  assert.equal(globalShortcut.held.size, 0);
});

test("a key another application holds is neither advertised nor released", () => {
  const globalShortcut = keys({ taken: [ISLAND_SHORTCUTS.voice] });
  const released = [];
  globalShortcut.unregister = accelerator => released.push(accelerator);
  const shortcuts = createIslandShortcuts({ globalShortcut, actions: { voice() {}, dictate() {}, capture() {}, stop() {}, expand() {} }, platform: "darwin" });
  assert.equal(shortcuts.labels.voice, undefined);
  assert.equal(shortcuts.labels.stop, "⌘⌥⇧X");
  shortcuts.close(); shortcuts.close();
  assert.deepEqual(released, [ISLAND_SHORTCUTS.dictate, ISLAND_SHORTCUTS.capture, ISLAND_SHORTCUTS.stop, ISLAND_SHORTCUTS.expand]);
});

test("a failing action or a missing shortcut service never throws", async () => {
  const globalShortcut = keys();
  createIslandShortcuts({ globalShortcut, platform: "linux",
    actions: { voice() { throw new Error("fixture"); }, capture: async () => { throw new Error("fixture"); }, dictate() {}, stop() {}, expand() {} } });
  for (const press of globalShortcut.held.values()) press();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(createIslandShortcuts({ globalShortcut: undefined, actions: { voice() {}, dictate() {}, capture() {}, stop() {}, expand() {} } }).labels, {});
});
