async function parseBody (r) {
  const text = await r.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { _raw: text }
  }
}

export async function apiFetch (path, options = {}) {
  const opts = { credentials: 'include', ...options }
  if (opts.body != null && typeof opts.body === 'string' && !(opts.headers && opts.headers['Content-Type'])) {
    opts.headers = { 'Content-Type': 'application/json', ...opts.headers }
  }
  const r = await fetch(path, opts)
  const data = await parseBody(r)
  return { ok: r.ok, status: r.status, data, response: r }
}

export async function getMe () {
  const { ok, data } = await apiFetch('/api/auth/me', { method: 'GET' })
  return { ok, user: ok ? data.user : null }
}

export async function getAuthOptions () {
  const { ok, data } = await apiFetch('/api/auth/options', { method: 'GET' })
  if (!ok) return { registrationOpen: false }
  return { registrationOpen: !!data.registrationOpen }
}

export async function register (email, password) {
  const { ok, data } = await apiFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  })
  if (!ok) throw new Error(data.error || 'No se pudo crear la cuenta')
  return data
}

export async function updateProfile (patch) {
  const { ok, data } = await apiFetch('/api/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(patch)
  })
  if (!ok) throw new Error(data.error || 'No se pudo guardar el perfil')
  return data
}

export async function changePassword (currentPassword, newPassword) {
  const { ok, data } = await apiFetch('/api/auth/password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword })
  })
  if (!ok) throw new Error(data.error || 'No se pudo cambiar la contraseña')
  return data
}

export async function login (email, password) {
  const { ok, data } = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  })
  if (!ok) throw new Error(data.error || 'Correo o contraseña incorrectos')
  return data
}

export async function logout () {
  await apiFetch('/api/auth/logout', { method: 'POST' })
}

export async function uploadAvatar (file) {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch('/api/auth/avatar', {
    method: 'POST',
    body: fd,
    credentials: 'include'
  })
  const data = await parseBody(r)
  if (!r.ok) throw new Error(data.error || 'No se pudo subir la imagen')
  return data
}

export async function deleteAvatar () {
  const { ok, data } = await apiFetch('/api/auth/avatar', { method: 'DELETE' })
  if (!ok) throw new Error(data.error || 'No se pudo quitar la foto')
  return data
}

export async function listAssets () {
  const { ok, data } = await apiFetch('/api/assets', { method: 'GET' })
  if (!ok) throw new Error(data.error || 'No se pudieron cargar las imágenes')
  return Array.isArray(data.assets) ? data.assets : []
}

export async function uploadAsset (file, { alias, title } = {}) {
  const a = String(alias || '').trim()
  if (!a) throw new Error('Alias requerido')
  const fd = new FormData()
  fd.append('file', file)
  const qs = new URLSearchParams({ alias: a })
  if (title) qs.set('title', String(title))
  const r = await fetch(`/api/assets?${qs.toString()}`, {
    method: 'POST',
    body: fd,
    credentials: 'include'
  })
  const data = await parseBody(r)
  if (!r.ok) throw new Error(data.error || 'No se pudo subir la imagen')
  return data
}

export async function deleteAsset (alias) {
  const a = String(alias || '').trim()
  const { ok, data } = await apiFetch(`/api/assets/${encodeURIComponent(a)}`, { method: 'DELETE' })
  if (!ok) throw new Error(data.error || 'No se pudo borrar la imagen')
  return data
}

export async function updateAsset (oldAlias, { alias, title } = {}) {
  const a = String(oldAlias || '').trim()
  const patch = {}
  if (alias !== undefined) patch.alias = alias
  if (title !== undefined) patch.title = title
  const { ok, data } = await apiFetch(`/api/assets/${encodeURIComponent(a)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  })
  if (!ok) throw new Error(data.error || 'No se pudo actualizar la imagen')
  return data
}

export async function getSheets () {
  const { ok, data } = await apiFetch('/api/sheets', { method: 'GET' })
  if (!ok) throw new Error(data.error || 'No se pudieron cargar las hojas')
  return Array.isArray(data.records) ? data.records : []
}

export async function putSheet (id, record) {
  const payload = {
    titulo: record.titulo,
    materia: record.materia,
    fecha: record.fecha,
    tipo: record.tipo,
    fields: record.fields,
    ...(record.layout != null ? { layout: record.layout } : {}),
    tags: Array.isArray(record.tags) ? record.tags : [],
    errorType: record.tipo === 'error' ? (record.errorType || null) : null,
    reviewLevel: record.reviewLevel ?? 1,
    lastReviewed: record.lastReviewed ?? null,
    nextReview: record.nextReview ?? null
  }
  const { ok, data } = await apiFetch(`/api/sheets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  })
  if (!ok) throw new Error(data.error || 'No se pudo guardar')
  return data
}

export async function postSheetReview (id, nivel) {
  const { ok, data } = await apiFetch(`/api/sheets/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    body: JSON.stringify({ nivel })
  })
  if (!ok) throw new Error(data.error || 'No se pudo registrar el repaso')
  return data
}

export async function getReviewToday () {
  const { ok, data } = await apiFetch('/api/review/today', { method: 'GET' })
  if (!ok) throw new Error(data.error || 'No se pudo cargar el repaso')
  return Array.isArray(data.records) ? data.records : []
}

export async function getStats () {
  const { ok, data } = await apiFetch('/api/stats', { method: 'GET' })
  if (!ok) throw new Error(data.error || 'No se pudieron cargar las estadísticas')
  return data
}

export async function deleteSheetRemote (id) {
  const { ok, data } = await apiFetch(`/api/sheets/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
  if (!ok) throw new Error(data.error || 'No se pudo eliminar')
}

export async function importLocalRecords (records) {
  const { ok, data } = await apiFetch('/api/sheets/import-local', {
    method: 'POST',
    body: JSON.stringify({ records })
  })
  if (!ok) throw new Error(data.error || 'La importación falló')
  return data
}
