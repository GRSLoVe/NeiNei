/**
 * Vista «Mis errores»: agrupa hojas tipo error por tipo analítico, materia y menciones wiki.
 */
import { resolveWikiTarget, parseWikiInner } from './wiki-links.js'

const WIKI_RE = /\[\[([^\[\]]+)\]\]/g

function extractWikiTargetsFromRecord (rec) {
  const out = new Set()
  const pushInner = (inner) => {
    const { target } = parseWikiInner(inner)
    if (target) out.add(String(target).trim())
  }
  const scan = (txt) => {
    if (typeof txt !== 'string' || !txt) return
    WIKI_RE.lastIndex = 0
    let m
    while ((m = WIKI_RE.exec(txt)) !== null) pushInner(m[1])
  }
  scan(rec.titulo || '')
  const f = rec.fields || {}
  for (const v of Object.values(f)) {
    if (typeof v === 'string') scan(v)
  }
  return [...out]
}

function groupBy (arr, keyFn) {
  const map = new Map()
  for (const x of arr) {
    const k = keyFn(x)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(x)
  }
  return map
}

export function initErrorsDashboard (ctx) {
  const { loadAll, openSheet, showEditorView } = ctx
  const root = document.getElementById('errors-groups')
  if (!root) return

  const typeLabels = {
    sin_clasificar: 'Sin clasificar',
    concepto: 'Concepto',
    procedimiento: 'Procedimiento',
    signos: 'Signos',
    otro: 'Otro'
  }

  window.addEventListener('neinei:show-errors', () => {
    ;(async () => {
      const all = await loadAll()
      const errors = all.filter((r) => r.tipo === 'error')
      root.innerHTML = ''

      const summary = document.createElement('div')
      summary.className = 'errors-summary'
      summary.innerHTML = `<p><strong>${errors.length}</strong> hoja(s) de error.</p>`
      root.appendChild(summary)

      if (!errors.length) {
        const p = document.createElement('p')
        p.className = 'view-panel-empty'
        p.textContent = 'Crea hojas con plantilla «Error» y clasifica el tipo de fallo en la cabecera.'
        root.appendChild(p)
        return
      }

      const inbound = new Map()
      for (const er of errors) inbound.set(er.id, new Set())
      for (const src of all) {
        const targets = extractWikiTargetsFromRecord(src)
        for (const tgt of targets) {
          const resolved = resolveWikiTarget(tgt, all)
          if (resolved && inbound.has(resolved.id) && src.id !== resolved.id) {
            inbound.get(resolved.id).add(src.id)
          }
        }
      }

      const byType = groupBy(errors, (r) => r.errorType || 'sin_clasificar')
      const typeSection = document.createElement('section')
      typeSection.className = 'errors-section'
      typeSection.innerHTML = '<h2>Por tipo de error</h2>'
      for (const [tkey, label] of Object.entries(typeLabels)) {
        const list = byType.get(tkey) || []
        if (!list.length) continue
        const h = document.createElement('h3')
        h.textContent = `${label} (${list.length})`
        typeSection.appendChild(h)
        const ul = document.createElement('ul')
        ul.className = 'errors-link-list'
        list
          .slice()
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
          .forEach((r) => {
            const li = document.createElement('li')
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.className = 'errors-link'
            btn.textContent = `${r.titulo || '(sin título)'}${r.materia ? ` · ${r.materia}` : ''}`
            btn.addEventListener('click', () => {
              openSheet(r)
              showEditorView()
            })
            li.appendChild(btn)
            ul.appendChild(li)
          })
        typeSection.appendChild(ul)
      }
      root.appendChild(typeSection)

      const byMat = groupBy(
        errors,
        (r) => (String(r.materia || '').trim() || '(sin materia)').toLowerCase()
      )
      const matSection = document.createElement('section')
      matSection.className = 'errors-section'
      matSection.innerHTML = '<h2>Por materia</h2>'
      const sortedMats = [...byMat.entries()].sort((a, b) => b[1].length - a[1].length)
      for (const [, recs] of sortedMats) {
        const matLabel = recs[0].materia?.trim() || '(sin materia)'
        const h = document.createElement('h3')
        h.textContent = `${matLabel} (${recs.length})`
        matSection.appendChild(h)
        const ul = document.createElement('ul')
        ul.className = 'errors-link-list'
        recs
          .slice()
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
          .forEach((r) => {
            const li = document.createElement('li')
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.className = 'errors-link'
            const et = r.errorType ? typeLabels[r.errorType] || r.errorType : 'sin clasificar'
            btn.textContent = `${r.titulo || '(sin título)'} · ${et}`
            btn.addEventListener('click', () => {
              openSheet(r)
              showEditorView()
            })
            li.appendChild(btn)
            ul.appendChild(li)
          })
        matSection.appendChild(ul)
      }
      root.appendChild(matSection)

      const freqSection = document.createElement('section')
      freqSection.className = 'errors-section'
      freqSection.innerHTML =
        '<h2>Por «popularidad» (otras hojas que enlazan aquí)</h2><p class="view-panel-hint">Cada enlace wiki [[…]] resuelto cuenta una hoja fuente distinta.</p>'
      const ranked = errors
        .map((r) => ({ r, c: inbound.get(r.id)?.size ?? 0 }))
        .sort(
          (a, b) =>
            b.c - a.c || String(b.r.updatedAt || '').localeCompare(String(a.r.updatedAt || ''))
        )
      const ulF = document.createElement('ul')
      ulF.className = 'errors-link-list'
      for (const { r, c } of ranked.slice(0, 20)) {
        const li = document.createElement('li')
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'errors-link'
        btn.textContent = `${r.titulo || '(sin título)'} — ${c} nota(s) enlazan aquí`
        btn.addEventListener('click', () => {
          openSheet(r)
          showEditorView()
        })
        li.appendChild(btn)
        ulF.appendChild(li)
      }
      freqSection.appendChild(ulF)
      root.appendChild(freqSection)

      const lastSection = document.createElement('section')
      lastSection.className = 'errors-section'
      lastSection.innerHTML = '<h2>Últimos errores (por fecha de edición)</h2>'
      const ulL = document.createElement('ul')
      ulL.className = 'errors-link-list'
      const latest = errors
        .slice()
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .slice(0, 15)
      for (const r of latest) {
        const li = document.createElement('li')
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'errors-link'
        btn.textContent = `${r.titulo || '(sin título)'} · ${String(r.updatedAt || '').slice(0, 16).replace('T', ' ')}`
        btn.addEventListener('click', () => {
          openSheet(r)
          showEditorView()
        })
        li.appendChild(btn)
        ulL.appendChild(li)
      }
      lastSection.appendChild(ulL)
      root.appendChild(lastSection)
    })().catch((e) => console.error(e))
  })
}
