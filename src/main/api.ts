import { BrowserWindow, app, dialog } from 'electron'
import type { OpenDialogOptions, SaveDialogOptions, MessageBoxOptions } from 'electron'
import { copyFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { all, one, run, tx, dbPath, closeDb, getSettings, DEFAULTS, makeBackup, backupDir } from './db'
import { orderRows, testRows, printRows } from './print'
import { adminUser, checkLock, clearFails, hashPin, int, me, recordFail, setSession, text, verifyPin } from './security'
import type {
  Category, Employee, HistoryRow, Order, OrderItem, Product, Report, Settings, SettingKey, TableRow, User
} from '../shared/types'

const now = (): number => Date.now()
const win = (): BrowserWindow | undefined => BrowserWindow.getAllWindows()[0]
const saveDlg = (o: SaveDialogOptions) => { const w = win(); return w ? dialog.showSaveDialog(w, o) : dialog.showSaveDialog(o) }
const openDlg = (o: OpenDialogOptions) => { const w = win(); return w ? dialog.showOpenDialog(w, o) : dialog.showOpenDialog(o) }
const msgDlg = (o: MessageBoxOptions) => { const w = win(); return w ? dialog.showMessageBox(w, o) : dialog.showMessageBox(o) }

const PRODUCT_COLS = 'id, category_id AS categoryId, name, price_cents AS priceCents, active'
const ORDER_COLS = `id, table_id AS tableId, table_name AS tableName, employee_id AS employeeId,
  employee_name AS employeeName, status, opened_at AS openedAt, closed_at AS closedAt, total_cents AS totalCents`

type ItemRow = { id: number; order_id: number; product_id: number | null; name: string; price_cents: number; qty: number; printed_qty: number }

function loadOrder(id: number): Order | null {
  const o = one<Omit<Order, 'items' | 'payment'>>(`SELECT ${ORDER_COLS} FROM orders WHERE id=?`, id)
  if (!o) return null
  const items = all<OrderItem>(
    'SELECT id, product_id AS productId, name, price_cents AS priceCents, qty, printed_qty AS printedQty FROM order_items WHERE order_id=? ORDER BY id', id)
  const payment = one<NonNullable<Order['payment']>>(
    'SELECT method, paid_at AS paidAt, employee_name AS employeeName FROM payments WHERE order_id=?', id) ?? null
  return { ...o, items, payment }
}

const touch = (orderId: number): void => {
  run('UPDATE orders SET total_cents=(SELECT COALESCE(SUM(qty*price_cents),0) FROM order_items WHERE order_id=?) WHERE id=?', orderId, orderId)
}
const empName = (id: number): string | null => one<{ name: string }>('SELECT name FROM employees WHERE id=?', id)?.name ?? null

function assertOpen(orderId: number): void {
  const o = one<{ status: string }>('SELECT status FROM orders WHERE id=?', orderId)
  if (!o) throw new Error('Order not found')
  if (o.status !== 'OPEN') throw new Error('This order is already closed and cannot be changed')
}

function logVoid(orderId: number, it: ItemRow, qty: number, employeeId: number): void {
  run('INSERT INTO voids(order_id, name, price_cents, qty, employee_id, employee_name, at) VALUES (?,?,?,?,?,?,?)',
    orderId, it.name, it.price_cents, qty, employeeId, empName(employeeId), now())
}

/** After items were removed: free the table when the order became empty. */
function settle(orderId: number): Order | null {
  touch(orderId)
  const left = one<{ n: number }>('SELECT COUNT(*) n FROM order_items WHERE order_id=?', orderId)!.n
  if (left > 0) return loadOrder(orderId)
  if (one('SELECT 1 FROM voids WHERE order_id=?', orderId)) run("UPDATE orders SET status='CANCELLED', closed_at=? WHERE id=?", now(), orderId)
  else run('DELETE FROM orders WHERE id=?', orderId)
  return null
}

function dropItem(it: ItemRow, employeeId: number): Order | null {
  if (it.printed_qty > 0) logVoid(it.order_id, it, it.printed_qty, employeeId)
  run('DELETE FROM order_items WHERE id=?', it.id)
  return settle(it.order_id)
}

const getItem = (id: number): ItemRow => {
  const it = one<ItemRow>('SELECT * FROM order_items WHERE id=?', id)
  if (!it) throw new Error('Item not found')
  assertOpen(it.order_id)
  return it
}

const start = (d: number): string => {
  const x = new Date(d)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()};${p(x.getHours())}:${p(x.getMinutes())}`
}

function queryOrders(from: number, to: number): HistoryRow[] {
  return all<HistoryRow>(
    `SELECT o.id, o.table_name AS tableName, o.employee_name AS employeeName, p.employee_name AS paidBy,
            o.closed_at AS closedAt, o.total_cents AS totalCents, p.method
     FROM orders o JOIN payments p ON p.order_id=o.id
     WHERE o.status='PAID' AND o.closed_at>=? AND o.closed_at<? ORDER BY o.closed_at DESC LIMIT 2000`, from, to)
}

function report(from: number, to: number): Report {
  const W = "o.status='PAID' AND o.closed_at>=? AND o.closed_at<?"
  const t = one<{ n: number; rev: number }>(`SELECT COUNT(*) n, COALESCE(SUM(o.total_cents),0) rev FROM orders o WHERE ${W}`, from, to)!
  const methods = all<{ method: string; c: number }>(
    `SELECT p.method, SUM(p.amount_cents) c FROM payments p JOIN orders o ON o.id=p.order_id WHERE ${W} GROUP BY p.method`, from, to)
  const itemsSold = one<{ q: number }>(
    `SELECT COALESCE(SUM(i.qty),0) q FROM order_items i JOIN orders o ON o.id=i.order_id WHERE ${W}`, from, to)!.q
  const top = all<Report['top'][number]>(
    `SELECT i.name, SUM(i.qty) qty, SUM(i.qty*i.price_cents) cents FROM order_items i JOIN orders o ON o.id=i.order_id
     WHERE ${W} GROUP BY i.name ORDER BY qty DESC, i.name LIMIT 30`, from, to)
  const employees = all<Report['employees'][number]>(
    `SELECT COALESCE(p.employee_name,'-') name, COUNT(*) orders, SUM(p.amount_cents) cents
     FROM payments p JOIN orders o ON o.id=p.order_id WHERE ${W} GROUP BY p.employee_name ORDER BY cents DESC`, from, to)
  const v = one<{ n: number; c: number }>(
    'SELECT COALESCE(SUM(qty),0) n, COALESCE(SUM(qty*price_cents),0) c FROM voids WHERE at>=? AND at<?', from, to)!
  const by = (m: string): number => methods.find((x) => x.method === m)?.c ?? 0
  return {
    orders: t.n, revenue: t.rev, cash: by('CASH'), card: by('CARD'), itemsSold,
    avg: t.n ? Math.round(t.rev / t.n) : 0, top, employees, voids: { count: v.n, cents: v.c }
  }
}

const startOfToday = (): number => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }

const PRINTER_TARGET = [
  /^\\\\[\w.-]+\\[\w .-]+$/,        // \\host\Share  (a shared printer, nothing deeper)
  /^COM\d{1,3}$/i,                      // serial
  /^[\w.-]+(:\d{1,5})?$/               // host or host:port
]

function cleanSetting(k: SettingKey, raw: unknown): string {
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (v.length > 200) throw new Error('Text is too long')
  switch (k) {
    case 'cafeName': if (!v) throw new Error('Café name is required'); return v
    case 'currency':
      if (!/^[A-Za-z]{3}$/.test(v)) throw new Error('Currency must be a 3-letter code, for example EUR')
      return v.toUpperCase()
    case 'printMode':
      if (!['windows', 'escpos', 'none'].includes(v)) throw new Error('Invalid printer type')
      return v
    case 'silentPrint': return v === '1' ? '1' : '0'
    case 'paperChars': return v === '32' ? '32' : '48'
    case 'escposTarget':
      if (v && !PRINTER_TARGET.some((re) => re.test(v))) throw new Error('Printer address looks wrong. Use an IP address, \\\\localhost\\ShareName or COM3.')
      return v
    default: return v
  }
}

const csvCell = (v: string | number): string => {
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s // stop Excel from running names as formulas
  return `"${s.replace(/"/g, '""')}"`
}

export const api = {
  // ---------- session ----------
  login(id: number, pin: string): User {
    int(id, 'employee')
    const given = typeof pin === 'string' ? pin : ''
    checkLock(id)
    const e = one<{ id: number; name: string; pin_hash: string | null; is_admin: number; active: number }>(
      'SELECT * FROM employees WHERE id=?', id)
    if (!e || !e.active) throw new Error('Employee not found')
    if (e.pin_hash) {
      const v = verifyPin(e.pin_hash, given)
      if (!v.ok) { recordFail(id); throw new Error('Wrong PIN') }
      if (v.legacy) run('UPDATE employees SET pin_hash=? WHERE id=?', hashPin(given), id)
    }
    clearFails(id)
    const user: User = { id: e.id, name: e.name, isAdmin: e.is_admin }
    setSession(user)
    return user
  },
  logout(): void { setSession(null) },

  // ---------- employees ----------
  listEmployees(includeInactive = false): Employee[] {
    if (includeInactive) adminUser()
    return all<Employee>(`SELECT id, name, is_admin AS isAdmin, active, (pin_hash IS NOT NULL) AS hasPin
                          FROM employees ${includeInactive ? '' : 'WHERE active=1'} ORDER BY name`)
  },

  /** pin: undefined = keep current, null = remove PIN, string = set new PIN */
  saveEmployee(e: { id?: number; name: string; pin?: string | null; isAdmin: boolean; active: boolean }): void {
    const name = text(e.name, 'Name')
    if (typeof e.pin === 'string' && e.pin && !/^\d{3,8}$/.test(e.pin)) throw new Error('PIN must be 3 to 8 digits')
    tx(() => {
      let id = e.id === undefined ? undefined : int(e.id, 'employee')
      if (id) run('UPDATE employees SET name=?, is_admin=?, active=? WHERE id=?', name, +!!e.isAdmin, +!!e.active, id)
      else id = Number(run('INSERT INTO employees(name, is_admin, active) VALUES (?,?,?)', name, +!!e.isAdmin, +!!e.active).lastInsertRowid)
      if (e.pin === null) run('UPDATE employees SET pin_hash=NULL WHERE id=?', id)
      else if (e.pin) run('UPDATE employees SET pin_hash=? WHERE id=?', hashPin(e.pin), id)
      if (one<{ n: number }>('SELECT COUNT(*) n FROM employees WHERE is_admin=1 AND active=1')!.n < 1)
        throw new Error('Keep at least one active admin')
    })
  },

  // ---------- tables ----------
  listTables: (): TableRow[] =>
    all<TableRow>(`SELECT t.id, t.name, o.id AS orderId, o.opened_at AS openedAt, o.total_cents AS totalCents, o.employee_name AS employeeName
                   FROM cafe_tables t LEFT JOIN orders o ON o.table_id=t.id AND o.status='OPEN'
                   WHERE t.active=1 ORDER BY t.sort, t.id`),

  saveTable(t: { id?: number; name: string }): void {
    const name = text(t.name, 'Table name', 40)
    if (t.id !== undefined) run('UPDATE cafe_tables SET name=? WHERE id=?', name, int(t.id, 'table'))
    else run('INSERT INTO cafe_tables(name, sort) VALUES (?, (SELECT COALESCE(MAX(sort),0)+1 FROM cafe_tables))', name)
  },

  moveTable(id: number, dir: -1 | 1): void {
    int(id, 'table'); int(dir, 'direction', -1, 1)
    tx(() => {
      const rows = all<{ id: number }>('SELECT id FROM cafe_tables WHERE active=1 ORDER BY sort, id')
      const i = rows.findIndex((r) => r.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= rows.length) return
      ;[rows[i], rows[j]] = [rows[j], rows[i]]
      rows.forEach((r, k) => run('UPDATE cafe_tables SET sort=? WHERE id=?', k, r.id))
    })
  },

  deleteTable(id: number): void {
    int(id, 'table')
    if (one("SELECT 1 FROM orders WHERE table_id=? AND status='OPEN'", id)) throw new Error('This table has an open order')
    run('UPDATE cafe_tables SET active=0 WHERE id=?', id)
  },

  // ---------- menu ----------
  listCategories: (includeInactive = false): Category[] =>
    all<Category>(`SELECT id, name, active FROM categories ${includeInactive ? '' : 'WHERE active=1'} ORDER BY sort, id`),

  saveCategory(c: { id?: number; name: string; active: boolean }): void {
    const name = text(c.name, 'Category name', 40)
    if (c.id !== undefined) run('UPDATE categories SET name=?, active=? WHERE id=?', name, +!!c.active, int(c.id, 'category'))
    else run('INSERT INTO categories(name, sort) VALUES (?, (SELECT COALESCE(MAX(sort),0)+1 FROM categories))', name)
  },

  listProducts: (includeInactive = false): Product[] =>
    all<Product>(`SELECT ${PRODUCT_COLS} FROM products ${includeInactive ? '' : 'WHERE active=1'} ORDER BY sort, name`),

  saveProduct(p: { id?: number; categoryId: number; name: string; priceCents: number; active: boolean }): void {
    const name = text(p.name, 'Product name', 60)
    const cents = int(p.priceCents, 'price (enter something like 1.50)', 0, 10_000_000)
    const cat = int(p.categoryId, 'category')
    if (!one('SELECT 1 FROM categories WHERE id=?', cat)) throw new Error('Category not found')
    if (p.id !== undefined) run('UPDATE products SET category_id=?, name=?, price_cents=?, active=? WHERE id=?', cat, name, cents, +!!p.active, int(p.id, 'product'))
    else run('INSERT INTO products(category_id, name, price_cents, active, sort) VALUES (?,?,?,?,(SELECT COALESCE(MAX(sort),0)+1 FROM products))', cat, name, cents, +!!p.active)
  },

  /** Top 10 products of the last 30 days (paid orders). Padded with other products while there is little history. */
  mostUsed(): Product[] {
    const since = now() - 30 * 864e5
    const top = all<Product>(
      `SELECT p.id, p.category_id AS categoryId, p.name, p.price_cents AS priceCents, p.active
       FROM products p JOIN order_items i ON i.product_id=p.id JOIN orders o ON o.id=i.order_id
       WHERE o.status='PAID' AND o.closed_at>=? AND p.active=1
       GROUP BY p.id ORDER BY SUM(i.qty) DESC, p.name LIMIT 10`, since)
    if (top.length >= 10) return top
    const ids = new Set(top.map((p) => p.id))
    const rest = all<Product>(`SELECT ${PRODUCT_COLS} FROM products WHERE active=1 ORDER BY sort, name`).filter((p) => !ids.has(p.id))
    return [...top, ...rest].slice(0, 10)
  },

  // ---------- orders (the acting employee always comes from the session) ----------
  getTableOrder(tableId: number): Order | null {
    const r = one<{ id: number }>("SELECT id FROM orders WHERE table_id=? AND status='OPEN'", int(tableId, 'table'))
    return r ? loadOrder(r.id) : null
  },

  getOrder(id: number): Order | null {
    const o = loadOrder(int(id, 'order'))
    if (o && !me().isAdmin && o.status !== 'OPEN' && (o.closedAt ?? 0) < startOfToday()) throw new Error('Only an admin can open older orders')
    return o
  },

  /** Adds one unit. Creates the order (table becomes occupied) on the first product. */
  addItem(tableId: number, productId: number): Order | null {
    const employeeId = me().id
    int(tableId, 'table'); int(productId, 'product')
    return tx(() => {
      let orderId = one<{ id: number }>("SELECT id FROM orders WHERE table_id=? AND status='OPEN'", tableId)?.id
      if (!orderId) {
        const t = one<{ name: string }>('SELECT name FROM cafe_tables WHERE id=? AND active=1', tableId)
        if (!t) throw new Error('Table not found')
        orderId = Number(run('INSERT INTO orders(table_id, table_name, employee_id, employee_name, opened_at) VALUES (?,?,?,?,?)',
          tableId, t.name, employeeId, empName(employeeId), now()).lastInsertRowid)
      }
      const p = one<{ id: number; name: string; price_cents: number }>('SELECT * FROM products WHERE id=? AND active=1', productId)
      if (!p) throw new Error('Product not available')
      const it = one<{ id: number }>('SELECT id FROM order_items WHERE order_id=? AND product_id=? AND price_cents=?', orderId, p.id, p.price_cents)
      if (it) run('UPDATE order_items SET qty=qty+1 WHERE id=?', it.id)
      else run('INSERT INTO order_items(order_id, product_id, name, price_cents, qty) VALUES (?,?,?,?,1)', orderId, p.id, p.name, p.price_cents)
      touch(orderId)
      return loadOrder(orderId)
    })
  },

  /** Changes quantity by +1 or -1. Reducing below what was already printed is recorded as a void. */
  changeQty(itemId: number, delta: 1 | -1): Order | null {
    const employeeId = me().id
    int(itemId, 'item'); int(delta, 'amount', -1, 1)
    if ((delta as number) === 0) throw new Error('Invalid amount')
    return tx(() => {
      const it = getItem(itemId)
      const nq = it.qty + delta
      if (nq <= 0) return dropItem(it, employeeId)
      if (nq < it.printed_qty) logVoid(it.order_id, it, it.printed_qty - nq, employeeId)
      run('UPDATE order_items SET qty=?, printed_qty=MIN(printed_qty, ?) WHERE id=?', nq, nq, itemId)
      touch(it.order_id)
      return loadOrder(it.order_id)
    })
  },

  removeItem(itemId: number): Order | null {
    const employeeId = me().id
    int(itemId, 'item')
    return tx(() => dropItem(getItem(itemId), employeeId))
  },

  /** Moves the order to another table. If that table already has an open order, both are merged. */
  moveOrder(orderId: number, toTableId: number): { tableName: string; merged: boolean } {
    int(orderId, 'order'); int(toTableId, 'table')
    return tx(() => {
      assertOpen(orderId)
      const to = one<{ id: number; name: string }>('SELECT id, name FROM cafe_tables WHERE id=? AND active=1', toTableId)
      if (!to) throw new Error('Table not found')
      const own = one<{ table_id: number }>('SELECT table_id FROM orders WHERE id=?', orderId)
      if (own?.table_id === toTableId) throw new Error('The order is already on this table')
      const other = one<{ id: number }>("SELECT id FROM orders WHERE table_id=? AND status='OPEN'", toTableId)
      if (!other) {
        run('UPDATE orders SET table_id=?, table_name=? WHERE id=?', to.id, to.name, orderId)
        return { tableName: to.name, merged: false }
      }
      for (const it of all<ItemRow>('SELECT * FROM order_items WHERE order_id=?', orderId)) {
        const same = one<{ id: number }>('SELECT id FROM order_items WHERE order_id=? AND product_id IS ? AND price_cents=?', other.id, it.product_id, it.price_cents)
        if (same) {
          run('UPDATE order_items SET qty=qty+?, printed_qty=printed_qty+? WHERE id=?', it.qty, it.printed_qty, same.id)
          run('DELETE FROM order_items WHERE id=?', it.id)
        } else run('UPDATE order_items SET order_id=? WHERE id=?', other.id, it.id)
      }
      run('UPDATE voids SET order_id=? WHERE order_id=?', other.id, orderId)
      run('DELETE FROM orders WHERE id=?', orderId)
      touch(other.id)
      return { tableName: to.name, merged: true }
    })
  },

  payOrder(orderId: number, method: 'CASH' | 'CARD'): Order {
    const employeeId = me().id
    int(orderId, 'order')
    if (method !== 'CASH' && method !== 'CARD') throw new Error('Choose cash or card')
    return tx(() => {
      assertOpen(orderId)
      if (!one('SELECT 1 FROM order_items WHERE order_id=?', orderId)) throw new Error('The order is empty')
      touch(orderId)
      const t = now()
      run("UPDATE orders SET status='PAID', closed_at=? WHERE id=?", t, orderId)
      const total = one<{ c: number }>('SELECT total_cents c FROM orders WHERE id=?', orderId)!.c
      run('INSERT INTO payments(order_id, method, amount_cents, paid_at, employee_id, employee_name) VALUES (?,?,?,?,?,?)',
        orderId, method, total, t, employeeId, empName(employeeId))
      return loadOrder(orderId)!
    })
  },

  // ---------- printing ----------
  async printOrder(orderId: number, kind: 'ticket' | 'receipt'): Promise<{ ok: boolean; error?: string }> {
    try {
      const o = loadOrder(int(orderId, 'order'))
      if (!o) return { ok: false, error: 'Order not found' }
      if (kind !== 'ticket' && kind !== 'receipt') return { ok: false, error: 'Invalid print type' }
      const s = getSettings()
      await printRows(orderRows(o, kind, s), s)
      if (kind === 'ticket' && o.status === 'OPEN') run('UPDATE order_items SET printed_qty=qty WHERE order_id=?', orderId)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },

  async testPrint(): Promise<{ ok: boolean; error?: string }> {
    try {
      const s = getSettings()
      await printRows(testRows(s), s)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },

  async listPrinters(): Promise<{ name: string; label: string }[]> {
    const w = win()
    if (!w) return []
    return (await w.webContents.getPrintersAsync()).map((p) => ({ name: p.name, label: p.displayName || p.name }))
  },

  // ---------- history & reports ----------
  /** Staff only see today's orders; admins can look at any period. */
  listOrders(from: number, to: number): HistoryRow[] {
    int(from, 'date', 0, 9e15); int(to, 'date', 0, 9e15)
    return queryOrders(me().isAdmin ? from : Math.max(from, startOfToday()), to)
  },
  report(from: number, to: number): Report { return report(int(from, 'date', 0, 9e15), int(to, 'date', 0, 9e15)) },

  async exportCsv(from: number, to: number): Promise<string | null> {
    int(from, 'date', 0, 9e15); int(to, 'date', 0, 9e15)
    const lines = [['Order', 'Date', 'Time', 'Table', 'Opened by', 'Paid by', 'Method', 'Total'].join(';')]
    for (const o of queryOrders(from, to).reverse()) {
      const [d, t] = start(o.closedAt).split(';')
      lines.push([o.id, d, t, o.tableName, o.employeeName ?? '', o.paidBy ?? '', o.method, (o.totalCents / 100).toFixed(2)].map(csvCell).join(';'))
    }
    const r = await saveDlg({ title: 'Export CSV', defaultPath: 'cafe-orders.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, '\ufeff' + lines.join('\r\n'))
    return r.filePath
  },

  // ---------- settings & backup ----------
  getSettings,
  saveSettings(p: Partial<Settings>): void {
    const clean: [string, string][] = []
    for (const [k, v] of Object.entries(p ?? {})) {
      if (Object.hasOwn(DEFAULTS, k)) clean.push([k, cleanSetting(k as SettingKey, v)])
    }
    tx(() => {
      for (const [k, v] of clean) run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v)
    })
  },

  async backupNow(): Promise<string | null> {
    const d = new Date().toISOString().slice(0, 10)
    const r = await saveDlg({ title: 'Save backup', defaultPath: `cafe-backup-${d}.db`, filters: [{ name: 'Database', extensions: ['db'] }] })
    if (r.canceled || !r.filePath) return null
    return makeBackup(r.filePath)
  },

  async restoreBackup(): Promise<boolean> {
    const r = await openDlg({ title: 'Choose a backup file', properties: ['openFile'], filters: [{ name: 'Database', extensions: ['db'] }] })
    if (r.canceled || !r.filePaths[0]) return false
    const file = r.filePaths[0]
    try {
      // Only accept a file that looks exactly like our own database: intact, expected tables, no triggers or views.
      const t = new Database(file, { readonly: true, fileMustExist: true })
      const ok = t.pragma('integrity_check', { simple: true }) === 'ok'
      const tables = t.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name IN ('employees','cafe_tables','categories','products','orders','order_items','payments','voids','settings')").get() as { c: number }
      const extras = t.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type IN ('trigger','view')").get() as { c: number }
      t.close()
      if (!ok || tables.c !== 9 || extras.c !== 0) throw new Error('invalid')
    } catch {
      throw new Error('This file is not a valid Café Manager backup')
    }
    const c = await msgDlg({
      type: 'warning', buttons: ['Cancel', 'Replace all data'], defaultId: 0, cancelId: 0,
      message: 'Replace ALL current data with this backup?', detail: 'A safety copy of the current data is saved first.'
    })
    if (c.response !== 1) return false
    await makeBackup(join(backupDir(), `before-restore-${Date.now()}.db`))
    closeDb()
    copyFileSync(file, dbPath())
    rmSync(dbPath() + '-wal', { force: true })
    rmSync(dbPath() + '-shm', { force: true })
    app.relaunch()
    app.exit(0)
    return true
  }
}
