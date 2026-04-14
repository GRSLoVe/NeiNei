/**
 * Repaso espaciado: lista del día y registro de nivel.
 */
import {
  SHEET_SELECT_SQL,
  rowToRecord,
  calcularProximoRepaso
} from '../lib/sheets-helpers.js'

export default async function reviewRoutes (fastify, opts) {
  const { db, requireAuth } = opts

  fastify.get('/api/review/today', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    const nowIso = new Date().toISOString()
    const rows = db
      .prepare(
        `${SHEET_SELECT_SQL} WHERE user_id = ? AND next_review IS NOT NULL AND next_review <= ? ORDER BY next_review ASC`
      )
      .all(uid, nowIso)
    return { records: rows.map(rowToRecord) }
  })

  fastify.post('/api/sheets/:id/review', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    const id = String(request.params.id).slice(0, 128)
    const nivelRaw = request.body?.nivel
    let nivel = Number(nivelRaw)
    if (!Number.isFinite(nivel)) {
      return reply.code(400).send({ error: 'nivel inválido' })
    }
    nivel = Math.min(5, Math.max(1, Math.floor(nivel)))
    const row = db.prepare('SELECT id FROM sheets WHERE id = ? AND user_id = ?').get(id, uid)
    if (!row) return reply.code(404).send({ error: 'No encontrada' })
    const now = new Date().toISOString()
    const next = calcularProximoRepaso(nivel)
    db.prepare(
      `UPDATE sheets SET review_level = ?, last_reviewed = ?, next_review = ? WHERE id = ? AND user_id = ?`
    ).run(nivel, now, next, id, uid)
    const out = db.prepare(`${SHEET_SELECT_SQL} WHERE id = ?`).get(id)
    return rowToRecord(out)
  })
}
