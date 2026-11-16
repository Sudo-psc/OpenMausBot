import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createIslandSession } from "./island-session.mjs";
import { prepareIslandMessage } from "./island-context-message.mjs";
import { englishT } from "./island-text.mjs";
import { createRequire } from "node:module";

const CHAT = { botId: "bot-1", threadId: "thread-1" };
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness(options = {}) {
  const h = { views: [], asks: [], preparations: [], requests: [], starts: [], stopped: [], finished: [], opened: [],
    active: false, busy: false, frameList: [], omiContext: "Omi fixture context", disposed: 0, sink: null,
    recalls: [], recalled: "", remembered: [], hidden: false, selections: [], continuous: [], app: "Notas", windows: ["Lista de compras"],
    computerNow: { ready: true, reason: null, fix: null }, enabled: 0 };
  h.session = createIslandSession({
    screenContext: { snapshot: () => ({ active: h.active, frameCount: h.frameList.length, app: h.app, windows: h.windows, hidden: h.hidden }),
      frames: () => h.frameList, situation: async () => (h.active && !h.hidden ? { app: h.app, windows: h.windows } : null), select: async (query, signal) => { h.selections.push([query, signal]); return h.active ? h.frameList : []; },
      setContinuous: on => h.continuous.push(on),
      start: () => { h.active = true; }, pause: () => { h.active = false; h.frameList = []; },
      dispose: () => { h.active = false; h.frameList = []; h.disposed += 1; } },
    omi: { snapshot: () => ({ status: "ready" }), context: () => h.omiContext,
      recall: options.recall ?? (async (query, opts) => { h.recalls.push([query, opts]); return h.recalled; }),
      remember: options.remember ?? (async note => { h.remembered.push(note); return { ok: true, message: "Memory saved to Omi." }; }),
      configure: options.configure ?? (async () => {}), disconnect: options.disconnect ?? (async () => {}), refresh: async () => {}, dispose: () => { h.disposed += 1; } },
    speech: { busy: () => h.busy, start: (sink, opts) => { h.sink = sink; h.starts.push(opts); },
      stop: sink => h.stopped.push(sink), finish: sink => h.finished.push(sink) },
    server: { prepare: options.prepare ?? (async () => CHAT), settleSend: options.settleSend, ask: async input => {
      h.asks.push(input);
      if (options.ask) return options.ask(input);
      input.onUpdate({ kind: "reply", text: "Fixture answer" }); return "done";
    } },
    request: async (...args) => { h.requests.push(args); return options.request ? options.request(...args) : { ok: true }; },
    render: view => h.views.push(view), openChat: chat => h.opened.push(chat), allowed: options.allowed ?? (() => true),
    t: options.t, clock: () => ({ toLocaleString: () => "16/11/2026 10:00" }),
    computer: { now: options.computerNow ?? (async () => h.computerNow), start: async () => { h.enabled += 1; h.computerNow = { ready: true, reason: null, fix: null }; return h.computerNow; } },
    prepareMessage: options.prepareMessage ?? (async input => { h.preparations.push(input); return "prepared: " + input.text; }),
  });
  return h;
}

test("explicit send combines fresh screen and Omi context, follows the answer and opens its chat", async () => {
  const h = harness();
  h.session.repaint();
  assert.equal(h.asks.length, 0);
  h.session.toggleCapture();
  h.frameList = [{ dataUrl: "fixture-image" }];
  await h.session.send("Explain this");
  assert.equal(h.preparations[0].text, "Explain this");
  assert.deepEqual(h.preparations[0].frames, h.frameList);
  assert.equal(h.preparations[0].omiContext, "Omi fixture context");
  assert.equal(h.asks[0].text, "prepared: Explain this");
  assert.equal(h.views.at(-1).state, "reply");
  assert.equal(h.views.at(-1).text, "Fixture answer");
  h.session.openChat(); assert.deepEqual(h.opened, [CHAT]);
  h.session.dispose();
});

test("speech is opt-in, finishes on command and sends only its own final transcript", async () => {
  const h = harness();
  h.session.toggleVoice();
  assert.deepEqual(h.starts, [{ endpointMs: 1500 }]);
  assert.equal(h.views.at(-1).mode, "conversation");
  h.sink.transcript({ text: "Ajude com a tela" });
  assert.equal(h.asks.length, 0);
  h.session.toggleVoice(); assert.deepEqual(h.finished, [h.sink]);
  h.sink.end({ code: 0 }); await flush();
  assert.equal(h.preparations[0].text, "Ajude com a tela");
  h.session.dispose();
});

test("busy voice is preserved and forbidden local tasks are not sent", async () => {
  const h = harness({ allowed: () => false });
  h.busy = true; h.session.toggleVoice();
  assert.equal(h.starts.length, 0);
  assert.match(h.views.at(-1).text, /microphone/);
  await h.session.send("Please act");
  assert.equal(h.asks.length, 0);
  assert.match(h.views.at(-1).text, /on this computer/);
  h.session.dispose();
});

test("cancellation during preparation does not send or interrupt an unrelated earlier chat", async () => {
  const ready = deferred(); let preparation = 0;
  const h = harness({ prepare: () => ++preparation === 1 ? Promise.resolve(CHAT) : ready.promise });
  await h.session.send("First request");
  const later = h.session.send("Second request");
  await h.session.pause();
  await later;
  ready.resolve({ botId: "other", threadId: "later" }); await flush();
  assert.equal(h.asks.length, 1);
  assert.equal(h.requests.length, 0);
  assert.equal(h.views.at(-1).state, "idle");
  h.session.dispose();
});

test("cancel calls the real interrupt route, waits before new sends and reports refusal", async () => {
  const interrupted = deferred();
  const h = harness({ ask: input => new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason))),
    request: () => interrupted.promise });
  const sending = h.session.send("Act"); await flush();
  const cancel = h.session.pause();
  await flush();
  assert.equal(h.requests[0][0], "/api/bots/bot-1/interrupt");
  assert.deepEqual(JSON.parse(h.requests[0][1].body), { threadId: "thread-1" });
  await h.session.send("Too soon");
  assert.equal(h.asks.length, 1);
  interrupted.resolve({ ok: false }); await cancel; await sending;
  assert.equal(h.views.at(-1).state, "error");
  assert.match(h.views.at(-1).text, /confirm the cancellation/);
  h.session.dispose();
});

test("screen lock clears captures and microphone without forgetting the running task", async () => {
  const answer = deferred();
  const h = harness({ ask: () => answer.promise });
  h.session.toggleCapture(); h.frameList = [{ dataUrl: "fixture" }];
  const sending = h.session.send("Act"); await flush();
  h.session.suspend();
  assert.equal(h.active, false);
  assert.deepEqual(h.frameList, []);
  assert.equal(h.views.at(-1).state, "thinking");
  assert.equal(h.asks[0].signal.aborted, false);
  h.asks[0].onUpdate({ kind: "reply", text: "Finished while locked" });
  answer.resolve("done"); await sending;
  assert.equal(h.views.at(-1).text, "Finished while locked");
  h.session.toggleVoice(); const sink = h.sink;
  h.session.suspend(); sink.transcript({ text: "must not send" }); sink.end({ code: 0 }); await flush();
  assert.deepEqual(h.stopped, [sink]);
  assert.equal(h.asks.length, 1);
  h.session.dispose();
});

for (const transition of ["toggleCapture", "suspend"]) {
  test(`${transition} revokes pending screen uploads without cancelling the text request`, async () => {
    const firstUpload = deferred();
    const uploads = [];
    const h = harness({ prepareMessage: prepareIslandMessage, request: async (route, init) => {
      uploads.push({ route, init });
      if (uploads.length === 1) await firstUpload.promise;
      return { ok: true, json: async () => ({ path: `/attachments/frame-${uploads.length}.png`, mime: "image/png", bytes: init.body.length }) };
    } });
    h.session.toggleCapture();
    h.frameList = ["one", "two", "three"].map(value => ({ dataUrl: `data:image/png;base64,${Buffer.from(value).toString("base64")}` }));
    const sending = h.session.send("Explique a tela");
    await flush();
    assert.equal(uploads.length, 1);
    h.session[transition]();
    firstUpload.resolve();
    await sending;
    assert.equal(h.active, false);
    assert.deepEqual(h.frameList, []);
    assert.equal(uploads.length, 1);
    assert.equal(h.asks.length, 1);
    assert.ok(h.asks[0].text.startsWith("Explique a tela"));
    assert.match(h.asks[0].text, /Omi fixture context/);
    assert.doesNotMatch(h.asks[0].text, /<attached-image/);
    h.session.dispose();
  });
}

test("pausing capture after message acceptance keeps the running task", async () => {
  const answer = deferred();
  const h = harness({ ask: () => answer.promise });
  h.session.toggleCapture();
  h.frameList = [{ dataUrl: "fixture-image" }];
  const sending = h.session.send("Act");
  await flush();
  assert.equal(h.asks.length, 1);
  h.session.toggleCapture();
  assert.equal(h.asks[0].signal.aborted, false);
  assert.equal(h.requests.length, 0);
  answer.resolve("done");
  await sending;
  assert.equal(h.views.at(-1).state, "reply");
  h.session.dispose();
});

test("cancel waits for message acceptance before interrupting and keeps new sends blocked", async () => {
  const delivery = deferred();
  const h = harness({ settleSend: () => delivery.promise,
    ask: input => new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason))) });
  const sending = h.session.send("Act"); await flush();
  const cancellation = h.session.pause(); await flush();
  assert.equal(h.requests.length, 0);
  await h.session.send("Too early"); assert.equal(h.asks.length, 1);
  delivery.resolve(); await cancellation; await sending;
  assert.equal(h.requests[0][0], "/api/bots/bot-1/interrupt");
  assert.equal(h.views.at(-1).state, "idle");
  h.session.dispose();
});

test("uncertain message acceptance is not reported as a confirmed cancellation", async () => {
  const h = harness({ settleSend: async () => { throw new Error("private transport error"); },
    ask: input => new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason))) });
  const sending = h.session.send("Act"); await flush();
  await h.session.pause(); await sending;
  assert.equal(h.requests.length, 0);
  assert.equal(h.views.at(-1).state, "error");
  assert.match(h.views.at(-1).text, /confirm the cancellation/);
  assert.equal(h.views.at(-1).text.includes("private"), false);
  h.session.dispose();
});

test("timeout while preparing restores an actionable error instead of remaining busy", async t => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  const h = harness({ prepare: () => new Promise(() => {}) });
  const send = h.session.send("Act");
  mock.timers.tick(180_000); await send;
  assert.equal(h.views.at(-1).state, "error");
  assert.match(h.views.at(-1).text, /wait ended/);
  assert.equal(h.asks.length, 0);
  h.session.dispose();
});

test("other UI errors during preparation cannot replace the person's prompt", async () => {
  const ready = deferred();
  const h = harness({ prepare: () => ready.promise, configure: async () => { throw new Error("keychain locked"); } });
  const send = h.session.send("Original question");
  await h.session.configureOmi("omi_dev_fixture");
  ready.resolve(CHAT); await send;
  assert.equal(h.preparations[0].text, "Original question");
  h.session.dispose();
});

for (const [action, message] of [["configureOmi", /connect Omi/], ["disconnectOmi", /remove the Omi key/]]) {
  test(`a failed ${action} keeps an active task cancellable`, async () => {
    const answer = deferred();
    const failure = async () => { throw new Error("fixture Omi error"); };
    const h = harness({ ask: () => answer.promise, configure: failure, disconnect: failure });
    const sending = h.session.send("Original question"); await flush();
    await h.session[action]("omi_dev_fixture");
    assert.equal(h.views.at(-1).state, "thinking");
    assert.equal(h.views.at(-1).text, "Original question");
    assert.equal(h.views.at(-1).omi.status, "error");
    assert.match(h.views.at(-1).omi.message, message);
    answer.resolve("done"); await sending;
    assert.equal(h.views.at(-1).state, "reply");
    h.session.dispose();
  });
}

test("dispose releases capture, Omi and microphone, and ignores late transcripts", async () => {
  const h = harness();
  h.session.toggleVoice(); const sink = h.sink;
  h.session.dispose(); sink.transcript({ text: "late" }); sink.end({ code: 0 }); await flush();
  assert.equal(h.disposed, 2);
  assert.deepEqual(h.stopped, [sink]);
  assert.equal(h.asks.length, 0);
});

async function say(h, words) {
  h.sink.transcript({ text: words });
  h.sink.end({ code: 0 });
  await flush(); await flush();
}

test("memories Omi finds for the request come before the cached Omi context", async () => {
  const h = harness();
  h.recalled = "Memórias relacionadas";
  await h.session.send("  Qual é o prazo do artigo?  ");
  assert.equal(h.recalls[0][0], "Qual é o prazo do artigo?");
  assert.ok(h.recalls[0][1].signal instanceof AbortSignal);
  assert.equal(h.preparations[0].omiContext, "Memórias relacionadas\n\nOmi fixture context");
  h.session.dispose();
});

test("a voice turn is spoken, then the island listens again until the person stays quiet", async () => {
  const h = harness();
  h.session.toggleVoice();
  await say(h, "Que horas é a reunião?");
  const answered = h.views.at(-1);
  assert.equal(answered.state, "reply");
  assert.equal(answered.conversation, true);
  assert.deepEqual(answered.speech, { turn: answered.speech.turn, text: "Fixture answer", done: true });
  assert.equal(h.starts.length, 1);
  h.session.spoken(answered.speech.turn + 1);
  assert.equal(h.starts.length, 1);
  h.session.spoken(answered.speech.turn);
  assert.equal(h.starts.length, 2);
  assert.equal(h.views.at(-1).state, "listening");
  assert.equal(h.views.at(-1).speech, null);
  h.sink.end({ code: 0 });
  assert.equal(h.views.at(-1).state, "idle");
  assert.equal(h.views.at(-1).conversation, false);
  assert.equal(h.asks.length, 1);
  h.session.dispose();
});

test("a streamed voice reply is handed to speech before the turn completes", async () => {
  const done = deferred();
  const h = harness({ ask: async input => { input.onUpdate({ kind: "reply", text: "Primeira frase. Segun" }); await done.promise; input.onUpdate({ kind: "reply", text: "Primeira frase. Segunda." }); return "done"; } });
  h.session.toggleVoice();
  await say(h, "Conte algo");
  assert.equal(h.views.at(-1).state, "thinking");
  assert.equal(h.views.at(-1).speech.text, "Primeira frase. Segun");
  assert.equal(h.views.at(-1).speech.done, false);
  h.session.spoken(h.views.at(-1).speech.turn);
  assert.equal(h.starts.length, 1);
  done.resolve(); await flush();
  assert.equal(h.views.at(-1).speech.done, true);
  h.session.dispose();
});

test("a typed request is never spoken and does not open the microphone", async () => {
  const h = harness();
  await h.session.send("Resuma");
  assert.equal(h.views.at(-1).speech, null);
  assert.equal(h.views.at(-1).conversation, false);
  h.session.spoken(1);
  assert.equal(h.starts.length, 0);
  h.session.dispose();
});

test("the voice key interrupts a spoken reply and listens at once", async () => {
  const h = harness();
  h.session.toggleVoice();
  await say(h, "Primeira pergunta");
  assert.ok(h.views.at(-1).speech);
  h.session.toggleVoice();
  assert.equal(h.views.at(-1).state, "listening");
  assert.equal(h.views.at(-1).speech, null);
  assert.equal(h.starts.length, 2);
  h.session.dispose();
});

test("stop ends listening, speaking and the conversation, and cancels a running task", async () => {
  const h = harness();
  h.session.toggleVoice();
  const first = h.sink;
  h.session.stop();
  assert.deepEqual(h.stopped, [first]);
  assert.equal(h.views.at(-1).state, "idle");
  assert.equal(h.views.at(-1).conversation, false);
  h.session.toggleVoice();
  await say(h, "Pergunta");
  h.session.stop();
  assert.equal(h.views.at(-1).speech, null);
  assert.equal(h.views.at(-1).conversation, false);
  assert.equal(h.views.at(-1).state, "reply");
  h.session.spoken(h.asks.length);
  assert.equal(h.starts.length, 2);
  h.session.dispose();

  const waiting = deferred();
  const busy = harness({ ask: () => waiting.promise });
  const sending = busy.session.send("Tarefa longa"); await flush();
  await busy.session.stop();
  assert.equal(busy.requests[0][0], "/api/bots/bot-1/interrupt");
  waiting.resolve("done"); await sending;
  busy.session.dispose();
});

test("a failed or waiting voice turn does not reopen the microphone", async () => {
  for (const result of ["failed", "needs-you"]) {
    const h = harness({ ask: async input => { input.onUpdate({ kind: "reply", text: "Parcial" }); return result; } });
    h.session.toggleVoice();
    await say(h, "Pedido");
    assert.equal(h.views.at(-1).conversation, false);
    const turn = h.views.at(-1).speech?.turn;
    if (turn) h.session.spoken(turn);
    assert.equal(h.starts.length, 1);
    h.session.dispose();
  }
});

test("saving to Omi sends the typed note, or the last exchange, only on command", async () => {
  const h = harness();
  await h.session.saveToOmi("");
  assert.deepEqual(h.remembered, []);
  assert.equal(h.views.at(-1)?.canSaveReply ?? false, false);
  await h.session.send("Qual é o prazo?");
  assert.deepEqual(h.remembered, []);
  assert.equal(h.views.at(-1).canSaveReply, true);
  await h.session.saveToOmi("  Prazo do artigo: 30 de novembro  ");
  await h.session.saveToOmi();
  assert.deepEqual(h.remembered, ["Prazo do artigo: 30 de novembro", "Pergunta: Qual é o prazo?\nResposta: Fixture answer"]);
  assert.equal(h.views.at(-1).omiNote, "Memory saved to Omi.");
  h.session.dispose();

  const refused = harness({ remember: async () => ({ ok: false, message: "O Omi recusou salvar a memória." }) });
  await refused.session.saveToOmi("Nota");
  assert.equal(refused.views.at(-1).omiNote, "O Omi recusou salvar a memória.");
  assert.equal(refused.views.at(-1).state, "idle");
  refused.session.dispose();
});

test("a reply that arrives after the screen locks is shown but not spoken", async () => {
  const waiting = deferred();
  const h = harness({ ask: async input => { await waiting.promise; input.onUpdate({ kind: "reply", text: "Resposta privada." }); return "done"; } });
  h.session.toggleVoice();
  await say(h, "Pergunta");
  h.session.suspend();
  waiting.resolve(); await flush();
  assert.equal(h.views.at(-1).state, "reply");
  assert.equal(h.views.at(-1).text, "Resposta privada.");
  assert.equal(h.views.at(-1).speech, null);
  assert.equal(h.starts.length, 1);
  h.session.dispose();
});

test("pausing perception while Omi is still searching keeps the screen off the request", async () => {
  for (const pause of ["toggleCapture", "suspend"]) {
    const searching = deferred();
    const h = harness({ recall: () => searching.promise });
    h.session.toggleCapture();
    h.frameList = [{ dataUrl: "fixture-image" }];
    const sending = h.session.send("Explique a tela"); await flush();
    h.session[pause]();
    searching.resolve("Memórias relacionadas"); await sending;
    assert.deepEqual(h.preparations.map(input => input.frames), [[]]);
    assert.equal(h.asks.length, 1);
    h.session.dispose();
  }
});

test("a message on screen is translated again when the language changes", async () => {
  const pt = createRequire(import.meta.url)("./native-text.cjs").createNativeText({ saved: "pt-br" }).t;
  let language = englishT;
  const h = harness({ t: (key, params) => language(key, params), ask: async () => { throw new Error("offline"); } });
  await h.session.send("Pergunta");
  assert.equal(h.views.at(-1).text, "Couldn't send. Check that MausBot is ready and try again.");
  language = pt;
  h.session.repaint();
  assert.equal(h.views.at(-1).text, "Não foi possível enviar. Verifique se o MausBot está pronto e tente novamente.");
  h.session.dispose();
});

test("a reply is never translated, and the needs-you hint is shown in the current language", async () => {
  const pt = createRequire(import.meta.url)("./native-text.cjs").createNativeText({ saved: "pt-br" }).t;
  let language = englishT;
  const h = harness({ t: (key, params) => language(key, params), ask: async input => { input.onUpdate({ kind: "reply", text: "Pronto." }); return "needs-you"; } });
  await h.session.send("Oi");
  assert.equal(h.views.at(-1).text, "Pronto.\nOpen the chat to continue.");
  language = pt;
  h.session.repaint();
  assert.equal(h.views.at(-1).text, "Pronto.\nAbra a conversa para continuar.");
  h.session.dispose();
});

test("dictation fills the draft for review and never sends, speaks or starts a conversation", async () => {
  const h = harness();
  h.session.dictate();
  assert.equal(h.views.at(-1).state, "listening");
  assert.equal(h.views.at(-1).mode, "dictation");
  h.sink.transcript({ text: "  Marcar retorno do paciente  " });
  h.session.dictate();
  assert.deepEqual(h.finished, [h.sink]);
  h.sink.end({ code: 0 }); await flush();
  assert.equal(h.asks.length, 0);
  assert.deepEqual(h.views.at(-1).draft, { id: 1, text: "Marcar retorno do paciente" });
  assert.equal(h.views.at(-1).state, "idle");
  assert.equal(h.views.at(-1).mode, null);
  assert.equal(h.views.at(-1).speech, null);
  assert.deepEqual(h.continuous.filter(Boolean), []);
  h.session.dispose();
});

test("only a voice conversation keeps the longer screen record, and it ends with the conversation", async () => {
  const h = harness();
  h.session.toggleVoice();
  assert.equal(h.continuous.at(-1), true);
  await say(h, "O que mudou na tela?");
  assert.equal(h.continuous.at(-1), true);
  h.session.stop();
  assert.equal(h.continuous.at(-1), false);
  h.session.toggleVoice();
  await h.session.send("Pedido digitado");
  assert.equal(h.continuous.at(-1), false);
  h.session.dispose();
});

test("a request carries the app in front, open windows, the time and whether the computer can be controlled", async () => {
  const h = harness();
  h.session.toggleCapture();
  h.frameList = [{ dataUrl: "fixture-image", app: "Notas" }];
  await h.session.send("Organize esta lista");
  assert.equal(h.selections[0][0], "Organize esta lista");
  assert.deepEqual(h.preparations[0].surroundings, { localTime: "16/11/2026 10:00", computerReady: true, app: "Notas", windows: ["Lista de compras"] });
  assert.equal(h.views.at(-1).capture.app, "Notas");
  h.session.toggleCapture();
  h.computerNow = { ready: false, reason: "permissions", fix: "allow" };
  await h.session.send("E agora?");
  assert.equal(h.preparations[1].surroundings, undefined);
  assert.deepEqual(h.views.at(-1).computer, { ready: false, reason: "permissions", fix: "allow" });
  await h.session.enableComputer();
  assert.equal(h.enabled, 1);
  assert.equal(h.views.at(-1).computer.ready, true);
  h.session.dispose();
});

test("pausing perception while computer control is still being read keeps the screen off the request", async () => {
  for (const pause of ["toggleCapture", "suspend"]) {
    const reading = deferred();
    const h = harness({ computerNow: () => reading.promise });
    h.session.toggleCapture();
    h.frameList = [{ dataUrl: "fixture-image" }];
    const sending = h.session.send("Explique a tela"); await flush();
    h.session[pause]();
    reading.resolve({ ready: true, reason: null, fix: null }); await sending;
    assert.deepEqual(h.preparations.map(input => input.frames), [[]]);
    assert.equal(h.preparations[0].surroundings, undefined);
    h.session.dispose();
  }
});

test("every way out of a voice chat returns to the short screen record", async () => {
  for (const result of ["failed", "needs-you"]) {
    const h = harness({ ask: async input => { input.onUpdate({ kind: "reply", text: "Parcial" }); return result; } });
    h.session.toggleVoice();
    assert.equal(h.continuous.at(-1), true);
    await say(h, "Pedido");
    assert.equal(h.continuous.at(-1), false);
    h.session.dispose();
  }
  let allowed = true;
  const h = harness({ allowed: () => allowed });
  h.session.toggleVoice();
  allowed = false;
  await say(h, "Pedido");
  assert.equal(h.continuous.at(-1), false);
  assert.equal(h.views.at(-1).conversation, false);
  h.session.dispose();
});

test("a sensitive app in front leaves the request without a situation and the island says why", async () => {
  const h = harness();
  h.session.toggleCapture();
  h.hidden = true;
  h.frameList = [];
  await h.session.send("Resuma");
  assert.equal(h.preparations[0].surroundings, undefined);
  assert.equal(h.views.at(-1).capture.hidden, true);
  assert.equal(h.views.at(-1).capture.app, "");
  assert.equal(h.views.at(-1).contextSummary, "");
  h.session.dispose();
});
