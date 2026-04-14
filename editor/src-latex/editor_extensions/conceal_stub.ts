/** Tipos mínimos para conceal_fns (sin el plugin conceal de Obsidian). */

export type Replacement = {
  start: number
  end: number
  text: string
  class?: string
  elementType?: string
}

export type ConcealSpec = Replacement[]

export function mkConcealSpec (...replacements: Replacement[]) {
  return replacements
}
