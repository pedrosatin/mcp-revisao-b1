# Servidor MCP de revisão da B1 (mcp-revisao-b1)

Servidor MCP em TypeScript com o SDK oficial (`@modelcontextprotocol/sdk` 1.30) e schemas em `zod` 4, para estudar a avaliação B1 da disciplina de Tecnologias Emergentes (ESOFT8, UniCesumar).

Ele registra os três primitivos do protocolo: três tools, um resource e dois prompts. As consultas de conteúdo devolvem o link do `slides.md` da turma, e o cálculo de custo usa preços consultados no momento da chamada.

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
| Tool | `consultarConteudo` | busca um termo nos slides da B1 e devolve título, trecho e link | o modelo |
| Tool | `custoDaChamada` | aplica a fórmula de custo com os preços do momento | o modelo |
| Tool | `listarModelos` | lista os ids de modelo aceitos, por nome ou provedor | o modelo |
| Resource | `b1://conteudo` | índice completo da B1 em markdown, com link por slide | o cliente |
| Prompt | `revisar-para-prova` | revisão socrática de um tópico, com os links da turma | o usuário |
| Prompt | `exercicio-de-custo` | exercício de cálculo conferido pela tool | o usuário |

## De onde vêm os preços

Os preços dos provedores mudam sem aviso, então nada fica gravado no código. A cada execução o servidor busca o catálogo público `model_prices_and_context_window.json`, mantido pelo projeto LiteLLM e servido como JSON bruto pelo GitHub. É um arquivo estruturado com `input_cost_per_token` e `output_cost_per_token` por id de modelo, o que dispensa raspar página de preços em HTML.

A resposta de `custoDaChamada` sempre declara a URL consultada e o horário da consulta, para o aluno conferir contra a tabela oficial do provedor.

O arquivo tem cerca de 2,5 MB e mais de 4 mil modelos. O servidor carrega isso uma vez, guarda em memória por `PRECOS_TTL_MIN` e devolve ao contexto só as linhas do modelo pedido. O cache guarda a promessa da consulta, não o resultado, para que chamadas concorrentes não baixem o catálogo várias vezes.

Em 16/09/2026 os valores do catálogo foram conferidos contra as páginas oficiais dos três provedores e bateram nos modelos testados.

| Variável | Padrão | Para que serve |
|---|---|---|
| `PRECOS_URL` | catálogo do LiteLLM no GitHub | troca a fonte de preços |
| `PRECOS_TTL_MIN` | `360` | validade do cache em memória, em minutos |
| `PRECOS_TIMEOUT_MS` | `15000` | tempo limite da consulta |
| `DADOS_DIR` | `./dados` | pasta do `conteudo-b1.json` |

## De onde vem o conteúdo

O `gerar-indice.ts` lê os `slides.md` do repositório da turma e grava `dados/conteudo-b1.json` com um item por slide: título, bloco, trecho de até 220 caracteres, termos de busca e a URL com a âncora de linha.

```
node gerar-indice.ts ../2026-tecnologias-emergentes-esoft8s-b
```

O índice guarda um trecho curto, não o slide inteiro. A resposta manda o aluno para o `slides.md` da turma, que é a fonte. Rode o gerador de novo sempre que os slides da turma mudarem, porque as âncoras de linha se deslocam.

Os quatro blocos indexados são `prompt`, `padroes`, `agentes` e `riscos`, com 53 slides ao todo. Os slides administrativos de abertura do semestre ficam de fora, pelo corte de `linhaMinima` em `gerar-indice.ts`.

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

O `Dockerfile` traz o label `io.docker.server.metadata`, exigido pelo gateway do Docker MCP Toolkit para aceitar a referência `docker://`. O servidor precisa de saída para `raw.githubusercontent.com` na porta 443, senão só `consultarConteudo` funciona.

## Limitações

- O catálogo de preços é de terceiros. Ele acompanha as tabelas oficiais, e o valor exibido deve ser conferido contra a página do provedor antes de virar decisão de orçamento.
- Preço por faixa de contexto, cache de prompt e lote não entram na conta. A tool cobra entrada e saída na tarifa cheia.
- As âncoras de linha quebram quando os slides da turma mudam sem o índice ser regerado.
- O servidor não grava nada. Não há registro de progresso de estudo.
- O teste em cliente real ficou no stdio. O uso no Claude Desktop ainda não foi feito para este servidor.

A condução em sala está no `apresentacao.md` da disciplina, na Aula 05.
