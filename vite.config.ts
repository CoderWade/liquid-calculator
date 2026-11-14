import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }

// GitHub Pages 项目站点部署在 /<repo>/ 下；仓库改名也能自动适配
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = process.env.GITHUB_ACTIONS && repo ? `/${repo}/` : '/'
const buildId = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version}-${buildId}`),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
})
