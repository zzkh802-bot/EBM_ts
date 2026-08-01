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
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
})
