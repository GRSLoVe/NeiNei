import type { Range } from '@codemirror/state'
import { EditorSelection, StateField, type EditorState } from '@codemirror/state'
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  type PluginValue
} from '@codemirror/view'
import { scanDollarMath, MathMode } from 'src/utils/context'
import { renderKatexDom } from 'src/utils/katex_render'

type PreviewToken =
  | { type: 'text'; text: string }
  | { type: 'math_inline'; latex: string }
  | { type: 'math_block'; latex: string }

/**
 * Sustitución por chip solo si el cursor no está en el interior del LaTeX (entre delimitadores).
 */
function selectionOverlapsInner (
  innerStart: number,
  innerEnd: number,
  state: EditorState
): boolean {
  if (innerEnd <= innerStart) return false
  for (const r of state.selection.ranges) {
    if (r.empty) {
      const p = r.from
      if (p >= innerStart && p < innerEnd) return true
    } else if (r.from < innerEnd && r.to > innerStart) {
      return true
    }
  }
  return false
}

class MathChipWidget extends WidgetType {
  constructor (
    readonly latex: string,
    readonly innerStart: number,
    readonly innerEnd: number
  ) {
    super()
  }

  eq (other: WidgetType): boolean {
    return (
      other instanceof MathChipWidget &&
      other.latex === this.latex &&
      other.innerStart === this.innerStart &&
      other.innerEnd === this.innerEnd
    )
  }

  toDOM (view: EditorView): HTMLElement {
    const el = document.createElement('span')
    el.className = 'math-chip'
    el.setAttribute('role', 'button')
    el.setAttribute('title', 'Clic para editar la fórmula')
    el.appendChild(renderKatexDom(this.latex, false))
    el.addEventListener('mousedown', e => {
      e.preventDefault()
      e.stopPropagation()
      view.focus()
      const head = Math.min(this.innerStart, view.state.doc.length)
      view.dispatch({
        selection: EditorSelection.cursor(head),
        scrollIntoView: true
      })
    })
    return el
  }

  ignoreEvent (): boolean {
    return true
  }
}

/** Solo inline: `$…$`, `\(…\)`. Bloques `$$` / `\[` → panel externo. */
function buildInlineMathDecorations (state: EditorState): DecorationSet {
  const doc = state.doc.toString()
  const bounds = scanDollarMath(doc)
  const ranges: Range<Decoration>[] = []

  for (const b of bounds) {
    if (b.mode === MathMode.BlockMath) continue
    if (!(b.outer_end > b.inner_end)) continue
    const line = state.doc.lineAt(b.outer_start)
    if (b.outer_end > line.to) continue

    const raw = doc.slice(b.inner_start, b.inner_end)
    if (!raw.trim()) continue
    if (selectionOverlapsInner(b.inner_start, b.inner_end, state)) continue

    ranges.push(
      Decoration.replace({
        widget: new MathChipWidget(raw.trim(), b.inner_start, b.inner_end),
        block: false
      }).range(b.outer_start, b.outer_end)
    )
  }

  return Decoration.set(ranges, true)
}

function tokenizeWithMath (doc: string): PreviewToken[] {
  const bounds = scanDollarMath(doc).slice().sort((a, b) => a.outer_start - b.outer_start)
  const out: PreviewToken[] = []
  let cursor = 0
  for (const b of bounds) {
    const start = Math.max(0, Math.min(doc.length, b.outer_start))
    const end = Math.max(0, Math.min(doc.length, b.outer_end))
    const innerStart = Math.max(0, Math.min(doc.length, b.inner_start))
    const innerEnd = Math.max(0, Math.min(doc.length, b.inner_end))
    if (start > cursor) out.push({ type: 'text', text: doc.slice(cursor, start) })

    if (end > innerEnd && innerEnd > innerStart) {
      const latex = doc.slice(innerStart, innerEnd).trim()
      if (latex) {
        out.push({
          type: b.mode === MathMode.BlockMath ? 'math_block' : 'math_inline',
          latex
        })
      } else {
        out.push({ type: 'text', text: doc.slice(start, end) })
      }
    } else {
      out.push({ type: 'text', text: doc.slice(start, end) })
    }
    cursor = Math.max(cursor, end)
  }
  if (cursor < doc.length) out.push({ type: 'text', text: doc.slice(cursor) })
  return out
}

function splitTextToLines (tokens: PreviewToken[]): PreviewToken[][] {
  const lines: PreviewToken[][] = [[]]
  for (const t of tokens) {
    if (t.type !== 'text') {
      lines[lines.length - 1].push(t)
      continue
    }
    const parts = t.text.split('\n')
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) lines[lines.length - 1].push({ type: 'text', text: parts[i] })
      if (i !== parts.length - 1) lines.push([])
    }
  }
  return lines
}

function appendInlineFormatting (parent: HTMLElement, text: string) {
  // Muy simple y seguro: **bold**, *italic*, `code` (sin anidado complejo)
  let i = 0
  while (i < text.length) {
    const nextCode = text.indexOf('`', i)
    const nextBold = text.indexOf('**', i)
    const nextIt = text.indexOf('*', i)
    let next = -1
    let kind: 'code' | 'bold' | 'italic' | null = null

    const cand: Array<{ pos: number; kind: 'code' | 'bold' | 'italic' }> = []
    if (nextCode !== -1) cand.push({ pos: nextCode, kind: 'code' })
    if (nextBold !== -1) cand.push({ pos: nextBold, kind: 'bold' })
    if (nextIt !== -1) cand.push({ pos: nextIt, kind: 'italic' })
    cand.sort((a, b) => a.pos - b.pos)
    if (cand.length) {
      next = cand[0].pos
      kind = cand[0].kind
    }

    if (next === -1 || kind == null) {
      parent.appendChild(document.createTextNode(text.slice(i)))
      return
    }
    if (next > i) parent.appendChild(document.createTextNode(text.slice(i, next)))

    if (kind === 'code') {
      const end = text.indexOf('`', next + 1)
      if (end === -1) {
        parent.appendChild(document.createTextNode(text.slice(next)))
        return
      }
      const code = document.createElement('code')
      code.textContent = text.slice(next + 1, end)
      parent.appendChild(code)
      i = end + 1
      continue
    }
    if (kind === 'bold') {
      const end = text.indexOf('**', next + 2)
      if (end === -1) {
        parent.appendChild(document.createTextNode(text.slice(next)))
        return
      }
      const strong = document.createElement('strong')
      strong.textContent = text.slice(next + 2, end)
      parent.appendChild(strong)
      i = end + 2
      continue
    }
    // italic
    const end = text.indexOf('*', next + 1)
    if (end === -1) {
      parent.appendChild(document.createTextNode(text.slice(next)))
      return
    }
    const em = document.createElement('em')
    em.textContent = text.slice(next + 1, end)
    parent.appendChild(em)
    i = end + 1
  }
}

function appendInlineTextWithEmbeds (parent: HTMLElement, text: string) {
  // ![[archivo.png|600]]  (ancho opcional)
  const reImg = /!\[\[([^\]\|]+?)(?:\|(\d+))?\]\]/g
  let idx = 0
  while (true) {
    const m = reImg.exec(text)
    if (!m) break
    if (m.index > idx) {
      const span = document.createElement('span')
      appendInlineFormatting(span, text.slice(idx, m.index))
      parent.appendChild(span)
    }
    const file = (m[1] || '').trim()
    const w = m[2] ? Number(m[2]) : null
    const img = document.createElement('img')
    img.className = 'md-embed-image'
    img.alt = file
    img.loading = 'lazy'
    img.decoding = 'async'
    // Resolver alias de galería (servido por la API) o fallback a ruta relativa.
    img.src = file.includes('/') ? encodeURI(file) : `/api/assets/${encodeURIComponent(file)}`
    if (w && Number.isFinite(w)) img.style.maxWidth = `${Math.max(40, Math.min(1400, w))}px`
    parent.appendChild(img)
    idx = m.index + m[0].length
  }
  if (idx < text.length) {
    const span = document.createElement('span')
    appendInlineFormatting(span, text.slice(idx))
    parent.appendChild(span)
  }
}

function renderMarkdownLike (doc: string, view: EditorView): HTMLElement {
  const root = document.createElement('div')
  root.className = 'md-preview-root'

  const lines = splitTextToLines(tokenizeWithMath(doc))
  let inCode = false
  let codeBuf: string[] = []

  const flushCode = () => {
    if (!inCode) return
    inCode = false
    const pre = document.createElement('pre')
    pre.className = 'md-codeblock'
    const code = document.createElement('code')
    code.textContent = codeBuf.join('\n')
    pre.appendChild(code)
    root.appendChild(pre)
    codeBuf = []
  }

  const appendParagraphFromTokens = (toks: PreviewToken[]) => {
    const p = document.createElement('p')
    p.className = 'md-paragraph'
    for (const t of toks) {
      if (t.type === 'text') {
        appendInlineTextWithEmbeds(p, t.text)
      } else if (t.type === 'math_inline') {
        const wrap = document.createElement('span')
        wrap.className = 'md-math-inline'
        wrap.appendChild(renderKatexDom(t.latex, false))
        p.appendChild(wrap)
      } else if (t.type === 'math_block') {
        const div = document.createElement('div')
        div.className = 'md-math-block'
        div.appendChild(renderKatexDom(t.latex, true))
        root.appendChild(p)
        root.appendChild(div)
        return
      }
    }
    root.appendChild(p)
  }

  for (const lineTokens of lines) {
    const plainLine = lineTokens
      .map(t => (t.type === 'text' ? t.text : t.type === 'math_inline' ? '$' : '$$'))
      .join('')

    // Fenced code blocks ```
    if (plainLine.trim().startsWith('```')) {
      if (inCode) {
        flushCode()
      } else {
        inCode = true
      }
      continue
    }
    if (inCode) {
      // en bloque de código: renderizamos todo como texto (sin KaTeX/embeds)
      codeBuf.push(lineTokens.map(t => (t.type === 'text' ? t.text : t.type === 'math_inline' ? `$${t.latex}$` : `$$\n${t.latex}\n$$`)).join(''))
      continue
    }

    // Separador ---
    if (/^\s*---\s*$/.test(plainLine)) {
      const hr = document.createElement('hr')
      hr.className = 'md-hr'
      root.appendChild(hr)
      continue
    }

    // Headings: ## / ### (simple)
    const mHeading = plainLine.match(/^\s*(#{2,3})\s+(.*)$/)
    if (mHeading) {
      const lvl = mHeading[1].length
      const h = document.createElement(lvl === 2 ? 'h2' : 'h3')
      h.className = 'md-heading'
      // Heading sin math complejo por ahora: si hay tokens no-texto, los renderizamos inline.
      const rest = lineTokens.slice()
      // quitar prefijo "## " o "### " solo del primer token de texto
      if (rest.length && rest[0].type === 'text') {
        rest[0] = { type: 'text', text: rest[0].text.replace(/^\s*#{2,3}\s+/, '') }
      }
      for (const t of rest) {
        if (t.type === 'text') appendInlineTextWithEmbeds(h, t.text)
        else if (t.type === 'math_inline') h.appendChild(renderKatexDom(t.latex, false))
        else {
          const blk = document.createElement('div')
          blk.className = 'md-math-block'
          blk.appendChild(renderKatexDom(t.latex, true))
          root.appendChild(h)
          root.appendChild(blk)
          continue
        }
      }
      root.appendChild(h)
      continue
    }

    // Línea en blanco -> salto de párrafo
    if (plainLine.trim() === '') {
      const br = document.createElement('div')
      br.className = 'md-blank'
      root.appendChild(br)
      continue
    }

    // Task list: - [ ] / - [x]
    const mTask = plainLine.match(/^\s*-\s*\[( |x|X)\]\s+(.*)$/)
    if (mTask) {
      const row = document.createElement('div')
      row.className = 'md-task'
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.disabled = true
      cb.checked = mTask[1].toLowerCase() === 'x'
      const content = document.createElement('span')
      content.className = 'md-task-content'
      const toks = lineTokens.slice()
      if (toks.length && toks[0].type === 'text') {
        toks[0] = { type: 'text', text: toks[0].text.replace(/^\s*-\s*\[(?: |x|X)\]\s+/, '') }
      }
      for (const t of toks) {
        if (t.type === 'text') appendInlineTextWithEmbeds(content, t.text)
        else if (t.type === 'math_inline') content.appendChild(renderKatexDom(t.latex, false))
        else {
          const blk = document.createElement('div')
          blk.className = 'md-math-block'
          blk.appendChild(renderKatexDom(t.latex, true))
          row.appendChild(cb)
          row.appendChild(content)
          root.appendChild(row)
          root.appendChild(blk)
          continue
        }
      }
      row.appendChild(cb)
      row.appendChild(content)
      root.appendChild(row)
      continue
    }

    // Default: párrafo (preservando saltos por líneas)
    appendParagraphFromTokens(lineTokens)
  }

  flushCode()
  return root
}

/**
 * StateField (no ViewPlugin): CM no permite replace widgets que crucen líneas
 * ni ciertos efectos de bloque desde facet `decorations` de plugins.
 */
export function mathPreviewDecorations () {
  return StateField.define<DecorationSet>({
    create (state) {
      return buildInlineMathDecorations(state)
    },
    update (prev, tr) {
      if (tr.docChanged || tr.selectionSet) {
        return buildInlineMathDecorations(tr.state)
      }
      return prev.map(tr.changes)
    },
    provide: f => EditorView.decorations.from(f)
  })
}

/**
 * Vista previa bajo el editor: texto plano + KaTeX (inline `$…$`, `\(...\)`, bloques `$$…$$`, `\[…\]`).
 */
export function mathBlockExternalPreviewPlugin () {
  return ViewPlugin.fromClass(
    class implements PluginValue {
      panel: HTMLElement
      private onPlainEditInput?: (ev: Event) => void
      private onPlainEditPaste?: (ev: ClipboardEvent) => void
      private onPlainEditKeyDown?: (ev: KeyboardEvent) => void
      private boxClassObserver?: MutationObserver
      private previewWrap?: HTMLElement
      private previewRenderedHost?: HTMLElement
      private previewEditOverlay?: HTMLElement

      constructor (private view: EditorView) {
        this.panel = document.createElement('div')
        this.panel.className = 'math-block-external-previews'
        const parent = this.view.dom.parentElement
        if (parent) parent.appendChild(this.panel)
        this.installPreviewOnlyObserver()
        this.sync()
      }

      update (u: ViewUpdate) {
        if (u.docChanged) this.sync()
      }

      destroy () {
        try {
          this.boxClassObserver?.disconnect()
        } catch {
          /* ignore */
        }
        this.panel.remove()
      }

      getBox (): HTMLElement | null {
        // Importante: en el lifecycle actual, `.box-cm-editor` se agrega DESPUÉS
        // de crear el EditorView. `.box` existe desde el HTML inicial.
        return (this.view.dom.closest?.('.box') as HTMLElement | null) ?? null
      }

      isPreviewOnly (): boolean {
        const box = this.getBox()
        return Boolean(box && box.classList.contains('is-cm-editor-preview-only'))
      }

      installPreviewOnlyObserver () {
        const box = this.getBox()
        if (!box) return
        this.boxClassObserver = new MutationObserver((muts) => {
          for (const m of muts) {
            if (m.type === 'attributes' && m.attributeName === 'class') {
              // Cambió el estado del ojo: re-sincronizamos para alternar contenteditable/aria.
              this.sync()
              break
            }
          }
        })
        this.boxClassObserver.observe(box, { attributes: true, attributeFilter: ['class'] })
      }

      attachPlainTextEditing (root: HTMLElement) {
        // Siempre limpiamos handlers viejos: `sync()` re-renderiza el root.
        if (this.onPlainEditInput) root.removeEventListener('input', this.onPlainEditInput)
        if (this.onPlainEditPaste) root.removeEventListener('paste', this.onPlainEditPaste)
        if (this.onPlainEditKeyDown) root.removeEventListener('keydown', this.onPlainEditKeyDown)

        const previewOnly = this.isPreviewOnly()
        if (!previewOnly) {
          this.panel.setAttribute('aria-hidden', 'true')
          root.removeAttribute('contenteditable')
          root.removeAttribute('role')
          root.removeAttribute('aria-label')
          root.classList.remove('is-plain-editable')
          this.onPlainEditInput = undefined
          this.onPlainEditPaste = undefined
          this.onPlainEditKeyDown = undefined
          return
        }

        // Si vamos a editar, NO debe estar aria-hidden.
        this.panel.removeAttribute('aria-hidden')

        // Edición rápida en la vista previa: solo texto plano.
        root.classList.add('is-plain-editable')
        root.setAttribute('role', 'textbox')
        root.setAttribute('aria-label', 'Edición rápida (texto plano)')
        // `plaintext-only` es soportado en Chromium; otros browsers lo ignoran y caen a texto normal.
        root.setAttribute('contenteditable', 'plaintext-only')

        this.onPlainEditKeyDown = (ev: KeyboardEvent) => {
          // Evitar que el Enter dispare atajos/globales que cambien el foco.
          // Insertamos salto de línea como texto plano.
          if (ev.key === 'Enter') {
            ev.preventDefault()
            ev.stopPropagation()
            try {
              const ok = (document as unknown as { execCommand?: (cmd: string, ui: boolean, val?: string) => boolean }).execCommand?.('insertText', false, '\n')
              if (!ok) {
                // Fallback: insertLineBreak suele crear <div>/<br>, pero al menos mantiene foco.
                ;(document as unknown as { execCommand?: (cmd: string, ui: boolean, val?: string) => boolean }).execCommand?.('insertLineBreak', false)
              }
            } catch {
              // ignore
            }
            return
          }

          // Mientras editamos aquí, no queremos que teclas se propaguen al resto de la app.
          // Esto reduce la chance de que un handler global robe el foco.
          ev.stopPropagation()
        }

        this.onPlainEditPaste = (ev: ClipboardEvent) => {
          // Pegar como texto plano
          try {
            const txt = ev.clipboardData?.getData('text/plain') ?? ''
            if (typeof (document as unknown as { execCommand?: (cmd: string, ui: boolean, val?: string) => boolean }).execCommand === 'function') {
              ev.preventDefault()
              ;(document as unknown as { execCommand: (cmd: string, ui: boolean, val?: string) => boolean }).execCommand('insertText', false, txt)
            }
          } catch {
            // si falla, dejamos el paste normal
          }
        }

        let applying = false
        this.onPlainEditInput = () => {
          if (applying) return
          applying = true
          try {
            const next = root.innerText.replace(/\r\n/g, '\n')
            const cur = this.view.state.doc.toString()
            if (next !== cur) {
              this.view.dispatch({
                changes: { from: 0, to: this.view.state.doc.length, insert: next }
              })
            }
          } finally {
            applying = false
          }
        }

        root.addEventListener('paste', this.onPlainEditPaste)
        root.addEventListener('keydown', this.onPlainEditKeyDown)
        root.addEventListener('input', this.onPlainEditInput)
      }

      ensurePreviewOnlyUi () {
        if (!this.previewWrap) {
          const wrap = document.createElement('div')
          wrap.className = 'neinei-preview-only-wrap'

          const renderedHost = document.createElement('div')
          renderedHost.className = 'neinei-preview-only-rendered'

          const overlay = document.createElement('div')
          overlay.className = 'neinei-preview-only-editor md-preview-root is-plain-editable'
          overlay.setAttribute('role', 'textbox')
          overlay.setAttribute('aria-label', 'Edición rápida (texto plano)')
          overlay.setAttribute('contenteditable', 'plaintext-only')
          overlay.style.whiteSpace = 'pre-wrap'
          overlay.style.wordBreak = 'break-word'
          overlay.style.minHeight = '1.2em'

          // Overlay primero para poder estilizar el render con selector de hermano (~).
          wrap.appendChild(overlay)
          wrap.appendChild(renderedHost)

          this.previewWrap = wrap
          this.previewRenderedHost = renderedHost
          this.previewEditOverlay = overlay
        }

        // Asegurar handlers (por si se recreó por cambio de modo).
        if (this.previewEditOverlay) this.attachPlainTextEditing(this.previewEditOverlay)
      }

      sync () {
        const doc = this.view.state.doc.toString()
        const previewOnly = this.isPreviewOnly()

        // Si estamos en modo "solo vista previa", mantenemos el render KaTeX visible y
        // encima una capa editable (texto invisible + caret visible) que sincroniza el texto.
        if (previewOnly) {
          if (!doc.trim()) {
            // Si está vacío, limpiamos la UI pero sin forzar re-render en cada tecla.
            this.panel.replaceChildren()
            return
          }
          this.panel.removeAttribute('aria-hidden')
          this.ensurePreviewOnlyUi()
          if (this.previewWrap && this.previewWrap.parentElement !== this.panel) {
            this.panel.replaceChildren()
            this.panel.appendChild(this.previewWrap)
          }

          // Actualizar capa editable solo si no está enfocada.
          const overlay = this.previewEditOverlay
          if (overlay) {
            const active = globalThis.document?.activeElement
            if (active !== overlay) {
              const cur = overlay.innerText.replace(/\r\n/g, '\n')
              if (cur !== doc) overlay.innerText = doc
            }
          }

          // Re-render KaTeX/markdown dentro del host, sin tocar la capa editable.
          const host = this.previewRenderedHost
          if (host) {
            host.replaceChildren()
            host.appendChild(renderMarkdownLike(doc, this.view))
          }
          return
        }

        // Modo normal: renderer markdown + KaTeX.
        this.panel.replaceChildren()
        const rendered = renderMarkdownLike(doc, this.view)
        // Mostrar el panel solo si hay algo que renderizar “especial” (math o markdown).
        if (!doc.trim()) return
        this.attachPlainTextEditing(rendered)
        this.panel.appendChild(rendered)
      }
    }
  )
}
