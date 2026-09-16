import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
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

// Catálogo de preços por token, mantido pelo projeto LiteLLM e servido como JSON bruto.
// Consultado a cada execução porque os preços dos provedores mudam sem aviso.
const PRECOS_URL = process.env.PRECOS_URL
  ?? 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const PRECOS_TTL_MS = Number(process.env.PRECOS_TTL_MIN ?? 360) * 60000
const TEMPO_LIMITE = Number(process.env.PRECOS_TIMEOUT_MS ?? 15000)
const DADOS = process.env.DADOS_DIR ?? join(import.meta.dirname, 'dados')

const conteudo = JSON.parse(await readFile(join(DADOS, 'conteudo-b1.json'), 'utf8')) as Conteudo
const idsDeBloco = conteudo.blocos.map(b => b.id) as [string, ...string[]]

const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const texto = (t: string): Resposta => ({ content: [{ type: 'text', text: t }] })
const falha = (t: string): Resposta => ({ content: [{ type: 'text', text: t }], isError: true })

// Guarda a promessa, e não só o resultado. Chamadas concorrentes chegam antes da
// primeira terminar, e sem isso cada uma baixaria a tabela de novo.
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
  console.error(`tabela de preços carregada: ${precos.size} modelos de ${PRECOS_URL}`)
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

// Tool 1: busca no índice dos slides da turma e devolve o link de cada slide.
const consultarConteudo = async (args: { termo: string, bloco?: string, limite?: number }): Promise<Resposta> => {
  const alvo = semAcento(args.termo)
  const palavras = alvo.split(/\s+/).filter(Boolean)
  const candidatos = args.bloco ? conteudo.itens.filter(i => i.bloco === args.bloco) : conteudo.itens
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
    return texto(`nenhum slide da B1 casa com "${args.termo}". Blocos disponíveis: ${idsDeBloco.join(', ')}.`)
  }
  const linhas = pontuados.map(({ item }) =>
    [`## ${item.titulo}`, `bloco: ${item.bloco} | id: ${item.id}`, item.trecho, `link: ${item.url}`].join('\n'))
  return texto([`${pontuados.length} slide(s) para "${args.termo}":`, '', ...linhas, '',
    `Fonte: ${conteudo.fonte}`].join('\n'))
}

// Tool 2: aplica a fórmula de custo do slide "Medindo o custo de uma chamada"
// com os preços baixados no momento da chamada.
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
  return texto([
    `modelo: ${args.modelo} (${preco.provedor})`,
    `preço por milhão de tokens: entrada US$ ${porMilhao(preco.entradaPorToken)}, saída US$ ${porMilhao(preco.saidaPorToken)}`,
    '',
    `entrada: ${args.tokensEntrada} tokens x ${chamadas} chamada(s) = ${dolar(custoEntrada)}`,
    `saída: ${args.tokensSaida} tokens x ${chamadas} chamada(s) = ${dolar(custoSaida)}`,
    `total: ${dolar(custoEntrada + custoSaida)}`,
    '',
    `preços consultados em ${tabela.consultadoEm} a partir de ${PRECOS_URL}`
  ].join('\n'))
}

// Tool 3: descobre os ids aceitos pela tool de custo.
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
  const linhas = achados.map(([id, p]) =>
    `${id} | ${p.provedor} | entrada US$ ${porMilhao(p.entradaPorToken)}/Mtok | saída US$ ${porMilhao(p.saidaPorToken)}/Mtok`)
  return texto([`${achados.length} de ${tabela.precos.size} modelos para "${args.filtro}":`, '', ...linhas].join('\n'))
}

// Resource: o cliente carrega o índice inteiro no contexto quando o aluno quer o mapa da prova.
const lerConteudo = async (uri: URL) => {
  const secoes = conteudo.blocos.map(bloco => {
    const itens = conteudo.itens.filter(i => i.bloco === bloco.id)
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

// Prompt 1: revisão de um tópico, usando a tool de busca e os links da turma.
const revisarParaProva = ({ topico }: { topico: string }) => ({
  messages: [{
    role: 'user' as const,
    content: {
      type: 'text' as const,
      text: [
        `Quero revisar "${topico}" para a avaliação B1 de Tecnologias Emergentes.`,
        'Chame a tool consultarConteudo com esse termo e use só os slides que ela devolver.',
        'Para cada slide, faça uma pergunta por vez e espere minha resposta antes de comentar.',
        'Depois da minha resposta, compare com o trecho do slide e cite o link para eu conferir.',
        'Se eu perguntar algo que não aparece nos slides devolvidos, diga que o tema está fora do material da B1.'
      ].join('\n')
    }
  }]
})

// Prompt 2: exercício de cálculo de custo, conferido pela tool.
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

const servidor = new McpServer({ name: 'mcp-revisao-b1', version: '1.0.0' })

servidor.registerTool('consultarConteudo', {
  description: 'Busca um termo nos slides da avaliação B1 e devolve título, trecho e o link do slides.md da turma.',
  inputSchema: {
    termo: z.string().min(2).describe('Palavra ou expressão, ex. prompt injection'),
    bloco: z.enum(idsDeBloco).optional().describe(`Restringe a um bloco: ${idsDeBloco.join(', ')}`),
    limite: z.number().int().min(1).max(10).optional().describe('Máximo de slides, padrão 5')
  },
  annotations: { readOnlyHint: true, openWorldHint: false }
}, consultarConteudo)

servidor.registerTool('custoDaChamada', {
  description: 'Calcula o custo de uma chamada de LLM a partir da contagem de tokens, com os preços consultados na hora.',
  inputSchema: {
    modelo: z.string().min(2).describe('Id do modelo, ex. claude-opus-5, gemini-2.5-pro'),
    tokensEntrada: z.number().int().min(0).describe('Tokens de entrada, o promptTokenCount da resposta da API'),
    tokensSaida: z.number().int().min(0).describe('Tokens de saída, o candidatesTokenCount da resposta da API'),
    chamadas: z.number().int().min(1).optional().describe('Número de chamadas iguais, padrão 1')
  },
  annotations: { readOnlyHint: true, openWorldHint: true }
}, custoDaChamada)

servidor.registerTool('listarModelos', {
  description: 'Lista os ids de modelo aceitos por custoDaChamada, filtrando por parte do nome ou pelo provedor.',
  inputSchema: {
    filtro: z.string().min(2).describe('Parte do id ou do provedor, ex. claude, gemini, openai'),
    limite: z.number().int().min(1).max(50).optional().describe('Máximo de ids, padrão 20')
  },
  annotations: { readOnlyHint: true, openWorldHint: true }
}, listarModelos)

servidor.registerResource('conteudo-b1', 'b1://conteudo', {
  title: 'Conteúdo da avaliação B1',
  description: 'Índice dos slides cobrados na B1, com link para o slides.md de cada aula da turma',
  mimeType: 'text/markdown'
}, lerConteudo)

servidor.registerPrompt('revisar-para-prova', {
  title: 'Revisar um tópico da B1',
  description: 'Revisão socrática de um tópico, com os links dos slides da turma',
  argsSchema: { topico: z.string().min(3).describe('Tópico da B1, ex. tool calling') }
}, revisarParaProva)

servidor.registerPrompt('exercicio-de-custo', {
  title: 'Exercício de custo de chamada',
  description: 'Gera um exercício de cálculo de custo e confere o resultado com a tool',
  argsSchema: { modelo: z.string().min(2).describe('Id do modelo, ex. claude-sonnet-5') }
}, exercicioDeCusto)

// O log vai para stderr porque stdout carrega as mensagens JSON-RPC.
console.error(`mcp-revisao-b1 no ar, ${conteudo.itens.length} slides indexados, aguardando no stdio`)

await servidor.connect(new StdioServerTransport())
