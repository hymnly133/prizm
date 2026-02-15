import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5183,
    fs: {
      allow: ['..']
    }
  },
  resolve: {
    alias: {
      '@prizm/client-core': resolve(__dirname, '../prizm-client-core/src')
    }
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        notification: resolve(__dirname, 'notification.html'),
        quickpanel: resolve(__dirname, 'quickpanel.html')
      }
    }
  }
})
