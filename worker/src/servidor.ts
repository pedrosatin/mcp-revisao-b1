import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import conteudoBruto from '../../dados/conteudo-b1.json'
import precosBruto from '../../dados/precos-compactos.json'

type Item = {
  id: string
  titulo: string
  bloco: string
  aula: string
  linha: number
  url: string
  trecho: string
  termos: string[]
}
type Bloco = { id: string, titulo: string, aula: string, url: string }
type Conteudo = { fonte: string, geradoEm: string, blocos: Bloco[], itens: Item[] }
type Preco = { entradaPorToken: number, saidaPorToken: number, provedor: string, janela?: number }
type Resposta = { content: { type: 'text', text: string }[], isError?: boolean }
type Conceito = { slideId: string, texto: string }
type LinhaPreco = [string, string, number, number] | [string, string, number, number, number]
type Catalogo = { fonte: string, geradoEm: string, modelos: LinhaPreco[] }

const conteudo = conteudoBruto as Conteudo
const catalogo = precosBruto as Catalogo
const idsDeBloco = conteudo.blocos.map(b => b.id) as [string, ...string[]]
const itemPorId = new Map(conteudo.itens.map(i => [i.id, i]))
const precos = new Map<string, Preco>()
for (const linha of catalogo.modelos) {
  const [id, provedor, entradaPorToken, saidaPorToken, janela] = linha
  precos.set(id, { provedor, entradaPorToken, saidaPorToken, janela })
}

const semAcento = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const texto = (t: string): Resposta => ({ content: [{ type: 'text', text: t }] })
const falha = (t: string): Resposta => ({ content: [{ type: 'text', text: t }], isError: true })

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
  const preco = precos.get(args.modelo)
  if (!preco) {
    return texto(`modelo "${args.modelo}" não está na tabela de ${precos.size} modelos. Use listarModelos para ver os ids aceitos.`)
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
    `preços do bundle do Worker, gerados em ${catalogo.geradoEm} a partir de ${catalogo.fonte}`,
    'para atualizar, rode node gerar-precos.ts e faça wrangler deploy de novo'
  ].join('\n'))
}

const listarModelos = async (args: { filtro: string, limite?: number }): Promise<Resposta> => {
  const alvo = semAcento(args.filtro)
  const achados = [...precos.entries()]
    .filter(([id, p]) => semAcento(id).includes(alvo) || semAcento(p.provedor).includes(alvo))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, args.limite ?? 20)
  if (achados.length === 0) return texto(`nenhum modelo casa com "${args.filtro}" entre ${precos.size} ids.`)
  const linhas = achados.map(([id, p]) => {
    const janela = p.janela ? ` | janela ${p.janela}` : ''
    return `${id} | ${p.provedor} | entrada US$ ${porMilhao(p.entradaPorToken)}/Mtok | saída US$ ${porMilhao(p.saidaPorToken)}/Mtok${janela}`
  })
  return texto([`${achados.length} de ${precos.size} modelos para "${args.filtro}":`, '', ...linhas].join('\n'))
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

export const criarServidor = (): McpServer => {
  const servidor = new McpServer({ name: 'mcp-revisao-b1', version: '1.0.0' })

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
    description: 'Calcula o custo de uma chamada de LLM a partir da contagem de tokens, com os preços do bundle do Worker, e informa a janela de contexto do modelo.',
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

  servidor.registerResource('conteudo-b1', 'b1://conteudo', {
    title: 'Conteúdo da avaliação B1',
    description: 'Índice dos slides da B1 e da aula de MCP, agrupados em prompt, padroes, agentes, riscos e mcp, com link para o slides.md de cada aula da turma',
    mimeType: 'text/markdown'
  }, lerConteudo)

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
