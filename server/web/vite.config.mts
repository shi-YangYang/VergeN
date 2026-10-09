import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  build: {
    outDir: '../internal/web/dist',
    emptyOutDir: true,
  },
  server: {
    port: 5273,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
