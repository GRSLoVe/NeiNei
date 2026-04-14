import * as api from './api.js'

const params = new URLSearchParams(window.location.search)
const nextUrl = params.get('next') || '/app.html'

function safeNext (url) {
  if (!url || !url.startsWith('/')) return '/app.html'
  if (url.startsWith('//')) return '/app.html'
  return url
}

const elErr = document.getElementById('login-error')
const elBanner = document.getElementById('login-banner')
const elRegisterHint = document.getElementById('register-hint')

if (params.get('err') === 'offline' && elBanner) {
  elBanner.hidden = false
  elBanner.textContent =
    'No hubo respuesta del servidor. Comprueba que la app esté en ejecución o usa «Solo este navegador».'
}

;(async () => {
  try {
    const { ok, user } = await api.getMe()
    if (ok && user) {
      window.location.href = safeNext(nextUrl)
      return
    }
  } catch {
    /* seguir en login */
  }
  try {
    const { registrationOpen } = await api.getAuthOptions()
    if (elRegisterHint) {
      elRegisterHint.textContent = registrationOpen
        ? '¿Primera vez? Usa «Crear cuenta nueva» con otro correo. Cada cuenta tiene sus propias hojas.'
        : '«Crear cuenta nueva» solo funciona si el servidor tiene activado el registro público (ALLOW_REGISTRATION). Si está desactivado, pide al administrador una cuenta o usa el correo del usuario inicial.'
    }
  } catch {
    if (elRegisterHint) {
      elRegisterHint.textContent =
        'Para una cuenta nueva, abre «Crear cuenta nueva». Si no carga el formulario, el registro no está disponible en este servidor.'
    }
  }
})()

document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const em = document.getElementById('login-email')?.value?.trim()
  const p = document.getElementById('login-pass')?.value || ''
  if (elErr) elErr.textContent = ''
  try {
    await api.login(em, p)
    window.location.href = safeNext(nextUrl)
  } catch (err) {
    if (elErr) elErr.textContent = err.message || 'Error de acceso'
  }
})
