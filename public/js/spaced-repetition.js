/**
 * Intervalos de repaso espaciado (nivel 1–5 → días).
 * Debe coincidir con api/lib/sheets-helpers.js → cálculo de next_review.
 */
export function calcularProximoRepaso (nivel) {
  const n = Math.min(5, Math.max(1, Number(nivel) || 1))
  const dias = { 1: 1, 2: 3, 3: 7, 4: 15, 5: 30 }
  const d = dias[n] ?? 1
  const hoy = new Date()
  hoy.setDate(hoy.getDate() + d)
  return hoy.toISOString()
}

/**
 * Tres botones → nivel concreto a enviar al API (sube dentro de rangos).
 */
export function nivelParaBotonRepaso (boton, reviewLevelActual) {
  const cur = Math.min(5, Math.max(1, Number(reviewLevelActual) || 1))
  if (boton === 'no') return 1
  if (boton === 'regular') return cur <= 2 ? 2 : 3
  if (boton === 'si') return cur >= 4 ? 5 : 4
  return cur
}
