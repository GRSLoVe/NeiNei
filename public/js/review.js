/**
 * Vista «Repasar hoy»: lista hojas con next_review vencido y botones de valoración.
 */
import * as api from './api.js'
import { nivelParaBotonRepaso } from './spaced-repetition.js'

function labelTipo (t) {
  const m = { concepto: 'Concepto', ejercicio: 'Ejercicio', error: 'Error', resumen: 'Resumen' }
  return m[t] || t
}

export function initReviewView (ctx) {
  const { applySheetReview, loadAll, isRemote, openSheet, showEditorView } = ctx
  const listEl = document.getElementById('review-list')
  const emptyEl = document.getElementById('review-empty')
  if (!listEl) return

  async function fetchDue () {
    if (isRemote()) {
      return api.getReviewToday()
    }
    const now = new Date().toISOString()
    const all = await loadAll()
    return all.filter((r) => r.nextReview && String(r.nextReview) <= now)
  }

  async function refresh () {
    listEl.innerHTML = ''
    let records
    try {
      records = await fetchDue()
    } catch (e) {
      listEl.innerHTML = `<li class="review-item review-item-err">${e.message || 'Error al cargar'}</li>`
      if (emptyEl) emptyEl.hidden = true
      return
    }
    if (emptyEl) emptyEl.hidden = records.length > 0
    if (!records.length) return

    for (const rec of records) {
      const li = document.createElement('li')
      li.className = 'review-item'
      const head = document.createElement('div')
      head.className = 'review-item-head'
      const titleBtn = document.createElement('button')
      titleBtn.type = 'button'
      titleBtn.className = 'review-open'
      titleBtn.textContent = rec.titulo || '(sin título)'
      titleBtn.addEventListener('click', () => {
        openSheet(rec)
        showEditorView()
      })
      const meta = document.createElement('span')
      meta.className = 'review-item-meta'
      const rl = rec.reviewLevel ?? 1
      meta.textContent = `${labelTipo(rec.tipo)} · nivel ${rl}${rec.materia ? ` · ${rec.materia}` : ''}`
      head.appendChild(titleBtn)
      head.appendChild(meta)

      const actions = document.createElement('div')
      actions.className = 'review-actions'
      const mkBtn = (label, botonKey) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'btn-secondary review-grade'
        b.textContent = label
        b.addEventListener('click', async () => {
          const nivel = nivelParaBotonRepaso(botonKey, rl)
          try {
            await applySheetReview(rec.id, nivel)
            await refresh()
          } catch (err) {
            alert(err.message || 'No se pudo guardar el repaso')
          }
        })
        return b
      }
      actions.appendChild(mkBtn('No lo sé', 'no'))
      actions.appendChild(mkBtn('Regular', 'regular'))
      actions.appendChild(mkBtn('Lo sé', 'si'))

      li.appendChild(head)
      li.appendChild(actions)
      listEl.appendChild(li)
    }
  }

  window.addEventListener('neinei:show-review', () => {
    refresh().catch((e) => console.error(e))
  })
}
