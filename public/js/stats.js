/**
 * Panel «Progreso»: métricas desde GET /api/stats o cálculo local en modo solo-navegador.
 */
import * as api from './api.js'

function computeLocalStats (all) {
  const now = new Date().toISOString()
  const totalSheets = all.length
  const totalErrors = all.filter((r) => r.tipo === 'error').length
  const dueToday = all.filter((r) => r.nextReview && String(r.nextReview) <= now).length
  const unscheduledReview = all.filter((r) => !r.nextReview || String(r.nextReview).trim() === '').length
  const sheetsNeedingReview = all.filter(
    (r) =>
      !r.nextReview ||
      String(r.nextReview).trim() === '' ||
      String(r.nextReview) <= now
  ).length
  const materias = {}
  for (const r of all) {
    const m = String(r.materia || '').trim()
    if (m) materias[m] = (materias[m] || 0) + 1
  }
  const topMaterias = Object.entries(materias)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([materia, count]) => ({ materia, count }))
  const errorsByType = {
    concepto: 0,
    procedimiento: 0,
    signos: 0,
    otro: 0,
    sin_clasificar: 0
  }
  for (const r of all) {
    if (r.tipo !== 'error') continue
    const k = ['concepto', 'procedimiento', 'signos', 'otro'].includes(r.errorType)
      ? r.errorType
      : 'sin_clasificar'
    errorsByType[k] += 1
  }
  return {
    totalSheets,
    totalErrors,
    dueToday,
    unscheduledReview,
    sheetsNeedingReview,
    topMaterias,
    errorsByType
  }
}

function card (title, value, sub) {
  const d = document.createElement('div')
  d.className = 'stats-card'
  const h = document.createElement('h3')
  h.className = 'stats-card-title'
  h.textContent = title
  const v = document.createElement('div')
  v.className = 'stats-card-value'
  v.textContent = String(value)
  d.appendChild(h)
  d.appendChild(v)
  if (sub) {
    const s = document.createElement('div')
    s.className = 'stats-card-sub'
    s.textContent = sub
    d.appendChild(s)
  }
  return d
}

export function initStatsView (ctx) {
  const { isRemote, loadAll } = ctx
  const grid = document.getElementById('stats-grid')
  const errEl = document.getElementById('stats-error')
  if (!grid) return

  window.addEventListener('neinei:show-stats', () => {
    ;(async () => {
      grid.innerHTML = ''
      if (errEl) errEl.hidden = true
      try {
        let s
        if (isRemote()) {
          s = await api.getStats()
        } else {
          const all = await loadAll()
          s = computeLocalStats(all)
        }
        grid.appendChild(card('Hojas totales', s.totalSheets))
        grid.appendChild(card('Hojas de error', s.totalErrors))
        grid.appendChild(card('Vencidas / hoy (repaso)', s.dueToday, 'Con fecha de repaso ya pasada'))
        grid.appendChild(
          card('Sin fecha de repaso', s.unscheduledReview, 'Aún no programadas')
        )
        grid.appendChild(
          card('Necesitan repaso (criterio amplio)', s.sheetsNeedingReview, 'Sin fecha o ya toca')
        )
        const mat = document.createElement('div')
        mat.className = 'stats-block'
        mat.innerHTML = '<h3 class="stats-block-title">Materias más usadas</h3>'
        const ul = document.createElement('ul')
        ul.className = 'stats-list'
        for (const { materia, count } of s.topMaterias || []) {
          const li = document.createElement('li')
          li.textContent = `${materia} — ${count}`
          ul.appendChild(li)
        }
        if (!s.topMaterias?.length) {
          const li = document.createElement('li')
          li.textContent = 'Aún sin datos'
          ul.appendChild(li)
        }
        mat.appendChild(ul)
        grid.appendChild(mat)

        const et = document.createElement('div')
        et.className = 'stats-block'
        et.innerHTML = '<h3 class="stats-block-title">Errores por tipo (hojas error)</h3>'
        const ul2 = document.createElement('ul')
        ul2.className = 'stats-list'
        const labels = {
          concepto: 'Concepto',
          procedimiento: 'Procedimiento',
          signos: 'Signos',
          otro: 'Otro',
          sin_clasificar: 'Sin clasificar'
        }
        for (const [k, lab] of Object.entries(labels)) {
          const li = document.createElement('li')
          li.textContent = `${lab}: ${s.errorsByType[k] ?? 0}`
          ul2.appendChild(li)
        }
        et.appendChild(ul2)
        grid.appendChild(et)
      } catch (e) {
        if (errEl) {
          errEl.hidden = false
          errEl.textContent = e.message || 'Error al cargar estadísticas'
        }
      }
    })().catch((e) => console.error(e))
  })
}
