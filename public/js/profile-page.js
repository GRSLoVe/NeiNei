import * as api from './api.js'
import { applyThemePreferenceWithListener, cacheThemeLocally } from './theme.js'

const DEFAULT_ACCENT = '#15803d'

const elLoading = document.getElementById('profile-loading')
const elContent = document.getElementById('profile-content')
const elUser = document.getElementById('profile-username')
const elDisplay = document.getElementById('display-name')
const elBio = document.getElementById('profile-bio')
const elAccent = document.getElementById('accent-color')
const elPersonalMsg = document.getElementById('personal-msg')
const elPwMsg = document.getElementById('pw-msg')
const elAvatarMsg = document.getElementById('avatar-msg')
const elAvatarPreview = document.getElementById('profile-avatar-preview')
const elAvatarPlaceholder = document.getElementById('profile-avatar-placeholder')
const elAvatarFile = document.getElementById('avatar-file')
const btnAvatarPick = document.getElementById('btn-avatar-pick')
const btnAvatarRemove = document.getElementById('btn-avatar-remove')

function redirectLogin () {
  window.location.href = `/login.html?next=${encodeURIComponent('/profile.html')}`
}

function applyAccentPreview (user) {
  const hex = user?.accentColor?.trim()
  if (hex && /^#[0-9A-Fa-f]{6}$/.test(hex)) {
    document.documentElement.style.setProperty('--accent-primary', hex)
  } else {
    document.documentElement.style.removeProperty('--accent-primary')
  }
}

function getThemeFromForm () {
  const el = document.querySelector('input[name="theme-pref"]:checked')
  const v = el?.value
  if (v === 'light' || v === 'dark' || v === 'system') return v
  return 'system'
}

function setThemeRadios (theme) {
  const t = theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system'
  const inp = document.querySelector(`input[name="theme-pref"][value="${t}"]`)
  if (inp) inp.checked = true
}

function updateAvatarPreview (user) {
  const url = user?.avatarUrl?.trim()
  if (elAvatarPreview && elAvatarPlaceholder && btnAvatarRemove) {
    if (url) {
      elAvatarPreview.src = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`
      elAvatarPreview.hidden = false
      elAvatarPlaceholder.hidden = true
      btnAvatarRemove.hidden = false
      elAvatarPreview.alt = user?.displayName || user?.username || 'Foto de perfil'
    } else {
      elAvatarPreview.removeAttribute('src')
      elAvatarPreview.hidden = true
      elAvatarPlaceholder.hidden = false
      btnAvatarRemove.hidden = true
    }
  }
}

function syncThemeFromUser (user) {
  const pref = user?.theme === 'light' || user?.theme === 'dark' || user?.theme === 'system'
    ? user.theme
    : 'system'
  cacheThemeLocally(pref)
  setThemeRadios(pref)
  applyThemePreferenceWithListener(pref)
}

document.getElementById('btn-profile-logout')?.addEventListener('click', async () => {
  try {
    await api.logout()
  } catch {
    /* ignore */
  }
  document.documentElement.style.removeProperty('--accent-primary')
  window.location.href = '/login.html'
})

btnAvatarPick?.addEventListener('click', () => elAvatarFile?.click())

elAvatarFile?.addEventListener('change', async () => {
  const file = elAvatarFile?.files?.[0]
  if (!file) return
  if (elAvatarMsg) {
    elAvatarMsg.textContent = ''
    elAvatarMsg.classList.remove('error')
  }
  try {
    const { user } = await api.uploadAvatar(file)
    updateAvatarPreview(user)
    if (elAvatarMsg) elAvatarMsg.textContent = 'Foto actualizada.'
  } catch (err) {
    if (elAvatarMsg) {
      elAvatarMsg.textContent = err.message || 'Error'
      elAvatarMsg.classList.add('error')
    }
  }
  elAvatarFile.value = ''
})

btnAvatarRemove?.addEventListener('click', async () => {
  if (elAvatarMsg) {
    elAvatarMsg.textContent = ''
    elAvatarMsg.classList.remove('error')
  }
  try {
    const { user } = await api.deleteAvatar()
    updateAvatarPreview(user)
    if (elAvatarMsg) elAvatarMsg.textContent = 'Foto eliminada.'
  } catch (err) {
    if (elAvatarMsg) {
      elAvatarMsg.textContent = err.message || 'Error'
      elAvatarMsg.classList.add('error')
    }
  }
})

document.querySelectorAll('input[name="theme-pref"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const pref = getThemeFromForm()
    cacheThemeLocally(pref)
    applyThemePreferenceWithListener(pref)
  })
})

document.getElementById('form-personal')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  if (elPersonalMsg) {
    elPersonalMsg.textContent = ''
    elPersonalMsg.classList.remove('error')
  }
  const displayName = elDisplay?.value?.trim() ?? ''
  const bio = elBio?.value?.trim() ?? ''
  const accentColor = elAccent?.value || ''
  const theme = getThemeFromForm()
  try {
    const { user } = await api.updateProfile({ displayName, bio, accentColor, theme })
    applyAccentPreview(user)
    syncThemeFromUser(user)
    if (elPersonalMsg) {
      elPersonalMsg.textContent = 'Perfil actualizado.'
      elPersonalMsg.classList.remove('error')
    }
  } catch (err) {
    if (elPersonalMsg) {
      elPersonalMsg.textContent = err.message || 'Error'
      elPersonalMsg.classList.add('error')
    }
  }
})

document.getElementById('btn-accent-default')?.addEventListener('click', async () => {
  if (elAccent) elAccent.value = DEFAULT_ACCENT
  if (elPersonalMsg) {
    elPersonalMsg.textContent = ''
    elPersonalMsg.classList.remove('error')
  }
  try {
    const displayName = elDisplay?.value?.trim() ?? ''
    const bio = elBio?.value?.trim() ?? ''
    const theme = getThemeFromForm()
    const { user } = await api.updateProfile({
      displayName,
      bio,
      accentColor: '',
      theme
    })
    applyAccentPreview(user)
    syncThemeFromUser(user)
    if (elPersonalMsg) {
      elPersonalMsg.textContent = 'Color restaurado al predeterminado.'
      elPersonalMsg.classList.remove('error')
    }
  } catch (err) {
    if (elPersonalMsg) {
      elPersonalMsg.textContent = err.message || 'Error'
      elPersonalMsg.classList.add('error')
    }
  }
})

document.getElementById('form-password')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const cur = document.getElementById('pw-current')?.value || ''
  const nw = document.getElementById('pw-new')?.value || ''
  const nw2 = document.getElementById('pw-new2')?.value || ''
  if (elPwMsg) {
    elPwMsg.textContent = ''
    elPwMsg.classList.remove('error')
  }
  if (nw !== nw2) {
    if (elPwMsg) {
      elPwMsg.textContent = 'Las contraseñas nuevas no coinciden'
      elPwMsg.classList.add('error')
    }
    return
  }
  try {
    await api.changePassword(cur, nw)
    if (elPwMsg) {
      elPwMsg.textContent = 'Contraseña actualizada.'
      elPwMsg.classList.remove('error')
    }
    document.getElementById('pw-current').value = ''
    document.getElementById('pw-new').value = ''
    document.getElementById('pw-new2').value = ''
  } catch (err) {
    if (elPwMsg) {
      elPwMsg.textContent = err.message || 'Error'
      elPwMsg.classList.add('error')
    }
  }
})

;(async () => {
  try {
    const { ok, user } = await api.getMe()
    if (!ok || !user) {
      redirectLogin()
      return
    }
    elLoading?.setAttribute('hidden', '')
    elContent?.removeAttribute('hidden')
    const elMail = document.getElementById('profile-email')
    if (elMail) elMail.textContent = user.email || '—'
    if (elUser) elUser.textContent = user.username || '—'
    if (elDisplay) elDisplay.value = user.displayName || ''
    if (elBio) elBio.value = user.bio || ''
    if (elAccent) {
      elAccent.value =
        user.accentColor && /^#[0-9A-Fa-f]{6}$/.test(user.accentColor.trim())
          ? user.accentColor.trim()
          : DEFAULT_ACCENT
    }
    applyAccentPreview(user)
    syncThemeFromUser(user)
    updateAvatarPreview(user)
  } catch {
    redirectLogin()
  }
})()
