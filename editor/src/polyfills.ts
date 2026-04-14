/**
 * obsidian-latex-suite usa .contains() en strings y arrays (API no estándar / Obsidian).
 */
declare global {
  interface String {
    contains(s: string): boolean
  }
  interface Array<T> {
    contains(x: T): boolean
  }
}

if (!String.prototype.contains) {
  (String.prototype as unknown as { contains: typeof String.prototype.includes }).contains =
    String.prototype.includes
}

if (!Array.prototype.contains) {
  (Array.prototype as unknown as { contains: <T>(this: T[], x: T) => boolean }).contains =
    function <T>(this: T[], x: T) {
      return this.indexOf(x) !== -1
    }
}

export {}
