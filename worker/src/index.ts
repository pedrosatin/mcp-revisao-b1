import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server'
import { criarServidor } from './servidor'

const ORIGENS = new Set(['pedrosatin.github.io', 'localhost', '127.0.0.1'])

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, mcp-session-id, MCP-Protocol-Version, Last-Event-ID, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'mcp-session-id',
  'Access-Control-Max-Age': '86400'
}

const hostnameDaOrigem = (origin: string | null): string | null => {
  if (!origin) return null
  try { return new URL(origin).hostname } catch { return null }
}

const comCors = (res: Response): Response => {
  const headers = new Headers(res.headers)
  for (const [chave, valor] of Object.entries(CORS)) headers.set(chave, valor)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

const jsonRpcErro = (status: number, message: string): Response => comCors(Response.json({
  jsonrpc: '2.0',
  error: { code: -32000, message },
  id: null
}, { status }))

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    const origem = hostnameDaOrigem(request.headers.get('Origin'))
    if (origem && !ORIGENS.has(origem)) {
      return jsonRpcErro(403, `Invalid Origin: ${origem}`)
    }

    const caminho = new URL(request.url).pathname
    if (caminho !== '/mcp') {
      return jsonRpcErro(404, 'Not Found')
    }

    const servidor = criarServidor()
    const transporte = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    })
    await servidor.connect(transporte)
    try {
      return comCors(await transporte.handleRequest(request))
    } finally {
      await transporte.close().catch(() => {})
      await servidor.close().catch(() => {})
    }
  }
} satisfies ExportedHandler
