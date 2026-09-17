const MCP = window.MCP_URL ?? '/mcp'
const PROTOCOLO = '2025-06-18'

let proximoId = 1
let sessao = null

const $ = id => document.getElementById(id)
const statusEl = $('status')
const logEl = $('log')
const mapaEl = $('mapa')
const slideEl = $('slide')

const setStatus = (texto, modo) => {
  statusEl.textContent = texto
  statusEl.className = `status${modo ? ` ${modo}` : ''}`
}

const extrairSse = (bruto) => {
  const blocos = []
  for (const trecho of bruto.split('\n\n')) {
    const linha = trecho.split('\n').find(l => l.startsWith('data:'))
    if (linha) blocos.push(linha.slice(5).trim())
  }
  if (blocos.length === 0) return JSON.parse(bruto)
  return JSON.parse(blocos[blocos.length - 1])
}

const registrarLog = (pedido, resposta, ms, erro) => {
  const li = document.createElement('li')
  const metodo = pedido.method === 'tools/call'
    ? `tools/call ${pedido.params?.name ?? ''}`
    : pedido.method
  const meta = document.createElement('p')
  meta.className = 'meta'
  meta.textContent = `${metodo} · ${ms} ms${erro ? ' · erro' : ''}`
  const pre = document.createElement('pre')
  pre.textContent = JSON.stringify({ pedido, resposta }, null, 2)
  li.append(meta, pre)
  logEl.prepend(li)
  while (logEl.children.length > 8) logEl.lastChild.remove()
}

const mcp = async (method, params) => {
  const pedido = { jsonrpc: '2.0', id: proximoId++, method, params }
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  }
  if (sessao) headers['mcp-session-id'] = sessao
  const t0 = performance.now()
  const res = await fetch(MCP, { method: 'POST', headers, body: JSON.stringify(pedido) })
  const sid = res.headers.get('mcp-session-id')
  if (sid) sessao = sid
  const bruto = await res.text()
  let mensagem
  try {
    mensagem = extrairSse(bruto)
  } catch {
    mensagem = { error: { message: bruto.slice(0, 400) || `HTTP ${res.status}` } }
  }
  const ms = Math.round(performance.now() - t0)
  const falhou = Boolean(mensagem.error) || !res.ok
  registrarLog(pedido, mensagem, ms, falhou)
  if (falhou) {
    const texto = mensagem.error?.message ?? `HTTP ${res.status}`
    throw new Error(texto)
  }
  return mensagem.result
}

const textoDaTool = (result) => {
  const partes = result?.content ?? []
  return partes.filter(p => p.type === 'text').map(p => p.text).join('\n')
}

const ligarLinks = (el, texto) => {
  el.textContent = ''
  const linhas = texto.split('\n')
  let resto = texto
  if (linhas[0].startsWith('## ')) {
    const h = document.createElement('h3')
    h.textContent = linhas[0].slice(3)
    el.append(h)
    resto = linhas.slice(1).join('\n').replace(/^\n/, '')
  }
  const re = /(https:\/\/[^\s)]+)/g
  let ultimo = 0
  let m
  const frag = document.createDocumentFragment()
  while ((m = re.exec(resto))) {
    frag.append(resto.slice(ultimo, m.index))
    const a = document.createElement('a')
    a.href = m[1]
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.textContent = m[1]
    frag.append(a)
    ultimo = m.index + m[1].length
  }
  frag.append(resto.slice(ultimo))
  el.append(frag)
}

const chamarTool = async (name, args) => {
  const result = await mcp('tools/call', { name, arguments: args ?? {} })
  if (result.isError) throw new Error(textoDaTool(result))
  return textoDaTool(result)
}

const parseMapa = (texto) => {
  const blocos = []
  let atual = null
  for (const linha of texto.split('\n')) {
    const cab = linha.match(/^## (.+) \((\w+), (\d+) slides\)$/)
    if (cab) {
      atual = { titulo: cab[1], id: cab[2], n: cab[3], slides: [] }
      blocos.push(atual)
      continue
    }
    const item = linha.match(/^- (\S+) \| (.+)$/)
    if (item && atual) atual.slides.push({ id: item[1], titulo: item[2] })
  }
  return blocos
}

const abrirSlide = async (id, botao) => {
  document.querySelectorAll('.slide-id.aberto').forEach(b => b.classList.remove('aberto'))
  if (botao) botao.classList.add('aberto')
  slideEl.classList.remove('vazio')
  slideEl.textContent = 'Lendo obterSlide…'
  try {
    const texto = await chamarTool('obterSlide', { slideId: id })
    ligarLinks(slideEl, texto)
  } catch (erro) {
    slideEl.textContent = erro.message
  }
}

const desenharMapa = (blocos) => {
  mapaEl.textContent = ''
  for (const bloco of blocos) {
    const sec = document.createElement('section')
    sec.className = 'bloco'
    const h = document.createElement('h3')
    h.textContent = `${bloco.titulo} (${bloco.id}, ${bloco.n})`
    const ol = document.createElement('ol')
    for (const slide of bloco.slides) {
      const li = document.createElement('li')
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'slide-id'
      b.dataset.id = slide.id
      const idSpan = document.createElement('span')
      idSpan.className = 'id'
      idSpan.textContent = slide.id
      b.replaceChildren(idSpan, document.createTextNode(` ${slide.titulo}`))
      b.addEventListener('click', () => abrirSlide(slide.id, b))
      li.append(b)
      ol.append(li)
    }
    sec.append(h, ol)
    mapaEl.append(sec)
  }
}

const carregarMapa = async () => {
  mapaEl.textContent = 'Chamando listarTopicos…'
  const texto = await chamarTool('listarTopicos', {})
  const blocos = parseMapa(texto)
  if (blocos.length === 0) {
    mapaEl.textContent = texto
    return
  }
  desenharMapa(blocos)
}

const conectar = async () => {
  setStatus(`initialize em ${MCP}…`)
  const init = await mcp('initialize', {
    protocolVersion: PROTOCOLO,
    capabilities: {},
    clientInfo: { name: 'mcp-revisao-b1-web', version: '1.0.0' }
  })
  if (sessao) {
    await fetch(MCP, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': sessao
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    })
  }
  const versao = init.protocolVersion ?? PROTOCOLO
  const origem = sessao ? `sessão ${sessao.slice(0, 8)}` : 'stateless'
  setStatus(`${origem} · protocolo ${versao} · ${MCP}`, 'ok')
  await carregarMapa()
}

document.querySelectorAll('.aba').forEach(aba => {
  aba.addEventListener('click', () => {
    const id = aba.dataset.aba
    document.querySelectorAll('.aba').forEach(a => {
      a.classList.toggle('ativa', a === aba)
      if (a === aba) a.setAttribute('aria-current', 'page')
      else a.removeAttribute('aria-current')
    })
    document.querySelectorAll('.painel').forEach(p => {
      p.hidden = p.dataset.painel !== id
    })
  })
})

$('form-busca').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const termo = $('termo').value.trim()
  const bloco = $('bloco-busca').value
  const saida = $('busca-saida')
  saida.textContent = 'consultando…'
  try {
    const args = { termo, limite: 5 }
    if (bloco) args.bloco = bloco
    ligarLinks(saida, await chamarTool('consultarConteudo', args))
  } catch (erro) {
    saida.textContent = erro.message
  }
})

$('form-conceito').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const saida = $('conceito-saida')
  saida.textContent = 'consultando…'
  try {
    ligarLinks(saida, await chamarTool('consultarConceito', { conceito: $('conceito').value }))
  } catch (erro) {
    saida.textContent = erro.message
  }
})

$('form-modelos').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const saida = $('modelos-saida')
  saida.textContent = 'consultando o catálogo…'
  try {
    saida.textContent = await chamarTool('listarModelos', { filtro: $('filtro').value.trim(), limite: 12 })
  } catch (erro) {
    saida.textContent = erro.message
  }
})

$('form-custo').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const saida = $('custo-saida')
  saida.textContent = 'calculando…'
  try {
    saida.textContent = await chamarTool('custoDaChamada', {
      modelo: $('modelo').value.trim(),
      tokensEntrada: Number($('tokens-in').value),
      tokensSaida: Number($('tokens-out').value),
      chamadas: Number($('chamadas').value)
    })
  } catch (erro) {
    saida.textContent = erro.message
  }
})

conectar().catch(erro => {
  setStatus(`falha no handshake: ${erro.message}. Local: node servidor.ts --http. Remoto: Worker em ${MCP}.`, 'erro')
})
