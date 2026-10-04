import Database from 'better-sqlite3'
import {app} from 'electron'
import {join} from 'node:path'
import {mkdirSync, readdirSync, rmSync} from 'node:fs'
import type {Settings} from '../shared/types'

export let db: Database.Database
export const dbPath = (): string => join(app.getPath('userData'), 'cafe.db')
export const backupDir = (): string => join(app.getPath('userData'), 'backups')

// Prepared statements are compiled once and reused. The set of SQL strings is fixed by the code
// (a handful of them differ only by a constant WHERE clause), so this cache cannot grow without bound.
const stmts = new Map<string, Database.Statement>()
const stmt = (sql: string): Database.Statement => {
    let s = stmts.get(sql)
    if (!s) {
        s = db.prepare(sql);
        stmts.set(sql, s)
    }
    return s
}
export const all = <T>(sql: string, ...p: unknown[]): T[] => stmt(sql).all(...p) as T[]
export const one = <T>(sql: string, ...p: unknown[]): T | undefined => stmt(sql).get(...p) as T | undefined
export const run = (sql: string, ...p: unknown[]) => stmt(sql).run(...p)
export const prepared = (sql: string): Database.Statement => stmt(sql)
export const tx = <T>(fn: () => T): T => db.transaction(fn)()

export const DEFAULTS: Settings = {
    cafeName: 'My Café',
    language: 'en', // 'en' | 'sq' | 'mk'
    layout: 'classic', // 'classic' (tables, then order) | 'split' (tables | order on one page)
    cardEnabled: '1',
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
    CREATE TABLE IF NOT EXISTS employees
    (
        id
        INTEGER
        PRIMARY
        KEY,
        name
        TEXT
        NOT
        NULL,
        pin_hash
        TEXT,
        is_admin
        INTEGER
        NOT
        NULL
        DEFAULT
        0,
        active
        INTEGER
        NOT
        NULL
        DEFAULT
        1
    );
    CREATE TABLE IF NOT EXISTS cafe_tables
    (
        id
        INTEGER
        PRIMARY
        KEY,
        name
        TEXT
        NOT
        NULL,
        sort
        INTEGER
        NOT
        NULL
        DEFAULT
        0,
        active
        INTEGER
        NOT
        NULL
        DEFAULT
        1
    );
    CREATE TABLE IF NOT EXISTS categories
    (
        id
        INTEGER
        PRIMARY
        KEY,
        name
        TEXT
        NOT
        NULL,
        sort
        INTEGER
        NOT
        NULL
        DEFAULT
        0,
        active
        INTEGER
        NOT
        NULL
        DEFAULT
        1
    );
    CREATE TABLE IF NOT EXISTS products
    (
        id
        INTEGER
        PRIMARY
        KEY,
        category_id
        INTEGER
        NOT
        NULL
        REFERENCES
        categories
    (
        id
    ),
        name TEXT NOT NULL, price_cents INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS orders
    (
        id
        INTEGER
        PRIMARY
        KEY,
        table_id
        INTEGER
        NOT
        NULL
        REFERENCES
        cafe_tables
    (
        id
    ), table_name TEXT NOT NULL,
        employee_id INTEGER, employee_name TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN', opened_at INTEGER NOT NULL, closed_at INTEGER,
        total_cents INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_per_table ON orders(table_id) WHERE status='OPEN';
    CREATE INDEX IF NOT EXISTS idx_orders_closed ON orders(status, closed_at);
    CREATE TABLE IF NOT EXISTS order_items
    (
        id
        INTEGER
        PRIMARY
        KEY,
        order_id
        INTEGER
        NOT
        NULL
        REFERENCES
        orders
    (
        id
    ) ON DELETE CASCADE,
        product_id INTEGER, name TEXT NOT NULL, price_cents INTEGER NOT NULL,
        qty INTEGER NOT NULL, printed_qty INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
    CREATE TABLE IF NOT EXISTS payments
    (
        id
        INTEGER
        PRIMARY
        KEY,
        order_id
        INTEGER
        NOT
        NULL
        REFERENCES
        orders
    (
        id
    ),
        method TEXT NOT NULL, amount_cents INTEGER NOT NULL, paid_at INTEGER NOT NULL,
        employee_id INTEGER, employee_name TEXT);
    CREATE TABLE IF NOT EXISTS voids
    (
        id
        INTEGER
        PRIMARY
        KEY,
        order_id
        INTEGER
        NOT
        NULL,
        name
        TEXT
        NOT
        NULL,
        price_cents
        INTEGER
        NOT
        NULL,
        qty
        INTEGER
        NOT
        NULL,
        employee_id
        INTEGER,
        employee_name
        TEXT,
        at
        INTEGER
        NOT
        NULL
    );
    CREATE TABLE IF NOT EXISTS settings
    (
        key
        TEXT
        PRIMARY
        KEY,
        value
        TEXT
        NOT
        NULL
    );
`

// Settings change rarely and are read on every print and every app start: cached, cleared by saveSettings().
let settingsCache: Settings | null = null
export const invalidateSettings = (): void => {
    settingsCache = null
}

export function getSettings(): Settings {
    if (!settingsCache) {
        const s: Record<string, string> = {...DEFAULTS}
        for (const r of all<{ key: string; value: string }>('SELECT key, value FROM settings')) {
            if (Object.hasOwn(DEFAULTS, r.key)) s[r.key] = r.value
        }
        settingsCache = s as Settings
    }
    return {...settingsCache}
}

function seed(): void {
    if (one('SELECT 1 FROM settings WHERE key=?', 'seeded')) return
    tx(() => {
        run("INSERT INTO employees(name, is_admin) VALUES ('Demo Employee', 1)")
        for (let i = 1; i <= 10; i++) run('INSERT INTO cafe_tables(name, sort) VALUES (?, ?)', `Table ${i}`, i)
        const menu: Record<string, [string, number, number][]> = { // [name, sell price, buy price] in cents (demo values)
            Coffee: [['Espresso', 100, 30], ['Macchiato', 120, 35], ['Cappuccino', 150, 45]],
            Drinks: [['Coca-Cola', 150, 70], ['Fanta', 150, 70], ['Water', 100, 25]],
            Beer: [['Skopsko', 200, 100], ['Heineken', 250, 130]],
            Food: []
        }
        let sort = 0
        for (const [cat, products] of Object.entries(menu)) {
            const cid = Number(run('INSERT INTO categories(name, sort) VALUES (?, ?)', cat, sort++).lastInsertRowid)
            products.forEach(([name, cents, cost], i) =>
                run('INSERT INTO products(category_id, name, price_cents, cost_cents, sort) VALUES (?, ?, ?, ?, ?)', cid, name, cents, cost, i))
        }
        run("INSERT INTO settings(key, value) VALUES ('seeded', '1')")
    })
}

const SCHEMA_VERSION = 3

/** Safe to run on every start and on existing data: only adds what is missing, never changes or removes rows. */
function migrate(): void {
    const v = db.pragma('user_version', {simple: true}) as number
    if (v < 2) {
        // History/reports/payment lookups were doing a full scan of `payments` for every order (see audit).
        db.exec('CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id)')
    }
    if (v < 3) {
        // Buy price (per product, and copied onto every sold line so old profit never changes) and when a line was added.
        const has = (t: string, c: string): boolean => (db.prepare(`PRAGMA table_info(${t})`).all() as {
            name: string
        }[]).some((r) => r.name === c)
        db.transaction(() => {
            if (!has('products', 'cost_cents')) db.exec('ALTER TABLE products ADD COLUMN cost_cents INTEGER NOT NULL DEFAULT 0')
            if (!has('order_items', 'cost_cents')) db.exec('ALTER TABLE order_items ADD COLUMN cost_cents INTEGER NOT NULL DEFAULT 0')
            if (!has('order_items', 'added_at')) db.exec('ALTER TABLE order_items ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0')
        })()
    }
    if (v < SCHEMA_VERSION) db.pragma(`user_version = ${SCHEMA_VERSION}`)
}

export function openDb(): void {
    db = new Database(dbPath())
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = FULL')          // a tap that was acknowledged survives a power cut (reliability over benchmark speed)
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 3000')
    db.pragma('temp_store = MEMORY')         // report GROUP BY / ORDER BY temp tables stay in RAM, not on disk
    db.pragma('journal_size_limit = 8388608') // keep the WAL file from staying large after a checkpoint
    db.exec(SCHEMA)
    migrate()
    seed()
}

export const closeDb = (): void => {
    stmts.clear();
    db.close()
}

/** Clean shutdown: refresh planner statistics, fold the WAL into the main file, close. Never throws. */
export function shutdownDb(): void {
    try {
        if (!db?.open) return
        db.pragma('optimize')
        db.pragma('wal_checkpoint(TRUNCATE)')
        closeDb()
    } catch (e) {
        console.error('Database shutdown failed', e)
    }
}

/** Cheap background upkeep, run well after the first screen is usable. */
export function idleMaintenance(): void {
    try {
        if (db?.open) db.pragma('optimize')
    } catch (e) {
        console.error('optimize failed', e)
    }
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** With no argument: daily rolling backup into the app's data folder. With a path: backup to that exact file. */
export async function makeBackup(dest?: string): Promise<string> {
    mkdirSync(backupDir(), {recursive: true})
    if (dest) {
        await db.backup(dest)
        return dest
    }
    const d = new Date()
    const file = join(backupDir(), `cafe-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.db`)
    await db.backup(file)
    const old = readdirSync(backupDir()).filter((f) => /^cafe-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -30)
    for (const f of old) rmSync(join(backupDir(), f), {force: true})
    return file
}

export function scheduleBackups(): void {
    const go = (): void => {
        makeBackup().catch((e) => console.error('Auto-backup failed', e))
    }
    setTimeout(go, 60_000) // not during startup: the first screen must not compete for disk
    setInterval(go, 3 * 3600 * 1000)
}
