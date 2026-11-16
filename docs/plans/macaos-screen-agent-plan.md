# MacaOS — plano do agente de tela, voz e automação para macOS

App nativo pequeno (menu bar + overlay) com consciência de tela em tempo real,
memória multimodal contínua (embeddings EmbeddingGemma 2), voz ao vivo, marcação
na tela, execução de ações no Mac (cursor, teclado, browser) e aprendizagem
contínua que vira skills. Referências: Vovy, Omni/Omi, OpenBot (OpenSquilla),
OpenMausBot.

Nome provisório: **MacaOS** (trocar sem custo — o plano não depende dele).

---

## 1. Posicionamento e princípios

| Princípio | Consequência de engenharia |
|---|---|
| Pequeno e rápido | Swift puro, ~30–50 MB de app; nada de Electron. Runtime Python opcional apenas como serviço auxiliar (não essencial). |
| Local-first | Captura, embeddings, SQLite e áudio ficam em `~/Library/Application Support/MacaOS`. LLM de raciocínio é BYO-key (nuvem ou modelo local via llama.cpp/MLX). |
| Um atalho, sempre presente | Hotkey global (`Fn` duplo ou `⌃⌥Space`) abre overlay **sem roubar foco** do app ativo. |
| Ver + agir separados | Percepção roda sempre; ação exige política de aprovação por classe de risco (herdado de OpenMausBot). |
| Privacidade por padrão | Pausa de captura em apps sensíveis (banco, saúde, 1Password), redação de segredos antes de persistir, tecla de pânico que apaga a janela recente. |

O que cada referência empresta:

- **Vovy** — UX do atalho único, "segue seu mouse", Learn Mode (overlay que
  ensina em vez de clicar) e Auto Mode (executa com aprovação nos passos
  importantes).
- **Omni/Omi** — memória passiva contínua (Rewind pesquisável por significado),
  gravação de áudio por modo (Off / Always On / Only Meetings), exportação da
  base de memórias.
- **OpenBot / OpenSquilla** — microkernel com um único *turn loop* compartilhado
  por todas as superfícies, router local de modelos por faixa de custo, memória
  `MEMORY.md` + notas datadas com busca FTS + vetorial, skills carregadas
  sob demanda, sandbox em camadas (macOS = Seatbelt/sandbox-exec).
- **OpenMausBot** — arquivos de memória em markdown editável com redação
  automática de credenciais, orçamento de tokens na carga de memória (primeiros
  200 linhas / 24 KB), cartões de aprovação para ações sensíveis, controle do
  host macOS como opt-in explícito.
- **Nova operator (calebnewtonusc/Nova, MIT)** — escada de 7 camadas de execução
  ordenadas por custo e confiabilidade: dados (SQLite/plists) → scripting
  (AppleScript/JXA/Shortcuts) → **Accessibility como padrão** → input bruto →
  visão (só para canvas/opacos) → browser via CDP → sandbox. Duas invariantes
  que adotamos no PolicyGate: conteúdo de tela é dado nunca ordem, e toda ação
  irreversível (enviar, pagar, apagar, publicar) exige humano mesmo sob "só faz".
- **Nova MCP (bigduu/Nova, MIT)** — servidor Rust de computer-use que valida a
  ordem AX-primeiro na prática: `ax_read`/`ax_activate` rejeitam snapshots
  obsoletos, leitura estruturada custa 78–96% menos tokens que screenshot em apps
  densos, `batch_actions` limita a 64 passos com falha estruturada. Pode servir
  de atalho (mãos emprestadas via MCP) enquanto o InputEngine nativo amadurece.

---

## 2. Arquitetura geral

```
┌─────────────────────────────  MacaOS.app (Swift, menu bar)  ─────────────────────────────┐
│                                                                                          │
│  Perception            Interface                 Agent Core                Action        │
│  ───────────           ──────────                 ──────────                ──────        │
│  CaptureEngine         OverlayPanel (NSPanel      TurnLoop (um só          InputEngine   │
│  (ScreenCaptureKit)     nonactivating)             loop p/ voz, texto,      (CGEvent +    │
│  DiffGate (perceptual  Annotator (marcações        widgets)                  AXPress)      │
│  hash p/ pular frames)  na tela, setas/caixas)    ToolRegistry              BrowserBridge │
│  AXProbe (árvore       VoiceOrchestrator          PolicyGate (aprovação    ShortcutsRun  │
│  AXUIElement)          (STT streaming ↔ TTS)       por classe de risco)    Scheduler     │
│  AudioTap (mic +       WidgetBar (dinâmico)       MemoryWriter              TerminalRun   │
│  system audio)         RewindSearch               SkillForge                                 │
│       │                     │                          │                                   │
│  ┌────┴─────────────────────┴──────────────────────────┴───────────────────────────┐      │
│  │                    StorageCore (SQLite WAL + sqlite-vec + FTS5)                  │      │
│  │  frames · audio_chunks · events · episodes · memories · skills · transcripts     │      │
│  │  blobs de imagem/JPEG em disco (~…/MacaOS/blobs), vetor de 768d (MRL→256)        │      │
│  └──────────────────────────────────────────────────────────────────────────────────┘      │
│                                        │                                                   │
│  ModelRuntime (protocolo): EmbeddingGemma 2 via MLX Swift (in-process)                      │
│                            LLM/visão: provedor externo OU llama-server local                │
│                            STT: whisper.cpp local · TTS: AVSpeechSynthesizer / cloud        │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

Regra de dependência: todo módulo fala com o mundo só através de protocolos
(`Clock`, `CaptureSource`, `ModelRuntime`, `Store`, `ActorPolicy`). Isso mantém
o núcleo testável e permite trocar nuvem↔local sem tocar no TurnLoop — padrão
que o OpenMausBot usa no harness e o OpenSquilla no gateway.

---

## 3. Subsistemas

### 3.1 Captura de tela com consciência em tempo real

- **ScreenCaptureKit** (macOS 14+): stream de uma display por vez, `minimumFrameInterval`
  adaptativo — alvo 1 fps ambiente, cai para 0.2 fps quando ocioso.
- **DiffGate antes de gastar qualquer coisa**: hash perceptual (dHash 64-bit) do
  frame reduzido. Sem mudança significativa → descarta. Só passa adiante quando
  há delta, ou a cada N segundos como heartbeat.
- Downscale para ~1280 px lado maior, JPEG q≈70 → blob em disco.
- Pipeline assíncrono com backpressure (canal com capacidade 1, drop-oldest):
  nunca deixa a fila de embedding crescer sem limite.
- **AXProbe**: junto do frame aceito, extrai a árvore de acessibilidade do app
  frontmost (janela, título, campos, botões habilitados, URL da aba ativa via
  AppleScript/JS bridge). O texto estruturado da AX tree é o que dá precisão; a
  imagem dá semântica visual. Os dois viram um registro `frame`.
- **Privacidade**: lista de apps/padrões de janela que pausam captura (padrão:
  banking, saúde, gerenciadores de senha, modo anônimo do navegador). Redação
  por OCR/regex de padrões tipo cartão de crédito e `password:` **antes** de
  persistir. Tecla de pânico limpa os últimos K minutos.

### 3.2 Banco vetorial com EmbeddingGemma 2

Escolha técnica validada (oct/2026):

- **EmbeddingGemma 2** (Google, Apache 2.0): 740M total = backbone de texto
  270M + encoder visão 170M + encoder áudio 300M, espelho unificado de **768
  dimensões** para texto/imagem/áudio/vídeo, contexto 8K, MRL truncável para
  512/256/128. É exatamente o "embedding Gemma 2" pedido, e roda on-device.
- **Inference**: `mlx-swift-lm` já traz `EmbeddingGemma2Embedding` nativo em
  Swift/MLX (carrega o checkpoint uma vez, reusa o actor; BF16 é o mais rápido
  em Apple Silicon; Q8_0 mantém cosine ≥0.9999 vs FP32). Alternativa zero-JIT:
  subprocesso `llama-server -m embeddinggemma-2-Q8_0.gguf --mmproj … --embeddings
  --pooling mean` servindo OpenAI-compatível em localhost.
- **Store**: SQLite + `sqlite-vec` (virtuel, `vec0`, cosine) + FTS5 para
  fallback lexical. Vetores armazenados como **float16**; índice ANN HNSW em
  **256 dims** (MRL) para velocidade; rerank exato em 768 dims nos top-64.
- **Prompt prefix correto**: queries usam `task: search query | query: …`,
  documentos usam `task: search result | query: …` (convenção do modelo;
  retrieval errado se inverter).
- Orçamento de espaço: ~1.5 KB/vetor em fp16@256d → 1 ano de captura moderada
  (~5k frames/dia) ≈ 2.7 GB de vetores + blobs JPEG comprimidos. Retenção
  configurável com expurgo em cascata (frames crus → episódios → memórias).

Esquema mínimo:

```sql
CREATE TABLE frames(id INTEGER PK, ts REAL, display TEXT, app_bundle TEXT,
  window_title TEXT, ax_json TEXT, blob TEXT, phash TEXT, episode_id INTEGER);
CREATE TABLE embeddings(owner_kind TEXT, owner_id INTEGER, modality TEXT,
  dim INTEGER, vec BLOB);                       -- preenchida via gatilho/app
CREATE VIRTUAL TABLE vec USING vec0(embedding float[256] distance_metric=cosine);
CREATE TABLE audio_chunks(id INTEGER PK, ts REAL, source TEXT /*mic|sys*/,
  dur REAL, transcript TEXT, diar TEXT, blob TEXT);
CREATE TABLE episodes(id INTEGER PK, t0 REAL, t1 REAL, title TEXT, summary TEXT);
CREATE TABLE memories(id INTEGER PK, kind TEXT /*fact|pref|correction*/,
  text TEXT, source_ids TEXT, pinned INTEGER, updated REAL);
CREATE TABLE skills(id INTEGER PK, name TEXT, path TEXT, triggers TEXT,
  steps_json TEXT, score REAL, uses INTEGER, last_ok REAL);
CREATE TABLE turns(id INTEGER PK, session TEXT, role TEXT, content TEXT, ts REAL);
```

### 3.3 Hierarquia de memória (contínua, não bruta)

Quatro andares, todos com embedding no mesmo espaço 768d:

1. **Frames** (minutos) — o que 3.1 produz.
2. **Episódios** (agregação a cada ~5–10 min ou troca de tarefa): um resumo
   textual barato gerado por modelo leve ("usuário revisou lentes de contato em
   Zety/Word, consultou TFOS DEWS III no浏览器") + embedding. É a unidade do
   *Rewind*.
3. **Memórias semânticas** — fatos, preferências e correções extraídos pela
   mesma via do OpenMausBot: escrita em markdown humano-editável
   (`~…/MacaOS/memory/*.md`, permissão 0600, redação de credenciais, arquivo
   `MEMORY.md` limitado aos primeiros 200 linhas/24 KB no system prompt) **e**
   indexados vetorialmente. Usuário pode abrir em Obsidian/editor.
4. **Skills procedurais** — ver 3.7.

Recall em cada turno: hybrid (BM25 no FTS5 + cosine em 256d, fusão RRF),
recência com decaimento exponencial, e boost para `pinned`. Custo por turno:
uma query de embedding (~10 ms) + busca local (<15 ms). Nunca injetar frames
crus no contexto; injeta-se resumo de episódio + citações clicáveis.

### 3.4 Áudio contínuo

- **Microfone**: AVAudioEngine, VAD local (silero-vad via ONNX core ou
  webrtcvad) segmentando em falas; whisper.cpp `large-v3-turbo` quantizado
  (base model) transcreve em background. Latência de transcrição não bloqueia
  o chat de voz (esse usa STT streaming do provedor em tempo real).
- **Áudio do sistema**: ScreenCaptureKit `SCStream` com audio capture
  (macOS 13+, filtro por processo) para gravar reuniões/vídeos.
- Modos herdados do Omi: `off` / `always` / `only-meetings` (detecta call ativa
  por estado do CoreAudio/CallKit-ish heuristics). Transcrições viram
  `audio_chunks` com embedding (o encoder de áudio do EmbeddingGemma 2 cobre
  trechos de até ~5.5 min por item; acima disso, janelar).
- Tudo local; nothing leaves the machine exceto quando o usuário conversa com o
  LLM de nuvem.

### 3.5 Overlay, hotkey e marcações na tela

- **NSPanel com `.nonactivatingPanel`** (técnica Raycast/Wispr): o app ativo
  mantém o foco; o widget aparece instantaneamente sobre qualquer app, multi-monitor.
- **Hotkey global**: `⌃⌥Space` ou duplo-toque em `Fn` (via IOKit HID, sem
  Accessibility ainda). Mantém pressionado = walkie-talkie (push-to-talk);
  toque = inicia sessão de voz contínua com barge-in.
- **Annotator mode** (pedido explícito do usuário): ao apertar a tecla de
  marcação (ex.: `⇧⌘M` ou caneta no overlay), congela um snapshot do monitor e
  entra em canvas transparente por cima de tudo:
  - desenhar setas, caixas, sublinhado, texto, círculos;
  - a pergunta vai para o modelo como **imagem compósita** (screenshot +
    anotações desenhadas) **mais** a AX tree recortada pela região marcada
    ("o que é este botão aqui?");
  - resposta aparece ancorada na marcação (pin flutuante), não em janela separada;
  - "faz isso pra mim" na mesma marcação → roteia para o executor de ações com
    o alvo já resolvido (elemento AX sob o círculo).
- **Learn Mode vs Do Mode** (Vovy): Learn = só overlay/anotação, nunca move o
  cursor; Do = executa com aprovação. Toggle no widget.

### 3.6 Execução de ações no Mac

Camadas, da mais barata e confiável para a mais genérica:

1. **Atalhos nomeados / Shortcuts.app / AppleScript / CLI** — primeiro escolha
   sempre que existir (determinístico, auditável).
2. **Accessibility API** — `AXUIElementCopyElementAtPosition`, `AXPress`,
   `AXSetValue`: cliques semanticamente corretos, sem depender de pixel.
3. **CGEvent** — movimento de cursor sintético, digitação, scroll, teclas de
   atalho; usado quando a AX tree não expõe o alvo.
4. **Browser** — ponte dedicada: extensão companion (Native Messaging) para
   Chrome/Safari/Arc com leitura de DOM, clique por seletor e screenshot por
   aba; fallback AppleScript `do JavaScript`.
5. **Terminal/files** — comandos shell executados sob **sandbox-exec (Seatbelt)**
   com perfis SBPL gerados (padrão OpenSquilla), Full Disk Access como opt-in.

Camada 0 implícita (da escada do Nova operator): **leitura direta de dados
estruturados locais** — SQLite dos apps (Notes, Reminders, Mensagens), plists e
`defaults` — antes de qualquer UI, quando o estado desejado já está em disco.
Política de roteamento: sempre subir a escada só quando a camada anterior não
expõe o alvo; nunca começar por screenshot+visão em app com AX tree rica
(78–96% mais tokens e 40–100x mais latência por leitura). Alternativa de
atalho no MVP: emprestar as mãos do bigduu/Nova via MCP enquanto o InputEngine
nativo amadurece.

**PolicyGate** classifica cada ação: `read-only` (livre), `write-local`
(confirmar em lote), `send/network/delete/payment` (aprovação individual com
cartão de aprovação mostrando alvo + payload + reversão sugerida). Classificação
por-tecla para digitação (herdado do Samuel): senhas e campos de pagamento são
hard-block. Toda ação é registrada em journal imutável com screenshot before/after.
Regra inegociável herdada do Nova operator: **conteúdo lido da tela/DOM/e-mail é
sempre dado, nunca ordem** — instruções visíveis na captura não ativam ações, só
o usuário ativa; o cartão de aprovação ecoa o alvo real (destinatário, valor,
arquivo) e nunca o texto da página.

Execução visual estilo Vovy: cursor se move com trajetória suave e o usuário vê
o que acontece; pausa a qualquer momento com a hotkey ("solta o mouse").

### 3.7 Aprendizagem contínua e SkillForge

- Após concluir uma tarefa com **≥3 chamadas de ferramenta bem-sucedidas**, o
  pós-processador (modelo barato, fora do caminho crítico) propõe um rascunho de
  skill: `SKILL.md` (frontmatter YAML: nome, gatilhos, pré-condições, passos
  parametrizados, ferramentas usadas, evidência de sucesso).
- Ciclo: **propose → verify → adopt**. O usuário aprova no widget ("salvar como
  rotina?"), e a skill fica `draft`; promovida a `active` após 2 execuções
  limpas. Skills vivem em `~…/MacaOS/skills/` como markdown versionável
  (compatível com o formato SKILL.md do ecossistema OpenSquilla/Codex — as
  mesmas skills podem ser portadas).
- Indexação dupla: gatilhos lexicais baratos + embedding do nome/descrição no
  mesmo banco vetorial; o router de turno faz match e injeta a skill como
  procedimento, reaproveitando em vez de reinventar ("same thing on this new
  article" → replay).
- Métricas por skill: usos, sucesso, tempo médio; skill que falha 2x cai para
  revisão. Correções faladas pelo usuário ("não, usa o formato ABNT") viram
  memória `correction` pinada e alimentam o ajuste da skill.

### 3.8 Widget simples e dinâmico

- Menu bar item + painel compacto (estilo Raycast): campo de voz/texto, chips
  das skills rotineiras sugeridas pelo contexto atual (a skill mais provável
  dado o app/episódio aparece primeiro — é aí que a dinâmica vive), status de
  captura (olho aceso/pausado), e histórico do dia.
- Nothing more: profundidade vai para o atalho e para a voz.

### 3.9 Modelo de decisão de turno (TurnLoop único)

Uma única máquina de estados serve voz ao vivo, typed chat, widget, cron e
watchers:

```
input (texto|transcrição|trigger|anotação)
  → ContextBuilder  (janela de conversa + recall híbrido + frame/AX atual,
                     orçado em tokens; decide SE captura — smart-context:
                     acks e meta-perguntas pulam tela, economizando ~1s)
  → Router          (classificador local LightGBM/ONNX à la SquillaRouter:
                     tier C0 trivial → modelo barato/local; C3 → frontier vision)
  → LLM turn        (tool-calling contra ToolRegistry)
  → PolicyGate      (aprovações quando necessário)
  → Execute + observe (screenshot after, loop ReAct limitado a K passos)
  → PostProcess     (transcript → memória, SkillForge, episódios)
```

Latência-alvo: overlay abre < 150 ms; primeira palavra falada < 1.2 s (voz com
provedor realtime) ou < 2.5 s (pipeline local STT+LLM streaming).

---

## 4. Stack e tamanho

| Camada | Escolha | Peso |
|---|---|---|
| App | Swift 6 + SwiftUI/AppKit, deployment target macOS 14 | binário ~15 MB |
| Embeddings | mlx-swift-lm `EmbeddingGemma2` (BF16) | pesos ~1.5 GB (download sob demanda, first-run) |
| Vetorial | SQLite WAL + sqlite-vec + FTS5 | embutido |
| STT local | whisper.cpp large-v3-turbo-q5 | ~570 MB (opcional; padrão = streaming do provedor) |
| Visão/raciocínio | BYO: Anthropic/OpenAI/Gemini realtime **ou** llama.cpp local (Qwen-VL/gpt-oss) | 0 no bundle |
| Automação | ScreenCaptureKit, Accessibility, CGEvent, EventKit, Shortcuts, sandbox-exec | frameworks do SO |

Meta declarada: instalação base < 60 MB; modelos são assets cacheados em
`~/Library/Caches/MacaOS/models` com verificação de checksum, exatamente como
open-source agents fazem. Uso em repouso da percepção: CPU < 4% e RAM < 250 MB
medidos no Activity Monitor (gate de release).

Permissões pedidas uma vez no onboarding com explicação por linha (padrão Omi):
Screen Recording, Microphone, Accessibility, Automation; opcionais: System Audio
(14.4+), Full Disk Access, Notifications.

---

## 5. Roadmap por fatias (cada uma entregando valor usável)

**F0 — Esqueleto (semana 1–2).** Projeto SPM, app de menu bar, NSPanel
nonactivating, hotkey global, onboarding de permissões, SQLite+sqlite-vec+FTS5
com migrações, ModelRuntime com EmbeddingGemma 2 via MLX e teste de sanidade
cross-modal (texto→imagem cosine > 0.6).

**F1 — Rewind (semana 3–4).** CaptureEngine + DiffGate + AXProbe, ingestão de
frames com embedding, busca semântica "what did I see yesterday about X",
player de timeline. Entregável: produto útil sozinho (substituto local do
Rewind/Omi).

**F2 — Perguntar com a tela (semana 5–6).** Chat typed no overlay com
context-builder (frame atual + recall), streaming de resposta, citações que
abrem o frame-fonte. Smart-context decide quando capturar.

**F3 — Marcações (semana 7).** Annotator: congelar snapshot, desenhar,
perguntar apontando, pin de resposta, "faz isso" resolvendo alvo via AX.

**F4 — Voz ao vivo (semana 8–9).** Push-to-talk + modo contínuo com barge-in,
STT streaming, TTS, whisper.cpp local como alternativa offline; áudio de
reuniões (mic + system) entrando na memória.

**F5 — Mãos (semana 10–12).** ToolRegistry completa (Shortcuts, AppleScript,
AX click/type, CGEvent, browser bridge, terminal sandboxado), PolicyGate com
cartões de aprovação, journal before/after, modo takeover com pausa por hotkey.

**F6 — Cérebro contínuo (semana 13–15).** Episódios automáticos, memória
markdown estilo OpenMausBot (budget, redação, undo), SkillForge propose→verify
→adopt, router local de tiers, widget dinâmico com sugestões contextuais,
watchers/agendador ("me avisa quando aparecer X na tela").

Cada fatia fecha com suíte de verificação própria: fixtures de frames sintéticos
(nada de dados reais no CI), testes determinísticos do DiffGate/schema, e
evals de retrieval (Recall@10 em corpus rotulado) e de tarefas de ação em VM
descartável — prática herdada do `docs/verification/` do OpenMausBot.

---

## 6. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Custo de GPU/CPU de embedar 1 fps continuamente | DiffGate filtra ~90% dos frames; batch assíncrono; MRL 256d no índice; janela de inferência com idle-detect (tela escura/lock → pausa total). |
| GGUF degrada embeddings de imagem (cosine ~0.94 vs 0.999 MLX) | caminho padrão = MLX Swift; llama.cpp só como fallback documentado para texto/áudio. |
| Ações destrutivas por engano | PolicyGate por classe de risco, aprovação individual para send/delete/payment, journal com reversão, hard-block em campos de senha. |
| Prompt injection vindo de conteúdo na tela (e-mail/page instrui o agente) | conteúdo de tela/AX/DOM entra como dado delimitado e escapado (padrão OpenSquilla de XML-escape em tool results); ações sensíveis exigem confirmação humana que ecoa o alvo real, não o texto da página. |
| Vazamento de dados sensíveis para LLM de nuvem | redação pré-persistência, lista de apps-pausa, modo "local only" que força rota llama.cpp/MLX, toggle por sessão. |
| Retenção de disco crescer sem limite | cotas configuráveis + expurgo em cascata com prioridade para memórias e skills. |
| Termos de uso de apps (WhatsApp etc.) ao automatizar | usar APIs/Shortcuts quando existirem; automação de UI só com consentimento explícito do usuário e journal. |
| Gatekeeping de notarização/entitlements p/ ScreenCaptureKit + AX | Developer ID + hardened runtime; entitlements `com.apple.security.device.audio-input`, screen capture exige TCC do usuário de qualquer forma. |

---

## 7. Decisões abertas (precisam do seu aval)

1. **Licença e posicionamento**: open-source Apache 2.0 (como OpenSquilla/
   OpenMausBot) ou fonte-privada com freemium?
2. **LLM padrão**: assumir BYO-key de nuvem no MVP (mais fácil, melhor
   qualidade) e deixar local como F6? Ou exigir 100% local desde F2?
3. **Idiomas**: PT-BR + EN no STT/TTS/UI desde o início (whisper.cpp cobre;
   EmbeddingGemma 2 é multilíngue)?
4. Extensão de browser própria já na F5 ou começar só com AppleScript/AX?

Se aprovar, o próximo passo concreto é a F0: scaffold do pacote Swift com o
harness de permissões, o NSPanel nonactivating e o teste cross-modal do
EmbeddingGemma 2 rodando em < 1 dia de trabalho.
