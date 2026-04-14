/**
 * Validación, serialización y helpers compartidos para hojas (sheets).
 * Usado por routes/sheets.js, review.js y stats.js.
 */

export const LAYOUT_JSON_MAX = 48000

export const ERROR_TYPES = new Set(['concepto', 'procedimiento', 'signos', 'otro'])

/** SELECT completo de columnas de hoja (post-migración). */
export const SHEET_SELECT_SQL = `SELECT id, titulo, materia, fecha, tipo, fields_json, created_at, updated_at,
  review_level, last_reviewed, next_review, error_type, tags_json
FROM sheets`

export function migrateSheetsColumns (db) {
  const cols = db.prepare('PRAGMA table_info(sheets)').all()
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('review_level')) {
    db.exec('ALTER TABLE sheets ADD COLUMN review_level INTEGER DEFAULT 1')
  }
  if (!names.has('last_reviewed')) {
    db.exec('ALTER TABLE sheets ADD COLUMN last_reviewed TEXT')
  }
  if (!names.has('next_review')) {
    db.exec('ALTER TABLE sheets ADD COLUMN next_review TEXT')
  }
  if (!names.has('error_type')) {
    db.exec('ALTER TABLE sheets ADD COLUMN error_type TEXT')
  }
  if (!names.has('tags_json')) {
    db.exec("ALTER TABLE sheets ADD COLUMN tags_json TEXT DEFAULT '[]'")
  }
}

export function parseFieldsJson (str) {
  let o = {}
  try {
    o = JSON.parse(str || '{}')
  } catch {
    return { fields: {}, layout: null }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) {
    return { fields: {}, layout: null }
  }
  if (o.fields != null && typeof o.fields === 'object' && !Array.isArray(o.fields)) {
    const layout =
      o.layout != null && typeof o.layout === 'object' && !Array.isArray(o.layout)
        ? o.layout
        : null
    return { fields: o.fields, layout }
  }
  return { fields: o, layout: null }
}

export function serializeFieldsJson (fields, layout) {
  if (layout == null) {
    return JSON.stringify(fields)
  }
  return JSON.stringify({ fields, layout })
}

export function validateLayout (layout) {
  if (layout == null) return { layout: null }
  if (typeof layout !== 'object' || Array.isArray(layout)) {
    return { error: 'layout inválido' }
  }
  const raw = JSON.stringify(layout)
  if (raw.length > LAYOUT_JSON_MAX) {
    return { error: 'layout demasiado grande' }
  }
  const out = {
    version: 1,
    order: [],
    hidden: [],
    labels: {},
    customBlocks: [],
    printMeta: layout.printMeta === false ? false : true
  }
  if (typeof layout.version === 'number' && Number.isFinite(layout.version)) {
    out.version = Math.min(999, Math.max(0, Math.floor(layout.version)))
  }
  if (Array.isArray(layout.order)) {
    out.order = layout.order
      .map((x) => String(x).slice(0, 256))
      .filter(Boolean)
      .slice(0, 200)
  }
  if (Array.isArray(layout.hidden)) {
    out.hidden = layout.hidden
      .map((x) => String(x).slice(0, 256))
      .filter(Boolean)
      .slice(0, 200)
  }
  if (layout.labels && typeof layout.labels === 'object' && !Array.isArray(layout.labels)) {
    for (const [k, v] of Object.entries(layout.labels)) {
      const kk = String(k).slice(0, 256)
      out.labels[kk] = String(v ?? '').slice(0, 500)
    }
  }
  if (Array.isArray(layout.customBlocks)) {
    out.customBlocks = layout.customBlocks
      .slice(0, 100)
      .map((b) => ({
        id: String(b?.id || '').slice(0, 128),
        label: String(b?.label || 'Apartado').slice(0, 200)
      }))
      .filter((b) => b.id.length > 0)
  }
  return { layout: out }
}

export function normalizeTags (input) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const out = []
  for (const x of input) {
    const s = String(x ?? '').trim().slice(0, 40)
    if (!s) continue
    const low = s.toLowerCase()
    if (seen.has(low)) continue
    seen.add(low)
    out.push(s)
    if (out.length >= 30) break
  }
  return out
}

export function normalizeErrorType (raw, tipo) {
  if (tipo !== 'error') return null
  const s = String(raw || '').trim().toLowerCase()
  if (!s || !ERROR_TYPES.has(s)) return null
  return s
}

export function parseTagsColumn (str) {
  try {
    const t = JSON.parse(str || '[]')
    return Array.isArray(t) ? normalizeTags(t) : []
  } catch {
    return []
  }
}

export function rowToRecord (r) {
  const { fields, layout } = parseFieldsJson(r.fields_json)
  const tags = parseTagsColumn(r.tags_json)
  const reviewLevel = Number(r.review_level)
  return {
    id: r.id,
    titulo: r.titulo,
    materia: r.materia,
    fecha: r.fecha,
    tipo: r.tipo,
    fields,
    layout,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    reviewLevel: Number.isFinite(reviewLevel) && reviewLevel >= 1 ? Math.min(5, reviewLevel) : 1,
    lastReviewed: r.last_reviewed || null,
    nextReview: r.next_review || null,
    errorType: r.error_type || null,
    tags
  }
}

export function validateRecordBody (body) {
  if (!body || typeof body !== 'object') return { error: 'Cuerpo inválido' }
  const tipo = body.tipo
  const allowed = ['concepto', 'ejercicio', 'error', 'resumen']
  if (!allowed.includes(tipo)) return { error: 'tipo inválido' }
  const titulo = String(body.titulo ?? '').slice(0, 500)
  const materia = String(body.materia ?? '').slice(0, 200)
  const fecha = String(body.fecha ?? '').slice(0, 32)
  const rawFields = body.fields && typeof body.fields === 'object' ? body.fields : {}
  const fields = { ...rawFields }
  delete fields.fields
  delete fields.layout
  let layout = null
  if (body.layout != null) {
    const lr = validateLayout(body.layout)
    if (lr.error) return { error: lr.error }
    layout = lr.layout
  }
  const tags = normalizeTags(body.tags)
  const errorType = normalizeErrorType(body.errorType, tipo)
  return { titulo, materia, fecha, tipo, fields, layout, tags, errorType }
}

/** Spaced repetition: días hasta el siguiente repaso según nivel 1–5. */
export function calcularProximoRepaso (nivel) {
  const n = Math.min(5, Math.max(1, Number(nivel) || 1))
  const dias = { 1: 1, 2: 3, 3: 7, 4: 15, 5: 30 }
  const d = dias[n] ?? 1
  const hoy = new Date()
  hoy.setDate(hoy.getDate() + d)
  return hoy.toISOString()
}
