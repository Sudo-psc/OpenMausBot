# Ilha dinâmica com contexto de tela e Omi

Protótipo local na branch `feat/dynamic-island-omi`. Implementação própria,
inspirada na experiência de sobreposição do Vovy. Não contém código ou recursos
visuais extraídos do Vovy. OpenMausBot mantém sua licença Apache 2.0.

## Comportamento

- Janela junto ao topo da tela principal, compacta ou expandida, com texto e voz.
- Atalhos globais, registrados só enquanto a ilha está aberta. A ilha mostra
  apenas os que conseguiu registrar; se outro aplicativo já usa a tecla, os
  botões continuam disponíveis.

  | Ação | Mac | Windows e Linux |
  | --- | --- | --- |
  | Ditar para o campo de texto, sem enviar | `⌘⌥⇧D` | `Ctrl+Alt+Shift+D` |
  | Falar, finalizar a fala ou interromper a resposta falada | `⌘⇧Space` | `Ctrl+Shift+Space` |
  | Ativar ou pausar a percepção da tela | `⌘⌥⇧S` | `Ctrl+Alt+Shift+S` |
  | Parar: encerra a conversa por voz ou cancela a tarefa em curso | `⌘⌥⇧X` | `Ctrl+Alt+Shift+X` |
  | Expandir ou recolher a ilha | `⌘⌥⇧I` | `Ctrl+Alt+Shift+I` |

- Conversa por voz: um pedido falado recebe resposta falada, frase a frase,
  enquanto o texto chega. Ao terminar de falar, a ilha volta a ouvir sozinha.
  A conversa termina com 8 segundos de silêncio, com o atalho Parar, com `Esc`
  na ilha, com um pedido digitado, com erro ou ao bloquear a tela. Pedidos
  digitados nunca são falados. Uma resposta que chega com a tela bloqueada é
  exibida, não falada.
- A fala usa a voz do sistema pelo navegador embutido, no idioma selecionado
  no aplicativo (tag BCP-47). O microfone só abre depois que a fala termina,
  então a ilha não ouve a própria resposta.
- A percepção começa pausada. Ativar percepção captura o monitor do cursor a
  cada 5 segundos, até três imagens JPEG em memória, com validade de 30 segundos.
- Pausar, bloquear a tela, suspender ou sair descarta as imagens. Após desbloquear,
  é preciso ativar novamente. Não há reconhecimento contínuo de áudio.
- Só um pedido explícito, digitado ou falado, envia as imagens recentes e o
  contexto Omi ao bot. A
  captura contínua não é um agente autônomo que executa instruções vistas na tela.
- As imagens enviadas se tornam anexos normais do histórico da conversa. Pausar
  limpa o buffer local, mas não apaga mensagens e anexos já enviados.
- Omi continua funcionando em paralelo. O adaptador usa a API oficial; não lê os
  arquivos privados do aplicativo e não controla seu microfone.
- Memória do Omi em três caminhos: a amostra recente (20 memórias e 10
  conversas, renovada a cada 2 minutos); uma busca por pedido, desligada por
  padrão, que a pessoa liga no botão Buscar no Omi a cada pedido (volta a desligar
  ao reabrir o app), que envia ao Omi os primeiros 200 caracteres do pedido e
  inclui até 8 memórias relacionadas; e
  a gravação, só pelos botões Salvar nota ou Salvar resposta, que cria uma
  memória privada de até 500 caracteres com a etiqueta `openmausbot`. Gravar
  exige uma chave com o escopo `memories:write`. Nada é gravado sem o comando.
- Chave Omi inserida no campo protegido da ilha, cifrada pelo sistema operacional
  e mantida fora do renderer depois da submissão. Nunca inserir a chave em chat.
- O modelo/serviço configurado no bot recebe o contexto enviado; esta branch
  não garante inferência local. Percepção visual exige modelo que aceite imagens.

## Executar uma demonstração isolada

```sh
pnpm install --frozen-lockfile
pnpm exec electron scripts/smoke-dynamic-island.mjs --smoke
```

O smoke usa UI, preload, sessão e protocolo de conversa reais, mas simula voz,
imagem da tela, resposta do bot e conta Omi. Não prova reconhecimento de voz
real, leitura real da tela, chamadas à conta Omi nem controle efetivo do Mac.
Sem `--smoke`, o script mantém a demonstração aberta. Dados, chaves e imagens
da demonstração são artificiais; seu perfil Electron é temporário.

## Executar com o aplicativo em desenvolvimento

Na raiz do clone, em cada um dos três terminais, defina:

```sh
export OMB_DATA_DIR="$PWD/.island-prototype/data"
export OMB_PORT=19879
export OMB_UI_PORT=15199
export ELECTRON_START_URL=http://127.0.0.1:15199
```

Depois, respectivamente, execute:

```sh
# Terminal 1: servidor com dados separados
pnpm dev:server
# Terminal 2: interface
pnpm dev
# Terminal 3: desktop com perfil Electron separado
pnpm exec electron . --dynamic-island --user-data-dir="$PWD/.island-prototype/electron"
```

Use outras portas livres se as indicadas estiverem ocupadas. Configure os bots
e a conexão Omi nesse ambiente separado. Não execute sobre a pasta de dados de
produção para verificar mudanças. O aplicativo Omi pode permanecer aberto.

## Verificação

```sh
node --test 'electron/island-*.node-test.mjs'
node --test 'electron/talk-*.node-test.mjs'
pnpm typecheck
pnpm lint
pnpm exec electron scripts/smoke-dynamic-island.mjs --smoke
```

Para verificar servidor/conversa, iniciar a fixture de `docs/verification/README.md`.
Para aceitação no Mac, verificar com autorização: reconhecimento de português,
permissão de gravação da tela, ações de um bot de teste, atalho em outro app,
monitor externo, Spaces/tela cheia, pausa/bloqueio e Omi funcionando simultaneamente.

### Resultado da integração em 13 de novembro de 2026

As regressões em `electron/island-session.node-test.mjs` e
`electron/island-page.node-test.mjs` verificam que:

- falhas ao configurar ou desconectar o Omi durante um pedido mantêm a tarefa
  ativa, com o erro na área do Omi, o cancelamento disponível e um novo
  rascunho preservado;
- pausar ou suspender revoga os uploads de imagens ainda pendentes, mas preserva
  o pedido de texto e uma tarefa já aceita pelo servidor.

| Comando | Resultado | Saída |
| --- | --- | --- |
| `node --test electron/island-*.node-test.mjs electron/talk-*.node-test.mjs` | exit 0; 148 testes passaram, 0 falharam | [coordination-node-tests.log](evidence/dynamic-island/coordination-node-tests.log) |
| `pnpm typecheck` | exit 0 | [coordination-typecheck.log](evidence/dynamic-island/coordination-typecheck.log) |
| `pnpm lint` | exit 0 | [coordination-lint.log](evidence/dynamic-island/coordination-lint.log) |
| `pnpm exec electron scripts/smoke-dynamic-island.mjs --smoke` | exit 0; 8 verificações passaram | [coordination-smoke.log](evidence/dynamic-island/coordination-smoke.log) |
| `pnpm exec vitest run server/island-server.e2e.test.ts` | exit 0; 1 teste passou em servidor isolado | [coordination-server-e2e.log](evidence/dynamic-island/coordination-server-e2e.log) |

Esses resultados usam dados simulados. Permanecem pendentes os testes com
microfone, captura da tela e conta Omi reais descritos acima.

### Resultado da conversa por voz e da memória Omi em 16 de novembro de 2026

Executado em Linux (Node 22, Electron sob `xvfb-run`), com dados simulados.

| Comando | Resultado | Saída |
| --- | --- | --- |
| `node --test electron/island-*.node-test.mjs electron/talk-*.node-test.mjs` | exit 0; 169 testes passaram, 0 falharam | [voice-omi-node-tests.log](evidence/dynamic-island/voice-omi-node-tests.log) |
| `pnpm typecheck` | exit 0 | |
| `pnpm lint` | exit 0 | |
| `xvfb-run -a pnpm exec electron --no-sandbox scripts/smoke-dynamic-island.mjs --smoke` | exit 0; 10 verificações passaram | [voice-omi-smoke.log](evidence/dynamic-island/voice-omi-smoke.log) |
| `pnpm exec vitest run server/island-server.e2e.test.ts` | exit 0; 1 teste passou em servidor isolado | |

O smoke agora cobre a conversa por atalho (resposta falada, nova escuta e
Parar) e a gravação de uma nota no Omi. Uma falha no smoke passou a encerrar
com exit 1; antes, a janela fechada encerrava o Electron com exit 0.

Não verificado nesta rodada: voz real do macOS, microfone, atalhos globais
reais, captura real da tela e conta Omi real, incluindo a busca
`memories/vector/search` e a gravação com escopo `memories:write`.

### Ditado, conversa e consciência do computador

- **Ditar** (`⌘⌥⇧D` / `Ctrl+Alt+Shift+D`): a fala vira texto no campo, para revisar
  e enviar. Nada é enviado nem falado.
- **Conversar** (`⌘⇧Space` / `Ctrl+Shift+Space`): conversa por voz contínua, com
  resposta falada. Os dois modos têm botão, rótulo e aviso próprios.
- **Registro durante a conversa:** com a percepção ativa, a ilha guarda só em
  memória até 12 momentos dos últimos 3 minutos (fora da conversa: 3 momentos, 30
  segundos). Pausar, bloquear a tela ou encerrar a conversa descarta o excedente.
- **Filtro de novidade:** cada captura recebe uma assinatura visual de 64 bits. A
  ilha espera que a próxima tela se pareça com a última guardada e só guarda outra
  quando isso falha: outro app na frente, outra janela, ou mudança visual acima da
  inquietação recente da tela. É uma heurística preditiva, não um modelo treinado.
- **Escolha do que enviar:** cada pedido leva no máximo 3 imagens: a mais recente
  e as anteriores cujo app e janelas mais combinam com o pedido.
- **Embeddings locais (opcional):** com `--island-embeddings`, a combinação usa
  embeddings de texto de um modelo no próprio computador (Ollama em
  `127.0.0.1:11434`, modelo `embeddinggemma`). Só endereços locais são aceitos.
  Sem o modelo, a ilha usa palavras em comum.
- **Situação do computador:** com a percepção ativa, o pedido leva a hora local,
  o app em primeiro plano (no Mac, via `lsappinfo`), os nomes de até 6 janelas
  abertas, lidos só no envio, e se o controle do computador está disponível. Com
  a percepção pausada, nada disso é enviado.
- **Apps e títulos privados:** um app em primeiro plano cujo nome sugere senhas,
  bancos ou pagamento oculta a tela: nada é capturado enquanto ele estiver na
  frente, o que já estava guardado é descartado e a ilha avisa. Títulos de
  janela com esses termos nunca entram na lista. A correspondência é por trecho do
  nome, então um site dentro do navegador só é pego se o título disser isso.
- **Controle do computador:** a ilha mostra o estado do controle que os bots já
  usam e oferece Ativar ou Permitir quando há correção possível.

### Modelo de ameaça: dados externos

Tela, títulos de janela, nome do app e memórias do Omi vêm de fora e podem
conter instruções para o bot. A mensagem os marca como não confiáveis e pede que
o bot nunca aja no computador por causa de texto que apareça neles, e que
pergunte no chat. Isso é uma orientação ao modelo, não um bloqueio: um modelo
que a ignore ainda poderia agir. Fechar essa lacuna exige confirmação nas
ferramentas de controle do computador, no servidor, e está pendente.

Não verificado em Mac real: a saída de `lsappinfo`, a ordem das janelas, a
assinatura visual em telas reais e um modelo `embeddinggemma` de verdade.

### Idioma da ilha

Os textos da ilha vêm de `native.island.*` em `src/locales/en.json` e seguem o
idioma escolhido no app; sem tradução, aparecem em inglês. `pt-br.json` traz a
versão atual. O texto enviado ao modelo (instruções sobre imagens e contexto
Omi) e o conteúdo salvo no Omi (`Pergunta:` / `Resposta:`) não são traduzidos.

## Limites conhecidos

A voz depende das vozes instaladas no sistema. Sem voz disponível, a resposta
aparece só em texto e a conversa segue ouvindo. Marcação simples de Markdown é
removida antes da fala; blocos de código são lidos como texto. A busca no Omi
consome o mesmo limite horário de leitura de memórias; ao receber 429, a ilha
suspende buscas e atualizações pelo tempo indicado. Uma busca lenta (4 s) ou
recusada é ignorada e o pedido segue sem as memórias relacionadas.


A proteção de conteúdo de uma janela não garante sua exclusão de capturas no
macOS moderno. A ilha e outras sobreposições podem aparecer na imagem. Captura
global pode incluir conteúdo sensível; pause ou escolha outro monitor antes de
enviar. O protótipo não faz OCR ou resumo em segundo plano: mantém um contexto
visual recente para o próximo pedido. Credenciais reais Omi e permissões do Mac
são necessárias para a aceitação completa, além dos testes simulados.

## Fontes

- https://github.com/milind-soni/OpenMausBot
- https://github.com/BasedHardware/omi
- https://docs.omi.me/doc/developer/api/overview
- https://docs.omi.me/doc/developer/api/memories
- https://docs.omi.me/doc/developer/api/conversations
- https://vovy.ai

## Reverter

Encerrar a demonstração e iniciar normalmente sem `--dynamic-island`. Não foi
alterada a instalação em `/Applications/OpenMausBot.app`. Nenhum push ou publicação
é necessário para usar a branch local.
