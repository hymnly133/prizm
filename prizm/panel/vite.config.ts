import path from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/dashboard/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  plugins: [vue(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'index.html'
    }
  },
  server: {
    port: 5174,
    proxy: {
      '/notes': { target: 'http://127.0.0.1:4127' },
      '/smtc': { target: 'http://127.0.0.1:4127' },
      '/notify': { target: 'http://127.0.0.1:4127' },
      '/health': { target: 'http://127.0.0.1:4127' },
      '/auth': { target: 'http://127.0.0.1:4127' }
    }
  }
})
