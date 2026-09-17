import { createMcpHandler } from 'agents/mcp/server'
import { criarServidor } from './servidor'

const handler = createMcpHandler(criarServidor, {
  route: '/mcp',
  allowedOriginHostnames: ['pedrosatin.github.io', 'localhost', '127.0.0.1'],
  corsOptions: {
    headers: 'Content-Type, Accept, mcp-session-id, MCP-Protocol-Version, Last-Event-ID, Mcp-Session-Id, Mcp-Protocol-Version'
  }
})

export default {
  fetch(request, env, ctx) {
    return handler(request, env, ctx)
  }
} satisfies ExportedHandler
