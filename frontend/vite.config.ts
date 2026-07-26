import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/ts-api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        timeout: 900_000,
        proxyTimeout: 900_000,
        rewrite: (path) => path.replace(/^\/ts-api/, ''),
      },
      '/ebm': { target: 'http://127.0.0.1:8000', changeOrigin: true, timeout: 900_000, proxyTimeout: 900_000 },
      '/archive': { target: 'http://127.0.0.1:8000', changeOrigin: true, timeout: 900_000, proxyTimeout: 900_000 },
      '^/literature/(search)': { target: 'http://127.0.0.1:8000', changeOrigin: true, timeout: 900_000, proxyTimeout: 900_000 },
      '/health': { target: 'http://127.0.0.1:8000', changeOrigin: true, timeout: 900_000, proxyTimeout: 900_000 },
      '^/evidence/(schema|normalize|panel|agent|mcp|extract|benchmark)': { target: 'http://127.0.0.1:8000', changeOrigin: true, timeout: 900_000, proxyTimeout: 900_000 },
      '/grade': { target: 'http://127.0.0.1:8000', changeOrigin: true, timeout: 900_000, proxyTimeout: 900_000 },
      '/qa': { target: 'http://127.0.0.1:8000', changeOrigin: true, timeout: 900_000, proxyTimeout: 900_000 },
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
})
