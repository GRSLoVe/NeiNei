/**
 * Diseño por hoja: orden, visibilidad, etiquetas y apartados de texto personalizados.
 */

export const LAYOUT_VERSION = 1

export const DEFAULT_ORDER = {
  concepto: [
    'concepto.tema',
    'concepto.idea_principal',
    'concepto.formula_clave',
    'concepto.explicacion_simple',
    'concepto.condiciones',
    'concepto.error_comun',
    'concepto.ejemplo',
    'concepto.intuicion'
  ],
  ejercicio: [
    'ejercicio.numero',
    'ejercicio.tema',
    'ejercicio.que_piden',
    'ejercicio.datos_clave',
    'ejercicio.plan',
    'ejercicio.resolucion',
    'ejercicio.resultado',
    'ejercicio.verificacion',
    'ejercicio.err',
    'ejercicio.tiempo_inicio',
    'ejercicio.tiempo_fin',
    'ejercicio.apoyo'
  ],
  error: [
    'error.ejercicio_ref',
    'error.que_hice_mal',
    'error.porque',
    'error.como_bien',
    'error.regla',
    'error.ejercicio_similar'
  ],
  resumen: [
    'resumen.tema',
    'resumen.formulas',
    'resumen.casos',
    'resumen.trucos',
    'resumen.errores_evitar',
    'resumen.ejemplo_tipico'
  ]
}

export const DEFAULT_LABELS = {
  'concepto.tema': 'Tema',
  'concepto.idea_principal': 'Idea principal',
  'concepto.formula_clave': 'Fórmula clave',
  'concepto.explicacion_simple': 'Explicación simple',
  'concepto.condiciones': 'Condiciones',
  'concepto.error_comun': 'Error común',
  'concepto.ejemplo': 'Ejemplo',
  'concepto.intuicion': 'Intuición',
  'ejercicio.numero': 'Número de ejercicio',
  'ejercicio.tema': 'Tema',
  'ejercicio.que_piden': 'Qué me piden',
  'ejercicio.datos_clave': 'Datos clave',
  'ejercicio.plan': 'Plan',
  'ejercicio.resolucion': 'Resolución (pasos)',
  'ejercicio.resultado': 'Resultado',
  'ejercicio.verificacion': 'Verificación',
  'ejercicio.err': 'Tipo de error',
  'ejercicio.tiempo_inicio': 'Tiempo de inicio',
  'ejercicio.tiempo_fin': 'Tiempo de finalización',
  'ejercicio.apoyo': 'Cómo lo resolví',
  'error.ejercicio_ref': 'Ejercicio donde fallé',
  'error.que_hice_mal': 'Qué hice mal',
  'error.porque': 'Por qué lo hice mal',
  'error.como_bien': 'Cómo se hacía bien',
  'error.regla': 'Regla aprendida',
  'error.ejercicio_similar': 'Ejercicio similar',
  'resumen.tema': 'Tema',
  'resumen.formulas': 'Fórmulas clave',
  'resumen.casos': 'Casos importantes',
  'resumen.trucos': 'Trucos',
  'resumen.errores_evitar': 'Errores a evitar',
  'resumen.ejemplo_tipico': 'Ejemplo típico'
}

function sheetArticle (tipo) {
  return document.getElementById(`sheet-${tipo}`)
}

export function defaultLayout (tipo) {
  return {
    version: LAYOUT_VERSION,
    order: [...(DEFAULT_ORDER[tipo] || [])],
    hidden: [],
    labels: {},
    customBlocks: [],
    printMeta: true
  }
}

export function isCustomFieldKey (tipo, blockId) {
  return (
    typeof blockId === 'string' &&
    blockId.startsWith(`${tipo}.custom_`)
  )
}

export function normalizeLayout (tipo, raw) {
  const native = DEFAULT_ORDER[tipo] || []
  const def = defaultLayout(tipo)
  if (!raw || typeof raw !== 'object') return def

  const hidden = Array.isArray(raw.hidden) ? raw.hidden.map(String) : []
  const labels =
    raw.labels && typeof raw.labels === 'object' && !Array.isArray(raw.labels)
      ? { ...raw.labels }
      : {}
  const customBlocks = Array.isArray(raw.customBlocks)
    ? raw.customBlocks
      .map((b) => ({
        id: String(b?.id || '').slice(0, 128),
        label: String(b?.label || 'Apartado').slice(0, 200)
      }))
      .filter((b) => /^custom_[a-zA-Z0-9_-]+$/.test(b.id))
    : []

  let order = Array.isArray(raw.order) ? raw.order.map(String) : []
  order = order.filter((id) => typeof id === 'string' && id.startsWith(`${tipo}.`))

  const validNative = new Set(native)
  const customIds = new Set(customBlocks.map((c) => `${tipo}.${c.id}`))
  const valid = new Set([...validNative, ...customIds])

  order = order.filter((id) => valid.has(id))
  for (const id of native) {
    if (!order.includes(id)) order.push(id)
  }
  for (const c of customBlocks) {
    const bid = `${tipo}.${c.id}`
    if (!order.includes(bid)) order.push(bid)
  }
  order = [...new Set(order)]

  const printMeta = raw.printMeta === false ? false : true

  return {
    version: LAYOUT_VERSION,
    order,
    hidden,
    labels,
    customBlocks,
    printMeta
  }
}

export function isLayoutDefault (tipo, layout) {
  const d = defaultLayout(tipo)
  const L = layout && typeof layout === 'object' ? layout : d
  if ((L.customBlocks && L.customBlocks.length) || (L.hidden && L.hidden.length)) {
    return false
  }
  if (L.labels && Object.keys(L.labels).length) return false
  if (JSON.stringify(L.order || []) !== JSON.stringify(d.order)) return false
  if (L.printMeta === false) return false
  return true
}

export function displayLabelForBlock (tipo, blockId, layout) {
  if (isCustomFieldKey(tipo, blockId)) {
    const sid = blockId.slice(`${tipo}.`.length)
    const cb = (layout.customBlocks || []).find((c) => c.id === sid)
    return (cb && cb.label) || 'Apartado'
  }
  const fromLayout = layout.labels && layout.labels[blockId]
  if (fromLayout != null && String(fromLayout).trim()) return String(fromLayout)
  return DEFAULT_LABELS[blockId] || blockId
}

function labelForBlock (tipo, blockId, layout) {
  return displayLabelForBlock(tipo, blockId, layout)
}

function removeCustomBlocks (article) {
  article.querySelectorAll('.sheet-block-custom').forEach((el) => el.remove())
}

function createCustomBlockEl (tipo, cb, layout, fieldValue) {
  const blockId = `${tipo}.${cb.id}`
  const wrap = document.createElement('div')
  wrap.className = 'sheet-block sheet-block-custom'
  wrap.dataset.sheetBlock = blockId
  const lab = labelForBlock(tipo, blockId, layout)
  wrap.innerHTML = `
    <div class="field">
      <div class="field-label" data-sheet-block-label></div>
      <div class="box lined" style="min-height:4.5em">
        <textarea class="field-input" data-f="${blockId}" rows="4" spellcheck="true"></textarea>
      </div>
    </div>
  `
  const labelEl = wrap.querySelector('[data-sheet-block-label]')
  if (labelEl) labelEl.textContent = lab
  const ta = wrap.querySelector('textarea')
  if (ta && fieldValue != null) ta.value = String(fieldValue)
  return wrap
}

/**
 * Aplica diseño al article del tipo (visibilidad, etiquetas, orden, apartados custom).
 * @param {Record<string,string>} [fields] valores para rellenar textareas custom
 */
export function applySheetLayout (tipo, layoutRaw, fields) {
  const article = sheetArticle(tipo)
  if (!article) return
  const layout = normalizeLayout(tipo, layoutRaw)
  const f = fields || {}

  removeCustomBlocks(article)
  for (const cb of layout.customBlocks) {
    const bid = `${tipo}.${cb.id}`
    article.appendChild(
      createCustomBlockEl(tipo, cb, layout, f[bid])
    )
  }

  const blocks = [
    ...article.querySelectorAll(':scope > .sheet-block[data-sheet-block]')
  ]
  const byId = new Map(blocks.map((b) => [b.dataset.sheetBlock, b]))
  const hiddenSet = new Set(layout.hidden || [])

  for (const b of blocks) {
    const id = b.dataset.sheetBlock
    b.classList.toggle('is-hidden', hiddenSet.has(id))
    const labelEl = b.querySelector('.field-label[data-sheet-block-label]')
    if (labelEl) {
      labelEl.textContent = labelForBlock(tipo, id, layout)
    }
  }

  const order = layout.order || []
  const title = article.querySelector('.sheet-title')
  const fragment = document.createDocumentFragment()
  const placed = new Set()
  for (const id of order) {
    const el = byId.get(id)
    if (el) {
      fragment.appendChild(el)
      placed.add(id)
    }
  }
  for (const b of blocks) {
    const id = b.dataset.sheetBlock
    if (!placed.has(id)) {
      fragment.appendChild(b)
      placed.add(id)
    }
  }
  if (title) title.after(fragment)
  else article.appendChild(fragment)

  const active = document
    .querySelector('section[data-sheet].is-active')
    ?.getAttribute('data-sheet')
  if (active === tipo) {
    applyPrintMetaDataset(layout)
  }
}

/** Sincroniza si la cabecera (título, materia, fecha) se imprime / exporta a PDF. */
export function applyPrintMetaDataset (layout) {
  const page = document.querySelector('.sheet-page')
  if (!page) return
  const show = !layout || layout.printMeta !== false
  page.dataset.printMeta = show ? '1' : '0'
}

/**
 * Lee el diseño actual desde el DOM.
 */
export function collectLayoutFromSheet (tipo) {
  const article = sheetArticle(tipo)
  if (!article) return defaultLayout(tipo)
  const page = document.querySelector('.sheet-page')
  const printMeta = page?.dataset.printMeta !== '0'
  const blocks = [
    ...article.querySelectorAll(':scope > .sheet-block[data-sheet-block]')
  ]
  const order = blocks.map((b) => b.dataset.sheetBlock)
  const hidden = blocks
    .filter((b) => b.classList.contains('is-hidden'))
    .map((b) => b.dataset.sheetBlock)
  const labels = {}
  for (const b of blocks) {
    const id = b.dataset.sheetBlock
    const labelEl = b.querySelector('.field-label[data-sheet-block-label]')
    const text = labelEl ? labelEl.textContent.trim() : ''
    const def = DEFAULT_LABELS[id]
    if (def != null && text !== def) labels[id] = text
  }
  const customBlocks = []
  for (const b of blocks) {
    const id = b.dataset.sheetBlock
    if (!isCustomFieldKey(tipo, id)) continue
    const suffix = id.slice(`${tipo}.`.length)
    const labelEl = b.querySelector('.field-label[data-sheet-block-label]')
    customBlocks.push({
      id: suffix,
      label: labelEl ? labelEl.textContent.trim() || 'Apartado' : 'Apartado'
    })
  }
  return normalizeLayout(tipo, {
    version: LAYOUT_VERSION,
    order,
    hidden,
    labels,
    customBlocks,
    printMeta
  })
}

export function addCustomBlock (layout, tipo, labelText) {
  const L = JSON.parse(JSON.stringify(layout))
  const id = `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  L.customBlocks.push({
    id,
    label: String(labelText || 'Nuevo apartado').slice(0, 200)
  })
  const bid = `${tipo}.${id}`
  if (!L.order.includes(bid)) L.order.push(bid)
  return L
}

export function removeCustomBlock (layout, tipo, customId) {
  const L = JSON.parse(JSON.stringify(layout))
  const bid = `${tipo}.${customId}`
  L.customBlocks = L.customBlocks.filter((c) => c.id !== customId)
  L.order = L.order.filter((x) => x !== bid)
  delete L.labels[bid]
  L.hidden = L.hidden.filter((x) => x !== bid)
  return L
}

export function moveBlockInLayout (layout, blockId, delta) {
  const L = JSON.parse(JSON.stringify(layout))
  const ix = L.order.indexOf(blockId)
  if (ix < 0) return L
  const ni = ix + delta
  if (ni < 0 || ni >= L.order.length) return L
  const t = L.order[ix]
  L.order[ix] = L.order[ni]
  L.order[ni] = t
  return L
}

export function setBlockHidden (layout, blockId, hidden) {
  const L = JSON.parse(JSON.stringify(layout))
  const s = new Set(L.hidden || [])
  if (hidden) s.add(blockId)
  else s.delete(blockId)
  L.hidden = [...s]
  return L
}

/** @param {string} tipo */
export function setBlockLabelForTipo (layout, tipo, blockId, text) {
  const L = JSON.parse(JSON.stringify(layout))
  L.labels = L.labels || {}
  const t = String(text || '').trim()
  if (!t) delete L.labels[blockId]
  else L.labels[blockId] = t.slice(0, 500)
  if (isCustomFieldKey(tipo, blockId)) {
    const sid = blockId.slice(`${tipo}.`.length)
    const cb = L.customBlocks.find((c) => c.id === sid)
    if (cb) cb.label = t.slice(0, 200) || 'Apartado'
  }
  return L
}
