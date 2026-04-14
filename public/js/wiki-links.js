/**
 * Enlaces wiki [[título]] o [[id:…|alias]] entre hojas guardadas.
 */

import { getPlainAndCaret, insertPlainIntoField } from './math-inline-editor.js'

const ID_PREFIX = 'id:'

export function parseWikiInner (inner) {
  const s = String(inner || '').trim()
  const pipe = s.indexOf('|')
  if (pipe <= 0 || pipe >= s.length - 1) {
    return { target: s, alias: null }
  }
  return {
    target: s.slice(0, pipe).trim(),
    alias: s.slice(pipe + 1).trim()
  }
}

export function getWikiLinkAt (value, caretIndex) {
  const v = String(value || '')
  const caret = Math.max(0, Math.min(typeof caretIndex === 'number' ? caretIndex : 0, v.length))
  const re = /\[\[([^\[\]]+)\]\]/g
  let m
  while ((m = re.exec(v)) !== null) {
    const start = m.index
    const end = m.index + m[0].length
    if (caret >= start && caret <= end) {
      const inner = m[1]
      const { target, alias } = parseWikiInner(inner)
      return { start, end, inner, target, alias }
    }
  }
  return null
}

export function getOpenWikiBracket (value, caretIndex) {
  const v = String(value || '')
  const caret = Math.max(0, Math.min(typeof caretIndex === 'number' ? caretIndex : 0, v.length))
  const before = v.slice(0, caret)
  const lastOpen = before.lastIndexOf('[[')
  if (lastOpen === -1) return null
  const between = before.slice(lastOpen + 2)
  if (between.indexOf(']]') !== -1) return null
  return { from: lastOpen, query: between }
}

export function resolveWikiTarget (target, records) {
  const raw = String(target || '').trim()
  if (!raw) return null
  const list = Array.isArray(records) ? records : []

  if (raw.toLowerCase().startsWith(ID_PREFIX)) {
    const id = raw.slice(ID_PREFIX.length).trim()
    return list.find((r) => r.id === id) || null
  }

  const lower = raw.toLowerCase()
  const exact = list.filter((r) => ((r.titulo || '').trim().toLowerCase() === lower))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) {
    return exact.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0]
  }

  const partial = list.filter((r) => ((r.titulo || '').toLowerCase().indexOf(lower) !== -1))
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) {
    return partial.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0]
  }
  return null
}

export function formatWikiLinkForRecord (rec) {
  const t = (rec.titulo || '').trim() || '(sin título)'
  if (/[\[\]|]/.test(t)) {
    const safe = t.replace(/\|/g, '·')
    return `[[${ID_PREFIX}${rec.id}|${safe}]]`
  }
  return `[[${t}]]`
}

function buildPicker () {
  const root = document.createElement('div')
  root.id = 'wiki-link-picker'
  root.className = 'wiki-link-picker'
  root.hidden = true
  root.setAttribute('role', 'listbox')
  root.innerHTML =
    '<div class="wiki-link-picker-head">Enlazar a una hoja</div><ul class="wiki-link-picker-list"></ul>'
  document.body.appendChild(root)
  return root
}

/**
 * @param {{ loadAll: () => Promise<Array>, openSheet: (rec: object) => void }} opts
 */
let wikiLinksInited = false
export function initWikiLinks (opts) {
  const { loadAll, openSheet } = opts
  if (typeof loadAll !== 'function' || typeof openSheet !== 'function') return
  if (wikiLinksInited) return
  const editor = document.getElementById('view-editor')
  if (!editor) return
  wikiLinksInited = true

  const picker = buildPicker()
  const listEl = picker.querySelector('.wiki-link-picker-list')
  let activeTa = null
  let openFrom = -1

  function hidePicker () {
    picker.hidden = true
    activeTa = null
    openFrom = -1
    listEl.innerHTML = ''
  }

  function showPicker (items, ta, from) {
    activeTa = ta
    openFrom = from
    listEl.innerHTML = ''
    if (!items.length) {
      const li = document.createElement('li')
      li.className = 'wiki-link-picker-empty'
      li.textContent = 'No hay hojas guardadas que coincidan. Guarda hojas en «Mis hojas» primero.'
      listEl.appendChild(li)
    } else {
      items.slice(0, 24).forEach((rec) => {
        const li = document.createElement('li')
        li.setAttribute('role', 'option')
        const main = document.createElement('span')
        main.className = 'wiki-pick-main'
        main.textContent = rec.titulo || '(sin título)'
        const sub = document.createElement('span')
        sub.className = 'wiki-pick-sub'
        sub.textContent = [rec.materia, rec.fecha].filter(Boolean).join(' · ')
        li.appendChild(main)
        if (sub.textContent) li.appendChild(sub)
        li.addEventListener('mousedown', (e) => {
          e.preventDefault()
          if (!activeTa) return
          const { caret } = getPlainAndCaret(activeTa)
          const link = formatWikiLinkForRecord(rec)
          insertPlainIntoField(activeTa, openFrom, caret, link)
          hidePicker()
        })
        listEl.appendChild(li)
      })
    }
    picker.hidden = false
  }

  let pickerReq = 0

  editor.addEventListener('click', async (e) => {
    const ta =
      e.target.closest?.('textarea.field-input[data-f]') ||
      e.target.closest?.('.cm-editor')?.closest('.box')?.querySelector('textarea.field-input[data-f]')
    if (!ta || !(e.ctrlKey || e.metaKey)) return
    const { plain, caret } = getPlainAndCaret(ta)
    const info = getWikiLinkAt(plain, caret)
    if (!info) return
    e.preventDefault()
    let records
    try {
      records = await loadAll()
    } catch {
      return
    }
    const rec = resolveWikiTarget(info.target, records)
    if (rec) openSheet(rec)
    else {
      window.alert(`No hay ninguna hoja guardada que coincida con «${info.target}».`)
    }
  })

  function onWikiFieldInput (ta) {
    if (!ta || !ta.matches?.('textarea.field-input[data-f]')) return
    const { plain, caret } = getPlainAndCaret(ta)
    const q = getOpenWikiBracket(plain, caret)
    if (!q) {
      hidePicker()
      return
    }
    const req = ++pickerReq
    loadAll().then((records) => {
      if (req !== pickerReq) return
      const { plain: p2, caret: c2 } = getPlainAndCaret(ta)
      const qNow = getOpenWikiBracket(p2, c2)
      if (!qNow || qNow.from !== q.from) return
      const needle = qNow.query.trim().toLowerCase()
      const filtered = records.filter((r) => {
        if (!needle) return true
        return String(r.titulo || '').toLowerCase().indexOf(needle) !== -1
      }).slice().sort((a, b) => String(a.titulo || '').localeCompare(String(b.titulo || ''), 'es'))
      showPicker(filtered, ta, q.from)
    }).catch(() => {})
  }

  editor.addEventListener('input', (e) => {
    onWikiFieldInput(e.target)
  })
  editor.addEventListener('neinei-field-sync', (e) => {
    onWikiFieldInput(e.detail?.field)
  })

  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !picker.hidden) {
      e.stopPropagation()
      hidePicker()
    }
  })

  document.addEventListener('click', (e) => {
    if (!picker.hidden && e.target !== picker && !picker.contains(e.target)) {
      if (!editor.contains(e.target)) hidePicker()
    }
  })
}
