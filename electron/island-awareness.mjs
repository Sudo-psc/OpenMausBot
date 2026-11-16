export const AWARENESS_LIMITS = Object.freeze({ signatureWidth: 9, signatureHeight: 8, surprise: 0.1, calm: 0.02,
  sentFrames: 3, windows: 6, textChars: 120 });

/** A 64-bit difference hash of a 9×8 BGRA bitmap (Electron's NativeImage.toBitmap), as 16 hex digits. Two screens that
 * look alike differ in few bits, so their distance says how much the screen changed without keeping either image. */
export function frameSignature(bitmap, width = AWARENESS_LIMITS.signatureWidth, height = AWARENESS_LIMITS.signatureHeight) {
  if (!bitmap || bitmap.length < width * height * 4) return null;
  const luma = index => bitmap[index] * 0.114 + bitmap[index + 1] * 0.587 + bitmap[index + 2] * 0.299;
  let bits = 0n;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width - 1; column += 1) {
      const at = (row * width + column) * 4;
      bits = (bits << 1n) | (luma(at) > luma(at + 4) ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

const HEX = /^[0-9a-f]{16}$/;

/** The share of bits two signatures differ in, 0 to 1. Unknown signatures count as fully different. */
export function signatureDistance(a, b) {
  if (!HEX.test(a ?? "") || !HEX.test(b ?? "")) return 1;
  let differing = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), count = 0;
  while (differing) { count += Number(differing & 1n); differing >>= 1n; }
  return count / 64;
}

const sameText = (a, b) => (a ?? "") === (b ?? "");
const MAX_THRESHOLD = 0.4;

/**
 * Decides which captures are worth keeping. It expects the next screen to look like the last one it kept, and keeps a
 * capture only when that expectation fails: another app in front, other windows, or a picture that changed by more
 * than the screen's own recent restlessness. A video or an animation raises that restlessness, so it stops filling the
 * record with near-copies. A heuristic in the spirit of predictive models, not a trained one.
 */
export function createSurpriseGate({ surprise = AWARENESS_LIMITS.surprise, calm = AWARENESS_LIMITS.calm } = {}) {
  let kept = null, restlessness = 0;
  return {
    decide(frame) {
      if (!kept) { kept = frame; return { keep: true, reason: "first", surprise: 1 }; }
      const measured = HEX.test(kept.signature ?? "") && HEX.test(frame.signature ?? "");
      const change = signatureDistance(kept.signature, frame.signature);
      const threshold = Math.min(MAX_THRESHOLD, Math.max(surprise, restlessness * 2));
      const reason = !sameText(kept.app, frame.app) ? "app"
        : !sameText(kept.windows?.[0], frame.windows?.[0]) ? "window"
          : change >= threshold ? "screen" : null;
      if (measured) restlessness = restlessness * 0.7 + change * 0.3;
      if (!reason) return { keep: false, reason: change <= calm ? "same" : "similar", surprise: change };
      kept = frame;
      return { keep: true, reason, surprise: change };
    },
    reset() { kept = null; restlessness = 0; },
  };
}

const WORD = /[\p{L}\p{N}]{3,}/gu;
const words = text => new Set(String(text ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").match(WORD) ?? []);

/** Shared words over the smaller set: 1 when one text's words all appear in the other. */
export function lexicalSimilarity(a, b) {
  const left = words(a), right = words(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, left = 0, right = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; left += a[i] * a[i]; right += b[i] * b[i]; }
  return left && right ? dot / Math.sqrt(left * right) : 0;
}

export const frameText = frame => [frame?.app, ...(frame?.windows ?? [])].filter(Boolean).join(" · ").slice(0, 600);

/**
 * Picks at most `limit` frames for a request: always the newest, then the ones whose app and window names are closest
 * to what was asked. `embed(texts, signal)` may resolve one vector per text, or null to fall back to shared words.
 * The result is in capture order.
 */
export async function selectFrames({ query, frames, embed, signal, limit = AWARENESS_LIMITS.sentFrames }) {
  if (!Array.isArray(frames) || !frames.length) return [];
  if (frames.length <= limit) return [...frames];
  const newest = frames.at(-1), earlier = frames.slice(0, -1);
  const texts = earlier.map(frameText);
  let scores = null;
  if (typeof embed === "function" && String(query ?? "").trim()) {
    const vectors = await Promise.resolve(embed([String(query), ...texts], signal)).catch(() => null);
    if (Array.isArray(vectors) && vectors.length === texts.length + 1) scores = texts.map((_, index) => cosine(vectors[0], vectors[index + 1]));
  }
  scores ??= texts.map(text => lexicalSimilarity(query, text));
  const chosen = earlier.map((frame, index) => ({ frame, index, score: scores[index] }))
    .sort((a, b) => b.score - a.score || b.index - a.index).slice(0, limit - 1).sort((a, b) => a.index - b.index);
  return [...chosen.map(item => item.frame), newest];
}
