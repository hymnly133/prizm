import { defineConfig } from 'vite'

export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173
  },
  build: {
    target: 'esnext',
    outDir: 'dist'
  }
})
