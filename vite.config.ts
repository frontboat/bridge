import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'

// To generate local certificates with mkcert, run in your terminal:
// npx vite-plugin-mkcert

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mkcert()],
})
