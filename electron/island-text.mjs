import nativeText from "./native-text.cjs";

export const englishT = nativeText.englishText.t;

/** Page labels, each named by its key in src/locales/en.json. */
const LABEL_KEYS = Object.freeze({
  idle: "native.island.idle", listening: "native.island.listening", thinking: "native.island.thinking",
  reply: "native.island.reply", error: "native.island.error", expand: "native.island.expand",
  collapse: "native.island.collapse", send: "native.island.send", prompt: "native.island.prompt",
  voice: "native.island.voice", stopVoice: "native.island.stopVoice", captureOn: "native.island.captureOn",
  captureOff: "native.island.captureOff", captureActive: "native.island.captureActive",
  capturePaused: "native.island.capturePaused", omi: "native.island.omi", omiReady: "native.island.omiReady",
  omiOff: "native.island.omiOff", omiLoading: "native.island.omiLoading", omiError: "native.island.omiError",
  omiKey: "native.island.omiKey", connect: "native.island.connect", disconnect: "native.island.disconnect",
  refresh: "native.island.refresh", configure: "native.island.configure", cancel: "native.island.cancel",
  openChat: "native.island.openChat", closeSettings: "native.island.closeSettings", context: "native.island.context",
  speaking: "native.island.speaking", endConversation: "native.island.endConversation",
  saveNote: "native.island.saveNote", saveReply: "native.island.saveReply", saveHint: "native.island.saveHint",
  shortcutVoice: "native.island.shortcutVoice", shortcutCapture: "native.island.shortcutCapture",
  shortcutStop: "native.island.shortcutStop", shortcutExpand: "native.island.shortcutExpand",
  shortcuts: "native.island.shortcuts",
});

/** The page's words in `t`'s language; `lang` is the BCP-47 tag speech synthesis uses for the same language. */
export function islandLabels(t = englishT, lang = "en") {
  const labels = Object.fromEntries(Object.entries(LABEL_KEYS).map(([name, key]) => [name, t(key)]));
  return Object.freeze({ ...labels, lang });
}
