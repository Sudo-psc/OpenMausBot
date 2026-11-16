import { createHash } from "node:crypto";
import { AWARENESS_LIMITS, createSurpriseGate, frameSignature, selectFrames } from "./island-awareness.mjs";

export const SCREEN_CONTEXT_LIMITS = Object.freeze({ intervalMs: 5_000, ttlMs: 30_000, maxFrames: 3, maxFrameBytes: 400_000 });
/** While a voice conversation runs: a longer, memory-only record of the moments the screen really changed. */
export const SCREEN_TIMELINE_LIMITS = Object.freeze({ intervalMs: 3_000, ttlMs: 300_000, maxFrames: 12 });

const label = value => typeof value === "string" ? [...value].filter(character => character.codePointAt(0) >= 32).join("").trim().slice(0, AWARENESS_LIMITS.textChars) : "";

export function createScreenContext({ captureFrame, onChange = () => {}, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout, intervalMs = SCREEN_CONTEXT_LIMITS.intervalMs, embed } = {}) {
  if (typeof captureFrame !== "function") throw new TypeError("captureFrame is required");
  if (!Number.isFinite(intervalMs) || intervalMs < 1_000) throw new RangeError("intervalMs must be at least 1000");
  let active = false;
  let disposed = false;
  let generation = 0;
  let pending = false;
  let timer = null;
  let records = [];
  let error = null;
  let continuous = false;
  const gate = createSurpriseGate();
  const limits = () => continuous ? SCREEN_TIMELINE_LIMITS : SCREEN_CONTEXT_LIMITS;

  function prune() {
    records = records.filter(frame => now() - frame.capturedAt < limits().ttlMs).slice(-limits().maxFrames);
  }

  function snapshot() {
    prune();
    return { active, capturing: pending && active, error, frameCount: records.length, continuous,
      lastCapturedAt: records.at(-1)?.capturedAt ?? null,
      displayId: records.at(-1)?.displayId ?? null,
      app: records.at(-1)?.app ?? "", windows: [...(records.at(-1)?.windows ?? [])] };
  }

  function notify() {
    try { onChange(snapshot()); } catch {}
  }

  function schedule() {
    if (!active || disposed || timer !== null) return;
    timer = setTimer(() => { timer = null; void capture(); }, continuous ? Math.min(intervalMs, SCREEN_TIMELINE_LIMITS.intervalMs) : intervalMs);
    timer?.unref?.();
  }

  async function capture() {
    if (!active || disposed || pending) return;
    pending = true;
    const started = generation;
    try {
      const frame = await captureFrame();
      if (!active || disposed || started !== generation) return;
      if (!frame || typeof frame.dataUrl !== "string" || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(frame.dataUrl)
        || Buffer.byteLength(frame.dataUrl) > SCREEN_CONTEXT_LIMITS.maxFrameBytes) {
        throw Object.assign(new Error("Invalid screen frame"), { code: "capture-unavailable" });
      }
      prune();
      const hash = createHash("sha256").update(frame.dataUrl).digest("hex");
      const record = { dataUrl: frame.dataUrl, displayId: String(frame.displayId ?? ""), capturedAt: now(), hash,
        signature: typeof frame.signature === "string" ? frame.signature : null, app: label(frame.app),
        windows: Array.isArray(frame.windows) ? frame.windows.map(label).filter(Boolean).slice(0, AWARENESS_LIMITS.windows) : [] };
      const last = records.at(-1);
      const unchanged = last?.hash === hash && last.displayId === record.displayId;
      const verdict = unchanged || last?.displayId !== record.displayId ? null : gate.decide(record);
      if (last && (unchanged || verdict?.keep === false)) records[records.length - 1] = { ...record, since: last.since, reason: last.reason };
      else {
        if (!verdict) { gate.reset(); gate.decide(record); }
        records.push({ ...record, since: record.capturedAt, reason: verdict?.reason ?? (last ? "display" : "first") });
      }
      records = records.slice(-limits().maxFrames);
      error = null;
    } catch (cause) {
      if (!active || disposed || started !== generation) return;
      records = [];
      error = ["screen-permission-denied", "screen-suspended"].includes(cause?.code) ? cause.code : "capture-unavailable";
    } finally {
      pending = false;
      if (active && !disposed) { notify(); schedule(); }
    }
  }

  function pause() {
    active = false;
    generation += 1;
    if (timer !== null) clearTimer(timer);
    timer = null;
    records = [];
    error = null;
    gate.reset();
    notify();
    return snapshot();
  }

  /** The frames worth sending with `query`. Resolves [] when perception was paused while it chose. */
  async function select(query, signal) {
    prune();
    const started = generation;
    const chosen = await selectFrames({ query, frames: records.map(frame => ({ ...frame })), embed, signal });
    return active && !disposed && started === generation ? chosen : [];
  }

  return {
    start() {
      if (!disposed && !active) {
        active = true;
        generation += 1;
        void capture();
        notify();
      }
      return snapshot();
    },
    pause,
    select,
    setContinuous(on) {
      if (continuous === Boolean(on)) return;
      continuous = Boolean(on);
      prune();
      if (active && timer !== null) { clearTimer(timer); timer = null; schedule(); }
      notify();
    },
    snapshot,
    frames() { prune(); return records.map(frame => ({ ...frame })); },
    dispose() { disposed = true; pause(); },
  };
}

export function createDesktopScreenCapture({ desktopCapturer, screen, systemPreferences,
  platform = process.platform, isSuspended = () => false, describe = async () => ({}) }) {
  return async function captureFrame() {
    if (isSuspended()) throw Object.assign(new Error("Screen is suspended"), { code: "screen-suspended" });
    if (platform === "darwin" && systemPreferences.getMediaAccessStatus("screen") === "denied") {
      throw Object.assign(new Error("Screen recording permission is denied"), { code: "screen-permission-denied" });
    }
    const displayId = String(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id);
    const [sources, surroundings] = await Promise.all([
      desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 960, height: 600 }, fetchWindowIcons: false }),
      Promise.resolve().then(describe).catch(() => ({})),
    ]);
    if (isSuspended()) throw Object.assign(new Error("Screen is suspended"), { code: "screen-suspended" });
    const source = sources.find(item => item.display_id === displayId);
    if (!source || source.thumbnail.isEmpty()) throw new Error("The selected display is unavailable");
    const dataUrl = `data:image/jpeg;base64,${source.thumbnail.toJPEG(55).toString("base64")}`;
    const small = source.thumbnail.resize({ width: AWARENESS_LIMITS.signatureWidth, height: AWARENESS_LIMITS.signatureHeight, quality: "good" });
    return { dataUrl, displayId, signature: frameSignature(small.toBitmap()), app: surroundings?.app, windows: surroundings?.windows };
  };
}
