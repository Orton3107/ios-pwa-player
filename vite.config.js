import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // base path для GitHub Pages: /<repo-name>/
  base: '/ios-pwa-player/',
  plugins: [react()],
})