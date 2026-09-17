# Servidor MCP de revisão da B1 (mcp-revisao-b1)

Servidor MCP em TypeScript com o SDK oficial (`@modelcontextprotocol/sdk` 1.30) e schemas em `zod` 4, para estudar a avaliação B1 da disciplina de Tecnologias Emergentes (ESOFT8, UniCesumar).

Ele registra os três primitivos do protocolo: seis tools, um resource e dois prompts. As consultas de conteúdo devolvem o link do `slides.md` da turma. O cálculo de custo usa preços consultados na primeira tool de preço do processo e reusa o cache em memória.

Node 24 executa o `.ts` sem build, por remoção de tipos. O transporte padrão é stdio. HTTP sobe com `--http`. O passo a passo de cada cliente está na seção "Como rodar".

## O que ele registra

| Primitivo | Nome | O que faz | Quem aciona |
|---|---|---|---|
| Tool | `listarTopicos` | lista os 5 blocos e o título de cada slide, com o id | o modelo |
| Tool | `consultarConteudo` | busca um termo e devolve título, trecho e link | o modelo |
| Tool | `obterSlide` | devolve o trecho e o link de um slide pelo id | o modelo |
| Tool | `consultarConceito` | definição curta dos padrões, RAG, injeção, primitivos MCP, ciclo e transporte | o modelo |
| Tool | `custoDaChamada` | aplica a fórmula de custo com os preços do momento e informa a janela | o modelo |
| Tool | `listarModelos` | lista ids de modelo por nome ou provedor, com preço e janela | o modelo |
| Resource | `b1://conteudo` | índice completo da B1 em markdown, com link por slide | o cliente |
| Prompt | `revisar-para-prova` | revisão socrática de um bloco, com a lista de slides no texto | o usuário |
| Prompt | `exercicio-de-custo` | exercício de cálculo conferido pela tool | o usuário |

`listarTopicos` existe porque o modelo só vê as descriptions das tools. O resource `b1://conteudo` lista os mesmos 65 slides, e só entra no contexto quando o cliente anexa. Sem a tool, o prompt de revisão pedia um tópico livre e o modelo inventava o mapa da prova.

## Como rodar

Substitua `/caminho/mcp-revisao-b1` pelo caminho absoluto do clone neste computador. No Windows o mesmo arquivo vira `C:\Users\aluno\mcp-revisao-b1\servidor.ts`. Node 24 precisa estar no `PATH` (`node --version` deve imprimir `v24`).

### Clone e dependências

```
git clone https://github.com/pedrosatin/mcp-revisao-b1.git
cd mcp-revisao-b1
npm install
```

### Stdio, local, sem Docker

O cliente inicia o processo e troca JSON-RPC na entrada e na saída padrão. O log do servidor vai para stderr.

```
node servidor.ts
```

ou `npm start`. O processo espera o handshake `initialize`. Sem cliente na stdin ele fica parado, e isso é o comportamento certo.

MCP Inspector, para ver tools, resources e prompts sem configurar um app:

```
npx @modelcontextprotocol/inspector node servidor.ts
```

### Streamable HTTP, local, sem Docker

Um processo HTTP longo. O cliente conecta em `http://127.0.0.1:3333/mcp`. Bind padrão em loopback, com proteção contra DNS rebinding do `createMcpExpressApp`.

```
node servidor.ts --http
```

ou `npm run start:http`. Equivalente por variável: `MCP_TRANSPORTE=http node servidor.ts`.

| Variável | Padrão | Efeito |
|---|---|---|
| `MCP_TRANSPORTE` | stdio | `http` sobe o servidor HTTP |
| `MCP_HOST` | `127.0.0.1` | endereço de bind |
| `MCP_PORT` | `3333` | porta |

Abra `http://127.0.0.1:3333/` no navegador. A página é um cliente MCP no mesmo origin: faz `initialize` em `POST /mcp`, guarda o `mcp-session-id` e cada botão vira `tools/call`. O painel da direita mostra o JSON-RPC. Não usa WebMCP (`document.modelContext`). O processo Node continua sendo o servidor.

Inspector no endpoint HTTP, se quiser o cliente oficial:

```
npx @modelcontextprotocol/inspector http://127.0.0.1:3333/mcp
```

Para ouvir em todas as interfaces, por exemplo num container:

```
MCP_TRANSPORTE=http MCP_HOST=0.0.0.0 MCP_PORT=3333 node servidor.ts
```

### SSE legado

A spec 2024-11-05 usava GET `/sse` para o stream e POST `/messages?sessionId=...` para as mensagens. O SDK marca esse transporte como deprecated. O servidor ainda responde nesses dois caminhos quando sobe com `--http`, para cliente antigo. Cliente novo usa `/mcp`.

### Docker, stdio

```
docker build -t mcp-revisao-b1:1.0.0 .
docker run -i --rm mcp-revisao-b1:1.0.0
```

O `-i` mantém a stdin aberta. Sem isso o processo stdio encerra. O label `io.docker.server.metadata` na imagem é o que o gateway do Docker MCP Toolkit exige para aceitar `docker://mcp-revisao-b1:1.0.0`.

### Docker, HTTP

```
docker run --rm -p 3333:3333 -e MCP_TRANSPORTE=http -e MCP_HOST=0.0.0.0 mcp-revisao-b1:1.0.0
```

A página fica em `http://127.0.0.1:3333/`. O endpoint MCP é `http://127.0.0.1:3333/mcp`. O servidor precisa de saída para `raw.githubusercontent.com` na porta 443. Sem essa saída, só as tools de conteúdo funcionam.

### Worker na Cloudflare e página no GitHub Pages

O endpoint público é um Worker sem sessão. Cada `POST /mcp` sobe um `WebStandardStreamableHTTPServerTransport` com `enableJsonResponse`. O corpo sai em `application/json` (JSON-RPC), para a aba Response do DevTools mostrar o objeto. A página em `web/` é o mesmo cliente HTTP, com `window.MCP_URL` apontando para o Worker quando o host é `pedrosatin.github.io`.

| Superfície | URL |
|---|---|
| Página | https://pedrosatin.github.io/mcp-revisao-b1/ |
| MCP | https://mcp-revisao-b1.satinp-dev.workers.dev/mcp |

O Worker empacota `dados/conteudo-b1.json` e `dados/precos-compactos.json`. Preço no Worker não consulta a rede. Rode `node gerar-precos.ts` e `npm run deploy:worker` quando o catálogo LiteLLM mudar. O processo Node local continua baixando o JSON completo na primeira tool de preço.

```
cd worker
npm install
npx wrangler deploy
```

A pasta `web/` sobe no GitHub Pages pelo workflow `.github/workflows/pages.yml`. O repositório precisa ser público no plano Free. CORS do Worker aceita `pedrosatin.github.io`, `localhost` e `127.0.0.1`.

Cliente HTTP remoto (Claude Code, Codex, ChatGPT) usa a URL do Worker:

```
claude mcp add --scope user --transport http revisao-b1-remoto https://mcp-revisao-b1.satinp-dev.workers.dev/mcp
```

### Claude Desktop

Arquivo de configuração, lido na inicialização do app:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

Stdio local, Node:

```json
{
  "mcpServers": {
    "revisao-b1": {
      "command": "node",
      "args": ["/caminho/mcp-revisao-b1/servidor.ts"]
    }
  }
}
```

No Windows nativo, se `npx` ou `node` falhar com "Connection closed", envolva em `cmd`:

```json
{
  "mcpServers": {
    "revisao-b1": {
      "command": "cmd",
      "args": ["/c", "node", "C:\\Users\\aluno\\mcp-revisao-b1\\servidor.ts"]
    }
  }
}
```

Stdio via Docker, depois do `docker build`:

```json
{
  "mcpServers": {
    "revisao-b1": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "mcp-revisao-b1:1.0.0"]
    }
  }
}
```

Feche o app por completo e abra de novo. No campo de mensagem, menu `+`, Connectors. O item `revisao-b1` aparece com a chave ligada. Peça `liste os tópicos da B1` e aprove a tool `listarTopicos`.

HTTP no Desktop usa `type: streamable-http` apontando para um servidor já no ar (`node servidor.ts --http` em outro terminal):

```json
{
  "mcpServers": {
    "revisao-b1": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3333/mcp"
    }
  }
}
```

Conectores remotos adicionados pela interface do app saem da infraestrutura da Anthropic e não alcançam `localhost`. Para este servidor na máquina do aluno, use stdio.

### Claude Code

Na pasta do clone, ou com `--scope user` para valer em qualquer projeto:

```
claude mcp add --scope user --transport stdio revisao-b1 -- node /caminho/mcp-revisao-b1/servidor.ts
```

Windows nativo:

```
claude mcp add --scope user --transport stdio revisao-b1 -- cmd /c node C:\Users\aluno\mcp-revisao-b1\servidor.ts
```

HTTP, com o servidor já escutando:

```
claude mcp add --scope user --transport http revisao-b1 http://127.0.0.1:3333/mcp
```

SSE legado, só se o cliente recusar HTTP:

```
claude mcp add --scope user --transport sse revisao-b1 http://127.0.0.1:3333/sse
```

Confira com `claude mcp list`. Dentro da sessão, `/mcp` mostra o estado. O `--` separa as flags do Claude Code do comando que sobe o servidor.

### Codex CLI

```
codex mcp add revisao-b1 -- node /caminho/mcp-revisao-b1/servidor.ts
```

HTTP:

```
codex mcp add revisao-b1 --url http://127.0.0.1:3333/mcp
```

O arquivo é `~/.codex/config.toml` (no Windows, `%USERPROFILE%\.codex\config.toml`). A tabela equivalente:

```toml
[mcp_servers.revisao-b1]
command = "node"
args = ["/caminho/mcp-revisao-b1/servidor.ts"]
```

`codex mcp list` confirma. Na TUI, `/mcp` lista o servidor na sessão.

### Antigravity (IDE) e AGY (CLI)

Os dois leem o mesmo arquivo, `~/.gemini/config/mcp_config.json` (no Windows, `%USERPROFILE%\.gemini\config\mcp_config.json`). HTTP usa a chave `serverUrl`, não `url`.

Pelo CLI `agy`:

```
agy mcp add revisao-b1 -- node /caminho/mcp-revisao-b1/servidor.ts
agy mcp add revisao-b1-http http://127.0.0.1:3333/mcp
agy mcp list
```

Na mão, stdio:

```json
{
  "mcpServers": {
    "revisao-b1": {
      "command": "node",
      "args": ["/caminho/mcp-revisao-b1/servidor.ts"]
    }
  }
}
```

HTTP:

```json
{
  "mcpServers": {
    "revisao-b1": {
      "serverUrl": "http://127.0.0.1:3333/mcp"
    }
  }
}
```

No IDE: menu `...` do painel do agente, MCP Servers, Manage MCP Servers, View raw config. No CLI, `/mcp` abre o painel. Reinicie o IDE depois de editar o JSON na mão.

### ChatGPT

O ChatGPT (web e app) fala só com servidor MCP remoto em HTTPS. Stdio local não entra. `http://127.0.0.1:3333/mcp` também não entra, porque a conexão sai da nuvem da OpenAI.

Passo a passo, conta com Developer Mode (Plus, Pro, Team ou Enterprise, conforme a liberação da OpenAI):

1. Em ChatGPT, Settings, Apps, Developer Mode ligado.
2. Apps & Connectors, Create. Nome `revisao-b1`. URL `https://mcp-revisao-b1.satinp-dev.workers.dev/mcp`.
3. Abra um chat, ligue o conector e peça `liste os tópicos da B1`.

## De onde vêm os preços

Os preços dos provedores mudam sem aviso, então nada fica gravado no código. Na primeira chamada de `custoDaChamada` ou `listarModelos` deste processo, o servidor busca o catálogo público `model_prices_and_context_window.json`, mantido pelo projeto LiteLLM e servido como JSON bruto pelo GitHub. É um arquivo estruturado com `input_cost_per_token` e `output_cost_per_token` por id de modelo, o que dispensa raspar página de preços em HTML.

Medida em 16/09/2026, a partir de Curitiba, com HIT no Fastly:

| Grandeza | Valor |
|---|---|
| Tamanho | 2.558.270 bytes (2,44 MiB) |
| Linhas | 68.346 |
| Ids no JSON | 4.089 |
| Ids com os dois preços | 3.431 |
| TTFB | 0,09 s |
| Download completo | 0,27 s |
| `Cache-Control` | `max-age=300` |
| `ETag` | presente |

Essas 68 mil linhas não entram no contexto do modelo. A tool devolve uma conta ou no máximo 20 ids. O GET pesa no processo. O parse guarda um `Map` com os 3.431 modelos que têm preço, da ordem de centenas de KB.

O servidor baixa uma vez por processo e guarda em memória por `PRECOS_TTL_MIN` minutos. O padrão é `360` minutos, que são 6 horas. A constante `PRECOS_TTL_MS` é o mesmo intervalo em milissegundos, porque `Date.now()` compara milissegundos. O cache guarda a promessa da consulta, não só o resultado, para que chamadas concorrentes compartilhem um GET.

O download fica na primeira tool de preço, não no `connect()`. O handshake `initialize` do MCP precisa responder na hora. Se `raw.githubusercontent.com` estiver bloqueado, o timeout de 15 s atrasaria até `listarTopicos`, que não usa a tabela. O gateway do Docker que recria o processo a cada call pagaria 2,55 MB em todo spawn.

A resposta de `custoDaChamada` declara a URL, o horário da consulta e a validade do cache, para o aluno conferir contra a tabela oficial do provedor.

Em 16/09/2026 os valores do catálogo foram conferidos contra as páginas oficiais dos três provedores e bateram nos modelos testados.

| Variável | Padrão | Para que serve |
|---|---|---|
| `PRECOS_URL` | catálogo do LiteLLM no GitHub | troca a fonte de preços |
| `PRECOS_TTL_MIN` | `360` (6 horas) | validade do cache em memória, em minutos |
| `PRECOS_TIMEOUT_MS` | `15000` | tempo limite da consulta |
| `DADOS_DIR` | `./dados` | pasta do `conteudo-b1.json` |
| `MCP_TRANSPORTE` | stdio | `http` sobe Streamable HTTP e o SSE legado |
| `MCP_HOST` | `127.0.0.1` | bind do servidor HTTP |
| `MCP_PORT` | `3333` | porta do servidor HTTP |

## De onde vem o conteúdo

O `gerar-indice.ts` lê os `slides.md` do repositório da turma e grava `dados/conteudo-b1.json` com um item por slide: título, bloco, trecho de até 220 caracteres, termos de busca e a URL com a âncora de linha.

```
node gerar-indice.ts ../2026-tecnologias-emergentes-esoft8s-b
```

O índice guarda um trecho curto, não o slide inteiro. A resposta manda o aluno para o `slides.md` da turma, que é a fonte. Rode o gerador de novo sempre que os slides da turma mudarem, porque as âncoras de linha se deslocam.

O URI `b1://conteudo` é o nome do recurso no protocolo. O JSON é lido no boot por `readFile`. O segundo parâmetro de `registerResource` é esse identificador, e o arquivo fica no `readFile` da inicialização.

Os cinco blocos indexados são `prompt`, `padroes`, `agentes`, `riscos` e `mcp`, com 65 slides ao todo. O bloco `mcp` vem da aula `2026-09-16-MCP` no repositório da turma. Os slides administrativos de abertura do semestre ficam de fora, pelo corte de `linhaMinima` em `gerar-indice.ts`.

`consultarConceito` cobre lookups fechados, com uma frase e o link. Fica de fora classificar enunciado aberto (qual padrão "cabe" numa história) e devolver o código do slide. Inclui primitivos MCP, ciclo, transporte e M+N, da aula de 16/09.

## Resultados validados

Testes de 16/09/2026 em host Linux com Node 24.19.0, SDK 1.30.0 e `zod` 4.6.5, por JSON-RPC no stdio.

- O `initialize` anunciou as três capacidades, `tools`, `resources` e `prompts`.
- `consultarConteudo` com `prompt injection` devolveu dois slides do bloco `riscos`, com a âncora de linha correta.
- `custoDaChamada` com `claude-opus-5`, 12 mil tokens de entrada, 800 de saída e 30 chamadas devolveu US$ 2,40, a US$ 5 e US$ 25 por milhão.
- O mesmo cenário em `gemini-2.5-pro` devolveu US$ 0,69, a US$ 1,25 e US$ 10 por milhão.
- Três chamadas seguidas compartilharam o mesmo `consultadoEm` e uma única consulta ao catálogo, com o cache de promessa.
- Um id fora do catálogo volta como dado, com a sugestão de usar `listarModelos`, porque nome errado não é falha do servidor.
- Com `PRECOS_URL` apontando para um arquivo inexistente, a resposta foi `falha ao consultar a tabela de preços [...] respondeu 404`, com `isError: true`.

Log em [`evidencias/01-revisao-b1-stdio.log`](evidencias/01-revisao-b1-stdio.log).

## Limitações

- O catálogo de preços é de terceiros. Ele acompanha as tabelas oficiais, e o valor exibido deve ser conferido contra a página do provedor antes de virar decisão de orçamento.
- Preço por faixa de contexto, cache de prompt e lote não entram na conta. A tool cobra entrada e saída na tarifa cheia.
- As âncoras de linha quebram quando os slides da turma mudam sem o índice ser regerado.
- O servidor não grava nada. Não há registro de progresso de estudo.
- O teste automatizado ficou no stdio e no `initialize` HTTP. Claude Desktop, Claude Code, Codex, Antigravity e AGY seguem o formato oficial de cada cliente. O Worker público cobre o HTTPS que o ChatGPT pede.
- MCP, backoff exponencial e os quatro modos de permissão do CLI ainda não estão nos `slides.md` da turma B. Entram no índice quando a aula for copiada para o GitHub da turma.

A condução em sala está no `apresentacao.md` da disciplina, na Aula 05.
