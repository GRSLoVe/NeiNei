/** Sustitutos mínimos para código portado desde el plugin de Obsidian. */

export const Platform = {
  isMacOS:
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPod|iPad/i.test(navigator.platform || navigator.userAgent || ''),
  isMobile:
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
}

export class Notice {
  constructor (message: unknown, _timeout?: number) {
    console.warn('[NeiNei latex-suite]', message)
  }

  hide () {}
}
