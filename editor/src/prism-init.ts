/**
 * Equivalente a marktext/src/muya/lib/prism/index.js (aprox. líneas 40–42):
 * precarga `latex` para bloques de fórmulas / resaltado tipo MarkText, `yaml` para front matter u otros.
 */
import Prism from 'prismjs'
import 'prismjs/components/prism-latex.js'
import 'prismjs/components/prism-yaml.js'

declare global {
  interface Window {
    Prism?: typeof Prism
  }
}

globalThis.Prism = Prism
if (typeof window !== 'undefined') window.Prism = Prism

export { Prism }
