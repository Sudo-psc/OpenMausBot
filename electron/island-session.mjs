import { randomUUID } from "node:crypto";
import { prepareIslandMessage } from "./island-context-message.mjs";
import { englishT, notice, words } from "./island-text.mjs";

const FOLLOW_UP_QUIET_MS = 8_000;
const NO_COMPUTER = Object.freeze({ now: async () => ({ ready: false, reason: "unsupported", fix: null }), start: async () => ({ ready: false, reason: "unsupported", fix: null }) });

export function createIslandSession({ screenContext, omi, speech, server, request, render, openChat,
  allowed = () => true, prepareMessage = prepareIslandMessage, t = englishT, computer = NO_COMPUTER, clock = () => new Date() }) {
  let state = "idle", text = "", expanded = false, controller = null, sink = null, chat = null;
  let disposed = false, listenTimer = null, cancelling = false, submittedChat = null, capturePreparation = null, omiError = null;
  let listening = null, draft = null, drafts = 0, computerStatus = null;
  let attention = false, conversation = false, speaking = null, speechTurn = 0, spokenTurn = 0, lastExchange = null, omiNote = "", saving = false;
  async function abortable(promise, signal) {
    let abort;
    const interrupted = new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
    try { return await Promise.race([promise, interrupted]); }
    finally { signal.removeEventListener("abort", abort); }
  }
  function repaint() {
    if (disposed) return;
    const capture = screenContext.snapshot();
    const omiView = omi.snapshot();
    render({ state, text: words(t, text) + (attention ? "\n" + t("native.island.needsYou") : ""), expanded,
      mode: conversation ? "conversation" : listening, draft,
      computer: computerStatus ? { ready: Boolean(computerStatus.ready), reason: computerStatus.reason ?? null, fix: computerStatus.fix ?? null } : null,
      capture: { enabled: capture.active, lastCapturedAt: capture.lastCapturedAt, app: capture.active ? capture.app ?? "" : "",
        message: capture.error ? t("native.island.captureError") : undefined },
      omi: omiError ? { ...omiView, status: "error", message: words(t, omiError) } : omiView,
      omiNote: words(t, omiNote), canSaveReply: Boolean(lastExchange) && !saving, conversation,
      speech: speaking ? { ...speaking } : null,
      contextSummary: capture.active ? t("native.island.contextSummary", { count: capture.frameCount }) : "" });
  }
  function stopListening() {
    clearTimeout(listenTimer);
    const target = sink; sink = null; listening = null;
    if (target) speech.stop(target);
  }
  function endConversation() { conversation = false; speaking = null; spokenTurn = 0; screenContext.setContinuous(false); }
  async function readComputer(reading) {
    try { computerStatus = await reading; } catch { computerStatus = { ready: false, reason: "not-running", fix: "start" }; }
    return computerStatus;
  }
  function pauseCapture() {
    capturePreparation?.abort();
    screenContext.pause();
  }
  async function cancel() {
    if (disposed || cancelling) return;
    const active = controller;
    const targetChat = submittedChat;
    submittedChat = null;
    controller = null;
    active?.abort(); stopListening(); endConversation();
    state = "idle"; text = ""; attention = false; repaint();
    if (!active || !targetChat) return;
    cancelling = true; state = "sending"; text = notice("native.island.cancelling"); repaint();
    try {
      await abortable(server.settleSend?.(), AbortSignal.timeout(10_000));
      const response = await request(`/api/bots/${encodeURIComponent(targetChat.botId)}/interrupt`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId: targetChat.threadId }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response?.ok) throw new Error("Interrupt refused");
      await response.body?.cancel().catch(() => {});
      state = "idle"; text = "";
    } catch {
      state = "error"; text = notice("native.island.cancelUnconfirmed");
    } finally { cancelling = false; repaint(); }
  }
  async function submit(words, spoken) {
    if (disposed || controller || cancelling || typeof words !== "string" || !words.trim()) return;
    if (!spoken) endConversation();
    speaking = null; attention = false;
    if (!allowed()) { conversation = false; state = "error"; text = notice("native.island.otherComputer"); repaint(); return; }
    stopListening();
    const active = new AbortController(); controller = active; submittedChat = null;
    const prompt = words.trim().slice(0, 4000);
    const turn = ++speechTurn;
    spokenTurn = spoken ? turn : 0;
    let reply = "";
    state = "thinking"; text = prompt; expanded = true; omiNote = ""; repaint();
    const timeout = setTimeout(() => active.abort(), 180_000); timeout.unref?.();
    try {
      const recalling = omi.recall(prompt, { signal: active.signal });
      chat = await abortable(server.prepare(), active.signal);
      active.signal.throwIfAborted();
      const omiContext = [await abortable(recalling, active.signal), omi.context()].filter(Boolean).join("\n\n");
      const [frames, control] = await abortable(Promise.all([screenContext.select(prompt, active.signal), readComputer(computer.now())]), active.signal);
      const seen = screenContext.snapshot();
      const surroundings = seen.active ? { localTime: clock().toLocaleString(), computerReady: Boolean(control?.ready), app: seen.app, windows: seen.windows } : undefined;
      const capture = frames.length ? new AbortController() : null;
      capturePreparation = capture;
      let message;
      try {
        const preparationSignal = capture ? AbortSignal.any([active.signal, capture.signal]) : active.signal;
        try {
          message = await abortable(prepareMessage({ text: prompt, frames, omiContext, surroundings, request, signal: preparationSignal }), preparationSignal);
        } catch (error) {
          if (!capture?.signal.aborted || active.signal.aborted) throw error;
        }
        if (capture?.signal.aborted) {
          message = await abortable(prepareMessage({ text: prompt, frames: [], omiContext, request, signal: active.signal }), active.signal);
        }
      } finally {
        if (capturePreparation === capture) capturePreparation = null;
      }
      active.signal.throwIfAborted();
      submittedChat = chat;
      const result = await server.ask({ chat, text: message, sendId: randomUUID(), signal: active.signal,
        onUpdate(update) {
          if (controller !== active || active.signal.aborted) return;
          if (update.kind !== "reply") return;
          reply = text = update.text;
          if (spokenTurn === turn) speaking = { turn, text: reply, done: false };
          repaint();
        } });
      if (controller !== active || active.signal.aborted) return;
      state = result === "failed" ? "error" : "reply";
      if (result !== "done") conversation = false;
      if (state === "reply" && reply.trim()) lastExchange = { prompt, reply };
      speaking = spokenTurn === turn && state === "reply" && reply.trim() ? { turn, text: reply, done: true } : null;
      if (result === "needs-you") attention = true;
    } catch {
      if (controller !== active) return;
      endConversation();
      state = "error";
      text = active.signal.aborted ? notice("native.island.waitEnded") : notice("native.island.sendFailed");
    } finally {
      clearTimeout(timeout);
      if (controller === active) {
        controller = null; submittedChat = null; repaint();
        if (conversation && !speaking) listen(FOLLOW_UP_QUIET_MS);
      }
    }
  }
  function listen(quietMs, mode = "conversation") {
    if (speech.busy()) { endConversation(); state = "error"; text = notice("native.island.micBusy"); repaint(); return; }
    let words = "";
    const quiet = () => {
      if (sink !== target) return;
      if (words.trim()) { speech.finish(target); return; }
      stopListening(); endConversation(); state = "idle"; text = ""; repaint();
    };
    const target = {
      transcript(line) {
        if (sink !== target) return;
        words = String(line?.text ?? "").slice(0, 4000); text = words;
        if (words.trim()) { clearTimeout(listenTimer); listenTimer = setTimeout(quiet, 60_000); }
        repaint();
      },
      replaced() { if (sink !== target) return; sink = null; listening = null; clearTimeout(listenTimer); endConversation(); state = "idle"; repaint(); },
      end(info) {
        if (sink !== target) return;
        sink = null; listening = null; clearTimeout(listenTimer);
        if (info?.code) { endConversation(); state = "error"; text = notice("native.island.listenFailed"); repaint(); }
        else if (words.trim() && mode === "dictation") { draft = { id: ++drafts, text: words.trim() }; state = "idle"; text = ""; repaint(); }
        else if (words.trim()) void submit(words, true);
        else { endConversation(); state = "idle"; text = ""; repaint(); }
      },
    };
    sink = target; listening = mode; state = "listening"; text = ""; expanded = true; repaint();
    listenTimer = setTimeout(quiet, quietMs);
    try { speech.start(target, { endpointMs: 1500 }); }
    catch { target.end({ code: 1 }); }
  }
  function toggleVoice() {
    if (disposed || controller || cancelling) return;
    if (sink) { speech.finish(sink); return; }
    conversation = true; speaking = null;
    screenContext.setContinuous(true);
    listen(60_000);
  }
  function dictate() {
    if (disposed || controller || cancelling) return;
    if (sink) { speech.finish(sink); return; }
    endConversation();
    listen(60_000, "dictation");
  }
  async function enableComputer() {
    if (disposed) return;
    await readComputer(computer.start());
    repaint();
  }
  function spoken(turn) {
    if (disposed || !speaking?.done || speaking.turn !== turn) return;
    speaking = null;
    if (conversation && !controller && !cancelling && !sink) listen(FOLLOW_UP_QUIET_MS);
    else repaint();
  }
  function stop() {
    if (disposed) return;
    if (controller || cancelling) return cancel();
    endConversation(); stopListening();
    if (state === "listening") { state = "idle"; text = ""; }
    repaint();
  }
  async function saveToOmi(note) {
    if (disposed || saving) return;
    const typed = typeof note === "string" ? note.trim().slice(0, 4000) : "";
    const content = typed || (lastExchange ? `Pergunta: ${lastExchange.prompt}\nResposta: ${lastExchange.reply}` : "");
    if (!content) return;
    saving = true; omiNote = notice("native.island.omiSaving"); repaint();
    try { const saved = await omi.remember(content); omiNote = saved.notice ?? saved.message; }
    finally { saving = false; repaint(); }
  }
  return {
    repaint, toggleVoice, dictate, enableComputer, spoken, stop, saveToOmi,
    send: words => submit(words, false),
    toggleExpanded() { expanded = !expanded; repaint(); if (expanded) void readComputer(computer.now()).then(repaint); },
    toggleCapture() { if (screenContext.snapshot().active) pauseCapture(); else screenContext.start(); repaint(); },
    pause: cancel,
    openChat() { openChat(chat); },
    async refreshOmi() { omiNote = ""; await omi.refresh(); omiError = null; repaint(); },
    async configureOmi(key) {
      if (typeof key !== "string" || key.length > 4096) return;
      omiError = null;
      try { await omi.configure(key); }
      catch {
        omiError = notice("native.island.omiConnectFailed");
        if (!controller && !cancelling) { state = "error"; text = omiError; }
      }
      repaint();
    },
    async disconnectOmi() {
      omiError = null;
      try { await omi.disconnect(); }
      catch {
        omiError = notice("native.island.omiDisconnectFailed");
        if (!controller && !cancelling) { state = "error"; text = omiError; }
      }
      repaint();
    },
    suspend() { pauseCapture(); stopListening(); endConversation(); if (state === "listening") { state = "idle"; text = ""; } repaint(); },
    dispose() { disposed = true; controller?.abort(); stopListening(); screenContext.dispose(); omi.dispose(); },
  };
}
