import * as api from './api.js'

const params = new URLSearchParams(window.location.search)
const nextUrl = params.get('next') || '/app.html'

function safeNext (url) {
  if (!url || !url.startsWith('/')) return '/app.html'
  if (url.startsWith('//')) return '/app.html'
  return url
}

const elClosed = document.getElementById('register-closed')
const elForm = document.getElementById('register-form')
const elErr = document.getElementById('register-error')

;(async () => {
  try {
    const { registrationOpen } = await api.getAuthOptions()
    if (!registrationOpen) {
      elClosed?.removeAttribute('hidden')
      return
    }
    elForm?.removeAttribute('hidden')
  } catch {
    elClosed?.removeAttribute('hidden')
    if (elClosed) {
      elClosed.innerHTML =
        'No se pudo comprobar el registro. <a href="/login.html">Volver al acceso</a>.'
    }
  }
})()

elForm?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const em = document.getElementById('reg-email')?.value?.trim()
  const p = document.getElementById('reg-pass')?.value || ''
  const p2 = document.getElementById('reg-pass2')?.value || ''
  if (elErr) {
    elErr.textContent = ''
    elErr.classList.remove('error')
  }
  if (p !== p2) {
    if (elErr) {
      elErr.textContent = 'Las contraseñas no coinciden'
      elErr.classList.add('error')
    }
    return
  }
  try {
    await api.register(em, p)
    window.location.href = safeNext(nextUrl)
  } catch (err) {
    if (elErr) {
      elErr.textContent = err.message || 'Error al registrar'
      elErr.classList.add('error')
    }
  }
})
