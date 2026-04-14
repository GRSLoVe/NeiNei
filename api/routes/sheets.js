/**
 * CRUD de hojas e import desde cliente local.
 */
import {
  SHEET_SELECT_SQL,
  serializeFieldsJson,
  rowToRecord,
  validateRecordBody
} from '../lib/sheets-helpers.js'

function pickImportReview (raw, existing) {
  const defLevel = existing ? Number(existing.review_level) || 1 : 1
  let reviewLevel = defLevel
  if ('reviewLevel' in raw && raw.reviewLevel != null) {
    reviewLevel = Math.min(5, Math.max(1, Number(raw.reviewLevel) || 1))
  }
  let lastReviewed = existing?.last_reviewed ?? null
  if ('lastReviewed' in raw) {
    lastReviewed =
      raw.lastReviewed == null || raw.lastReviewed === ''
        ? null
        : String(raw.lastReviewed)
  }
  let nextReview = existing?.next_review ?? null
  if ('nextReview' in raw) {
    nextReview =
      raw.nextReview == null || raw.nextReview === ''
        ? null
        : String(raw.nextReview)
  }
  return { reviewLevel, lastReviewed, nextReview }
}

export default async function sheetsRoutes (fastify, opts) {
  const { db, requireAuth } = opts

  function safeDbError (e) {
    const msg = String(e?.message || e || '')
    // Errores típicos de SQLite/better-sqlite3
    if (/SQLITE_CONSTRAINT/i.test(msg)) return 'No se pudo guardar: conflicto/duplicado en la base de datos'
    if (/SQLITE_BUSY/i.test(msg)) return 'La base de datos está ocupada. Intenta de nuevo en unos segundos'
    if (/too large|too big|range|out of memory/i.test(msg)) return 'El contenido es demasiado grande para guardarse'
    return msg || 'No se pudo guardar'
  }

  fastify.get('/api/sheets', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    const rows = db
      .prepare(`${SHEET_SELECT_SQL} WHERE user_id = ? ORDER BY updated_at DESC`)
      .all(uid)
    return { records: rows.map(rowToRecord) }
  })

  fastify.post('/api/sheets', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    const v = validateRecordBody(request.body)
    if (v.error) return reply.code(400).send({ error: v.error })
    const now = new Date().toISOString()
    let id = request.body.id != null ? String(request.body.id).slice(0, 128) : ''
    if (!id) id = `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const existing = db.prepare('SELECT id FROM sheets WHERE id = ? AND user_id = ?').get(id, uid)
    if (existing) return reply.code(409).send({ error: 'Ya existe una hoja con ese id' })
    try {
      const tagsJson = JSON.stringify(v.tags)
      const fieldsJson = serializeFieldsJson(v.fields, v.layout)
      db.prepare(
        `INSERT INTO sheets (id, user_id, titulo, materia, fecha, tipo, fields_json, created_at, updated_at, tags_json, error_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        uid,
        v.titulo || '(sin título)',
        v.materia,
        v.fecha,
        v.tipo,
        fieldsJson,
        now,
        now,
        tagsJson,
        v.errorType
      )
    } catch (e) {
      fastify.log.error(e)
      return reply.code(400).send({ error: safeDbError(e) })
    }
    const row = db.prepare(`${SHEET_SELECT_SQL} WHERE id = ?`).get(id)
    reply.code(201).send(rowToRecord(row))
  })

  fastify.put('/api/sheets/:id', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    const id = String(request.params.id).slice(0, 128)
    const v = validateRecordBody(request.body)
    if (v.error) return reply.code(400).send({ error: v.error })
    const row = db.prepare('SELECT id, created_at FROM sheets WHERE id = ? AND user_id = ?').get(id, uid)
    const existingFull = row
      ? db.prepare(`${SHEET_SELECT_SQL} WHERE id = ? AND user_id = ?`).get(id, uid)
      : null
    const b = request.body || {}
    let reviewLevel = existingFull ? Number(existingFull.review_level) || 1 : 1
    let lastReviewed = existingFull?.last_reviewed ?? null
    let nextReview = existingFull?.next_review ?? null
    if ('reviewLevel' in b) {
      reviewLevel = Math.min(5, Math.max(1, Number(b.reviewLevel) || 1))
    }
    if ('lastReviewed' in b) {
      lastReviewed =
        b.lastReviewed == null || b.lastReviewed === '' ? null : String(b.lastReviewed)
    }
    if ('nextReview' in b) {
      nextReview =
        b.nextReview == null || b.nextReview === '' ? null : String(b.nextReview)
    }

    const now = new Date().toISOString()
    if (!row) {
      if (!('reviewLevel' in b)) reviewLevel = 1
      if (!('lastReviewed' in b)) lastReviewed = null
      if (!('nextReview' in b)) nextReview = null
      try {
        const tagsJson = JSON.stringify(v.tags)
        const fieldsJson = serializeFieldsJson(v.fields, v.layout)
        db.prepare(
          `INSERT INTO sheets (id, user_id, titulo, materia, fecha, tipo, fields_json, created_at, updated_at,
            tags_json, error_type, review_level, last_reviewed, next_review)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          uid,
          v.titulo || '(sin título)',
          v.materia,
          v.fecha,
          v.tipo,
          fieldsJson,
          now,
          now,
          tagsJson,
          v.errorType,
          reviewLevel,
          lastReviewed,
          nextReview
        )
      } catch (e) {
        fastify.log.error(e)
        return reply.code(400).send({ error: safeDbError(e) })
      }
    } else {
      try {
        const tagsJson = JSON.stringify(v.tags)
        const fieldsJson = serializeFieldsJson(v.fields, v.layout)
        db.prepare(
          `UPDATE sheets SET titulo = ?, materia = ?, fecha = ?, tipo = ?, fields_json = ?, updated_at = ?,
            tags_json = ?, error_type = ?, review_level = ?, last_reviewed = ?, next_review = ?
           WHERE id = ? AND user_id = ?`
        ).run(
          v.titulo || '(sin título)',
          v.materia,
          v.fecha,
          v.tipo,
          fieldsJson,
          now,
          tagsJson,
          v.errorType,
          reviewLevel,
          lastReviewed,
          nextReview,
          id,
          uid
        )
      } catch (e) {
        fastify.log.error(e)
        return reply.code(400).send({ error: safeDbError(e) })
      }
    }
    const out = db.prepare(`${SHEET_SELECT_SQL} WHERE id = ?`).get(id)
    return rowToRecord(out)
  })

  fastify.delete('/api/sheets/:id', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    const id = String(request.params.id).slice(0, 128)
    const info = db.prepare('DELETE FROM sheets WHERE id = ? AND user_id = ?').run(id, uid)
    if (info.changes === 0) return reply.code(404).send({ error: 'No encontrada' })
    return { ok: true }
  })

  fastify.post('/api/sheets/import-local', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    const records = request.body?.records
    if (!Array.isArray(records)) {
      return reply.code(400).send({ error: 'records debe ser un array' })
    }
    let imported = 0
    const now = new Date().toISOString()
    const insertNew = db.prepare(
      `INSERT INTO sheets (id, user_id, titulo, materia, fecha, tipo, fields_json, created_at, updated_at,
        review_level, last_reviewed, next_review, error_type, tags_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const updateExisting = db.prepare(
      `UPDATE sheets SET titulo = ?, materia = ?, fecha = ?, tipo = ?, fields_json = ?, updated_at = ?,
        review_level = ?, last_reviewed = ?, next_review = ?, error_type = ?, tags_json = ?
       WHERE id = ? AND user_id = ?`
    )

    const tx = db.transaction((items) => {
      for (const raw of items) {
        const v = validateRecordBody(raw)
        if (v.error) continue
        const id =
          raw.id != null
            ? String(raw.id).slice(0, 128)
            : `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
        const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : now
        const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : now
        const tagsJson = JSON.stringify(v.tags)
        const existing = db.prepare(`${SHEET_SELECT_SQL} WHERE id = ? AND user_id = ?`).get(id, uid)
        const { reviewLevel, lastReviewed, nextReview } = pickImportReview(raw, existing)

        if (existing) {
          updateExisting.run(
            v.titulo || '(sin título)',
            v.materia,
            v.fecha,
            v.tipo,
            serializeFieldsJson(v.fields, v.layout),
            updatedAt,
            reviewLevel,
            lastReviewed,
            nextReview,
            v.errorType,
            tagsJson,
            id,
            uid
          )
        } else {
          insertNew.run(
            id,
            uid,
            v.titulo || '(sin título)',
            v.materia,
            v.fecha,
            v.tipo,
            serializeFieldsJson(v.fields, v.layout),
            createdAt,
            updatedAt,
            reviewLevel,
            lastReviewed,
            nextReview,
            v.errorType,
            tagsJson
          )
        }
        imported += 1
      }
    })
    tx(records.slice(0, 5000))
    return { ok: true, imported }
  })
}
