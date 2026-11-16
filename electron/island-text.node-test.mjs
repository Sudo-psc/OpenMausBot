import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { islandLabels } from "./island-text.mjs";

const { createNativeText, englishText } = createRequire(import.meta.url)("./native-text.cjs");

test("the island shows the app's language and falls back to English for a language without a pack", () => {
  const portuguese = islandLabels(createNativeText({ saved: "pt-br" }).t, "pt-BR");
  assert.equal(portuguese.voice, "Falar");
  assert.equal(portuguese.endConversation, "Encerrar conversa");
  assert.equal(portuguese.lang, "pt-BR");
  const unknown = islandLabels(createNativeText({ saved: "xx-unknown" }).t);
  assert.equal(unknown.voice, "Talk");
  assert.equal(islandLabels(englishText.t).saveReply, "Save reply");
});
