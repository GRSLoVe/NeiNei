import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/** Carpeta `editor/` donde vive este config (no depender solo de `process.cwd()`). */
const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root,
  resolve: {
    alias: [
      { find: /^src\/(.+)/, replacement: `${root}/src-latex/$1` },
      { find: 'obsidian', replacement: path.join(root, 'src/shims/obsidian.ts') }
    ]
  },
  build: {
    lib: {
      entry: path.join(root, 'src/main.ts'),
      name: 'NeiNeiEditor',
      formats: ['es'],
      fileName: () => 'neinei-cm-editor.js'
    },
    outDir: path.join(root, '../public/js'),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
})
