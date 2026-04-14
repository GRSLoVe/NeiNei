/**
 * Agregados para el panel de progreso.
 */
import { ERROR_TYPES } from '../lib/sheets-helpers.js'

export default async function statsRoutes (fastify, opts) {
  const { db, requireAuth } = opts

  fastify.get('/api/stats', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    const nowIso = new Date().toISOString()

    const totalRow = db
      .prepare('SELECT COUNT(*) AS n FROM sheets WHERE user_id = ?')
      .get(uid)
    const totalSheets = Number(totalRow?.n) || 0

    const errorRow = db
      .prepare(`SELECT COUNT(*) AS n FROM sheets WHERE user_id = ? AND tipo = 'error'`)
      .get(uid)
    const totalErrors = Number(errorRow?.n) || 0

    const dueRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM sheets WHERE user_id = ? AND next_review IS NOT NULL AND next_review <= ?`
      )
      .get(uid, nowIso)
    const dueToday = Number(dueRow?.n) || 0

    const unscheduledRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM sheets WHERE user_id = ? AND (next_review IS NULL OR trim(COALESCE(next_review,'')) = '')`
      )
      .get(uid)
    const unscheduledReview = Number(unscheduledRow?.n) || 0

    const pendingRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM sheets WHERE user_id = ? AND (
          next_review IS NULL OR trim(COALESCE(next_review,'')) = '' OR next_review <= ?
        )`
      )
      .get(uid, nowIso)
    const sheetsNeedingReview = Number(pendingRow?.n) || 0

    const materias = db
      .prepare(
        `SELECT materia, COUNT(*) AS c FROM sheets WHERE user_id = ? AND trim(COALESCE(materia,'')) != ''
         GROUP BY materia ORDER BY c DESC LIMIT 10`
      )
      .all(uid)

    const errTypesRows = db
      .prepare(
        `SELECT error_type, COUNT(*) AS c FROM sheets WHERE user_id = ? AND tipo = 'error'
         GROUP BY error_type ORDER BY c DESC`
      )
      .all(uid)

    const errorsByType = {
      concepto: 0,
      procedimiento: 0,
      signos: 0,
      otro: 0,
      sin_clasificar: 0
    }
    for (const r of errTypesRows) {
      const k =
        r.error_type && ERROR_TYPES.has(r.error_type) ? r.error_type : 'sin_clasificar'
      errorsByType[k] += Number(r.c)
    }

    return {
      totalSheets,
      totalErrors,
      dueToday,
      unscheduledReview,
      sheetsNeedingReview,
      topMaterias: materias.map((m) => ({ materia: m.materia, count: Number(m.c) })),
      errorsByType
    }
  })
}
