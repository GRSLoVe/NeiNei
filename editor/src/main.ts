import './polyfills'
import './prism-init'
import 'katex/dist/katex.min.css'
import 'katex/dist/contrib/mhchem.mjs'

import { StreamLanguage } from '@codemirror/language'
import { Prec, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { minimalSetup } from 'codemirror'

import { getLatexSuiteConfigExtension } from 'src/snippets/codemirror/config'
import { snippetExtensions } from 'src/snippets/codemirror/extensions'
import {
  handleUpdate,
  onInput,
  keyboardEventPlugin,
  getKeymaps
} from 'src/latex_suite'
import { contextPlugin, mathBoundsPlugin } from 'src/utils/context'
import {
  colorPairedBracketsPluginLowestPrec,
  highlightCursorBracketsPlugin
} from 'src/editor_extensions/highlight_brackets'
import {
  cursorTooltipField,
  cursorTooltipBaseTheme,
  neineiMathTooltips
} from 'src/editor_extensions/math_tooltip'
import {
  mathBlockExternalPreviewPlugin
} from 'src/editor_extensions/math_preview_decorations'
import {
  DEFAULT_SETTINGS,
  processLatexSuiteSettings,
  type LatexSuiteCMSettings
} from 'src/settings/settings'
import {
  parseSnippetVariablesFromObject,
  parseSnippetsFromArray
} from 'src/snippets/parse'
import bundledSnippetVariables from '../src-latex/default_snippet_variables.js'
import bundledSnippets from '../src-latex/default_snippets.js'

let cmSettingsPromise: Promise<LatexSuiteCMSettings> | null = null

const CM_TOGGLE_CLASS = 'is-cm-editor-preview-only'

const SVG_EYE = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`

const SVG_EYE_OFF = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`

function attachCmEditorEyeToggle (box: HTMLElement): void {
  if (box.querySelector(':scope > .cm-editor-eye-toggle')) return

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'cm-editor-eye-toggle'
  // Por defecto: editor oculto (solo vista previa)
  box.classList.add(CM_TOGGLE_CLASS)
  btn.setAttribute('aria-pressed', 'true')
  btn.setAttribute('aria-label', 'Mostrar editor')
  btn.title = 'Mostrar editor'
  btn.innerHTML = `<span class="cm-editor-eye-toggle__icon">${SVG_EYE}</span>`

  btn.addEventListener('click', () => {
    const on = box.classList.toggle(CM_TOGGLE_CLASS)
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
    if (on) {
      btn.setAttribute('aria-label', 'Mostrar editor')
      btn.title = 'Mostrar editor'
      btn.innerHTML = `<span class="cm-editor-eye-toggle__icon">${SVG_EYE}</span>`
    } else {
      btn.setAttribute('aria-label', 'Ocultar editor')
      btn.title = 'Ocultar editor (solo vista previa)'
      btn.innerHTML = `<span class="cm-editor-eye-toggle__icon">${SVG_EYE_OFF}</span>`
    }
  })

  box.prepend(btn)

  // Click en el bloque (cuando está oculto) = empezar a escribir.
  // En modo overlay, la capa editable suele capturar el click; esto es un fallback robusto.
  box.addEventListener('pointerdown', (ev) => {
    if (!box.classList.contains(CM_TOGGLE_CLASS)) return
    const t = ev.target as HTMLElement | null
    if (t && t.closest?.('.cm-editor-eye-toggle')) return
    const overlay = box.querySelector<HTMLElement>('.neinei-preview-only-editor[contenteditable]')
    overlay?.focus?.()
  })
}

function slugifyAlias (s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64)
}

async function uploadImageToGallery (file: File, alias: string, title: string | null) {
  const fd = new FormData()
  fd.append('file', file)
  const qs = new URLSearchParams({ alias })
  if (title) qs.set('title', title)
  const r = await fetch(`/api/assets?${qs.toString()}`, {
    method: 'POST',
    body: fd,
    credentials: 'include'
  })
  let data: any = {}
  try {
    data = await r.json()
  } catch {
    /* ignore */
  }
  if (!r.ok) throw new Error(data?.error || 'No se pudo subir la imagen')
  return data
}

async function uploadWithAutoAlias (file: File): Promise<{ alias: string }> {
  const base = slugifyAlias(file.name.replace(/\.[a-z0-9]+$/i, '')) || 'imagen'
  // Intentos: base + sufijo corto, y si colisiona, incrementa.
  const seed = Date.now().toString(36).slice(-5)
  for (let i = 0; i < 8; i++) {
    const alias = slugifyAlias(i === 0 ? `${base}-${seed}` : `${base}-${seed}-${i + 1}`)
    try {
      await uploadImageToGallery(file, alias, file.name || null)
      return { alias }
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (!msg.toLowerCase().includes('ya existe')) throw e
    }
  }
  // Último recurso
  const alias = slugifyAlias(`${base}-${seed}-${Math.random().toString(36).slice(2, 6)}`)
  await uploadImageToGallery(file, alias, file.name || null)
  return { alias }
}

function imagePasteDropPlugin (): Extension {
  return EditorView.domEventHandlers({
    paste: (e, view) => {
      const files = e.clipboardData?.files
      if (!files || files.length === 0) return false
      const file = files[0]
      if (!file || !file.type.startsWith('image/')) return false
      e.preventDefault()

      void (async () => {
        try {
          const { alias } = await uploadWithAutoAlias(file)
          const embed = `![[${alias}|600]]`
          const sel = view.state.selection.main
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: embed },
            selection: { anchor: sel.from + embed.length }
          })
        } catch (err: any) {
          alert(err?.message || 'Error al subir la imagen')
        }
      })()
      return true
    },
    drop: (e, view) => {
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return false
      const file = files[0]
      if (!file || !file.type.startsWith('image/')) return false
      e.preventDefault()

      void (async () => {
        try {
          const { alias } = await uploadWithAutoAlias(file)
          const embed = `![[${alias}|600]]`
          const sel = view.state.selection.main
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: embed },
            selection: { anchor: sel.from + embed.length }
          })
        } catch (err: any) {
          alert(err?.message || 'Error al subir la imagen')
        }
      })()
      return true
    }
  })
}

function buildExtensions (
  cmSettings: LatexSuiteCMSettings,
  ta: HTMLTextAreaElement
): Extension[] {
  const exts: Extension[] = [
    minimalSetup,
    StreamLanguage.define(stex),
    EditorView.editable.of(true),
    EditorView.lineWrapping,
    Prec.highest(mathBoundsPlugin.extension),
    Prec.highest(contextPlugin.extension),
    getLatexSuiteConfigExtension(cmSettings),
    Prec.highest(keyboardEventPlugin.extension),
    EditorView.inputHandler.of(onInput),
    EditorView.updateListener.of(handleUpdate),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        ta.value = update.state.doc.toString()
        queueMicrotask(() => {
          ta.dispatchEvent(new Event('input', { bubbles: true }))
          const ve = document.getElementById('view-editor')
          if (ve) {
            ve.dispatchEvent(
              new CustomEvent<{ field: HTMLTextAreaElement }>('neinei-field-sync', {
                bubbles: true,
                detail: { field: ta }
              })
            )
          }
        })
      }
    }),
    snippetExtensions,
    Prec.highest(keymap.of(getKeymaps(cmSettings))),
    imagePasteDropPlugin(),
    neineiFieldTheme
  ]
  if (cmSettings.colorPairedBracketsEnabled) {
    exts.push(colorPairedBracketsPluginLowestPrec)
  }
  if (cmSettings.highlightCursorBracketsEnabled) {
    exts.push(highlightCursorBracketsPlugin.extension)
  }
  if (cmSettings.mathPreviewEnabled) {
    exts.push(
      cursorTooltipField,
      cursorTooltipBaseTheme,
      neineiMathTooltips,
      mathBlockExternalPreviewPlugin()
    )
  }
  return exts
}

const neineiFieldTheme = EditorView.theme({
  '&': {
    minHeight: '6.5rem',
    fontSize: '15px'
  },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    minHeight: '6.5rem'
  },
  '.cm-content': { minHeight: '6rem', padding: '0.5rem 0.6rem' },
  '.cm-gutters': { display: 'none' },
  /* stex / Prism-latex–like: colores legibles con tema claro/oscuro de la app */
  '.cm-comment': { color: 'var(--neinei-cm-comment, #6a737d)' },
  '.cm-keyword': { color: 'var(--neinei-cm-keyword, #005cc5)' },
  '.cm-string': { color: 'var(--neinei-cm-string, #22863a)' },
  '.cm-meta': { color: 'var(--neinei-cm-meta, #6f42c1)' },
  '.cm-atom': { color: 'var(--neinei-cm-atom, #005cc5)' },
  '.cm-bracket': { color: 'var(--neinei-cm-bracket, #24292e)' }
})

async function getCMSettings (): Promise<LatexSuiteCMSettings> {
  if (!cmSettingsPromise) {
    cmSettingsPromise = (async () => {
      const vars = parseSnippetVariablesFromObject(bundledSnippetVariables)
      const snippets = parseSnippetsFromArray(bundledSnippets, vars)
      return processLatexSuiteSettings(snippets, DEFAULT_SETTINGS)
    })()
  }
  return cmSettingsPromise
}

function upgradeTextarea (ta: HTMLTextAreaElement, cmSettings: LatexSuiteCMSettings) {
  if (ta.dataset.cmUpgraded === '1') return
  const box = ta.closest('.box')
  if (!box) {
    return
  }

  ta.dataset.cmUpgraded = '1'
  ta.classList.add('field-input-hidden')
  ta.setAttribute('tabindex', '-1')
  ta.setAttribute('aria-hidden', 'true')

  const wrap = document.createElement('div')
  wrap.className = 'cm-field-editor-root'
  ta.insertAdjacentElement('afterend', wrap)

  const ph = ta.getAttribute('placeholder') || ''
  const extensions = buildExtensions(cmSettings, ta)
  if (ph) {
    extensions.push(placeholder(ph))
  }

  try {
    const state = EditorState.create({
      doc: ta.value,
      extensions
    })

    const view = new EditorView({
      state,
      parent: wrap
    })

    ;(ta as unknown as { _cmView: EditorView })._cmView = view

    box.classList.add('box-cm-editor')
    attachCmEditorEyeToggle(box)
  } catch (e) {
    delete ta.dataset.cmUpgraded
    ta.classList.remove('field-input-hidden')
    ta.removeAttribute('tabindex')
    ta.removeAttribute('aria-hidden')
    wrap.remove()
    throw e
  }
}

export async function initCmSheetEditors (): Promise<void> {
  const cmSettings = await getCMSettings()
  document.querySelectorAll<HTMLTextAreaElement>('textarea.field-input[data-f]').forEach((ta) => {
    try {
      upgradeTextarea(ta, cmSettings)
    } catch (e) {
      console.error('NeiNei CM field:', e)
    }
  })
}

export function getPlainAndCaret (ta: HTMLTextAreaElement | null) {
  if (!ta) return { plain: '', caret: 0 }
  const v = (ta as unknown as { _cmView?: EditorView })._cmView
  if (v) {
    return {
      plain: v.state.doc.toString(),
      caret: v.state.selection.main.head
    }
  }
  return {
    plain: ta.value,
    caret: typeof ta.selectionStart === 'number' ? ta.selectionStart : 0
  }
}

export function insertPlainIntoField (
  ta: HTMLTextAreaElement | null,
  start: number,
  end: number,
  text: string,
  caretPlainOverride: number | null = null
) {
  if (!ta) return
  const v = (ta as unknown as { _cmView?: EditorView })._cmView
  const caretPlain =
    typeof caretPlainOverride === 'number' ? caretPlainOverride : start + text.length
  if (v) {
    const beforeLen = v.state.doc.length
    const removed = end - start
    const newLen = beforeLen - removed + text.length
    const anchor = Math.min(Math.max(0, caretPlain), newLen)
    v.dispatch({
      changes: { from: start, to: end, insert: text },
      selection: { anchor, head: anchor }
    })
    v.focus()
    return
  }
  const val = ta.value
  ta.value = val.slice(0, start) + text + val.slice(end)
  const pos = Math.min(caretPlain, ta.value.length)
  ta.selectionStart = ta.selectionEnd = pos
  ta.focus()
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}

export function refreshMathEditor (ta: HTMLTextAreaElement | null) {
  const v = ta && (ta as unknown as { _cmView?: EditorView })._cmView
  if (!v) return
  const next = ta!.value
  v.dispatch({
    changes: { from: 0, to: v.state.doc.length, insert: next },
    selection: { anchor: Math.min(v.state.selection.main.anchor, next.length) }
  })
}

/** Compat con el nombre anterior del módulo. */
export const initMathInlineEditors = initCmSheetEditors
