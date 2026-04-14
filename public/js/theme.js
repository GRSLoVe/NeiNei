/** Preferencia guardada en servidor; localStorage sincroniza antes de pintar (inline en HTML). */

const MEDIA_DARK = '(prefers-color-scheme: dark)'

let mediaListener = null

export function readCachedTheme () {
  try {
    const t = localStorage.getItem('neinei-theme')
    if (t === 'light' || t === 'dark' || t === 'system') return t
  } catch {
    /* ignore */
  }
  return 'system'
}

export function cacheThemeLocally (pref) {
  try {
    if (pref === 'light' || pref === 'dark' || pref === 'system') {
      localStorage.setItem('neinei-theme', pref)
    }
  } catch {
    /* ignore */
  }
}

export function getResolvedTheme (pref) {
  if (pref === 'dark') return 'dark'
  if (pref === 'light') return 'light'
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia(MEDIA_DARK).matches ? 'dark' : 'light'
}

/** Aplica data-theme resuelto (light | dark) al documento. */
export function applyThemePreference (pref) {
  const resolved = getResolvedTheme(pref)
  document.documentElement.setAttribute('data-theme', resolved)
}

/**
 * Como applyThemePreference, pero si pref es system escucha cambios del SO.
 */
export function applyThemePreferenceWithListener (pref) {
  if (mediaListener && typeof window !== 'undefined') {
    window.matchMedia(MEDIA_DARK).removeEventListener('change', mediaListener)
    mediaListener = null
  }
  applyThemePreference(pref)
  if (pref === 'system' && typeof window !== 'undefined') {
    mediaListener = () => applyThemePreference('system')
    window.matchMedia(MEDIA_DARK).addEventListener('change', mediaListener)
  }
}
