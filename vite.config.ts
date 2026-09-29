import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
// @ts-ignore —— 后端 API 以中间件形式挂到 dev/preview 服务器，保证 `npm run dev` 一次起全
import apiApp from './server/app.js'

function apiPlugin(): Plugin {
  return {
    name: 'api-middleware',
    configureServer(server) {
      server.middlewares.use(apiApp)
    },
    configurePreviewServer(server) {
      server.middlewares.use(apiApp)
    },
  }
}

// 演示模式（--mode demo）：把 @/lib/api 替换为浏览器内存版，构建纯静态站点（GitHub Pages 用）
const alias = (mode: string) => [
  {
    find: /^@\/lib\/api$/,
    replacement: mode === 'demo'
      ? path.resolve(__dirname, './src/lib/api.demo.ts')
      : path.resolve(__dirname, './src/lib/api.ts'),
  },
  { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, './src') + '/$1' },
]

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [inspectAttr(), apiPlugin(), react()],
  server: {
    port: 7100,
    host: true,
    strictPort: true,
  },
  preview: {
    port: 7100,
    host: true,
    strictPort: true,
  },
  resolve: {
    alias: alias(mode),
  },
}));
