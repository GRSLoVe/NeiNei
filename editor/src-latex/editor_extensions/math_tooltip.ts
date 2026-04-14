import {
  Tooltip,
  showTooltip,
  EditorView,
  ViewUpdate,
  tooltips
} from '@codemirror/view'
import { StateField, EditorState, EditorSelection, StateEffect } from '@codemirror/state'
import { Bounds, Context, getContextPlugin } from 'src/utils/context'
import { getLatexSuiteConfig } from 'src/snippets/codemirror/config'
import { renderKatexDom } from 'src/utils/katex_render'

type MathTooltip = {
  equation: string
  bounds: Bounds
  pos: number
  tooltip: Tooltip
}

const updateTooltipEffect = StateEffect.define<MathTooltip[]>()

export const cursorTooltipField = StateField.define<readonly MathTooltip[]>({
  create: () => [],

  update (tooltips, tr) {
    for (const effect of tr.effects) {
      if (effect.is(updateTooltipEffect)) return effect.value
    }
    return tooltips
  },

  provide: f =>
    showTooltip.computeN([f], state => state.field(f).map(t => t.tooltip))
})

function insertCursorInLatex (
  eqn: string,
  eqnPos: number,
  cursorChar: string
): string {
  const cur = cursorChar.trim()
  if (!cur) return eqn.slice(0, eqnPos) + eqn.slice(eqnPos)
  const escaped = cur.replace(/\\/g, '\\textbackslash{}').replace(/}/g, '\\}')
  return `${eqn.slice(0, eqnPos)}\\text{${escaped}}${eqn.slice(eqnPos)}`
}

/** Vista previa flotante con KaTeX (sustituto de renderMath de Obsidian). */
export function handleMathTooltip (update: ViewUpdate) {
  const shouldUpdate = update.docChanged || update.selectionSet
  if (!shouldUpdate) return
  const settings = getLatexSuiteConfig(update.state)

  const ctx = getContextPlugin(update.view)
  const eqnBounds = shouldShowTooltip(update.state, ctx)

  if (!eqnBounds) {
    const currTooltips = update.state.field(cursorTooltipField)
    if (currTooltips.length > 0) {
      update.view.dispatch({
        effects: [updateTooltipEffect.of([])]
      })
    }
    return
  }

  const eqn = update.state.sliceDoc(eqnBounds.inner_start, eqnBounds.inner_end)
  const pos = ctx.pos
  const eqnPos = Math.max(
    0,
    Math.min(eqn.length, pos - eqnBounds.inner_start)
  )

  const eqnWithDecorations = insertCursorInLatex(
    eqn,
    eqnPos,
    settings.mathPreviewCursor
  )

  const oldTooltips = update.state.field(cursorTooltipField)
  if (
    oldTooltips.length === 1 &&
    oldTooltips[0].equation === eqnWithDecorations &&
    oldTooltips[0].bounds.inner_start === eqnBounds.inner_start &&
    oldTooltips[0].bounds.inner_end === eqnBounds.inner_end
  ) {
    return
  }

  const above = settings.mathPreviewPositionIsAbove
  const displayMode = ctx.mode.blockMath || ctx.mode.codeMath

  const create = () => {
    const dom = document.createElement('div')
    dom.classList.add('cm-tooltip-cursor')
    dom.classList.add(above ? 'cm-tooltip-above' : 'cm-tooltip-below')

    let toRender = eqnWithDecorations
    if (ctx.mode.blockMath) {
      const blockQuoteCount = update.state.doc
        .lineAt(eqnBounds.inner_start)
        .text.match(/^ {0,3}(>+)/)?.[1]?.length
      if (blockQuoteCount) {
        const regex = new RegExp(`^ {0,3}>{${blockQuoteCount}}`, 'gm')
        if (regex.test(eqn)) {
          toRender = toRender.replaceAll(regex, '')
        }
      }
    }

    const rendered = renderKatexDom(toRender, displayMode)
    dom.appendChild(rendered)

    return { dom }
  }

  let newTooltips: Tooltip[] = []

  if (ctx.mode.blockMath || ctx.mode.codeMath) {
    newTooltips = [
      {
        pos: above ? eqnBounds.inner_start : eqnBounds.inner_end,
        above,
        strictSide: true,
        arrow: true,
        create
      }
    ]
  } else if (ctx.mode.inlineMath && above) {
    newTooltips = [
      {
        pos: eqnBounds.inner_start,
        above: true,
        strictSide: true,
        arrow: true,
        create
      }
    ]
  } else if (ctx.mode.inlineMath && !above) {
    const endRange = EditorSelection.range(eqnBounds.inner_end, eqnBounds.inner_end)
    newTooltips = [
      {
        pos: Math.max(
          eqnBounds.inner_start,
          update.view.moveToLineBoundary(endRange, false).anchor
        ),
        above: false,
        strictSide: true,
        arrow: true,
        create
      }
    ]
  }

  update.view.dispatch({
    effects: [
      updateTooltipEffect.of(
        newTooltips.map(t => ({
          equation: eqnWithDecorations,
          bounds: eqnBounds,
          pos: t.pos,
          tooltip: t
        }))
      )
    ]
  })
}

function shouldShowTooltip (state: EditorState, ctx: Context): Bounds | null {
  if (!ctx.mode.inMath()) return null
  if (ctx.mode.blockMath) return null

  const eqnBounds = ctx.getInnerBounds()
  if (!eqnBounds) return null

  const eqn = state.sliceDoc(eqnBounds.inner_start, eqnBounds.inner_end).trim()
  if (eqn === '') return null

  return eqnBounds
}

export const cursorTooltipBaseTheme = EditorView.baseTheme({
  '.cm-tooltip.cm-tooltip-cursor': {
    backgroundColor: 'var(--surface, #fff)',
    color: 'var(--ink, #111)',
    border: '1px solid var(--border, #ccc)',
    padding: '4px 6px',
    borderRadius: '6px',
    maxWidth: 'min(96vw, 28rem)',
    overflowX: 'auto',
    '& .cm-tooltip-arrow:before': {
      borderTopColor: 'var(--border, #ccc)',
      borderBottomColor: 'var(--border, #ccc)'
    },
    '& .cm-tooltip-arrow:after': {
      borderTopColor: 'var(--surface, #fff)',
      borderBottomColor: 'var(--surface, #fff)'
    },
    '& p': { margin: '0' },
    '& .katex': { fontSize: '1em' }
  }
})

export const neineiMathTooltips = tooltips({ position: 'fixed' })
