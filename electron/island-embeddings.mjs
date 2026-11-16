const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const TIMEOUT_MS = 1_500, RETRY_MS = 300_000, MAX_TEXTS = 16, MAX_CHARS = 600;

/**
 * Text embeddings from a model the person runs on this computer (Ollama's /api/embed, EmbeddingGemma by default).
 * Security: only a loopback address is ever called, so the request and window names it embeds never leave the machine.
 * `embed` resolves one vector per text, or null when the model is absent, slow or answers badly; after a failure it
 * waits five minutes before asking again.
 */
export function createLocalEmbedder({ fetch = globalThis.fetch, url = "http://127.0.0.1:11434", model = "embeddinggemma", now = Date.now } = {}) {
  let endpoint = null, retryAt = 0;
  try {
    const parsed = new URL("/api/embed", url);
    if (parsed.protocol === "http:" && LOOPBACK.has(parsed.hostname)) endpoint = parsed.href;
  } catch {}
  return {
    available: () => endpoint !== null && now() >= retryAt,
    async embed(texts, signal) {
      if (!endpoint || now() < retryAt || !Array.isArray(texts) || !texts.length || texts.length > MAX_TEXTS) return null;
      const input = texts.map(text => String(text ?? "").slice(0, MAX_CHARS) || " ");
      try {
        const deadline = AbortSignal.timeout(TIMEOUT_MS);
        const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, input }), redirect: "error", signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
        if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error("refused"); }
        const vectors = (await response.json())?.embeddings;
        const valid = Array.isArray(vectors) && vectors.length === input.length
          && vectors.every(vector => Array.isArray(vector) && vector.length > 0 && vector.length === vectors[0].length && vector.every(Number.isFinite));
        if (!valid) throw new Error("invalid");
        return vectors;
      } catch {
        if (!signal?.aborted) retryAt = now() + RETRY_MS;
        return null;
      }
    },
  };
}
