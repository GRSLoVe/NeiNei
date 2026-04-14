import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import session from '@fastify/session'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { migrateSheetsColumns } from './lib/sheets-helpers.js'
import sheetsRoutes from './routes/sheets.js'
import reviewRoutes from './routes/review.js'
import statsRoutes from './routes/stats.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
function resolvePublicDir () {
  if (process.env.PUBLIC_DIR) return path.resolve(process.env.PUBLIC_DIR)
  const flat = path.join(__dirname, 'public')
  if (fs.existsSync(flat)) return flat
  return path.join(__dirname, '..', 'public')
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
const AVATARS_DIR = path.join(DATA_DIR, 'avatars')
const ASSETS_DIR = path.join(DATA_DIR, 'assets')
const DB_PATH = path.join(DATA_DIR, 'neinei.db')
const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const ASSET_MAX_BYTES = 8 * 1024 * 1024
const SESSION_SECRET = process.env.SESSION_SECRET || ''
const ADMIN_USER = process.env.ADMIN_USER || 'admin'
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''

function ensureDataDir () {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

function ensureAvatarsDir () {
  fs.mkdirSync(AVATARS_DIR, { recursive: true })
}

function ensureAssetsDir () {
  fs.mkdirSync(ASSETS_DIR, { recursive: true })
}

function detectImageBuffer (buf) {
  if (!buf || buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' }
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: 'png', mime: 'image/png' }
  }
  if (
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: 'webp', mime: 'image/webp' }
  }
  return null
}

function removeAvatarFiles (uid) {
  ensureAvatarsDir()
  for (const ext of ['jpg', 'png', 'webp']) {
    const p = path.join(AVATARS_DIR, `${uid}.${ext}`)
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      /* ignore */
    }
  }
}

function avatarFilePath (uid, ext) {
  return path.join(AVATARS_DIR, `${uid}.${ext}`)
}

function openDb () {
  ensureDataDir()
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sheets (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      titulo TEXT NOT NULL,
      materia TEXT NOT NULL,
      fecha TEXT NOT NULL,
      tipo TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sheets_user_updated ON sheets(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      alias TEXT NOT NULL,
      title TEXT,
      ext TEXT NOT NULL,
      mime TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE (user_id, alias)
    );
    CREATE INDEX IF NOT EXISTS idx_assets_user_updated ON assets(user_id, updated_at DESC);
  `)
  migrateUsersTable(db)
  backfillUserEmails(db)
  migrateSheetsColumns(db)
  migrateAssetsColumns(db)
  return db
}

function migrateUsersTable (db) {
  const cols = db.prepare('PRAGMA table_info(users)').all()
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('email')) {
    db.exec('ALTER TABLE users ADD COLUMN email TEXT')
  }
  if (!names.has('display_name')) {
    db.exec('ALTER TABLE users ADD COLUMN display_name TEXT')
  }
  if (!names.has('profile_bio')) {
    db.exec('ALTER TABLE users ADD COLUMN profile_bio TEXT')
  }
  if (!names.has('accent_color')) {
    db.exec('ALTER TABLE users ADD COLUMN accent_color TEXT')
  }
  if (!names.has('theme_preference')) {
    db.exec('ALTER TABLE users ADD COLUMN theme_preference TEXT')
  }
  if (!names.has('avatar_ext')) {
    db.exec('ALTER TABLE users ADD COLUMN avatar_ext TEXT')
  }
  if (!names.has('avatar_rev')) {
    db.exec('ALTER TABLE users ADD COLUMN avatar_rev INTEGER DEFAULT 0')
  }
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email)'
  )
}

function migrateAssetsColumns (db) {
  const cols = db.prepare('PRAGMA table_info(assets)').all()
  if (!Array.isArray(cols) || cols.length === 0) return
  const names = new Set(cols.map((c) => c.name))
  // (reservado para futuras migraciones)
  if (!names.has('title')) {
    db.exec('ALTER TABLE assets ADD COLUMN title TEXT')
  }
}

function backfillUserEmails (db) {
  const rows = db.prepare(
    `SELECT id, username FROM users WHERE email IS NULL OR trim(COALESCE(email, '')) = ''`
  ).all()
  for (const r of rows) {
    const u = String(r.username).replace(/@/g, '').replace(/\s+/g, '') || 'usuario'
    const synthetic = `${u}@cuenta.local`.toLowerCase()
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(synthetic, r.id)
  }
}

const SQL_USER_PUBLIC_ROW =
  'SELECT id, email, username, display_name, profile_bio, accent_color, theme_preference, avatar_ext, avatar_rev FROM users WHERE id = ?'

function isValidEmail (s) {
  const t = String(s || '').trim()
  if (t.length < 5 || t.length > 254) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)
}

function normalizeEmail (s) {
  return String(s || '').trim().toLowerCase()
}

function isValidPassword (p) {
  const s = String(p || '')
  return s.length >= 8 && s.length <= 128
}

function uniqueUsernameForEmail (db, email) {
  const local = email
    .split('@')[0]
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  let base = (local || 'usuario').slice(0, 32)
  let tryName = base
  let i = 0
  while (db.prepare('SELECT id FROM users WHERE username = ?').get(tryName)) {
    i += 1
    const suffix = `_${i}`
    tryName = (base.slice(0, Math.max(1, 32 - suffix.length)) + suffix).slice(0, 32)
  }
  return tryName
}

function userPublic (row) {
  if (!row) return null
  const themeRaw = String(row.theme_preference || '').toLowerCase()
  const theme =
    themeRaw === 'light' || themeRaw === 'dark' || themeRaw === 'system'
      ? themeRaw
      : 'system'
  const rev = Number(row.avatar_rev) || 0
  const hasAv = !!(row.avatar_ext && String(row.avatar_ext).trim())
  return {
    id: row.id,
    email: row.email || '',
    username: row.username,
    displayName: row.display_name || '',
    bio: row.profile_bio || '',
    accentColor: row.accent_color || '',
    theme,
    avatarUrl: hasAv ? `/api/auth/avatar?r=${rev}` : ''
  }
}

function ensureAdminUser (db) {
  const row = db.prepare('SELECT id FROM users LIMIT 1').get()
  if (row) return row.id
  if (!ADMIN_PASSWORD) {
    console.warn(
      'ADMIN_PASSWORD no está definida: no se creó ningún usuario. Define ADMIN_EMAIL (recomendado), ADMIN_USER y ADMIN_PASSWORD en .env.'
    )
    return null
  }
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 12)
  const seedEmail = isValidEmail(ADMIN_EMAIL)
    ? normalizeEmail(ADMIN_EMAIL)
    : `${String(ADMIN_USER).replace(/@/g, '').replace(/\s+/g, '') || 'admin'}@cuenta.local`.toLowerCase()
  const info = db.prepare(
    'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)'
  ).run(seedEmail, ADMIN_USER, hash)
  return Number(info.lastInsertRowid)
}

async function buildServer () {
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET debe tener al menos 32 caracteres')
  }

  const db = openDb()
  ensureAdminUser(db)

  const fastify = Fastify({
    logger: true,
    trustProxy: true
  })

  await fastify.register(cookie)
  await fastify.register(session, {
    secret: SESSION_SECRET,
    cookieName: 'neinei.sid',
    cookie: {
      path: '/',
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 14
    }
  })

  await fastify.register(multipart, {
    limits: { fileSize: Math.max(AVATAR_MAX_BYTES, ASSET_MAX_BYTES) }
  })

  function requireAuth (request, reply) {
    const uid = request.session.get('userId')
    if (!uid) {
      reply.code(401).send({ error: 'No autenticado' })
      return null
    }
    return uid
  }

  await fastify.register(sheetsRoutes, { db, requireAuth })
  await fastify.register(reviewRoutes, { db, requireAuth })
  await fastify.register(statsRoutes, { db, requireAuth })

  fastify.post('/api/auth/login', async (request, reply) => {
    const body = request.body || {}
    const ident = String(body.email || body.username || '').trim()
    const password = String(body.password || '')
    if (!ident || !password) {
      return reply.code(400).send({ error: 'Correo y contraseña requeridos' })
    }
    const user = db
      .prepare(
        `SELECT id, username, password_hash FROM users
         WHERE lower(email) = lower(?) OR username = ?`
      )
      .get(ident, ident)
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return reply.code(401).send({ error: 'Correo o contraseña incorrectos' })
    }
    request.session.set('userId', user.id)
    const full = db.prepare(SQL_USER_PUBLIC_ROW).get(user.id)
    return { ok: true, user: userPublic(full) }
  })

  fastify.get('/api/auth/options', async () => ({
    registrationOpen: process.env.ALLOW_REGISTRATION === 'true'
  }))

  fastify.post('/api/auth/register', async (request, reply) => {
    if (process.env.ALLOW_REGISTRATION !== 'true') {
      return reply.code(403).send({ error: 'El registro está desactivado' })
    }
    const body = request.body || {}
    const email = normalizeEmail(body.email)
    const p = String(body.password || '')
    if (!isValidEmail(email)) {
      return reply.code(400).send({ error: 'Introduce un correo electrónico válido' })
    }
    if (!isValidPassword(p)) {
      return reply.code(400).send({
        error: 'La contraseña debe tener entre 8 y 128 caracteres'
      })
    }
    const exists = db
      .prepare('SELECT id FROM users WHERE lower(email) = lower(?)')
      .get(email)
    if (exists) return reply.code(409).send({ error: 'Ese correo ya está registrado' })
    const username = uniqueUsernameForEmail(db, email)
    const hash = bcrypt.hashSync(p, 12)
    const info = db
      .prepare(
        'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)'
      )
      .run(email, username, hash)
    const row = db.prepare(SQL_USER_PUBLIC_ROW).get(Number(info.lastInsertRowid))
    request.session.set('userId', row.id)
    return { ok: true, user: userPublic(row) }
  })

  fastify.post('/api/auth/logout', async (request) => {
    await request.session.destroy()
    return { ok: true }
  })

  fastify.get('/api/auth/me', async (request, reply) => {
    const uid = request.session.get('userId')
    if (!uid) return reply.code(401).send({ error: 'No autenticado' })
    const user = db.prepare(SQL_USER_PUBLIC_ROW).get(uid)
    if (!user) {
      await request.session.destroy()
      return reply.code(401).send({ error: 'No autenticado' })
    }
    return { user: userPublic(user) }
  })

  fastify.patch('/api/auth/profile', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    const body = request.body || {}
    const cur = db.prepare(SQL_USER_PUBLIC_ROW).get(uid)
    if (!cur) return reply.code(404).send({ error: 'Usuario no encontrado' })
    let displayName = cur.display_name
    let bio = cur.profile_bio
    let accent = cur.accent_color
    let themePref = cur.theme_preference
    if (body.displayName !== undefined) {
      displayName = String(body.displayName ?? '').trim().slice(0, 100) || null
    }
    if (body.bio !== undefined) {
      bio = String(body.bio ?? '').trim().slice(0, 500) || null
    }
    if (body.accentColor !== undefined && body.accentColor !== null) {
      const raw = String(body.accentColor).trim()
      if (raw === '') accent = null
      else if (!/^#[0-9A-Fa-f]{6}$/.test(raw)) {
        return reply.code(400).send({ error: 'Color inválido (usa #rrggbb)' })
      } else accent = raw
    }
    if (body.theme !== undefined && body.theme !== null) {
      const t = String(body.theme).toLowerCase()
      if (!['light', 'dark', 'system'].includes(t)) {
        return reply.code(400).send({ error: 'Tema inválido (light, dark o system)' })
      }
      themePref = t === 'system' ? null : t
    }
    db.prepare(
      `UPDATE users SET display_name = ?, profile_bio = ?, accent_color = ?, theme_preference = ?
       WHERE id = ?`
    ).run(displayName, bio, accent, themePref, uid)
    const row = db.prepare(SQL_USER_PUBLIC_ROW).get(uid)
    return { user: userPublic(row) }
  })

  fastify.get('/api/auth/avatar', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    const u = db
      .prepare('SELECT avatar_ext FROM users WHERE id = ?')
      .get(uid)
    if (!u?.avatar_ext) {
      return reply.code(404).send({ error: 'Sin foto' })
    }
    const ext = String(u.avatar_ext)
    const filePath = avatarFilePath(uid, ext)
    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'Archivo no encontrado' })
    }
    const mime =
      ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    return reply.type(mime).send(fs.createReadStream(filePath))
  })

  fastify.post('/api/auth/avatar', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    let part
    try {
      part = await request.file()
    } catch (err) {
      return reply.code(400).send({ error: 'Archivo demasiado grande (máx. 2 MB)' })
    }
    if (!part) {
      return reply.code(400).send({ error: 'Adjunta una imagen (campo file)' })
    }
    let buf
    try {
      buf = await part.toBuffer()
    } catch {
      return reply
        .code(400)
        .send({ error: 'No se pudo leer la imagen o supera el tamaño máximo (2 MB)' })
    }
    const det = detectImageBuffer(buf)
    if (!det) {
      return reply
        .code(400)
        .send({ error: 'Formato no admitido (usa JPEG, PNG o WebP)' })
    }
    ensureAvatarsDir()
    removeAvatarFiles(uid)
    const dest = avatarFilePath(uid, det.ext)
    fs.writeFileSync(dest, buf)
    db.prepare(
      `UPDATE users SET avatar_ext = ?, avatar_rev = COALESCE(avatar_rev, 0) + 1 WHERE id = ?`
    ).run(det.ext, uid)
    const row = db.prepare(SQL_USER_PUBLIC_ROW).get(uid)
    return { ok: true, user: userPublic(row) }
  })

  fastify.delete('/api/auth/avatar', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    removeAvatarFiles(uid)
    db.prepare(
      'UPDATE users SET avatar_ext = NULL, avatar_rev = COALESCE(avatar_rev, 0) + 1 WHERE id = ?'
    ).run(uid)
    const row = db.prepare(SQL_USER_PUBLIC_ROW).get(uid)
    return { user: userPublic(row) }
  })

  function safeAlias (raw) {
    const base = String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9._-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
    return base.slice(0, 64)
  }

  function assetFilePath (userId, assetId, ext) {
    ensureAssetsDir()
    const udir = path.join(ASSETS_DIR, String(userId))
    fs.mkdirSync(udir, { recursive: true })
    return path.join(udir, `${assetId}.${ext}`)
  }

  fastify.get('/api/assets', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    const rows = db
      .prepare(
        `SELECT id, alias, title, ext, mime, size_bytes, created_at, updated_at
         FROM assets WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500`
      )
      .all(uid)
    return { assets: rows }
  })

  fastify.get('/api/assets/:alias', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    const alias = safeAlias(request.params?.alias)
    if (!alias) return reply.code(400).send({ error: 'Alias inválido' })
    const a = db
      .prepare(
        'SELECT id, user_id, alias, title, ext, mime, size_bytes FROM assets WHERE user_id = ? AND alias = ?'
      )
      .get(uid, alias)
    if (!a) return reply.code(404).send({ error: 'No encontrada' })
    const p = assetFilePath(uid, a.id, a.ext)
    if (!fs.existsSync(p)) return reply.code(404).send({ error: 'Archivo no encontrado' })
    return reply
      .type(String(a.mime || 'application/octet-stream'))
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(fs.createReadStream(p))
  })

  fastify.post('/api/assets', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return

    let part
    try {
      part = await request.file()
    } catch {
      return reply.code(400).send({ error: 'Archivo demasiado grande (máx. 8 MB)' })
    }
    if (!part) return reply.code(400).send({ error: 'Adjunta una imagen (campo file)' })

    const q = request.query || {}
    const alias = safeAlias(q.alias)
    const title = q.title != null ? String(q.title).trim().slice(0, 120) : null
    if (!alias) return reply.code(400).send({ error: 'Alias requerido (query ?alias=...)' })

    let buf
    try {
      buf = await part.toBuffer()
    } catch {
      return reply.code(400).send({ error: 'No se pudo leer la imagen' })
    }
    if (!buf || buf.length === 0) return reply.code(400).send({ error: 'Archivo vacío' })
    if (buf.length > ASSET_MAX_BYTES) {
      return reply.code(400).send({ error: 'Archivo demasiado grande (máx. 8 MB)' })
    }

    const det = detectImageBuffer(buf)
    if (!det) {
      return reply.code(400).send({ error: 'Formato no admitido (usa JPEG, PNG o WebP)' })
    }

    const exists = db
      .prepare('SELECT id FROM assets WHERE user_id = ? AND alias = ?')
      .get(uid, alias)
    if (exists) return reply.code(409).send({ error: 'Ya existe una imagen con ese alias' })

    const now = new Date().toISOString()
    const assetId = `a_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    const dest = assetFilePath(uid, assetId, det.ext)
    fs.writeFileSync(dest, buf)

    db.prepare(
      `INSERT INTO assets (id, user_id, alias, title, ext, mime, size_bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(assetId, uid, alias, title, det.ext, det.mime, buf.length, now, now)

    const row = db
      .prepare(
        'SELECT id, alias, title, ext, mime, size_bytes, created_at, updated_at FROM assets WHERE user_id = ? AND id = ?'
      )
      .get(uid, assetId)
    return reply.code(201).send({ ok: true, asset: row })
  })

  fastify.delete('/api/assets/:alias', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    const alias = safeAlias(request.params?.alias)
    if (!alias) return reply.code(400).send({ error: 'Alias inválido' })
    const a = db
      .prepare('SELECT id, ext FROM assets WHERE user_id = ? AND alias = ?')
      .get(uid, alias)
    if (!a) return reply.code(404).send({ error: 'No encontrada' })
    const p = assetFilePath(uid, a.id, a.ext)
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      /* ignore */
    }
    const info = db.prepare('DELETE FROM assets WHERE user_id = ? AND alias = ?').run(uid, alias)
    return { ok: info.changes > 0 }
  })

  fastify.patch('/api/assets/:alias', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    const oldAlias = safeAlias(request.params?.alias)
    if (!oldAlias) return reply.code(400).send({ error: 'Alias inválido' })
    const body = request.body || {}
    const cur = db
      .prepare('SELECT id, alias, title, ext, mime, size_bytes, created_at, updated_at FROM assets WHERE user_id = ? AND alias = ?')
      .get(uid, oldAlias)
    if (!cur) return reply.code(404).send({ error: 'No encontrada' })

    let nextAlias = cur.alias
    if (body.alias !== undefined) {
      const a = safeAlias(body.alias)
      if (!a) return reply.code(400).send({ error: 'Alias inválido' })
      nextAlias = a
      const exists = db
        .prepare('SELECT id FROM assets WHERE user_id = ? AND alias = ? AND id != ?')
        .get(uid, nextAlias, cur.id)
      if (exists) return reply.code(409).send({ error: 'Ya existe una imagen con ese alias' })
    }
    let nextTitle = cur.title || null
    if (body.title !== undefined) {
      nextTitle = body.title == null ? null : String(body.title).trim().slice(0, 120) || null
    }

    const now = new Date().toISOString()
    const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const oldAliasEsc = escapeRegExp(cur.alias)
    const embedRe = new RegExp(`!\\[\\[${oldAliasEsc}(\\|\\d+)?\\]\\]`, 'g')

    let updatedSheets = 0
    const tx = db.transaction(() => {
      db.prepare('UPDATE assets SET alias = ?, title = ?, updated_at = ? WHERE user_id = ? AND id = ?')
        .run(nextAlias, nextTitle, now, uid, cur.id)

      // Si cambió el alias, actualizar todos los embeds en hojas del usuario.
      if (cur.alias !== nextAlias) {
        const rows = db
          .prepare('SELECT id, fields_json FROM sheets WHERE user_id = ?')
          .all(uid)
        const upd = db.prepare('UPDATE sheets SET fields_json = ?, updated_at = ? WHERE user_id = ? AND id = ?')
        for (const r of rows) {
          const fj = String(r.fields_json || '')
          if (!fj.includes(`![[${cur.alias}`)) continue
          const next = fj.replace(embedRe, (m, g1) => `![[${nextAlias}${g1 || ''}]]`)
          if (next !== fj) {
            upd.run(next, now, uid, r.id)
            updatedSheets++
          }
        }
      }
    })
    tx()

    const row = db
      .prepare('SELECT id, alias, title, ext, mime, size_bytes, created_at, updated_at FROM assets WHERE user_id = ? AND id = ?')
      .get(uid, cur.id)
    return { ok: true, asset: row, updatedSheets }
  })

  fastify.put('/api/auth/password', async (request, reply) => {
    const uid = requireAuth(request, reply)
    if (uid == null) return
    const { currentPassword, newPassword } = request.body || {}
    const cur = String(currentPassword || '')
    const neu = String(newPassword || '')
    if (!cur || !neu) {
      return reply.code(400).send({ error: 'Indica contraseña actual y nueva' })
    }
    if (neu.length < 8 || neu.length > 128) {
      return reply.code(400).send({ error: 'La nueva contraseña debe tener entre 8 y 128 caracteres' })
    }
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(uid)
    if (!row || !bcrypt.compareSync(cur, row.password_hash)) {
      return reply.code(401).send({ error: 'Contraseña actual incorrecta' })
    }
    const hash = bcrypt.hashSync(neu, 12)
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, uid)
    return { ok: true }
  })

  fastify.get('/', async (_, reply) => reply.redirect('/login.html', 302))

  const publicDir = resolvePublicDir()
  await fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
    index: ['index.html']
  })

  const port = Number(process.env.PORT || 3000)
  const host = process.env.HOST || '0.0.0.0'
  await fastify.listen({ port, host })
}

buildServer().catch((err) => {
  console.error(err)
  process.exit(1)
})
