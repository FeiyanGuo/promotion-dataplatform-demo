import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../data')

export function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf-8'))
}

export function saveJson(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 1), 'utf-8')
}

export function loadData() {
  return {
    promotions: loadJson('promotions.json'),
    roster: loadJson('roster.json'),
    users: loadJson('users.json'),
  }
}

export function logAudit(entry) {
  const audit = loadJson('audit.json')
  audit.unshift({ time: new Date().toISOString(), ...entry })
  saveJson('audit.json', audit.slice(0, 2000))
}
