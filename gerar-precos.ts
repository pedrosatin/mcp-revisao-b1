const PRECOS_URL = process.env.PRECOS_URL
  ?? 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const SAIDA = new URL('./dados/precos-compactos.json', import.meta.url)

type Linha = [string, string, number, number] | [string, string, number, number, number]

const res = await fetch(PRECOS_URL, { signal: AbortSignal.timeout(30_000) })
if (!res.ok) throw new Error(`${PRECOS_URL} respondeu ${res.status}`)
const bruto = await res.json() as Record<string, Record<string, unknown>>
const modelos: Linha[] = []
for (const [id, dados] of Object.entries(bruto)) {
  const entrada = dados.input_cost_per_token
  const saida = dados.output_cost_per_token
  if (typeof entrada !== 'number' || typeof saida !== 'number') continue
  const provedor = String(dados.litellm_provider ?? 'desconhecido')
  const janela = dados.max_input_tokens
  if (typeof janela === 'number') modelos.push([id, provedor, entrada, saida, janela])
  else modelos.push([id, provedor, entrada, saida])
}
modelos.sort((a, b) => a[0].localeCompare(b[0]))
const corpo = JSON.stringify({ fonte: PRECOS_URL, geradoEm: new Date().toISOString(), modelos })
const { writeFile } = await import('node:fs/promises')
await writeFile(SAIDA, corpo)
console.error(`${modelos.length} modelos, ${corpo.length} bytes, ${SAIDA.pathname}`)
