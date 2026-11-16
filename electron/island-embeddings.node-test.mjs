import assert from "node:assert/strict";
import test from "node:test";
import { createLocalEmbedder } from "./island-embeddings.mjs";

const answer = (body, status = 200) => new Response(JSON.stringify(body), { status });

test("embeddings are asked only of this computer, with bounded text", async () => {
  const calls = [];
  const embedder = createLocalEmbedder({ fetch: async (url, options) => { calls.push({ url, options }); return answer({ embeddings: [[1, 0], [0, 1]] }); } });
  assert.deepEqual(await embedder.embed(["pedido", "x".repeat(5000)]), [[1, 0], [0, 1]]);
  assert.equal(calls[0].url, "http://127.0.0.1:11434/api/embed");
  assert.equal(calls[0].options.redirect, "error");
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(sent.model, "embeddinggemma");
  assert.equal(sent.input[1].length, 600);
  for (const url of ["https://127.0.0.1:11434", "http://example.com:11434", "http://192.168.0.5:11434", "not a url"]) {
    const remote = createLocalEmbedder({ url, fetch: () => assert.fail("must not call a remote host") });
    assert.equal(remote.available(), false);
    assert.equal(await remote.embed(["pedido"]), null);
  }
});

test("a missing or misbehaving model answers null and is left alone for five minutes", async () => {
  for (const reply of [() => answer({}, 404), () => answer({ embeddings: [[1, 0]] }), () => answer({ embeddings: [[1, 0], [1]] }),
    () => answer({ embeddings: [[1, "a"], [0, 1]] }), () => { throw new Error("offline"); }]) {
    let clock = 0, calls = 0;
    const embedder = createLocalEmbedder({ now: () => clock, fetch: async () => { calls += 1; return reply(); } });
    assert.equal(await embedder.embed(["a", "b"]), null);
    assert.equal(embedder.available(), false);
    assert.equal(await embedder.embed(["a", "b"]), null);
    assert.equal(calls, 1);
    clock = 300_000;
    assert.equal(embedder.available(), true);
  }
  const embedder = createLocalEmbedder({ fetch: () => assert.fail("too many texts") });
  assert.equal(await embedder.embed(Array.from({ length: 17 }, () => "a")), null);
  assert.equal(await embedder.embed([]), null);
});

test("a cancelled request does not mark the model as missing", async () => {
  const cancel = new AbortController();
  const embedder = createLocalEmbedder({ fetch: (_url, options) => new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason))) });
  const pending = embedder.embed(["a"], cancel.signal);
  cancel.abort();
  assert.equal(await pending, null);
  assert.equal(embedder.available(), true);
});
