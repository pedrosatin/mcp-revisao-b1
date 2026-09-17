import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

type Item = {
  id: string, titulo: string, bloco: string, aula: string,
  linha: number, url: string, trecho: string, termos: string[]
}
type Bloco = { id: string, titulo: string, aula: string, url: string }
type Conteudo = { fonte: string, geradoEm: string, blocos: Bloco[], itens: Item[] }
type Preco = { entradaPorToken: number, saidaPorToken: number, provedor: string, janela?: number }
type Tabela = { precos: Map<string, Preco>, consultadoEm: string }
type Resposta = { content: { type: 'text', text: string }[], isError?: boolean }
type Conceito = { slideId: string, texto: string }

// Catálogo público do LiteLLM (~2,55 MB, ~68 mil linhas, ~4 mil ids).
// Essas linhas não entram no contexto do modelo. A tool devolve uma conta
// ou no máximo 20 ids. O GET pesa no processo, não na janela.
const PRECOS_URL = process.env.PRECOS_URL
  ?? 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
// Validade do cache em memória: 360 minutos = 6 horas. Preço de provedor
// muda no máximo algumas vezes por semana, e a aula dura cerca de 2 h.
// A env PRECOS_TTL_MIN troca o valor em minutos. PRECOS_TTL_MS é o mesmo
// intervalo em milissegundos, que é o que Date.now() compara.
const PRECOS_TTL_MIN = Number(process.env.PRECOS_TTL_MIN ?? 360)
const PRECOS_TTL_MS = PRECOS_TTL_MIN * 60_000
const TEMPO_LIMITE = Number(process.env.PRECOS_TIMEOUT_MS ?? 15000)
const DADOS = process.env.DADOS_DIR ?? join(import.meta.dirname, 'dados')

const conteudo = JSON.parse(await readFile(join(DADOS, 'conteudo-b1.json'), 'utf8')) as Conteudo
const idsDeBloco = conteudo.blocos.map(b => b.id) as [string, ...string[]]
const itemPorId = new Map(conteudo.itens.map(i => [i.id, i]))

const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const texto = (t: string): Resposta => ({ content: [{ type: 'text', text: t }] })
const falha = (t: string): Resposta => ({ content: [{ type: 'text', text: t }], isError: true })
const rotuloDoTtl = (): string =>
  PRECOS_TTL_MIN % 60 === 0 ? `${PRECOS_TTL_MIN / 60} h` : `${PRECOS_TTL_MIN} min`

// Definições curtas extraídas dos slides da turma B. A tool devolve o texto
// e o link. O aluno ainda precisa abrir o slide. Os ids apontam para o JSON.
const CONCEITOS: Record<string, Conceito> = {
  factory: {
    slideId: 'padroes-03-factory-trocar-de-provedor',
    texto: 'createLLMProvider(nome) decide qual função devolver, "gemini" ou "groq". O restante do código pede ILLMProvider e não conhece o provedor.'
  },
  strategy: {
    slideId: 'padroes-04-strategy-comportamento-em-runtime',
    texto: 'O algoritmo que muda em runtime é a função escolhida no mapa skills. executarSkill(nome, input) despacha para o handler.'
  },
  adapter: {
    slideId: 'padroes-05-adapter-padronizar-resposta-baguncada',
    texto: 'adaptResponse é função pura. Entra a string bagunçada do provedor e sai o contrato StandardAIResponse.'
  },
  observer: {
    slideId: 'padroes-06-observer-monitorar-execucao-sem-acoplar',
    texto: 'Quem quer saber o que o agente faz se inscreve com onAgentEvent. O agente emite com emitAgentEvent e não conhece os ouvintes.'
  },
  adr: {
    slideId: 'padroes-09-anatomia-de-um-adr',
    texto: 'Cinco campos. Título numerado, Status (proposto, aceito ou substituído), Contexto, Decisão, Consequências.'
  },
  'prompt-skill-regra': {
    slideId: 'agentes-06-comparativo-regras-skills-e-prompts',
    texto: 'Prompt avulso vive no histórico e ativa na digitação. Skill é arquivo acionado sob demanda por contexto. Regra é arquivo de configuração carregado na inicialização, no repositório inteiro.'
  },
  rag: {
    slideId: 'agentes-10-indexacao-de-documentos-no-rag',
    texto: 'Indexação, uma vez por documento: Documentos, Chunks, Embeddings, Banco vetorial. Consulta: Query, busca semântica, injeção no contexto, LLM.'
  },
  'ciclo-tool-calling': {
    slideId: 'agentes-13-ciclo-de-execucao-de-tool-calling',
    texto: '1. App envia prompt e schemas. 2. Modelo devolve tool_use. 3. App executa a função. 4. App devolve tool_result. 5. Modelo responde. Quem executa é o runtime, não o modelo.'
  },
  injecao: {
    slideId: 'riscos-04-vetores-de-prompt-injection',
    texto: 'Direta vem da entrada do usuário. Indireta vem de conteúdo externo no contexto: README, busca, issues, e-mail, tool_result, logs. Três camadas no Opus 5: treino, sondas de entrada, classificador de saída.'
  },
  'primitivos-mcp': {
    slideId: 'mcp-04-o-que-um-servidor-mcp-expoe',
    texto: 'Tools: operação com schema, o modelo aciona. Resources: conteúdo por URI, o cliente anexa. Prompts: instrução parametrizada, o usuário escolhe. O servidor anuncia na inicialização quais oferece.'
  },
  'ciclo-mcp': {
    slideId: 'mcp-06-ciclo-de-uma-chamada-por-mcp',
    texto: 'initialize, tools/list, schemas no prompt, tool_use, tools/call, content, tool_result. O modelo segue o ciclo de Tool Calling. A execução atravessa o transporte até o servidor.'
  },
  'transporte-mcp': {
    slideId: 'mcp-07-transporte-e-log-do-servidor',
    texto: 'stdio para subprocesso local. Streamable HTTP para remoto, um endpoint. O envelope JSON-RPC é o mesmo. Log em stderr, porque stdout carrega o protocolo.'
  },
  'integracoes-mcp': {
    slideId: 'mcp-03-integracoes-com-o-protocolo-mcp',
    texto: 'Cada cliente e cada servidor implementam a spec uma vez. Três clientes e duas fontes somam cinco implementações (M+N). Sem MCP, cada par vira um conector (M vezes N).'
  }
}
const idsDeConceito = Object.keys(CONCEITOS) as [string, ...string[]]

// Cache lazy. O handshake initialize do MCP precisa responder na hora.
// Baixar 2,55 MB no connect() atrasaria o stdio e, com firewall, faria
// consultarConteudo esperar 15 s por uma tabela que ele não usa.
// O gateway do Docker que recria o processo a cada call pagaria o GET
// em todo spawn. Inspector e `docker run -i` mantêm o processo aberto,
// então um GET cobre as 6 horas do TTL.
//
// Guarda a PROMESSA, não só o Map. Duas tools concorrentes chegam antes
// da primeira terminar, e sem isso cada uma baixaria o catálogo de novo.
let cache: Promise<Tabela> | undefined
let expiraEm = 0

const buscar = async (): Promise<Tabela> => {
  const resposta = await fetch(PRECOS_URL, { signal: AbortSignal.timeout(TEMPO_LIMITE) })
  if (!resposta.ok) throw new Error(`${PRECOS_URL} respondeu ${resposta.status}`)
  const bruto = await resposta.json() as Record<string, Record<string, unknown>>
  const precos = new Map<string, Preco>()
  for (const [id, dados] of Object.entries(bruto)) {
    const entrada = dados.input_cost_per_token
    const saida = dados.output_cost_per_token
    if (typeof entrada !== 'number' || typeof saida !== 'number') continue
    precos.set(id, {
      entradaPorToken: entrada,
      saidaPorToken: saida,
      provedor: String(dados.litellm_provider ?? 'desconhecido'),
      janela: typeof dados.max_input_tokens === 'number' ? dados.max_input_tokens : undefined
    })
  }
  console.error(`tabela de preços carregada: ${precos.size} modelos, cache válido por ${PRECOS_TTL_MIN} min (${rotuloDoTtl()}), fonte ${PRECOS_URL}`)
  return { precos, consultadoEm: new Date().toISOString() }
}

const baixarPrecos = (): Promise<Tabela> => {
  if (cache && Date.now() < expiraEm) return cache
  expiraEm = Date.now() + PRECOS_TTL_MS
  cache = buscar().catch(erro => {
    cache = undefined
    expiraEm = 0
    throw erro
  })
  return cache
}

const porMilhao = (v: number): number => Number((v * 1_000_000).toFixed(4))
const dolar = (v: number): string => `US$ ${v.toFixed(6)}`

const idDeSlide = z.string().min(3)
  .refine(id => itemPorId.has(id), { message: 'slideId inexistente, consulte listarTopicos' })

const slidesDoBloco = (bloco: string): Item[] => conteudo.itens.filter(i => i.bloco === bloco)

const listarTopicos = async (args: { bloco?: string }): Promise<Resposta> => {
  const blocos = args.bloco ? conteudo.blocos.filter(b => b.id === args.bloco) : conteudo.blocos
  const secoes = blocos.map(b => {
    const itens = slidesDoBloco(b.id)
    return [
      `## ${b.titulo} (${b.id}, ${itens.length} slides)`,
      `aula: ${b.url}`,
      ...itens.map(i => `- ${i.id} | ${i.titulo}`)
    ].join('\n')
  })
  return texto([
    `Conteúdo da avaliação B1, ${conteudo.itens.length} slides em ${conteudo.blocos.length} blocos.`,
    `Fonte: ${conteudo.fonte}. Índice gerado em ${conteudo.geradoEm}.`,
    'Use o id com obterSlide. O resource b1://conteudo traz a mesma lista com links, quando o cliente anexa.',
    '',
    ...secoes
  ].join('\n\n'))
}

const consultarConteudo = async (args: { termo: string, bloco?: string, limite?: number }): Promise<Resposta> => {
  const alvo = semAcento(args.termo)
  const palavras = alvo.split(/\s+/).filter(Boolean)
  const candidatos = args.bloco ? slidesDoBloco(args.bloco) : conteudo.itens
  const pontuados = candidatos
    .map(item => {
      const campo = semAcento(`${item.titulo} ${item.trecho}`)
      const noTitulo = semAcento(item.titulo).includes(alvo) ? 10 : 0
      const acertos = palavras.filter(p => campo.includes(p) || item.termos.includes(p)).length
      return { item, peso: noTitulo + acertos }
    })
    .filter(p => p.peso > 0)
    .sort((a, b) => b.peso - a.peso)
    .slice(0, args.limite ?? 5)

  if (pontuados.length === 0) {
    return texto(`nenhum slide da B1 casa com "${args.termo}". Blocos: ${idsDeBloco.join(', ')}. Chame listarTopicos para ver os títulos.`)
  }
  const linhas = pontuados.map(({ item }) =>
    [`## ${item.titulo}`, `bloco: ${item.bloco} | id: ${item.id}`, item.trecho, `link: ${item.url}`].join('\n'))
  return texto([`${pontuados.length} slide(s) para "${args.termo}":`, '', ...linhas, '',
    `Fonte: ${conteudo.fonte}`].join('\n'))
}

const obterSlide = async (args: { slideId: string }): Promise<Resposta> => {
  const item = itemPorId.get(args.slideId)
  if (!item) {
    return falha(`slide ${args.slideId} não encontrado. Consulte listarTopicos.`)
  }
  return texto([
    `## ${item.titulo}`,
    `id: ${item.id} | bloco: ${item.bloco}`,
    item.trecho.length > 0 ? item.trecho : '(slide de capa ou de referências, sem trecho indexado)',
    `link: ${item.url}`
  ].join('\n'))
}

const consultarConceito = async (args: { conceito: string }): Promise<Resposta> => {
  const conceito = CONCEITOS[args.conceito]
  const slide = itemPorId.get(conceito.slideId)
  if (!slide) {
    return falha(`o slide ${conceito.slideId} saiu do índice. Rode gerar-indice.ts de novo.`)
  }
  return texto([
    `## ${args.conceito}`,
    conceito.texto,
    '',
    `slide: ${slide.titulo}`,
    `link: ${slide.url}`
  ].join('\n'))
}

const custoDaChamada = async (args: {
  modelo: string, tokensEntrada: number, tokensSaida: number, chamadas?: number
}): Promise<Resposta> => {
  let tabela: Tabela
  try {
    tabela = await baixarPrecos()
  } catch (erro) {
    return falha(`falha ao consultar a tabela de preços em ${PRECOS_URL}: ${(erro as Error).message}`)
  }
  const preco = tabela.precos.get(args.modelo)
  if (!preco) {
    return texto(`modelo "${args.modelo}" não está na tabela de ${tabela.precos.size} modelos. Use listarModelos para ver os ids aceitos.`)
  }
  const chamadas = args.chamadas ?? 1
  const custoEntrada = args.tokensEntrada * preco.entradaPorToken * chamadas
  const custoSaida = args.tokensSaida * preco.saidaPorToken * chamadas
  const tokensDaChamada = args.tokensEntrada + args.tokensSaida
  const janela = preco.janela
    ? `janela de contexto: ${preco.janela} tokens (ocupação desta chamada: ${tokensDaChamada})`
    : 'janela de contexto: o catálogo não informa max_input_tokens para este id'
  return texto([
    `modelo: ${args.modelo} (${preco.provedor})`,
    `preço por milhão de tokens: entrada US$ ${porMilhao(preco.entradaPorToken)}, saída US$ ${porMilhao(preco.saidaPorToken)}`,
    janela,
    '',
    `entrada: ${args.tokensEntrada} tokens x ${chamadas} chamada(s) = ${dolar(custoEntrada)}`,
    `saída: ${args.tokensSaida} tokens x ${chamadas} chamada(s) = ${dolar(custoSaida)}`,
    `total: ${dolar(custoEntrada + custoSaida)}`,
    '',
    `preços consultados em ${tabela.consultadoEm} a partir de ${PRECOS_URL}`,
    `cache em memória válido por ${PRECOS_TTL_MIN} min (${rotuloDoTtl()}) neste processo`
  ].join('\n'))
}

const listarModelos = async (args: { filtro: string, limite?: number }): Promise<Resposta> => {
  let tabela: Tabela
  try {
    tabela = await baixarPrecos()
  } catch (erro) {
    return falha(`falha ao consultar a tabela de preços em ${PRECOS_URL}: ${(erro as Error).message}`)
  }
  const alvo = semAcento(args.filtro)
  const achados = [...tabela.precos.entries()]
    .filter(([id, p]) => semAcento(id).includes(alvo) || semAcento(p.provedor).includes(alvo))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, args.limite ?? 20)
  if (achados.length === 0) return texto(`nenhum modelo casa com "${args.filtro}" entre ${tabela.precos.size} ids.`)
  const linhas = achados.map(([id, p]) => {
    const janela = p.janela ? ` | janela ${p.janela}` : ''
    return `${id} | ${p.provedor} | entrada US$ ${porMilhao(p.entradaPorToken)}/Mtok | saída US$ ${porMilhao(p.saidaPorToken)}/Mtok${janela}`
  })
  return texto([`${achados.length} de ${tabela.precos.size} modelos para "${args.filtro}":`, '', ...linhas].join('\n'))
}

const lerConteudo = async (uri: URL) => {
  const secoes = conteudo.blocos.map(bloco => {
    const itens = slidesDoBloco(bloco.id)
    return [`## ${bloco.titulo} (${itens.length} slides)`, `Aula: ${bloco.url}`, '',
      ...itens.map(i => `- [${i.titulo}](${i.url})`)].join('\n')
  })
  return {
    contents: [{
      uri: uri.href,
      mimeType: 'text/markdown',
      text: [`# Conteúdo da avaliação B1`, '',
        `Índice gerado em ${conteudo.geradoEm} a partir de ${conteudo.fonte}.`, '',
        ...secoes].join('\n\n')
    }]
  }
}

const revisarParaProva = ({ bloco }: { bloco: string }) => {
  const b = conteudo.blocos.find(x => x.id === bloco) as Bloco
  const itens = slidesDoBloco(bloco)
  const lista = itens.map(i => `- ${i.id} | ${i.titulo}`).join('\n')
  return {
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: [
          `Quero revisar o bloco "${b.titulo}" (${b.id}) para a avaliação B1 de Tecnologias Emergentes.`,
          `Este bloco tem ${itens.length} slides:`,
          lista,
          '',
          'Conduza a revisão com as tools do servidor mcp-revisao-b1:',
          '1. Chame obterSlide com o id de um slide da lista, ou consultarConteudo com um termo.',
          '2. Faça uma pergunta por vez e espere minha resposta antes de comentar.',
          '3. Depois da minha resposta, compare com o trecho e cite o link para eu conferir.',
          '4. Se eu perguntar algo que não aparece nos slides deste bloco, diga que o tema está fora do material da B1.',
          'Use só o conteúdo devolvido pelas tools. Não invente slide que não está na lista.'
        ].join('\n')
      }
    }]
  }
}

const exercicioDeCusto = ({ modelo }: { modelo: string }) => ({
  messages: [{
    role: 'user' as const,
    content: {
      type: 'text' as const,
      text: [
        `Monte um exercício de cálculo de custo de chamada usando o modelo ${modelo}.`,
        'Invente um cenário com número de tokens de entrada, de saída e de chamadas por dia.',
        'Peça que eu calcule antes de conferir. Só depois da minha resposta, chame a tool custoDaChamada com os mesmos números.',
        'Compare o meu resultado com o da tool e mostre onde a conta divergiu.',
        'A fórmula é a do slide "Medindo o custo de uma chamada": entrada vezes preço de entrada, mais saída vezes preço de saída.'
      ].join('\n')
    }
  }]
})

const criarServidor = (): McpServer => {
const servidor = new McpServer({ name: 'mcp-revisao-b1', version: '1.0.0' })

// Tool. O modelo decide quando chamar. A description entra no tools/list
// de toda conversa, então o mapa da B1 precisa aparecer aqui, não só no
// resource. Resource só entra no contexto se o cliente anexar.

servidor.registerTool('listarTopicos', {
  description: 'Lista os 5 blocos (prompt, padroes, agentes, riscos, mcp) e o título de cada slide, com o id para obterSlide. Chame antes de revisar.',
  inputSchema: { bloco: z.enum(idsDeBloco).optional().describe(`Restringe a um bloco: ${idsDeBloco.join(', ')}`) },
  annotations: { readOnlyHint: true, openWorldHint: false }
}, listarTopicos)

servidor.registerTool('consultarConteudo', {
  description: 'Busca um termo nos slides da avaliação B1 e devolve título, trecho e o link do slides.md da turma. Chame listarTopicos se ainda não souber os blocos.',
  inputSchema: {
    termo: z.string().min(2).describe('Palavra ou expressão, ex. prompt injection'),
    bloco: z.enum(idsDeBloco).optional().describe(`Restringe a um bloco: ${idsDeBloco.join(', ')}`),
    limite: z.number().int().min(1).max(10).optional().describe('Máximo de slides, padrão 5')
  },
  annotations: { readOnlyHint: true, openWorldHint: false }
}, consultarConteudo)

servidor.registerTool('obterSlide', {
  description: 'Devolve o trecho indexado e o link de um slide da B1, pelo id de listarTopicos.',
  inputSchema: { slideId: idDeSlide.describe('Id de listarTopicos, ex. padroes-03-factory-trocar-de-provedor') },
  annotations: { readOnlyHint: true, openWorldHint: false }
}, obterSlide)

servidor.registerTool('consultarConceito', {
  description: 'Devolve a definição curta gravada no slide, com o link. Conceitos fechados: Factory, Strategy, Adapter, Observer, ADR, regras/skills, RAG, ciclo de tool calling, injeção, primitivos MCP, ciclo MCP, transporte e M+N.',
  inputSchema: { conceito: z.enum(idsDeConceito).describe(`Um de: ${idsDeConceito.join(', ')}`) },
  annotations: { readOnlyHint: true, openWorldHint: false }
}, consultarConceito)

servidor.registerTool('custoDaChamada', {
  description: 'Calcula o custo de uma chamada de LLM a partir da contagem de tokens, com os preços consultados na hora, e informa a janela de contexto do modelo.',
  inputSchema: {
    modelo: z.string().min(2).describe('Id do modelo, ex. claude-opus-5, gemini-2.5-pro'),
    tokensEntrada: z.number().int().min(0).describe('Tokens de entrada, o promptTokenCount da resposta da API'),
    tokensSaida: z.number().int().min(0).describe('Tokens de saída, o candidatesTokenCount da resposta da API'),
    chamadas: z.number().int().min(1).optional().describe('Número de chamadas iguais, padrão 1')
  },
  annotations: { readOnlyHint: true, openWorldHint: true }
}, custoDaChamada)

servidor.registerTool('listarModelos', {
  description: 'Lista os ids de modelo aceitos por custoDaChamada, filtrando por parte do nome ou pelo provedor. Inclui preço por milhão e janela de contexto.',
  inputSchema: {
    filtro: z.string().min(2).describe('Parte do id ou do provedor, ex. claude, gemini, openai'),
    limite: z.number().int().min(1).max(50).optional().describe('Máximo de ids, padrão 20')
  },
  annotations: { readOnlyHint: true, openWorldHint: true }
}, listarModelos)

// registerResource(nome, uri, metadados, callback)
//
// 1. 'conteudo-b1' é o Resource.name. Sai em resources/list. É o id que o
//    cliente mostra no menu. O mapa interno do SDK indexa pelo URI.
//
// 2. 'b1://conteudo' é o Resource.uri, um identificador RFC 3986 com
//    esquema próprio. A spec deixa o servidor interpretar o URI. O arquivo
//    dados/conteudo-b1.json é lido na inicialização por readFile, fora
//    deste registro. O cliente trata b1:// como nome do recurso no
//    protocolo, sem abrir o identificador no navegador.
//
// 3. Quem resolve: o servidor MCP, no handler de resources/read. O SDK
//    faz new URL(params.uri), encontra o registro e chama lerConteudo.
//    O esquema b1 fica entre o cliente MCP e este processo.
//
// 4. String = URI fixo, entra em resources/list. ResourceTemplate com
//    {placeholders} iria para resources/templates/list. O índice é um
//    documento só, então URI fixo basta.
//
// 5. O terceiro parâmetro (title, description, mimeType) vai para
//    resources/list. O quarto é o handler de resources/read. O handler
//    recebe a URL do pedido e devolve contents[].uri igual ao que o
//    cliente pediu.
//
// Resource é acionado pelo cliente (menu, anexo). Tool é acionada pelo
// modelo. Prompt é escolhido pelo usuário.

servidor.registerResource('conteudo-b1', 'b1://conteudo', {
  title: 'Conteúdo da avaliação B1',
  description: 'Índice dos slides da B1 e da aula de MCP, agrupados em prompt, padroes, agentes, riscos e mcp, com link para o slides.md de cada aula da turma',
  mimeType: 'text/markdown'
}, lerConteudo)

// Prompt. O usuário escolhe no menu do cliente. O argumento virou enum
// dos 4 blocos para o texto já nascer com a lista de slides, em vez de
// um tópico livre que o modelo precisaria adivinhar.

servidor.registerPrompt('revisar-para-prova', {
  title: 'Revisar um bloco da B1',
  description: 'Revisão socrática de um bloco da B1. O texto já lista os slides daquele bloco.',
  argsSchema: { bloco: z.enum(idsDeBloco).describe(`Id do bloco: ${idsDeBloco.join(', ')}`) }
}, revisarParaProva)

servidor.registerPrompt('exercicio-de-custo', {
  title: 'Exercício de custo de chamada',
  description: 'Gera um exercício de cálculo de custo e confere o resultado com a tool',
  argsSchema: { modelo: z.string().min(2).describe('Id do modelo, ex. claude-sonnet-5') }
}, exercicioDeCusto)

return servidor
}

const servirStdio = async (): Promise<void> => {
  const servidor = criarServidor()
  // O log vai para stderr porque stdout carrega as mensagens JSON-RPC.
  console.error(`mcp-revisao-b1 no ar, ${conteudo.itens.length} slides indexados, aguardando no stdio`)
  await servidor.connect(new StdioServerTransport())
}

const servirHttp = async (): Promise<void> => {
  const host = process.env.MCP_HOST ?? '127.0.0.1'
  const porta = Number(process.env.MCP_PORT ?? 3333)
  const app = createMcpExpressApp({ host })
  const sessoes = new Map<string, StreamableHTTPServerTransport | SSEServerTransport>()

  // Streamable HTTP (spec 2025-03-26 em diante). Um único endpoint.
  app.all('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id']
    const sid = typeof sessionId === 'string' ? sessionId : undefined
    try {
      let transporte: StreamableHTTPServerTransport
      const existente = sid ? sessoes.get(sid) : undefined
      if (existente instanceof StreamableHTTPServerTransport) {
        transporte = existente
      } else if (!sid && req.method === 'POST' && isInitializeRequest(req.body)) {
        transporte = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: id => {
            sessoes.set(id, transporte)
          }
        })
        transporte.onclose = () => {
          const id = transporte.sessionId
          if (id) sessoes.delete(id)
        }
        await criarServidor().connect(transporte)
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'sessão HTTP inválida. POST initialize em /mcp sem mcp-session-id.' },
          id: null
        })
        return
      }
      await transporte.handleRequest(req, res, req.body)
    } catch (erro) {
      console.error('falha no transporte HTTP', erro)
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'erro interno no transporte HTTP' },
          id: null
        })
      }
    }
  })

  // HTTP+SSE da spec 2024-11-05. Clientes antigos ainda usam. Preferir /mcp.
  app.get('/sse', async (_req, res) => {
    const transporte = new SSEServerTransport('/messages', res)
    sessoes.set(transporte.sessionId, transporte)
    res.on('close', () => sessoes.delete(transporte.sessionId))
    await criarServidor().connect(transporte)
  })

  app.post('/messages', async (req, res) => {
    const sid = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined
    const transporte = sid ? sessoes.get(sid) : undefined
    if (!(transporte instanceof SSEServerTransport)) {
      res.status(400).send('sessionId SSE ausente ou inválido')
      return
    }
    await transporte.handlePostMessage(req, res, req.body)
  })

  const web = join(import.meta.dirname, 'web')
  app.get('/', (_req, res) => res.sendFile(join(web, 'index.html')))
  app.get('/app.css', (_req, res) => res.sendFile(join(web, 'app.css')))
  app.get('/app.js', (_req, res) => res.sendFile(join(web, 'app.js')))
  app.get('/favicon.ico', (_req, res) => res.status(204).end())

  await new Promise<void>((resolve, reject) => {
    const http = app.listen(porta, host, () => resolve())
    http.on('error', reject)
  })
  console.error(`mcp-revisao-b1 no ar, ${conteudo.itens.length} slides, HTTP em http://${host}:${porta}/mcp`)
  console.error(`página cliente em http://${host}:${porta}/`)
  console.error(`SSE legado (spec 2024-11-05) em GET http://${host}:${porta}/sse e POST /messages`)
}

const modoHttp = process.argv.includes('--http') || process.env.MCP_TRANSPORTE === 'http'
if (modoHttp) await servirHttp()
else await servirStdio()
