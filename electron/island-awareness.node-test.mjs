import assert from "node:assert/strict";
import test from "node:test";
import { cosine, createSurpriseGate, frameSignature, lexicalSimilarity, selectFrames, signatureDistance } from "./island-awareness.mjs";

function bitmap(luma) {
  const pixels = Buffer.alloc(9 * 8 * 4);
  for (let i = 0; i < 72; i += 1) pixels.fill(luma(i % 9, Math.floor(i / 9)), i * 4, i * 4 + 3);
  return pixels;
}
const rising = frameSignature(bitmap(x => x * 20)), falling = frameSignature(bitmap(x => 200 - x * 20));

test("a signature tells like screens from different ones without keeping the picture", () => {
  assert.equal(rising, "0000000000000000");
  assert.equal(falling, "ffffffffffffffff");
  assert.equal(signatureDistance(rising, rising), 0);
  assert.equal(signatureDistance(rising, falling), 1);
  assert.equal(signatureDistance(rising, frameSignature(bitmap((x, y) => y === 0 ? 200 - x * 20 : x * 20))), 0.125);
  assert.equal(frameSignature(Buffer.alloc(10)), null);
  assert.equal(signatureDistance(rising, "not-a-signature"), 1);
});

test("the gate keeps a capture only when the screen is not what it expected", () => {
  const gate = createSurpriseGate();
  const frame = (signature, app = "Safari", window = "Inbox") => ({ signature, app, windows: [window] });
  assert.deepEqual(gate.decide(frame(rising)), { keep: true, reason: "first", surprise: 1 });
  assert.deepEqual(gate.decide(frame(rising)), { keep: false, reason: "same", surprise: 0 });
  assert.equal(gate.decide(frame("0000000000000007")).reason, "similar");
  assert.equal(gate.decide(frame(rising, "Notas")).reason, "app");
  assert.equal(gate.decide(frame(rising, "Notas", "Outra janela")).reason, "window");
  assert.deepEqual(gate.decide(frame(falling, "Notas", "Outra janela")), { keep: true, reason: "screen", surprise: 1 });
  gate.reset();
  assert.equal(gate.decide(frame(falling)).reason, "first");
});

test("a restless screen has to change more before another capture is kept", () => {
  const gate = createSurpriseGate();
  const frame = signature => ({ signature, app: "Player", windows: ["Filme"] });
  const flicker = ["00000000000000ff", "000000000000ff00", "00000000000000ff", "000000000000ff00", "00000000000000ff", "000000000000ff00"];
  gate.decide(frame(rising));
  const kept = flicker.map(signature => gate.decide(frame(signature)).keep);
  assert.deepEqual(kept.slice(0, 4), [true, true, true, false]);
  assert.equal(gate.decide(frame(falling)).keep, true);
});

test("similarity ignores case and accents, and cosine guards odd vectors", () => {
  assert.equal(lexicalSimilarity("o relatório de vendas", "RELATORIO Vendas 2026 · Planilhas"), 1);
  assert.equal(lexicalSimilarity("agenda", "Planilhas"), 0);
  assert.equal(lexicalSimilarity("", "Planilhas"), 0);
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1], [1, 2]), 0);
});

test("a request gets the newest screen plus the earlier ones that fit it best", async () => {
  const frames = ["Mail · Caixa de entrada", "Planilhas · Relatório de vendas", "Música", "Navegador · Notícias", "Terminal"]
    .map((name, index) => ({ id: index, app: name.split(" · ")[0], windows: [name.split(" · ")[1]].filter(Boolean) }));
  assert.deepEqual((await selectFrames({ query: "resuma o relatório de vendas", frames })).map(frame => frame.id), [1, 3, 4]);
  assert.deepEqual((await selectFrames({ query: "", frames })).map(frame => frame.id), [2, 3, 4]);
  assert.deepEqual((await selectFrames({ query: "x", frames: frames.slice(0, 2) })).map(frame => frame.id), [0, 1]);
  assert.deepEqual(await selectFrames({ query: "x", frames: [] }), []);
  const asked = [];
  const embed = async texts => { asked.push(texts); return texts.map((_, index) => index === 0 || index === 3 ? [1, 0] : [0, 1]); };
  assert.deepEqual((await selectFrames({ query: "tocar algo", frames, embed })).map(frame => frame.id), [2, 3, 4]);
  assert.equal(asked[0][0], "tocar algo");
  assert.equal(asked[0].length, 5);
  for (const broken of [async () => null, async () => [[1]], async () => { throw new Error("offline"); }]) {
    assert.deepEqual((await selectFrames({ query: "resuma o relatório de vendas", frames, embed: broken })).map(frame => frame.id), [1, 3, 4]);
  }
});
