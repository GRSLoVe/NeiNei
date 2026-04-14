/**
 * Permite `vite build` (o `npx vite build`) desde la raíz del repo sin
 * `cd editor`: la config real vive en `editor/vite.config.ts` y fija `root`
 * con `import.meta.url` de ese archivo.
 */
export { default } from './editor/vite.config'
