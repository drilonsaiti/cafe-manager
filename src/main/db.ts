import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import type { Settings } from '../shared/types'

export let db: Database.Database
export const dbPath = (): string => join(app.getPath('userData'), 'cafe.db')
export const backupDir = (): string => join(app.getPath('userData'), 'backups')

export const all = <T>(sql: string, ...p: unknown[]): T[] => db.prepare(sql).all(...p) as T[]
export const one = <T>(sql: string, ...p: unknown[]): T | undefined => db.prepare(sql).get(...p) as T | undefined
export const run = (sql: string, ...p: unknown[]) => db.prepare(sql).run(...p)
export const tx = <T>(fn: () => T): T => db.transaction(fn)()

export const DEFAULTS: Settings = {
  cafeName: 'My Café',
  address: '',
  currency: 'EUR',
  footer: 'Thank you!',
  printMode: 'windows', // 'windows' | 'escpos' | 'none'
  printerName: '',
  silentPrint: '0',
  escposTarget: '',
  paperChars: '48'
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS employees(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, pin_hash TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS cafe_tables(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS categories(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL, price_cents INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, table_id INTEGER NOT NULL REFERENCES cafe_tables(id), table_name TEXT NOT NULL,
  employee_id INTEGER, employee_name TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN', opened_at INTEGER NOT NULL, closed_at INTEGER,
  total_cents INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_per_table ON orders(table_id) WHERE status='OPEN';
CREATE INDEX IF NOT EXISTS idx_orders_closed ON orders(status, closed_at);
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER, name TEXT NOT NULL, price_cents INTEGER NOT NULL,
  qty INTEGER NOT NULL, printed_qty INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
  method TEXT NOT NULL, amount_cents INTEGER NOT NULL, paid_at INTEGER NOT NULL,
  employee_id INTEGER, employee_name TEXT);
CREATE TABLE IF NOT EXISTS voids(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, name TEXT NOT NULL, price_cents INTEGER NOT NULL,
  qty INTEGER NOT NULL, employee_id INTEGER, employee_name TEXT, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

export function getSettings(): Settings {
  const s: Record<string, string> = { ...DEFAULTS }
  for (const r of all<{ key: string; value: string }>('SELECT key, value FROM settings')) {
    if (Object.hasOwn(DEFAULTS, r.key)) s[r.key] = r.value
  }
  return s as Settings
}

function seed(): void {
  if (one('SELECT 1 FROM settings WHERE key=?', 'seeded')) return
  tx(() => {
    run("INSERT INTO employees(name, is_admin) VALUES ('Demo Employee', 1)")
    for (let i = 1; i <= 10; i++) run('INSERT INTO cafe_tables(name, sort) VALUES (?, ?)', `Table ${i}`, i)
    const menu: Record<string, [string, number][]> = {
      Coffee: [['Espresso', 100], ['Macchiato', 120], ['Cappuccino', 150]],
      Drinks: [['Coca-Cola', 150], ['Fanta', 150], ['Water', 100]],
      Beer: [['Skopsko', 200], ['Heineken', 250]],
      Food: []
    }
    let sort = 0
    for (const [cat, products] of Object.entries(menu)) {
      const cid = Number(run('INSERT INTO categories(name, sort) VALUES (?, ?)', cat, sort++).lastInsertRowid)
      products.forEach(([name, cents], i) =>
        run('INSERT INTO products(category_id, name, price_cents, sort) VALUES (?, ?, ?, ?)', cid, name, cents, i))
    }
    run("INSERT INTO settings(key, value) VALUES ('seeded', '1')")
  })
}

export function openDb(): void {
  db = new Database(dbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  seed()
}

export const closeDb = (): void => { db.close() }

const pad = (n: number): string => String(n).padStart(2, '0')

/** With no argument: daily rolling backup into the app's data folder. With a path: backup to that exact file. */
export async function makeBackup(dest?: string): Promise<string> {
  mkdirSync(backupDir(), { recursive: true })
  if (dest) {
    await db.backup(dest)
    return dest
  }
  const d = new Date()
  const file = join(backupDir(), `cafe-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.db`)
  await db.backup(file)
  const old = readdirSync(backupDir()).filter((f) => /^cafe-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -30)
  for (const f of old) rmSync(join(backupDir(), f), { force: true })
  return file
}

export function scheduleBackups(): void {
  const go = (): void => { makeBackup().catch((e) => console.error('Auto-backup failed', e)) }
  setTimeout(go, 5000)
  setInterval(go, 3 * 3600 * 1000)
}
