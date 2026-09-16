# Servidor MCP de revisão da B1 (mcp-revisao-b1)

Servidor MCP em TypeScript com o SDK oficial (`@modelcontextprotocol/sdk` 1.30) e schemas em `zod` 4, para estudar a avaliação B1 da disciplina de Tecnologias Emergentes (ESOFT8, UniCesumar).

Ele registra os três primitivos do protocolo: seis tools, um resource e dois prompts. As consultas de conteúdo devolvem o link do `slides.md` da turma. O cálculo de custo usa preços consultados na primeira tool de preço do processo e reusa o cache em memória.

```
npm install
node servidor.ts
```

Node 24 executa o `.ts` sem build, por remoção de tipos. Com o MCP Inspector:

```
npx @modelcontextprotocol/inspector node servidor.ts
```

## O que ele registra

| Primitivo | Nome | O que faz | Quem aciona |
|---|---|---|---|
| Tool | `listarTopicos` | lista os 4 blocos e o título de cada slide, com o id | o modelo |
| Tool | `consultarConteudo` | busca um termo e devolve título, trecho e link | o modelo |
| Tool | `obterSlide` | devolve o trecho e o link de um slide pelo id | o modelo |
| Tool | `consultarConceito` | definição curta de Factory, Strategy, Adapter, Observer, ADR, regras/skills, RAG, ciclo de tool calling e injeção | o modelo |
| Tool | `custoDaChamada` | aplica a fórmula de custo com os preços do momento e informa a janela | o modelo |
| Tool | `listarModelos` | lista ids de modelo por nome ou provedor, com preço e janela | o modelo |
| Resource | `b1://conteudo` | índice completo da B1 em markdown, com link por slide | o cliente |
| Prompt | `revisar-para-prova` | revisão socrática de um bloco, com a lista de slides no texto | o usuário |
| Prompt | `exercicio-de-custo` | exercício de cálculo conferido pela tool | o usuário |

`listarTopicos` existe porque o modelo só vê as descriptions das tools. O resource `b1://conteudo` lista os mesmos 53 slides, e só entra no contexto quando o cliente anexa. Sem a tool, o prompt de revisão pedia um tópico livre e o modelo inventava o mapa da prova.

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

## De onde vem o conteúdo

O `gerar-indice.ts` lê os `slides.md` do repositório da turma e grava `dados/conteudo-b1.json` com um item por slide: título, bloco, trecho de até 220 caracteres, termos de busca e a URL com a âncora de linha.

```
node gerar-indice.ts ../2026-tecnologias-emergentes-esoft8s-b
```

O índice guarda um trecho curto, não o slide inteiro. A resposta manda o aluno para o `slides.md` da turma, que é a fonte. Rode o gerador de novo sempre que os slides da turma mudarem, porque as âncoras de linha se deslocam.

O URI `b1://conteudo` é o nome do recurso no protocolo. O JSON é lido no boot por `readFile`. O segundo parâmetro de `registerResource` é esse identificador, e o arquivo fica no `readFile` da inicialização.

Os quatro blocos indexados são `prompt`, `padroes`, `agentes` e `riscos`, com 53 slides ao todo. Os slides administrativos de abertura do semestre ficam de fora, pelo corte de `linhaMinima` em `gerar-indice.ts`.

`consultarConceito` cobre nove lookups fechados, com uma frase e o link. Fica de fora classificar enunciado aberto (qual padrão "cabe" numa história) e devolver o código do slide.

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

## Em container

```
docker build -t mcp-revisao-b1:1.0.0 .
docker run -i --rm mcp-revisao-b1:1.0.0
```

O `Dockerfile` traz o label `io.docker.server.metadata`, exigido pelo gateway do Docker MCP Toolkit para aceitar a referência `docker://`. O servidor precisa de saída para `raw.githubusercontent.com` na porta 443, senão só as tools de conteúdo funcionam.

## Limitações

- O catálogo de preços é de terceiros. Ele acompanha as tabelas oficiais, e o valor exibido deve ser conferido contra a página do provedor antes de virar decisão de orçamento.
- Preço por faixa de contexto, cache de prompt e lote não entram na conta. A tool cobra entrada e saída na tarifa cheia.
- As âncoras de linha quebram quando os slides da turma mudam sem o índice ser regerado.
- O servidor não grava nada. Não há registro de progresso de estudo.
- O teste em cliente real ficou no stdio. O uso no Claude Desktop ainda não foi feito para este servidor.
- MCP, backoff exponencial e os quatro modos de permissão do CLI ainda não estão nos `slides.md` da turma B. Entram no índice quando a aula for copiada para o GitHub da turma.

A condução em sala está no `apresentacao.md` da disciplina, na Aula 05.
