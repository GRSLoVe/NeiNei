import * as api from './api.js'
import {
  applyThemePreferenceWithListener,
  cacheThemeLocally,
  readCachedTheme
} from './theme.js'
import {
  initMathInlineEditors,
  refreshMathEditor,
  insertPlainIntoField,
  getPlainAndCaret
} from './math-inline-editor.js'
import { initWikiLinks } from './wiki-links.js'
import {
  applySheetLayout,
  applyPrintMetaDataset,
  collectLayoutFromSheet,
  isLayoutDefault,
  normalizeLayout,
  addCustomBlock,
  removeCustomBlock,
  moveBlockInLayout,
  setBlockHidden,
  setBlockLabelForTipo,
  isCustomFieldKey,
  displayLabelForBlock
} from './sheet-layout.js'
import { calcularProximoRepaso } from './spaced-repetition.js'
import { initReviewView } from './review.js'
import { initStatsView } from './stats.js'
import { initErrorsDashboard } from './errors-dashboard.js'
import { initBacklinksAndPreview } from './backlinks.js'

/** CodeMirror + KaTeX solo se montan en el arranque; tras cambiar el diseño hay textareas nuevos (apartados personalizados). */
function scheduleCmEditors () {
  void initMathInlineEditors().catch((err) => {
    console.error('NeiNei CM editors:', err)
  })
}

const STORAGE_KEY = 'hojasEstudioV1'
const LOCAL_SESSION_KEY = 'neineiLocalOnly'

/** Asegura tags, repaso y errorType en registros antiguos o parciales. */
function normalizeSheetRecord (r) {
  if (!r || typeof r !== 'object') return r
  const tagsRaw = Array.isArray(r.tags) ? r.tags : []
  const tags = []
  const seen = new Set()
  for (const t of tagsRaw) {
    const s = String(t ?? '').trim().slice(0, 40)
    if (!s) continue
    const low = s.toLowerCase()
    if (seen.has(low)) continue
    seen.add(low)
    tags.push(s)
    if (tags.length >= 30) break
  }
  const rl = Number(r.reviewLevel)
  const reviewLevel =
    Number.isFinite(rl) && rl >= 1 ? Math.min(5, Math.floor(rl)) : 1
  const tipo = r.tipo
  let errorType = r.errorType != null && String(r.errorType).trim() ? String(r.errorType).trim() : null
  if (tipo !== 'error') errorType = null
  return {
    ...r,
    tags,
    errorType,
    reviewLevel,
    lastReviewed: r.lastReviewed || null,
    nextReview: r.nextReview || null
  }
}

function getTagsFromDom () {
  const root = document.getElementById('tags-chips')
  if (!root) return []
  return [...root.querySelectorAll('.tag-chip[data-tag]')]
    .map((c) => c.getAttribute('data-tag'))
    .filter(Boolean)
}

function renderTagsChips (tags) {
  const el = document.getElementById('tags-chips')
  if (!el) return
  el.innerHTML = ''
  const list = Array.isArray(tags) ? tags : []
  const seen = new Set()
  for (const t of list) {
    const s = String(t ?? '').trim().slice(0, 40)
    if (!s) continue
    const low = s.toLowerCase()
    if (seen.has(low)) continue
    seen.add(low)
    const span = document.createElement('span')
    span.className = 'tag-chip'
    span.setAttribute('data-tag', s)
    span.appendChild(document.createTextNode(s))
    const rm = document.createElement('button')
    rm.type = 'button'
    rm.className = 'tag-chip-rm'
    rm.setAttribute('aria-label', `Quitar etiqueta ${s}`)
    rm.textContent = '×'
    rm.addEventListener('click', () => {
      span.remove()
      refreshTagsDatalist().catch(() => {})
    })
    span.appendChild(rm)
    el.appendChild(span)
  }
}

async function refreshTagsDatalist () {
  const dl = document.getElementById('tags-suggestions')
  if (!dl) return
  const all = await loadAll()
  const set = new Set()
  for (const r of all) {
    for (const t of r.tags || []) {
      const s = String(t).trim()
      if (s) set.add(s)
    }
  }
  for (const t of getTagsFromDom()) set.add(t)
  dl.innerHTML = ''
  for (const t of set) {
    const o = document.createElement('option')
    o.value = t
    dl.appendChild(o)
  }
}

function updateMetaErrorTypeVisibility () {
  const w = document.getElementById('meta-error-type-wrap')
  if (w) w.hidden = activeId !== 'error'
}

let remoteReady = false
let serverRecords = []

const sections = document.querySelectorAll('[data-sheet]')
let activeId = 'concepto'
let currentId = null
let viewMode = 'editor'

const MAX_EDITOR_HISTORY = 30
const editorHistoryStack = []

const elShell = document.getElementById('app-shell')
const elUserBar = document.getElementById('user-bar')
const elUserName = document.getElementById('user-display')
const elUserAvatar = document.getElementById('user-avatar')

function setShellLocked (locked) {
  if (elShell) elShell.classList.toggle('is-locked', locked)
}

function wantsLocalOnly () {
  const p = new URLSearchParams(window.location.search)
  if (p.get('local') === '1') {
    sessionStorage.setItem(LOCAL_SESSION_KEY, '1')
    history.replaceState({}, '', '/app.html')
    return true
  }
  return sessionStorage.getItem(LOCAL_SESSION_KEY) === '1'
}

function redirectToLogin (query = '') {
  const q = query ? `&${query}` : ''
  window.location.href = `/login.html?next=${encodeURIComponent('/app.html')}${q}`
}

function applyUserAccent (user) {
  const hex = user?.accentColor?.trim()
  if (hex && /^#[0-9A-Fa-f]{6}$/.test(hex)) {
    document.documentElement.style.setProperty('--accent-primary', hex)
  } else {
    document.documentElement.style.removeProperty('--accent-primary')
  }
}

function setUserBar (user) {
  if (!elUserBar || !elUserName) return
  if (user && user.username) {
    elUserBar.hidden = false
    const label = (user.displayName && String(user.displayName).trim()) || user.username
    elUserName.textContent = label
    const bio = user.bio && String(user.bio).trim()
    const em = user.email && String(user.email).trim()
    const tipLines = []
    if (em) tipLines.push(em)
    if (bio) tipLines.push(bio.length > 320 ? `${bio.slice(0, 320)}…` : bio)
    if (tipLines.length) elUserName.title = tipLines.join('\n\n')
    else elUserName.removeAttribute('title')
    applyUserAccent(user)
    if (elUserAvatar) {
      if (user.avatarUrl) {
        elUserAvatar.src = user.avatarUrl
        elUserAvatar.hidden = false
        elUserAvatar.alt = ''
      } else {
        elUserAvatar.removeAttribute('src')
        elUserAvatar.hidden = true
        elUserAvatar.alt = ''
      }
    }
    const pref =
      user.theme === 'light' || user.theme === 'dark' || user.theme === 'system'
        ? user.theme
        : 'system'
    cacheThemeLocally(pref)
    applyThemePreferenceWithListener(pref)
  } else {
    elUserBar.hidden = true
    elUserName.textContent = ''
    elUserName.removeAttribute('title')
    document.documentElement.style.removeProperty('--accent-primary')
    if (elUserAvatar) {
      elUserAvatar.removeAttribute('src')
      elUserAvatar.hidden = true
    }
    applyThemePreferenceWithListener(readCachedTheme())
  }
}

function loadLocalBackup () {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function hasLocalBackup () {
  return loadLocalBackup().length > 0
}

function updatePlantillasUI () {
  const el = document.getElementById('plantillas-label')
  if (el) el.textContent = labelTipo(activeId)
  document.querySelectorAll('.plantilla-opt').forEach((btn) => {
    const on = btn.getAttribute('data-plantilla') === activeId
    btn.classList.toggle('is-active', on)
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
  })
}

function closePlantillasPanel () {
  const d = document.getElementById('plantillas-details')
  if (d) d.open = false
}

function isDraftNonEmpty () {
  const m = getMetaFromDom()
  if ((m.titulo || '').trim() || (m.materia || '').trim()) return true
  const f = collectFieldsForTipo(activeId)
  for (const k of Object.keys(f)) {
    if (k === 'ejercicio.err') {
      if (Array.isArray(f[k]) && f[k].some(Boolean)) return true
      continue
    }
    if (k === 'ejercicio.apoyo' && String(f[k] || '').trim()) return true
    if (String(f[k] || '').trim()) return true
  }
  if (!isLayoutDefault(activeId, collectLayoutFromSheet(activeId))) return true
  return false
}

function trySelectPlantilla (nuevo) {
  if (nuevo === activeId) {
    closePlantillasPanel()
    return
  }
  const hadSaved = currentId !== null
  const dirtyDraft = !currentId && isDraftNonEmpty()
  if (hadSaved) {
    if (
      !confirm(
        'Cambiar de plantilla cierra la hoja guardada en el editor y abre un borrador del tipo elegido. Los datos de cabecera se mantienen; el cuerpo se vacía. ¿Continuar?'
      )
    ) {
      return
    }
    currentId = null
    applyFields({})
    setActive(nuevo)
    applySheetLayout(nuevo, null, {})
    scheduleCmEditors()
    updatePlantillasUI()
    closePlantillasPanel()
    updateStatusPill()
    return
  }
  if (dirtyDraft) {
    if (!confirm('Cambiar de plantilla borra lo que escribiste en este borrador. ¿Continuar?')) return
    setActive(nuevo)
    clearForm()
    updatePlantillasUI()
    closePlantillasPanel()
    return
  }
  setActive(nuevo)
  applySheetLayout(nuevo, null, {})
  scheduleCmEditors()
  updatePlantillasUI()
  closePlantillasPanel()
}

function setViewMode (mode) {
  viewMode = mode
  const ve = document.getElementById('view-editor')
  const vl = document.getElementById('view-library')
  const vr = document.getElementById('view-review')
  const vs = document.getElementById('view-stats')
  const verr = document.getElementById('view-errors')
  const ht = document.getElementById('header-editor-tools')
  const hl = document.getElementById('header-library-tools')
  const hx = document.getElementById('header-extra-tools')
  const hxt = document.getElementById('header-extra-title')

  const hideAllViews = () => {
    if (ve) ve.hidden = true
    if (vl) vl.hidden = true
    if (vr) vr.hidden = true
    if (vs) vs.hidden = true
    if (verr) verr.hidden = true
  }

  if (mode === 'library') {
    hideAllViews()
    if (vl) vl.hidden = false
    if (ht) ht.hidden = true
    if (hl) hl.hidden = false
    if (hx) hx.hidden = true
    refreshLibraryList()
    try {
      const u = new URL(window.location.href)
      u.searchParams.set('biblioteca', '1')
      u.searchParams.delete('repaso')
      u.searchParams.delete('progreso')
      u.searchParams.delete('errores')
      history.replaceState({}, '', u)
    } catch {
      /* ignore */
    }
  } else if (mode === 'review') {
    hideAllViews()
    if (vr) vr.hidden = false
    if (ht) ht.hidden = true
    if (hl) hl.hidden = true
    if (hx) {
      hx.hidden = false
      if (hxt) hxt.textContent = 'Repasar hoy'
    }
    window.dispatchEvent(new CustomEvent('neinei:show-review'))
    try {
      const u = new URL(window.location.href)
      u.searchParams.delete('biblioteca')
      u.searchParams.set('repaso', '1')
      u.searchParams.delete('progreso')
      u.searchParams.delete('errores')
      history.replaceState({}, '', u)
    } catch {
      /* ignore */
    }
  } else if (mode === 'stats') {
    hideAllViews()
    if (vs) vs.hidden = false
    if (ht) ht.hidden = true
    if (hl) hl.hidden = true
    if (hx) {
      hx.hidden = false
      if (hxt) hxt.textContent = 'Progreso'
    }
    window.dispatchEvent(new CustomEvent('neinei:show-stats'))
    try {
      const u = new URL(window.location.href)
      u.searchParams.delete('biblioteca')
      u.searchParams.delete('repaso')
      u.searchParams.set('progreso', '1')
      u.searchParams.delete('errores')
      history.replaceState({}, '', u)
    } catch {
      /* ignore */
    }
  } else if (mode === 'errors') {
    hideAllViews()
    if (verr) verr.hidden = false
    if (ht) ht.hidden = true
    if (hl) hl.hidden = true
    if (hx) {
      hx.hidden = false
      if (hxt) hxt.textContent = 'Mis errores'
    }
    window.dispatchEvent(new CustomEvent('neinei:show-errors'))
    try {
      const u = new URL(window.location.href)
      u.searchParams.delete('biblioteca')
      u.searchParams.delete('repaso')
      u.searchParams.delete('progreso')
      u.searchParams.set('errores', '1')
      history.replaceState({}, '', u)
    } catch {
      /* ignore */
    }
  } else {
    hideAllViews()
    if (ve) ve.hidden = false
    if (ht) ht.hidden = false
    if (hl) hl.hidden = true
    if (hx) hx.hidden = true
    try {
      const u = new URL(window.location.href)
      u.searchParams.delete('biblioteca')
      u.searchParams.delete('repaso')
      u.searchParams.delete('progreso')
      u.searchParams.delete('errores')
      history.replaceState({}, '', u)
    } catch {
      /* ignore */
    }
  }
}

function openLibraryView () {
  setViewMode('library')
}

function showEditorView () {
  setViewMode('editor')
}

function openReviewView () {
  setViewMode('review')
}

function openStatsView () {
  setViewMode('stats')
}

function openErrorsView () {
  setViewMode('errors')
}

function setActive (id) {
  activeId = id
  sections.forEach((el) => {
    const on = el.getAttribute('data-sheet') === id
    el.classList.toggle('is-active', on)
  })
  updatePlantillasUI()
  updateStatusPill()
  updateMetaErrorTypeVisibility()
}

async function loadAll () {
  const list = remoteReady ? serverRecords.slice() : loadLocalBackup()
  return list.map(normalizeSheetRecord)
}

function saveAllLocal (records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
}

async function applySheetReview (id, nivel) {
  const n = Math.min(5, Math.max(1, Math.floor(Number(nivel) || 1)))
  if (remoteReady) {
    const updated = await api.postSheetReview(id, n)
    const idx = serverRecords.findIndex((r) => r.id === id)
    if (idx >= 0) serverRecords[idx] = updated
    else serverRecords.push(updated)
    return normalizeSheetRecord(updated)
  }
  const list = loadLocalBackup().map(normalizeSheetRecord)
  const ix = list.findIndex((r) => r.id === id)
  if (ix < 0) throw new Error('Hoja no encontrada')
  const now = new Date().toISOString()
  const next = calcularProximoRepaso(n)
  list[ix] = {
    ...list[ix],
    reviewLevel: n,
    lastReviewed: now,
    nextReview: next,
    updatedAt: now
  }
  saveAllLocal(list)
  return list[ix]
}

function syncMetaInputs (name, value) {
  document.querySelectorAll(`.meta-input[data-meta="${name}"]`).forEach((el) => {
    el.value = value != null ? value : ''
  })
}

function getMetaFromDom () {
  const root = document.getElementById('editor-meta')
  if (!root) return { titulo: '', materia: '', fecha: '' }
  const t = root.querySelector('.meta-input[data-meta="titulo"]')
  const m = root.querySelector('.meta-input[data-meta="materia"]')
  const f = root.querySelector('.meta-input[data-meta="fecha"]')
  return {
    titulo: t && t.value ? t.value.trim() : '',
    materia: m && m.value ? m.value.trim() : '',
    fecha: f && f.value ? f.value : ''
  }
}

function syncPrintMetaHeader () {
  const meta = getMetaFromDom()
  const main = document.getElementById('print-rec-main')
  const sub = document.getElementById('print-rec-sub')
  if (main) main.textContent = meta.titulo || '(sin título)'
  const parts = []
  if (meta.materia) parts.push(meta.materia)
  if (meta.fecha) parts.push(meta.fecha)
  if (sub) sub.textContent = parts.join(' · ')
}

window.addEventListener('beforeprint', () => {
  syncPrintMetaHeader()
})

function setMetaOnAll (meta) {
  syncMetaInputs('titulo', meta.titulo || '')
  syncMetaInputs('materia', meta.materia || '')
  syncMetaInputs('fecha', meta.fecha || '')
}

document.querySelectorAll('.meta-input[data-meta]').forEach((inp) => {
  inp.addEventListener('input', () => {
    const name = inp.getAttribute('data-meta')
    const val = inp.value
    document.querySelectorAll(`.meta-input[data-meta="${name}"]`).forEach((el) => {
      if (el !== inp) el.value = val
    })
  })
})

document.getElementById('tags-input')?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return
  e.preventDefault()
  const inp = e.target
  const raw = inp.value.trim().slice(0, 40)
  if (!raw) return
  const cur = getTagsFromDom()
  if (cur.length >= 30) return
  if (cur.some((t) => t.toLowerCase() === raw.toLowerCase())) {
    inp.value = ''
    return
  }
  renderTagsChips([...cur, raw])
  inp.value = ''
  refreshTagsDatalist().catch(() => {})
})

function getFieldPlainText (t) {
  const v = t._cmView
  if (v && v.state != null) return v.state.doc.toString()
  return t.value
}

function collectFields () {
  const fields = {}
  document.querySelectorAll('textarea.field-input[data-f]').forEach((t) => {
    const k = t.getAttribute('data-f')
    if (k) fields[k] = getFieldPlainText(t)
  })
  const err = [false, false, false, false, false, false]
  document.querySelectorAll('input[type="checkbox"][data-f="ejercicio.err"]').forEach((c) => {
    const i = parseInt(c.getAttribute('data-err-i'), 10)
    if (!Number.isNaN(i) && i >= 0 && i < 6) err[i] = !!c.checked
  })
  fields['ejercicio.err'] = err
  let apoyo = ''
  document.querySelectorAll('.apoyo-opciones input[data-apoyo]').forEach((c) => {
    if (c.checked) apoyo = c.getAttribute('data-apoyo') || ''
  })
  fields['ejercicio.apoyo'] = apoyo
  return fields
}

function collectFieldsForTipo (tipo) {
  const full = collectFields()
  const p = `${tipo}.`
  const out = {}
  Object.keys(full).forEach((k) => {
    if (k.indexOf(p) === 0) out[k] = full[k]
  })
  return out
}

function applyFields (fields) {
  const f = fields || {}
  document.querySelectorAll('textarea.field-input[data-f]').forEach((t) => {
    const k = t.getAttribute('data-f')
    t.value = f[k] != null ? String(f[k]) : ''
    refreshMathEditor(t)
  })
  let err = f['ejercicio.err']
  if (!Array.isArray(err)) err = [false, false, false, false, false, false]
  document.querySelectorAll('input[type="checkbox"][data-f="ejercicio.err"]').forEach((c) => {
    const i = parseInt(c.getAttribute('data-err-i'), 10)
    c.checked = !!err[i]
  })
  const ap = f['ejercicio.apoyo'] || ''
  document.querySelectorAll('.apoyo-opciones input[data-apoyo]').forEach((c) => {
    c.checked = c.getAttribute('data-apoyo') === ap
  })
}

function defaultMetaFecha () {
  return new Date().toISOString().slice(0, 10)
}

function labelTipo (t) {
  const m = { concepto: 'Concepto', ejercicio: 'Ejercicio', error: 'Error', resumen: 'Resumen' }
  return m[t] || t
}

function openSearchPalette () {
  const dlg = document.getElementById('dialog-search')
  const inp = document.getElementById('dialog-search-input')
  const res = document.getElementById('dialog-search-results')
  if (!dlg || !inp || !res || typeof dlg.showModal !== 'function') return
  inp.value = ''
  res.innerHTML = ''
  dlg.showModal()
  inp.focus()
  const runQuery = async () => {
    const q = inp.value.trim().toLowerCase()
    const all = await loadAll()
    const list = q
      ? all.filter((r) => concatSearchText(r).includes(q))
      : all.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    res.innerHTML = ''
    list.slice(0, 50).forEach((r) => {
      const li = document.createElement('li')
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.setAttribute('role', 'option')
      btn.textContent = `${r.titulo || '(sin título)'} · ${labelTipo(r.tipo)}`
      btn.addEventListener('click', () => {
        dlg.close()
        loadRecord(r)
        showEditorView()
      })
      li.appendChild(btn)
      res.appendChild(li)
    })
  }
  inp.oninput = () => {
    runQuery().catch(() => {})
  }
  dlg.addEventListener(
    'close',
    () => {
      inp.oninput = null
    },
    { once: true }
  )
  runQuery().catch(() => {})
}

async function updateStatusPill () {
  const el = document.getElementById('status-pill')
  if (!el) return
  if (!currentId) {
    el.textContent = `Borrador (no guardado) · ${labelTipo(activeId)}`
    el.title = ''
    return
  }
  const all = await loadAll()
  const rec = all.find((r) => r.id === currentId)
  if (!rec) {
    el.textContent = `Borrador · ${labelTipo(activeId)}`
    return
  }
  el.textContent = `Guardada: ${rec.titulo || '(sin título)'} · ${labelTipo(rec.tipo)}`
  el.title = `Actualizado: ${rec.updatedAt || ''}`
}

function clearForm () {
  applyFields({})
  applySheetLayout(activeId, null, {})
  scheduleCmEditors()
  setMetaOnAll({ titulo: '', materia: '', fecha: defaultMetaFecha() })
  const et = document.getElementById('meta-error-type')
  if (et) et.value = ''
  renderTagsChips([])
  currentId = null
  updateStatusPill()
  refreshTagsDatalist().catch(() => {})
  window.dispatchEvent(new CustomEvent('neinei:record-loaded', { detail: { id: null } }))
}

async function saveRecord () {
  const meta = getMetaFromDom()
  if (!meta.fecha) meta.fecha = defaultMetaFecha()
  setMetaOnAll(meta)
  const tipo = activeId
  const fields = collectFieldsForTipo(tipo)
  const layoutRaw = collectLayoutFromSheet(tipo)
  const layout = isLayoutDefault(tipo, layoutRaw) ? null : layoutRaw
  const now = new Date().toISOString()
  let id = currentId
  const all = await loadAll()
  const existing = id ? all.find((r) => r.id === id) : null
  if (!id) {
    id = `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }
  const tags = getTagsFromDom()
  const etEl = document.getElementById('meta-error-type')
  const errorType =
    tipo === 'error' && etEl && etEl.value ? String(etEl.value) : null
  const rec = {
    id,
    titulo: meta.titulo || '(sin título)',
    materia: meta.materia || '',
    fecha: meta.fecha,
    tipo,
    fields,
    ...(layout != null ? { layout } : {}),
    tags,
    errorType,
    reviewLevel: existing?.reviewLevel ?? 1,
    lastReviewed: existing?.lastReviewed ?? null,
    nextReview: existing?.nextReview ?? null,
    createdAt: existing && existing.createdAt ? existing.createdAt : now,
    updatedAt: now
  }

  if (remoteReady) {
    try {
      const saved = await api.putSheet(id, rec)
      const idx = serverRecords.findIndex((r) => r.id === id)
      if (idx >= 0) serverRecords[idx] = saved
      else serverRecords.push(saved)
      currentId = saved.id
    } catch (e) {
      alert(e.message || 'No se pudo guardar en el servidor')
      return
    }
  } else {
    let list = all.slice()
    const ix = list.findIndex((r) => r.id === id)
    if (ix >= 0) list[ix] = rec
    else list.push(rec)
    saveAllLocal(list)
    currentId = id
  }
  updateStatusPill()
}

function snapshotEditorState () {
  return {
    currentId,
    activeId,
    meta: getMetaFromDom(),
    fields: collectFields(),
    layout: collectLayoutFromSheet(activeId)
  }
}

function pushEditorHistory () {
  editorHistoryStack.push(snapshotEditorState())
  if (editorHistoryStack.length > MAX_EDITOR_HISTORY) {
    editorHistoryStack.shift()
  }
  updateBackNavUI()
}

function restoreEditorSnapshot (snap) {
  if (!snap) return
  currentId = snap.currentId
  setMetaOnAll({
    titulo: snap.meta.titulo || '',
    materia: snap.meta.materia || '',
    fecha: snap.meta.fecha || defaultMetaFecha()
  })
  const aid = snap.activeId || 'concepto'
  setActive(aid)
  applySheetLayout(aid, snap.layout != null ? snap.layout : null, snap.fields || {})
  applyFields(snap.fields || {})
  scheduleCmEditors()
  updateStatusPill()
  updatePlantillasUI()
}

function goBackEditor () {
  if (!editorHistoryStack.length) return
  const snap = editorHistoryStack.pop()
  restoreEditorSnapshot(snap)
  updateBackNavUI()
}

function updateBackNavUI () {
  const b = document.getElementById('btn-volver-nota')
  if (b) b.disabled = editorHistoryStack.length === 0
}

function openSheetFromWikiLink (rec) {
  if (!rec) return
  if (rec.id !== currentId) {
    pushEditorHistory()
  }
  loadRecord(rec)
}

function loadRecord (rec) {
  if (!rec) return
  const n = normalizeSheetRecord(rec)
  showEditorView()
  currentId = n.id
  setMetaOnAll({
    titulo: n.titulo === '(sin título)' ? '' : (n.titulo || ''),
    materia: n.materia || '',
    fecha: n.fecha || defaultMetaFecha()
  })
  const tipo = n.tipo || 'concepto'
  setActive(tipo)
  applySheetLayout(tipo, n.layout, n.fields || {})
  applyFields(n.fields || {})
  scheduleCmEditors()
  renderTagsChips(n.tags || [])
  const et = document.getElementById('meta-error-type')
  if (et) et.value = n.errorType && tipo === 'error' ? n.errorType : ''
  updateStatusPill()
  refreshTagsDatalist().catch(() => {})
  window.dispatchEvent(new CustomEvent('neinei:record-loaded', { detail: { id: n.id } }))
}

function concatSearchText (rec) {
  const parts = [rec.titulo, rec.materia, rec.fecha, rec.tipo]
  if (rec.tags && rec.tags.length) parts.push(rec.tags.join(' '))
  if (rec.fields) {
    Object.keys(rec.fields).forEach((k) => {
      const v = rec.fields[k]
      if (Array.isArray(v)) parts.push(v.map((x) => (x ? '1' : '0')).join(''))
      else parts.push(String(v))
    })
  }
  return parts.join(' ').toLowerCase()
}

async function refreshLibraryList () {
  const list = document.getElementById('library-list')
  if (!list) return
  const desde = document.getElementById('filtro-desde')?.value
  const hasta = document.getElementById('filtro-hasta')?.value
  const ft = (document.getElementById('filtro-titulo')?.value || '').trim().toLowerCase()
  const fm = (document.getElementById('filtro-materia')?.value || '').trim().toLowerCase()
  const ftipo = document.getElementById('filtro-tipo')?.value
  const fcont = (document.getElementById('filtro-contenido')?.value || '').trim().toLowerCase()
  const ftagRaw = (document.getElementById('filtro-tags')?.value || '').trim().toLowerCase()
  const ftagTokens = ftagRaw
    ? ftagRaw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
    : []

  const all = (await loadAll()).slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))

  const filtered = all.filter((r) => {
    if (desde && (r.fecha || '') < desde) return false
    if (hasta && (r.fecha || '') > hasta) return false
    if (ftipo && r.tipo !== ftipo) return false
    if (ft && String(r.titulo || '').toLowerCase().indexOf(ft) === -1) return false
    if (fm && String(r.materia || '').toLowerCase().indexOf(fm) === -1) return false
    if (fcont && concatSearchText(r).indexOf(fcont) === -1) return false
    if (ftagTokens.length) {
      const tagsLow = (r.tags || []).map((t) => String(t).toLowerCase())
      if (!ftagTokens.every((tok) => tagsLow.some((t) => t.includes(tok)))) return false
    }
    return true
  })

  list.innerHTML = ''
  if (!filtered.length) {
    const li0 = document.createElement('li')
    li0.style.display = 'block'
    li0.innerHTML = '<div class="library-empty">No hay hojas que coincidan. Ajusta filtros o guarda una hoja nueva.</div>'
    list.appendChild(li0)
    return
  }
  filtered.forEach((r) => {
    const li = document.createElement('li')
    li.className = 'library-card'
    const bOpen = document.createElement('button')
    bOpen.type = 'button'
    bOpen.className = 'open-rec'
    const badge = document.createElement('span')
    badge.className = 'library-badge'
    badge.textContent = labelTipo(r.tipo)
    const mainEl = document.createElement('div')
    mainEl.className = 'rec-main'
    mainEl.textContent = r.titulo || '(sin título)'
    const subEl = document.createElement('div')
    subEl.className = 'rec-sub'
    subEl.textContent = `${r.materia ? `${r.materia} · ` : ''}${r.fecha || ''} · ${r.updatedAt ? r.updatedAt.slice(0, 16).replace('T', ' ') : ''}`
    bOpen.appendChild(badge)
    bOpen.appendChild(mainEl)
    bOpen.appendChild(subEl)
    bOpen.addEventListener('click', () => {
      showEditorView()
      loadRecord(r)
    })
    const bDel = document.createElement('button')
    bDel.type = 'button'
    bDel.className = 'del-rec'
    bDel.textContent = 'Eliminar'
    bDel.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta hoja de forma permanente?')) return
      if (remoteReady) {
        try {
          await api.deleteSheetRemote(r.id)
          serverRecords = serverRecords.filter((x) => x.id !== r.id)
        } catch (e) {
          alert(e.message || 'No se pudo eliminar')
          return
        }
      } else {
        const rest = loadLocalBackup().filter((x) => x.id !== r.id)
        saveAllLocal(rest)
      }
      if (currentId === r.id) clearForm()
      refreshLibraryList()
    })
    li.appendChild(bOpen)
    li.appendChild(bDel)
    list.appendChild(li)
  })
}

document.querySelectorAll('.plantilla-opt').forEach((btn) => {
  btn.addEventListener('click', () => {
    trySelectPlantilla(btn.getAttribute('data-plantilla'))
  })
})

function finishNewSheet (tipo) {
  const dlg = document.getElementById('dialog-pick-tipo')
  if (dlg && dlg.open) dlg.close()
  if (tipo && ['concepto', 'ejercicio', 'error', 'resumen'].includes(tipo)) {
    setActive(tipo)
  }
  clearForm()
  updatePlantillasUI()
  showEditorView()
}

document.querySelectorAll('.pick-tipo-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const t = btn.getAttribute('data-new-tipo')
    if (t) finishNewSheet(t)
  })
})
document.getElementById('dialog-pick-cancel')?.addEventListener('click', () => {
  document.getElementById('dialog-pick-tipo')?.close()
})

let layoutDialogDraft = null

function renderLayoutDialogList () {
  const ul = document.getElementById('dialog-layout-list')
  if (!ul || !layoutDialogDraft) return
  const pm = document.getElementById('dialog-layout-print-meta')
  if (pm) pm.checked = layoutDialogDraft.printMeta !== false
  ul.innerHTML = ''
  const tipo = activeId
  for (const blockId of layoutDialogDraft.order) {
    const li = document.createElement('li')
    li.className = 'dialog-layout-row'
    const isHidden = layoutDialogDraft.hidden.includes(blockId)
    const visWrap = document.createElement('div')
    visWrap.className = 'layout-vis'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = !isHidden
    cb.title = 'Mostrar en la hoja'
    const visLab = document.createElement('label')
    visLab.appendChild(cb)
    visLab.appendChild(document.createTextNode(' Mostrar'))
    visWrap.appendChild(visLab)
    cb.addEventListener('change', () => {
      layoutDialogDraft = setBlockHidden(layoutDialogDraft, blockId, !cb.checked)
    })
    const inp = document.createElement('input')
    inp.type = 'text'
    inp.value = displayLabelForBlock(tipo, blockId, layoutDialogDraft)
    inp.addEventListener('input', () => {
      layoutDialogDraft = setBlockLabelForTipo(
        layoutDialogDraft,
        tipo,
        blockId,
        inp.value
      )
    })
    const btns = document.createElement('div')
    btns.className = 'dialog-layout-row-btns'
    const bUp = document.createElement('button')
    bUp.type = 'button'
    bUp.textContent = '↑'
    bUp.title = 'Subir'
    bUp.addEventListener('click', () => {
      layoutDialogDraft = moveBlockInLayout(layoutDialogDraft, blockId, -1)
      renderLayoutDialogList()
    })
    const bDn = document.createElement('button')
    bDn.type = 'button'
    bDn.textContent = '↓'
    bDn.title = 'Bajar'
    bDn.addEventListener('click', () => {
      layoutDialogDraft = moveBlockInLayout(layoutDialogDraft, blockId, 1)
      renderLayoutDialogList()
    })
    btns.appendChild(bUp)
    btns.appendChild(bDn)
    const extras = document.createElement('div')
    extras.className = 'dialog-layout-row-btns'
    if (isCustomFieldKey(tipo, blockId)) {
      const bRm = document.createElement('button')
      bRm.type = 'button'
      bRm.textContent = 'Quitar'
      bRm.addEventListener('click', () => {
        const sid = blockId.slice(`${tipo}.`.length)
        layoutDialogDraft = removeCustomBlock(layoutDialogDraft, tipo, sid)
        renderLayoutDialogList()
      })
      extras.appendChild(bRm)
    }
    li.appendChild(visWrap)
    li.appendChild(inp)
    li.appendChild(btns)
    li.appendChild(extras)
    ul.appendChild(li)
  }
}

function openLayoutDialog () {
  const dlg = document.getElementById('dialog-layout')
  if (!dlg || typeof dlg.showModal !== 'function') return
  layoutDialogDraft = normalizeLayout(activeId, collectLayoutFromSheet(activeId))
  const pm = document.getElementById('dialog-layout-print-meta')
  if (pm) {
    pm.checked = layoutDialogDraft.printMeta !== false
    pm.onchange = () => {
      if (layoutDialogDraft) layoutDialogDraft.printMeta = pm.checked
    }
  }
  renderLayoutDialogList()
  dlg.showModal()
}

function applyLayoutDialogAndClose () {
  const dlg = document.getElementById('dialog-layout')
  if (!layoutDialogDraft) {
    dlg?.close()
    return
  }
  const fields = collectFields()
  applySheetLayout(activeId, layoutDialogDraft, fields)
  applyFields(fields)
  scheduleCmEditors()
  dlg?.close()
}

document.getElementById('btn-personalizar-apartados')?.addEventListener('click', () => {
  showEditorView()
  openLayoutDialog()
})

function safeAlias (raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64)
}

let lastFocusedField = null
document.addEventListener('focusin', (e) => {
  const t = e.target
  if (!t || typeof t.closest !== 'function') return
  const box = t.closest('.box')
  if (!box) return
  const ta = box.querySelector('textarea.field-input[data-f]')
  if (ta) lastFocusedField = ta
})

function insertEmbedAtCaret (embed) {
  const ta = lastFocusedField
  if (!ta) return false
  const { plain, caret } = getPlainAndCaret(ta)
  insertPlainIntoField(ta, caret, caret, embed, caret + embed.length)
  return true
}

function openGalleryDialog () {
  const dlg = document.getElementById('dialog-gallery')
  if (!dlg || typeof dlg.showModal !== 'function') return
  renderGalleryList().catch(() => {})
  dlg.showModal()
  document.getElementById('gallery-alias')?.focus()
}

let gallerySelected = null

function showGalleryPreview (asset) {
  gallerySelected = asset
  const panel = document.getElementById('gallery-preview')
  const img = document.getElementById('gallery-preview-img')
  const inpA = document.getElementById('gallery-edit-alias')
  const inpT = document.getElementById('gallery-edit-title')
  if (!panel || !img || !inpA || !inpT) return
  panel.hidden = false
  img.src = `/api/assets/${encodeURIComponent(asset.alias)}`
  img.alt = asset.title || asset.alias
  inpA.value = asset.alias
  inpT.value = asset.title || ''
}

async function renderGalleryList () {
  const ul = document.getElementById('gallery-list')
  const msg = document.getElementById('gallery-msg')
  if (!ul) return
  ul.replaceChildren()
  const panel = document.getElementById('gallery-preview')
  if (panel) panel.hidden = true
  gallerySelected = null
  if (msg) {
    msg.textContent = 'Cargando…'
    msg.classList.remove('error')
  }
  try {
    const assets = await api.listAssets()
    if (!assets.length) {
      const li = document.createElement('li')
      li.className = 'dialog-gallery-item'
      li.textContent = 'Aún no has subido imágenes.'
      ul.appendChild(li)
      if (msg) msg.textContent = ''
      return
    }
    for (const a of assets) {
      const li = document.createElement('li')
      li.className = 'dialog-gallery-item'
      li.tabIndex = 0
      li.setAttribute('role', 'button')
      li.setAttribute('aria-label', `Ver ${a.alias}`)
      const img = document.createElement('img')
      img.className = 'dialog-gallery-thumb'
      img.alt = a.title || a.alias || ''
      img.loading = 'lazy'
      img.decoding = 'async'
      img.src = `/api/assets/${encodeURIComponent(a.alias)}`
      const meta = document.createElement('div')
      meta.className = 'dialog-gallery-meta'
      const p1 = document.createElement('p')
      p1.className = 'dialog-gallery-alias'
      p1.textContent = a.alias
      const p2 = document.createElement('p')
      p2.className = 'dialog-gallery-title2'
      p2.textContent = a.title || ''
      meta.appendChild(p1)
      meta.appendChild(p2)
      const acts = document.createElement('div')
      acts.className = 'dialog-gallery-actions'
      const bCopy = document.createElement('button')
      bCopy.type = 'button'
      bCopy.className = 'btn-secondary'
      bCopy.textContent = 'Copiar embed'
      bCopy.addEventListener('click', async () => {
        const txt = `![[${a.alias}|600]]`
        try {
          await navigator.clipboard.writeText(txt)
          if (msg) {
            msg.textContent = `Copiado: ${txt}`
            msg.classList.remove('error')
          }
        } catch {
          if (msg) {
            msg.textContent = `No se pudo copiar. Usa: ${txt}`
            msg.classList.add('error')
          }
        }
      })
      const bDel = document.createElement('button')
      bDel.type = 'button'
      bDel.className = 'btn-secondary'
      bDel.textContent = 'Borrar'
      bDel.addEventListener('click', async () => {
        if (!confirm(`¿Borrar "${a.alias}"?`)) return
        try {
          await api.deleteAsset(a.alias)
          await renderGalleryList()
        } catch (e) {
          if (msg) {
            msg.textContent = e.message || 'Error al borrar'
            msg.classList.add('error')
          }
        }
      })
      acts.appendChild(bCopy)
      acts.appendChild(bDel)
      li.appendChild(img)
      li.appendChild(meta)
      li.appendChild(acts)
      const pick = () => {
        ul.querySelectorAll('.dialog-gallery-item.is-active').forEach((n) => n.classList.remove('is-active'))
        li.classList.add('is-active')
        showGalleryPreview(a)
      }
      li.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest && ev.target.closest('button')
        if (btn) return
        pick()
      })
      li.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault()
          pick()
        }
      })
      ul.appendChild(li)
    }
    if (msg) msg.textContent = ''
  } catch (e) {
    if (msg) {
      msg.textContent = e.message || 'Error al cargar'
      msg.classList.add('error')
    }
  }
}

document.getElementById('btn-galeria')?.addEventListener('click', () => {
  showEditorView()
  openGalleryDialog()
})

document.getElementById('btn-gallery-close')?.addEventListener('click', () => {
  document.getElementById('dialog-gallery')?.close()
})

document.getElementById('btn-gallery-refresh')?.addEventListener('click', () => {
  renderGalleryList().catch(() => {})
})

document.getElementById('btn-gallery-pick')?.addEventListener('click', () => {
  document.getElementById('gallery-file')?.click()
})

document.getElementById('gallery-upload-form')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const inpAlias = document.getElementById('gallery-alias')
  const inpTitle = document.getElementById('gallery-title')
  const inpFile = document.getElementById('gallery-file')
  const msg = document.getElementById('gallery-msg')
  const file = inpFile?.files?.[0]
  const alias = safeAlias(inpAlias?.value || '')
  const title = String(inpTitle?.value || '').trim()
  if (msg) {
    msg.textContent = ''
    msg.classList.remove('error')
  }
  if (!alias) {
    if (msg) {
      msg.textContent = 'Pon un alias (único).'
      msg.classList.add('error')
    }
    return
  }
  if (!file) {
    if (msg) {
      msg.textContent = 'Elige una imagen (PNG/JPEG/WebP).'
      msg.classList.add('error')
    }
    return
  }
  try {
    if (msg) {
      msg.textContent = 'Subiendo…'
      msg.classList.remove('error')
    }
    await api.uploadAsset(file, { alias, title })
    if (msg) msg.textContent = `Subida OK. Usa: ![[${alias}|600]]`
    if (inpFile) inpFile.value = ''
    await renderGalleryList()
  } catch (err) {
    if (msg) {
      msg.textContent = err.message || 'Error'
      msg.classList.add('error')
    }
  }
})

document.getElementById('btn-gallery-copy')?.addEventListener('click', async () => {
  const msg = document.getElementById('gallery-msg')
  if (!gallerySelected) return
  const txt = `![[${gallerySelected.alias}|600]]`
  try {
    await navigator.clipboard.writeText(txt)
    if (msg) {
      msg.textContent = `Copiado: ${txt}`
      msg.classList.remove('error')
    }
  } catch {
    if (msg) {
      msg.textContent = `No se pudo copiar. Usa: ${txt}`
      msg.classList.add('error')
    }
  }
})

document.getElementById('btn-gallery-insert')?.addEventListener('click', () => {
  const msg = document.getElementById('gallery-msg')
  if (!gallerySelected) return
  const txt = `![[${gallerySelected.alias}|600]]`
  const ok = insertEmbedAtCaret(txt)
  if (!ok && msg) {
    msg.textContent = `No pude detectar el campo activo. Copia y pega: ${txt}`
    msg.classList.add('error')
  }
})

document.getElementById('btn-gallery-save')?.addEventListener('click', async () => {
  const msg = document.getElementById('gallery-msg')
  if (!gallerySelected) return
  const inpA = document.getElementById('gallery-edit-alias')
  const inpT = document.getElementById('gallery-edit-title')
  const nextAlias = safeAlias(inpA?.value || '')
  const nextTitle = String(inpT?.value || '').trim()
  if (!nextAlias) {
    if (msg) {
      msg.textContent = 'Alias inválido.'
      msg.classList.add('error')
    }
    return
  }
  try {
    if (msg) {
      msg.textContent = 'Guardando…'
      msg.classList.remove('error')
    }
    const { asset } = await api.updateAsset(gallerySelected.alias, {
      alias: nextAlias,
      title: nextTitle
    })
    gallerySelected = asset
    if (msg) msg.textContent = 'Cambios guardados.'
    await renderGalleryList()
  } catch (e) {
    if (msg) {
      msg.textContent = e.message || 'Error'
      msg.classList.add('error')
    }
  }
})

document.getElementById('dialog-layout-add')?.addEventListener('click', () => {
  if (!layoutDialogDraft) return
  layoutDialogDraft = addCustomBlock(layoutDialogDraft, activeId, 'Nuevo apartado')
  renderLayoutDialogList()
})

document.getElementById('dialog-layout-reset')?.addEventListener('click', () => {
  if (!layoutDialogDraft) return
  layoutDialogDraft = normalizeLayout(activeId, null)
  renderLayoutDialogList()
})

document.getElementById('dialog-layout-apply')?.addEventListener('click', () => {
  applyLayoutDialogAndClose()
})

document.getElementById('dialog-layout-cancel')?.addEventListener('click', () => {
  document.getElementById('dialog-layout')?.close()
})

document.getElementById('dialog-layout')?.addEventListener('close', () => {
  layoutDialogDraft = null
})

const apoyoOpciones = document.querySelector('.apoyo-opciones')
if (apoyoOpciones) {
  apoyoOpciones.addEventListener('change', (e) => {
    const t = e.target
    if (t.type !== 'checkbox') return
    if (t.checked) {
      apoyoOpciones.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        if (cb !== t) cb.checked = false
      })
    }
  })
}

function getActiveSheetEl () {
  return document.getElementById(`sheet-${activeId}`)
}

function slugify (s) {
  return String(s || 'hoja')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/gi, '')
    .slice(0, 48) || 'hoja'
}

document.getElementById('btn-guardar')?.addEventListener('click', () => {
  showEditorView()
  saveRecord()
})

document.getElementById('btn-nueva')?.addEventListener('click', () => {
  if (currentId !== null || isDraftNonEmpty()) {
    if (!confirm('¿Nueva hoja? Se perderán los cambios no guardados en el editor.')) return
  }
  const dlg = document.getElementById('dialog-pick-tipo')
  if (dlg && typeof dlg.showModal === 'function') dlg.showModal()
  else {
    const t = window.prompt('Tipo: concepto, ejercicio, error o resumen', 'concepto')
    if (!t) return
    const n = String(t).toLowerCase().trim()
    if (['concepto', 'ejercicio', 'error', 'resumen'].includes(n)) finishNewSheet(n)
  }
})

document.getElementById('btn-biblioteca')?.addEventListener('click', () => {
  if (viewMode === 'library') showEditorView()
  else openLibraryView()
})
document.getElementById('btn-volver-editor')?.addEventListener('click', () => {
  showEditorView()
})

document.getElementById('btn-volver-nota')?.addEventListener('click', () => {
  goBackEditor()
})

document.addEventListener('keydown', (e) => {
  if (!e.altKey || e.key !== 'ArrowLeft' || e.repeat) return
  if (editorHistoryStack.length === 0) return
  e.preventDefault()
  goBackEditor()
})

;[
  'filtro-desde',
  'filtro-hasta',
  'filtro-titulo',
  'filtro-materia',
  'filtro-tipo',
  'filtro-contenido',
  'filtro-tags'
].forEach((id) => {
  const n = document.getElementById(id)
  if (!n) return
  n.addEventListener('input', () => refreshLibraryList())
  if (n.tagName === 'SELECT') n.addEventListener('change', () => refreshLibraryList())
})

document.getElementById('btn-print')?.addEventListener('click', () => {
  showEditorView()
  document.body.classList.remove('imprimir-todas')
  syncPrintMetaHeader()
  window.print()
})

document.getElementById('btn-pdf')?.addEventListener('click', () => {
  showEditorView()
  const page = document.querySelector('.sheet-page')
  if (!page || typeof globalThis.html2pdf === 'undefined') {
    alert('No se pudo cargar el generador de PDF. Comprueba tu conexión.')
    return
  }
  syncPrintMetaHeader()
  const wrap = page.cloneNode(true)
  wrap.classList.add('pdf-export-root')
  wrap.style.position = 'fixed'
  wrap.style.left = '-9999px'
  wrap.style.top = '0'
  wrap.style.width = '210mm'
  wrap.querySelectorAll('section[data-sheet]:not(.is-active)').forEach((s) => s.remove())
  document.body.appendChild(wrap)
  const m = getMetaFromDom()
  const name = `${slugify(m.titulo)}-${activeId}.pdf`
  const opt = {
    margin: 0,
    filename: name,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: 'avoid-all' }
  }
  const done = () => {
    try {
      wrap.remove()
    } catch {
      /* ignore */
    }
  }
  globalThis
    .html2pdf()
    .set(opt)
    .from(wrap)
    .save()
    .then(done)
    .catch(done)
})

async function afterAuth (user) {
  remoteReady = true
  setUserBar(user)
  setShellLocked(false)
  try {
    serverRecords = await api.getSheets()
  } catch (e) {
    alert(e.message || 'Error al cargar datos')
    remoteReady = false
    serverRecords = []
    try {
      await api.logout()
    } catch {
      /* ignore */
    }
    redirectToLogin()
    return
  }
  updateStatusPill()
  const btnImp = document.getElementById('btn-import-local')
  if (btnImp) btnImp.hidden = !hasLocalBackup()
}

async function handleLogout () {
  if (remoteReady) {
    try {
      await api.logout()
    } catch {
      /* ignore */
    }
  }
  remoteReady = false
  serverRecords = []
  setUserBar(null)
  window.location.href = '/login.html'
}

document.getElementById('btn-logout')?.addEventListener('click', () => {
  handleLogout()
})

document.getElementById('btn-extra-volver-editor')?.addEventListener('click', () => {
  showEditorView()
})
document.getElementById('btn-nav-stats')?.addEventListener('click', () => openStatsView())
document.getElementById('btn-nav-review')?.addEventListener('click', () => openReviewView())
document.getElementById('btn-nav-errors')?.addEventListener('click', () => openErrorsView())

document.getElementById('fab-nueva')?.addEventListener('click', () => {
  document.getElementById('btn-nueva')?.click()
})

document.getElementById('btn-modo-foco')?.addEventListener('click', () => {
  document.getElementById('app-shell')?.classList.toggle('is-focus-mode')
})

document.getElementById('btn-export-json')?.addEventListener('click', async () => {
  try {
    const sheets = await loadAll()
    const blob = new Blob(
      [
        JSON.stringify(
          { version: 1, exportedAt: new Date().toISOString(), sheets },
          null,
          2
        )
      ],
      { type: 'application/json' }
    )
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `neinei-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e) {
    alert(e.message || 'Error al exportar')
  }
})

document.getElementById('btn-import-json')?.addEventListener('click', () => {
  document.getElementById('input-import-json')?.click()
})

document.getElementById('input-import-json')?.addEventListener('change', async (e) => {
  const f = e.target.files?.[0]
  e.target.value = ''
  if (!f) return
  try {
    const text = await f.text()
    const data = JSON.parse(text)
    if (!data || data.version !== 1 || !Array.isArray(data.sheets)) {
      throw new Error('Archivo no válido: se espera { version: 1, sheets: [...] }')
    }
    if (!confirm(`¿Importar ${data.sheets.length} hoja(s)? Se fusionan por id.`)) return
    const merged = data.sheets.map(normalizeSheetRecord)
    if (remoteReady) {
      for (const rec of merged) {
        await api.putSheet(rec.id, rec)
      }
      serverRecords = await api.getSheets()
    } else {
      const cur = loadLocalBackup().map(normalizeSheetRecord)
      const byId = new Map(cur.map((r) => [r.id, r]))
      for (const r of merged) {
        const prev = byId.get(r.id) || {}
        byId.set(r.id, normalizeSheetRecord({ ...prev, ...r, id: r.id }))
      }
      saveAllLocal([...byId.values()])
    }
    await refreshTagsDatalist()
    refreshLibraryList()
    alert('Importación completada')
  } catch (err) {
    alert(err.message || 'Error al importar')
  }
})

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey
  if (!mod || e.repeat) return
  const tag = e.target && e.target.tagName
  const inSearch = e.target && e.target.id === 'dialog-search-input'
  if (e.key === 's' || e.key === 'S') {
    if (tag === 'INPUT' && !inSearch) return
    e.preventDefault()
    saveRecord().catch(() => {})
    return
  }
  if (e.key === 'k' || e.key === 'K') {
    e.preventDefault()
    openSearchPalette()
    return
  }
  if (e.key === 'n' || e.key === 'N') {
    if (inSearch) return
    e.preventDefault()
    document.getElementById('btn-nueva')?.click()
  }
})

document.getElementById('btn-import-local')?.addEventListener('click', async () => {
  const records = loadLocalBackup()
  if (!records.length) return
  if (!confirm(`¿Importar ${records.length} hoja(s) desde este navegador al servidor?`)) return
  try {
    await api.importLocalRecords(records)
    serverRecords = await api.getSheets()
    const btnImp = document.getElementById('btn-import-local')
    if (btnImp) btnImp.hidden = true
    if (confirm('¿Borrar la copia local del navegador tras importar?')) {
      localStorage.removeItem(STORAGE_KEY)
    }
    refreshLibraryList()
    alert('Importación completada')
  } catch (e) {
    alert(e.message || 'Error al importar')
  }
})

async function boot () {
  initWikiLinks({ loadAll, openSheet: openSheetFromWikiLink })
  setMetaOnAll({ titulo: '', materia: '', fecha: defaultMetaFecha() })
  const btnImp = document.getElementById('btn-import-local')

  async function mountEditorsAndChrome () {
    ;['concepto', 'ejercicio', 'error', 'resumen'].forEach((t) => {
      applySheetLayout(t, null, {})
    })
    applyPrintMetaDataset(normalizeLayout(activeId, null))
    await initMathInlineEditors()
    updateStatusPill()
    updatePlantillasUI()
    updateMetaErrorTypeVisibility()
    await refreshTagsDatalist()

    initReviewView({
      applySheetReview,
      loadAll,
      isRemote: () => remoteReady,
      openSheet: loadRecord,
      showEditorView
    })
    initStatsView({ isRemote: () => remoteReady, loadAll })
    initErrorsDashboard({ loadAll, openSheet: loadRecord, showEditorView })
    initBacklinksAndPreview({ loadAll, openSheet: loadRecord, showEditorView })

    const sp = new URLSearchParams(window.location.search)
    if (sp.get('repaso') === '1') setViewMode('review')
    else if (sp.get('progreso') === '1') setViewMode('stats')
    else if (sp.get('errores') === '1') setViewMode('errors')
    else if (sp.get('biblioteca') === '1') setViewMode('library')
  }

  if (wantsLocalOnly()) {
    remoteReady = false
    serverRecords = []
    setUserBar(null)
    setShellLocked(false)
    if (btnImp) btnImp.hidden = true
    await mountEditorsAndChrome()
    return
  }

  setShellLocked(true)
  setUserBar(null)
  if (btnImp) btnImp.hidden = !hasLocalBackup()

  try {
    const { ok, user } = await api.getMe()
    if (ok && user) {
      await afterAuth(user)
    } else {
      redirectToLogin()
      return
    }
  } catch {
    redirectToLogin('err=offline')
    return
  }
  await mountEditorsAndChrome()
}

boot().catch((err) => {
  console.error('NeiNei boot:', err)
})
