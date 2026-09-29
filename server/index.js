// 独立运行入口（生产模式）：node server/index.js → 静态站点 + API 同端口
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import apiApp from './app.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(apiApp)

const dist = path.resolve(__dirname, '../dist')
app.use(express.static(dist))
app.use((req, res) => res.sendFile(path.join(dist, 'index.html')))

const port = process.env.PORT || 7100
app.listen(port, () => console.log(`server listening on http://localhost:${port}`))
