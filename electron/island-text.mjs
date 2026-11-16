import nativeText from "./native-text.cjs";

export const englishT = nativeText.englishText.t;

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
  shortcuts: "native.island.shortcuts", captureHidden: "native.island.captureHidden", dictate: "native.island.dictate", stopDictation: "native.island.stopDictation",
  dictating: "native.island.dictating", dictateHint: "native.island.dictateHint", voiceHint: "native.island.voiceHint",
  shortcutDictate: "native.island.shortcutDictate", computerReady: "native.island.computerReady",
  computerOff: "native.island.computerOff", computerPermissions: "native.island.computerPermissions",
  computerStarting: "native.island.computerStarting", computerUnsupported: "native.island.computerUnsupported",
  computerEnable: "native.island.computerEnable", computerAllow: "native.island.computerAllow",
});

export function islandLabels(t = englishT, lang = "en") {
  const labels = Object.fromEntries(Object.entries(LABEL_KEYS).map(([name, key]) => [name, t(key)]));
  return Object.freeze({ ...labels, lang });
}

/** A message the island generated, kept as its key so a change of language redraws it. */
export const notice = (key, params) => Object.freeze({ key, params });

export const words = (t, value) => typeof value === "string" ? value : value ? t(value.key, value.params) : "";
