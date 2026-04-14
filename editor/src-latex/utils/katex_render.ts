import katex from 'katex'

export type KatexRenderResult =
  | { ok: true; html: string }
  | { ok: false; message: string }

/**
 * Renderiza LaTeX a HTML con KaTeX (sin envolver en delimitadores $).
 */
export function renderKatexHtml (
  latex: string,
  displayMode: boolean
): KatexRenderResult {
  const trimmed = latex.trim()
  if (!trimmed) {
    return { ok: false, message: '' }
  }
  try {
    const html = katex.renderToString(trimmed, {
      displayMode,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      output: 'html'
    })
    return { ok: true, html }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: msg }
  }
}

export function renderKatexDom (
  latex: string,
  displayMode: boolean
): HTMLElement {
  const wrap = document.createElement(displayMode ? 'div' : 'span')
  const r = renderKatexHtml(latex, displayMode)
  if (r.ok) {
    wrap.innerHTML = r.html
    return wrap
  }
  wrap.className = 'neinei-katex-error'
  wrap.textContent = latex
  wrap.title = r.message
  return wrap
}
