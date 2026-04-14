/**
 * Backlinks (quién enlaza esta hoja) y vista previa al estar el cursor en [[…]].
 */
import { resolveWikiTarget, parseWikiInner, getWikiLinkAt } from './wiki-links.js'
import { getPlainAndCaret } from './math-inline-editor.js'

const WIKI_RE = /\[\[([^\[\]]+)\]\]/g

function scanRecordOutgoingLinks (rec, allRecords) {
  const linkedIds = new Set()
  const visit = (inner) => {
    const { target } = parseWikiInner(inner)
    if (!target) return
    const hit = resolveWikiTarget(target, allRecords)
    if (hit?.id) linkedIds.add(hit.id)
  }
  const scanText = (s) => {
    if (typeof s !== 'string') return
    WIKI_RE.lastIndex = 0
    let m
    while ((m = WIKI_RE.exec(s)) !== null) visit(m[1])
  }
  scanText(rec.titulo || '')
  for (const v of Object.values(rec.fields || {})) {
    if (typeof v === 'string') scanText(v)
  }
  return linkedIds
}

function buildBacklinkMap (allRecords) {
  const map = new Map()
  for (const r of allRecords) {
    for (const tid of scanRecordOutgoingLinks(r, allRecords)) {
      if (!map.has(tid)) map.set(tid, [])
      map.get(tid).push({ id: r.id, titulo: r.titulo || '(sin título)', tipo: r.tipo })
    }
  }
  return map
}

export function ideaPrincipalSnippet (rec) {
  const f = rec.fields || {}
  const pick = (keys) => {
    for (const k of keys) {
      const t = String(f[k] ?? '').trim()
      if (t) return t.replace(/\s+/g, ' ').slice(0, 280)
    }
    return ''
  }
  switch (rec.tipo) {
    case 'concepto':
      return pick(['concepto.idea_principal', 'concepto.tema', 'concepto.explicacion_simple'])
    case 'resumen':
      return pick(['resumen.tema', 'resumen.casos'])
    case 'error':
      return pick(['error.regla', 'error.que_hice_mal', 'error.porque'])
    case 'ejercicio':
      return pick(['ejercicio.tema', 'ejercicio.que_piden'])
    default:
      return ''
  }
}

function bodyPreviewSnippet (rec) {
  const f = rec.fields || {}
  const parts = []
  for (const v of Object.values(f)) {
    if (typeof v === 'string' && v.trim()) parts.push(v.trim().replace(/\s+/g, ' '))
  }
  return parts.join(' · ').slice(0, 380)
}

export function initBacklinksAndPreview (ctx) {
  const { loadAll, openSheet, showEditorView } = ctx
  const listEl = document.getElementById('backlinks-list')
  const emptyEl = document.getElementById('backlinks-empty')
  const previewEl = document.getElementById('wiki-link-preview')
  if (!listEl) return

  let hidePreviewTimer = null
  function hidePreview () {
    if (previewEl) previewEl.hidden = true
  }

  function showPreview (x, y, targetRecOrNull) {
    if (!previewEl) return
    if (!targetRecOrNull) {
      hidePreview()
      return
    }
    const idea = ideaPrincipalSnippet(targetRecOrNull)
    const body = bodyPreviewSnippet(targetRecOrNull)
    previewEl.innerHTML = ''
    const t = document.createElement('div')
    t.className = 'wiki-preview-title'
    t.textContent = targetRecOrNull.titulo || '(sin título)'
    previewEl.appendChild(t)
    if (idea) {
      const i = document.createElement('div')
      i.className = 'wiki-preview-idea'
      i.textContent = idea
      previewEl.appendChild(i)
    }
    const p = document.createElement('div')
    p.className = 'wiki-preview-body'
    p.textContent = body || '(sin texto)'
    previewEl.appendChild(p)
    previewEl.hidden = false
    const pad = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = x + pad
    let top = y + pad
    previewEl.style.maxWidth = `${Math.min(320, vw - 24)}px`
    previewEl.style.left = `${Math.min(left, vw - 24 - (previewEl.offsetWidth || 280))}px`
    previewEl.style.top = `${Math.min(top, vh - 24 - (previewEl.offsetHeight || 120))}px`
  }

  async function refreshBacklinks (sheetId) {
    listEl.innerHTML = ''
    if (!sheetId) {
      if (emptyEl) emptyEl.hidden = false
      return
    }
    const all = await loadAll()
    const mmap = buildBacklinkMap(all)
    const srcs = mmap.get(sheetId) || []
    if (emptyEl) emptyEl.hidden = srcs.length > 0
    for (const s of srcs) {
      const li = document.createElement('li')
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'backlink-item'
      btn.textContent = s.titulo
      btn.addEventListener('click', () => {
        const rec = all.find((r) => r.id === s.id)
        if (rec) {
          openSheet(rec)
          showEditorView()
        }
      })
      li.appendChild(btn)
      listEl.appendChild(li)
    }
  }

  window.addEventListener('neinei:record-loaded', (ev) => {
    const id = ev.detail?.id
    refreshBacklinks(id).catch((e) => console.error(e))
  })

  function onFieldActivity (e) {
    const ta = e.target
    if (!ta || !ta.matches || !ta.matches('textarea.field-input[data-f]')) return
    const { plain: text, caret } = getPlainAndCaret(ta)
    const hit = getWikiLinkAt(text, caret)
    if (!hit) {
      if (hidePreviewTimer) clearTimeout(hidePreviewTimer)
      hidePreviewTimer = setTimeout(hidePreview, 120)
      return
    }
    if (hidePreviewTimer) clearTimeout(hidePreviewTimer)
    ;(async () => {
      const all = await loadAll()
      const resolved = resolveWikiTarget(hit.target, all)
      const rect = ta.getBoundingClientRect()
      showPreview(rect.left, rect.bottom, resolved)
    })().catch(() => hidePreview())
  }

  document.getElementById('view-editor')?.addEventListener('keyup', onFieldActivity)
  document.getElementById('view-editor')?.addEventListener('click', onFieldActivity)
  document.getElementById('view-editor')?.addEventListener('blur', (e) => {
    if (e.target?.matches?.('textarea.field-input[data-f]')) {
      setTimeout(hidePreview, 200)
    }
  }, true)
}
