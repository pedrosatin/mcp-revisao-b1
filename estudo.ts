export type SlideEstudo = {
  id: string
  titulo: string
  bloco: string
  aula: string
  linha: number
  url: string
  trecho: string
}

export type BlocoEstudo = { id: string, titulo: string, aula: string, url: string }

const FUSO = 'America/Sao_Paulo'

export const dataProva = (): string => {
  const env = typeof process !== 'undefined' ? process.env.DATA_PROVA : undefined
  return env && env.length > 0 ? env : '2026-09-24'
}

export const hoje = (): string => {
  const env = typeof process !== 'undefined' ? process.env.DATA_HOJE : undefined
  if (env && env.length > 0) return env
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())
}

export const somarDias = (data: string, dias: number): string => {
  const d = new Date(`${data}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export const diasEntre = (de: string, ate: string): number =>
  Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000)

const arquivoDe = (s: SlideEstudo): string => `${s.aula}/slides.md#L${s.linha}`

const fichaDe = (s: SlideEstudo, extra: string[] = []): string => [
  `## ${s.titulo}`,
  `id: ${s.id} | bloco: ${s.bloco}`,
  `arquivo: ${arquivoDe(s)}`,
  ...extra,
  s.trecho.length > 0 ? s.trecho : '(slide de capa ou de referências, sem trecho indexado)',
  `link: ${s.url}`
].join('\n')

export const textoSorteio = (
  itens: SlideEstudo[],
  args: { bloco?: string, evitar?: string[] }
): string => {
  const pool = args.bloco ? itens.filter(i => i.bloco === args.bloco) : itens
  if (pool.length === 0) {
    return `nenhum slide no bloco ${args.bloco ?? '(todos)'}. Consulte listarTopicos.`
  }
  const evitar = new Set(args.evitar ?? [])
  const restantes = pool.filter(i => !evitar.has(i.id))
  const candidatos = restantes.length > 0 ? restantes : pool
  const escolhido = candidatos[Math.floor(Math.random() * candidatos.length)]
  return fichaDe(escolhido, [
    `sorteio: ${candidatos.length} de ${pool.length} neste recorte`
  ])
}

export const textoPlano = (
  itens: SlideEstudo[],
  blocos: BlocoEstudo[],
  args: { bloco?: string }
): string => {
  const prova = dataProva()
  const dia = hoje()
  const recorte = args.bloco ? itens.filter(i => i.bloco === args.bloco) : itens
  if (recorte.length === 0) {
    return `nenhum slide no bloco ${args.bloco}. Consulte listarTopicos.`
  }
  const titulo = args.bloco
    ? (blocos.find(b => b.id === args.bloco)?.titulo ?? args.bloco)
    : 'os 5 blocos'
  const restantes = diasEntre(dia, prova)
  const cabeca = [
    `# Plano até a avaliação B1`,
    `prova: ${prova}`,
    `hoje: ${dia}`,
    `recorte: ${titulo} (${recorte.length} slides)`
  ]
  if (restantes <= 0) {
    return [
      ...cabeca,
      'não restam dias de estudo antes da prova. Lista para revisar hoje:',
      '',
      ...recorte.map(s => `- ${s.id} | ${s.titulo} | ${arquivoDe(s)}`)
    ].join('\n')
  }
  const dias = Array.from({ length: restantes }, (_, i) => somarDias(dia, i))
  const porDia = Math.ceil(recorte.length / dias.length)
  const secoes = dias.map((d, i) => {
    const fatia = recorte.slice(i * porDia, (i + 1) * porDia)
    if (fatia.length === 0) return ''
    return [`## ${d} (${fatia.length} slide(s))`, ...fatia.map(s => `- ${s.id} | ${s.titulo}`)].join('\n')
  }).filter(s => s.length > 0)
  return [
    ...cabeca,
    `dias até a prova: ${restantes}`,
    `${porDia} slide(s) por dia, na ordem do índice.`,
    '',
    ...secoes
  ].join('\n')
}

export const markdownDoBloco = (bloco: BlocoEstudo, itens: SlideEstudo[]): string => {
  const slides = itens.filter(i => i.bloco === bloco.id)
  return [
    `# ${bloco.titulo}`,
    `pasta: ${bloco.aula}/slides.md`,
    `aula: ${bloco.url}`,
    '',
    ...slides.map(s => `- [${s.titulo}](${s.url})`)
  ].join('\n')
}

export const promptPlano = (bloco: BlocoEstudo, itens: SlideEstudo[]): string => {
  const lista = itens.filter(i => i.bloco === bloco.id).map(s => `- ${s.id} | ${s.titulo}`).join('\n')
  return [
    `Quero um plano de estudo do bloco "${bloco.titulo}" (${bloco.id}) até a avaliação B1 em ${dataProva()}.`,
    `Este bloco tem estes slides, cada um no arquivo ${bloco.aula}/slides.md:`,
    lista,
    '',
    'Use as tools do servidor mcp-revisao-b1:',
    `1. Chame planoAteProva com bloco "${bloco.id}" e mostre a agenda.`,
    '2. No primeiro dia da agenda, chame obterSlide no primeiro id e faça uma pergunta sobre o trecho.',
    '3. Uma pergunta por vez. Não invente slide que não está na lista.'
  ].join('\n')
}

export const promptExemplo = (slide: SlideEstudo): string => [
  `Explique o conteúdo do slide ${slide.id} ("${slide.titulo}") da disciplina de Tecnologias Emergentes.`,
  `O arquivo da aula é ${arquivoDe(slide)}.`,
  'Comece pelo mecanismo, em até dois parágrafos, com o vocabulário do trecho.',
  'Mostre um exemplo em TypeScript funcional, sem classes, sem ponto e vírgula, no máximo 12 linhas.',
  'Termine com uma pergunta sobre o exemplo.',
  '',
  'Trecho indexado:',
  '',
  slide.trecho.length > 0 ? slide.trecho : '(sem trecho indexado)'
].join('\n')
