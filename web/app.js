const MCP = window.MCP_URL ?? '/mcp'
const PROTOCOLO = '2025-06-18'
const RPC_CHAVE = 'mcp-revisao-b1-rpc-aberto'

let proximoId = 1
let sessao = null
let rpcCount = 0

const $ = id => document.getElementById(id)
const statusEl = $('status')
const statusTexto = $('status-texto')
const logEl = $('log')
const mapaEl = $('mapa')
const slideEl = $('slide')
const toggleEl = $('rpc-toggle')
const corpoEl = $('rpc-corpo')
const ultimaEl = $('rpc-ultima')
const contagemEl = $('rpc-contagem')

$('endpoint').textContent = MCP

const setStatus = (texto, modo) => {
  statusTexto.textContent = texto
  statusEl.className = `status${modo ? ` ${modo}` : ''}`
}

const rpcAberto = () => toggleEl.getAttribute('aria-expanded') === 'true'

const aplicarDock = (aberto) => {
  toggleEl.setAttribute('aria-expanded', String(aberto))
  corpoEl.hidden = !aberto
  try { localStorage.setItem(RPC_CHAVE, aberto ? '1' : '0') } catch { /* ignore */ }
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
  const metodo = pedido.method === 'tools/call'
    ? `tools/call ${pedido.params?.name ?? ''}`
    : pedido.method
  rpcCount += 1
  contagemEl.textContent = String(rpcCount)
  ultimaEl.textContent = `${metodo}, ${ms} ms${erro ? ', erro' : ''}`

  const li = document.createElement('li')
  li.className = erro ? 'rpc erro' : 'rpc'
  const details = document.createElement('details')
  details.open = true
  const summary = document.createElement('summary')
  const nome = document.createElement('span')
  nome.className = 'metodo'
  nome.textContent = metodo
  const tempo = document.createElement('span')
  tempo.className = 'ms'
  tempo.textContent = `${ms} ms`
  const estado = document.createElement('span')
  estado.className = 'estado'
  estado.textContent = erro ? 'erro' : 'ok'
  summary.append(nome, tempo, estado)

  const par = document.createElement('div')
  par.className = 'rpc-par'
  const pedidoSec = document.createElement('section')
  const pedidoH = document.createElement('h3')
  pedidoH.textContent = 'pedido'
  const pedidoPre = document.createElement('pre')
  pedidoPre.textContent = JSON.stringify(pedido, null, 2)
  pedidoSec.append(pedidoH, pedidoPre)
  const respSec = document.createElement('section')
  const respH = document.createElement('h3')
  respH.textContent = 'resposta'
  const respPre = document.createElement('pre')
  respPre.textContent = JSON.stringify(resposta, null, 2)
  respSec.append(respH, respPre)
  par.append(pedidoSec, respSec)
  details.append(summary, par)
  li.append(details)
  logEl.prepend(li)
  for (const irmao of logEl.children) {
    if (irmao !== li) {
      const d = irmao.querySelector('details')
      if (d) d.open = false
    }
  }
  while (logEl.children.length > 12) logEl.lastChild.remove()
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

let mermaidApi = null
const mermaidDe = async () => {
  if (mermaidApi !== null) return mermaidApi
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/mermaid@11/+esm')
    mod.default.initialize({
      startOnLoad: false,
      theme: 'neutral',
      securityLevel: 'strict',
      fontFamily: 'IBM Plex Sans, Segoe UI, sans-serif'
    })
    mermaidApi = mod.default
  } catch {
    mermaidApi = false
  }
  return mermaidApi
}

const renderMarkdown = async (el, md) => {
  const marked = window.marked
  const purify = window.DOMPurify
  if (!marked?.parse || !purify?.sanitize) {
    el.textContent = md
    return
  }
  el.innerHTML = purify.sanitize(marked.parse(md, { gfm: true, breaks: false }))
  el.querySelectorAll('a[href^="http"]').forEach(a => {
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
  })
  const nos = []
  el.querySelectorAll('pre code.language-mermaid').forEach(code => {
    const div = document.createElement('div')
    div.className = 'mermaid'
    div.textContent = code.textContent
    code.parentElement.replaceWith(div)
    nos.push(div)
  })
  if (nos.length === 0) return
  const mermaid = await mermaidDe()
  if (!mermaid) return
  try { await mermaid.run({ nodes: nos }) } catch { /* o pre original já foi trocado */ }
}

const preencherFicha = async (el, texto) => {
  el.textContent = ''
  el.classList.remove('vazio')
  const linhas = texto.split('\n')
  let i = 0
  if (linhas[0]?.startsWith('## ')) {
    const h = document.createElement('h3')
    h.textContent = linhas[0].slice(3)
    el.append(h)
    i = 1
    while (linhas[i] === '') i += 1
  }
  const campos = document.createElement('p')
  campos.className = 'campos'
  const corpoLinhas = []
  let link = ''
  for (; i < linhas.length; i += 1) {
    const linha = linhas[i]
    const idBloco = linha.match(/^id:\s+(\S+)\s+\|\s+bloco:\s+(\S+)/)
    if (idBloco) {
      const a = document.createElement('span')
      a.textContent = idBloco[1]
      const b = document.createElement('span')
      b.textContent = `bloco ${idBloco[2]}`
      campos.append(a, b)
      continue
    }
    const blocoId = linha.match(/^bloco:\s+(\S+)\s+\|\s+id:\s+(\S+)/)
    if (blocoId) {
      const a = document.createElement('span')
      a.textContent = blocoId[2]
      const b = document.createElement('span')
      b.textContent = `bloco ${blocoId[1]}`
      campos.append(a, b)
      continue
    }
    const soBloco = linha.match(/^bloco:\s+(\S+)$/)
    if (soBloco) {
      const b = document.createElement('span')
      b.textContent = `bloco ${soBloco[1]}`
      campos.append(b)
      continue
    }
    if (linha.startsWith('link: ')) {
      link = linha.slice(6).trim()
      continue
    }
    if (linha.startsWith('arquivo: ')) {
      const arq = document.createElement('span')
      arq.className = 'arquivo'
      arq.textContent = linha.slice(9).trim()
      campos.append(arq)
      continue
    }
    if (linha.startsWith('sorteio: ')) {
      const s = document.createElement('span')
      s.textContent = linha.slice(9).trim()
      campos.append(s)
      continue
    }
    if (linha.startsWith('slide: ')) {
      const b = document.createElement('span')
      b.textContent = linha.slice(7)
      campos.append(b)
      continue
    }
    corpoLinhas.push(linha)
  }
  if (campos.childNodes.length) el.append(campos)
  const md = corpoLinhas.join('\n').replace(/^\n+|\n+$/g, '')
  if (md.length > 0) {
    const corpo = document.createElement('div')
    corpo.className = 'corpo md'
    el.append(corpo)
    await renderMarkdown(corpo, md)
  }
  if (link) {
    const a = document.createElement('a')
    a.className = 'link-aula'
    a.href = link
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    const arquivoEl = el.querySelector('.arquivo')
    a.textContent = arquivoEl?.textContent
      ? `Abrir ${arquivoEl.textContent}`
      : 'Abrir o slide no GitHub da turma'
    el.append(a)
  }
}

const mostrar = async (el, texto) => {
  if (/\nid: /.test(texto) && (texto.includes('\nlink: ') || texto.startsWith('## '))) {
    await preencherFicha(el, texto)
    return
  }
  el.textContent = ''
  el.classList.remove('vazio')
  el.classList.add('md')
  await renderMarkdown(el, texto)
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
      atual = { titulo: cab[1], id: cab[2], n: cab[3], pasta: '', slides: [] }
      blocos.push(atual)
      continue
    }
    const pasta = linha.match(/^pasta: (.+)$/)
    if (pasta && atual) {
      atual.pasta = pasta[1]
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
    await mostrar(slideEl, texto)
  } catch (erro) {
    slideEl.textContent = erro.message
  }
}

const desenharMapa = (blocos) => {
  mapaEl.textContent = ''
  blocos.forEach((bloco, indice) => {
    const sec = document.createElement('details')
    sec.className = 'bloco'
    if (indice === 0) sec.open = true
    const sum = document.createElement('summary')
    const titulo = document.createElement('span')
    titulo.textContent = bloco.titulo
    const meta = document.createElement('span')
    meta.className = 'meta'
    meta.textContent = bloco.pasta ? `${bloco.pasta}` : `${bloco.id}, ${bloco.n}`
    sum.append(titulo, meta)
    const ol = document.createElement('ol')
    for (const slide of bloco.slides) {
      const li = document.createElement('li')
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'slide-id'
      b.dataset.id = slide.id
      b.title = slide.id
      const titulo = document.createElement('span')
      titulo.className = 'titulo-slide'
      titulo.textContent = slide.titulo
      b.append(titulo)
      b.addEventListener('click', () => abrirSlide(slide.id, b))
      li.append(b)
      ol.append(li)
    }
    sec.append(sum, ol)
    mapaEl.append(sec)
  })
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
  setStatus(`initialize em ${MCP}`)
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
  setStatus(`${origem}, protocolo ${versao}`, 'ok')
  await carregarMapa()
}

const ativarAba = (id) => {
  document.querySelectorAll('.aba').forEach(a => {
    const ativa = a.dataset.aba === id
    a.setAttribute('aria-selected', String(ativa))
  })
  document.querySelectorAll('.painel').forEach(p => {
    p.hidden = p.dataset.painel !== id
  })
}

document.querySelectorAll('.aba').forEach(aba => {
  aba.addEventListener('click', () => ativarAba(aba.dataset.aba))
})

toggleEl.addEventListener('click', () => aplicarDock(!rpcAberto()))

$('form-busca').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const termo = $('termo').value.trim()
  const bloco = $('bloco-busca').value
  const saida = $('busca-saida')
  saida.textContent = 'consultando…'
  try {
    const args = { termo, limite: 5 }
    if (bloco) args.bloco = bloco
    await mostrar(saida, await chamarTool('consultarConteudo', args))
  } catch (erro) {
    saida.textContent = erro.message
  }
})

$('form-conceito').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const saida = $('conceito-saida')
  saida.textContent = 'consultando…'
  try {
    await mostrar(saida, await chamarTool('consultarConceito', { conceito: $('conceito').value }))
  } catch (erro) {
    saida.textContent = erro.message
  }
})

$('form-modelos').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const saida = $('modelos-saida')
  saida.textContent = 'consultando o catálogo…'
  try {
    await mostrar(saida, await chamarTool('listarModelos', { filtro: $('filtro').value.trim(), limite: 12 }))
  } catch (erro) {
    saida.textContent = erro.message
  }
})

$('form-custo').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const saida = $('custo-saida')
  saida.textContent = 'calculando…'
  try {
    await mostrar(saida, await chamarTool('custoDaChamada', {
      modelo: $('modelo').value.trim(),
      tokensEntrada: Number($('tokens-in').value),
      tokensSaida: Number($('tokens-out').value),
      chamadas: Number($('chamadas').value)
    }))
  } catch (erro) {
    saida.textContent = erro.message
  }
})

const vistos = []
$('form-sortear').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const saida = $('sorteio-saida')
  saida.textContent = 'sorteando…'
  try {
    const args = { evitar: vistos.slice(-40) }
    const bloco = $('bloco-sorteio').value
    if (bloco) args.bloco = bloco
    const texto = await chamarTool('sortearRevisao', args)
    await mostrar(saida, texto)
    const id = texto.match(/^id: (\S+)/m)?.[1]
    if (id && !vistos.includes(id)) vistos.push(id)
  } catch (erro) {
    saida.textContent = erro.message
  }
})

$('form-plano').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const saida = $('plano-saida')
  saida.textContent = 'montando o plano…'
  try {
    const args = {}
    const bloco = $('bloco-plano').value
    if (bloco) args.bloco = bloco
    await mostrar(saida, await chamarTool('planoAteProva', args))
  } catch (erro) {
    saida.textContent = erro.message
  }
})

$('form-recurso').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const saida = $('recurso-saida')
  saida.textContent = 'resources/read…'
  try {
    const uri = `b1://bloco/${$('bloco-recurso').value}`
    const result = await mcp('resources/read', { uri })
    const texto = result.contents?.map(c => c.text).join('\n\n') ?? JSON.stringify(result, null, 2)
    await mostrar(saida, texto)
  } catch (erro) {
    saida.textContent = erro.message
  }
})

$('form-prompt').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const saida = $('prompt-saida')
  saida.textContent = 'prompts/get…'
  try {
    const nome = $('nome-prompt').value
    const arg = $('arg-prompt').value.trim()
    const arguments_ = nome === 'explicar-com-exemplo'
      ? { slideId: arg }
      : nome === 'exercicio-de-custo'
        ? { modelo: arg }
        : { bloco: arg }
    const result = await mcp('prompts/get', { name: nome, arguments: arguments_ })
    const textos = (result.messages ?? []).map(m => m.content?.text ?? JSON.stringify(m.content))
    saida.textContent = textos.join('\n\n') || JSON.stringify(result, null, 2)
  } catch (erro) {
    saida.textContent = erro.message
  }
})

{
  let aberto
  try {
    const salvo = localStorage.getItem(RPC_CHAVE)
    if (salvo === '1') aberto = true
    else if (salvo === '0') aberto = false
  } catch { /* ignore */ }
  if (aberto === undefined) aberto = false
  aplicarDock(aberto)
}

conectar().catch(erro => {
  setStatus(`falha no handshake. ${erro.message}`, 'erro')
})
