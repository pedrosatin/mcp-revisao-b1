// Lê os slides.md do repositório da turma e grava dados/conteudo-b1.json com um item por slide.
// Uso: node gerar-indice.ts ~/Work/unicesumar/2026-tecnologias-emergentes-esoft8s-b

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type Aula = { pasta: string, bloco: string, titulo: string, linhaMinima: number }
type Item = {
  id: string, titulo: string, bloco: string, aula: string,
  linha: number, url: string, trecho: string, termos: string[]
}

const REPO = 'https://github.com/TI-UNICESUMAR/2026-tecnologias-emergentes-esoft8s-b'

// linhaMinima corta os slides administrativos de abertura, que não entram na avaliação.
const AULAS: Aula[] = [
  { pasta: '2026-08-05-apresentacao-eng-prompt-contexto', bloco: 'prompt', titulo: 'Prompt e contexto', linhaMinima: 190 },
  { pasta: '2026-08-12-padroes-adr-trabalho', bloco: 'padroes', titulo: 'Padrões de projeto e ADR', linhaMinima: 0 },
  { pasta: '2026-08-26-rules-skills-toolcall-rag', bloco: 'agentes', titulo: 'Skills, rules, RAG e tool calling', linhaMinima: 0 },
  { pasta: '2026-09-09-skills-riscos-cli', bloco: 'riscos', titulo: 'Riscos, prompt injection e ferramentas CLI', linhaMinima: 0 }
]

const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const termosDe = (titulo: string, trecho: string): string[] => {
  const vazias = new Set(['para', 'como', 'que', 'com', 'uma', 'dos', 'das', 'por', 'sem', 'nao', 'mais', 'isso', 'ele', 'ela', 'seu', 'sua', 'antes', 'depois', 'cada', 'entre'])
  const brutos = semAcento(`${titulo} ${trecho}`).split(/[^a-z0-9]+/)
  return [...new Set(brutos.filter(t => t.length > 3 && !vazias.has(t)))]
}

const slugificar = (s: string): string =>
  semAcento(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

const extrair = (markdown: string, aula: Aula): Item[] => {
  const linhas = markdown.split('\n')
  const cabecalhos: { titulo: string, linha: number }[] = []
  let dentroDeCodigo = false
  linhas.forEach((linha, i) => {
    if (linha.startsWith('```')) dentroDeCodigo = !dentroDeCodigo
    if (dentroDeCodigo) return
    if (linha.startsWith('## ')) cabecalhos.push({ titulo: linha.slice(3).trim(), linha: i + 1 })
  })

  return cabecalhos
    .filter(c => c.linha >= aula.linhaMinima)
    .map((c, i) => {
      const fim = cabecalhos[cabecalhos.indexOf(c) + 1]?.linha ?? linhas.length + 1
      const corpo = linhas.slice(c.linha, fim - 1)
        .filter(l => !l.startsWith('```') && !l.startsWith('---') && l.trim().length > 0)
        .join(' ')
        .replace(/[*`#]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      const trecho = corpo.length > 220 ? `${corpo.slice(0, 220)}...` : corpo
      return {
        id: `${aula.bloco}-${String(i + 1).padStart(2, '0')}-${slugificar(c.titulo)}`,
        titulo: c.titulo,
        bloco: aula.bloco,
        aula: aula.pasta,
        linha: c.linha,
        url: `${REPO}/blob/main/${aula.pasta}/slides.md#L${c.linha}`,
        trecho,
        termos: termosDe(c.titulo, trecho)
      }
    })
}

const base = process.argv[2]
if (!base) {
  console.error('uso: node gerar-indice.ts <caminho do clone do repositório da turma>')
  process.exit(1)
}

const itens: Item[] = []
for (const aula of AULAS) {
  const markdown = await readFile(join(base, aula.pasta, 'slides.md'), 'utf8')
  const extraidos = extrair(markdown, aula)
  itens.push(...extraidos)
  console.error(`${aula.pasta}: ${extraidos.length} slides`)
}

const conteudo = {
  fonte: REPO,
  geradoEm: new Date().toISOString().slice(0, 10),
  blocos: AULAS.map(a => ({ id: a.bloco, titulo: a.titulo, aula: a.pasta, url: `${REPO}/blob/main/${a.pasta}/slides.md` })),
  itens
}

await writeFile(join(import.meta.dirname, 'dados', 'conteudo-b1.json'), `${JSON.stringify(conteudo, null, 2)}\n`)
console.error(`total: ${itens.length} slides em ${AULAS.length} blocos`)
