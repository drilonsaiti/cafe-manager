import type {MessageBoxOptions, OpenDialogOptions, SaveDialogOptions} from 'electron'
import {app, BrowserWindow, dialog} from 'electron'
import {closeSync, copyFileSync, openSync, rmSync, writeSync} from 'node:fs'
import {join} from 'node:path'
import Database from 'better-sqlite3'
import {
    all,
    backupDir,
    closeDb,
    dbPath,
    DEFAULTS,
    getSettings,
    invalidateSettings,
    makeBackup,
    one,
    prepared,
    run,
    tx
} from './db'
import type {PreviewData} from './print'
import {orderRows, printRows, receiptWidth, sampleOrder, testRows} from './print'
import {adminUser, checkLock, clearFails, hashPin, int, me, recordFail, setSession, text, verifyPin} from './security'
import type {
    AdminProduct,
    BootData,
    Category,
    Employee,
    HistoryPage,
    HistoryRow,
    LoginResult,
    MoveResult,
    Order,
    OrderItem,
    Product,
    Report,
    SettingKey,
    Settings,
    TableRow,
    User,
    Workspace
} from '../shared/types'
import {VOID_GRACE_MS} from '../shared/types'

const now = (): number => Date.now()
const win = (): BrowserWindow | undefined => BrowserWindow.getAllWindows()[0]
const saveDlg = (o: SaveDialogOptions) => {
    const w = win();
    return w ? dialog.showSaveDialog(w, o) : dialog.showSaveDialog(o)
}
const openDlg = (o: OpenDialogOptions) => {
    const w = win();
    return w ? dialog.showOpenDialog(w, o) : dialog.showOpenDialog(o)
}
const msgDlg = (o: MessageBoxOptions) => {
    const w = win();
    return w ? dialog.showMessageBox(w, o) : dialog.showMessageBox(o)
}

const PRODUCT_COLS = 'id, category_id AS categoryId, name, price_cents AS priceCents, active'
const ADMIN_PRODUCT_COLS = `${PRODUCT_COLS}, cost_cents AS costCents`
const ORDER_COLS = `o.id, o.table_id AS tableId, o.table_name AS tableName, o.employee_id AS employeeId,
  o.employee_name AS employeeName, o.status, o.opened_at AS openedAt, o.closed_at AS closedAt, o.total_cents AS totalCents`

type ItemRow = {
    id: number;
    order_id: number;
    product_id: number | null;
    name: string;
    price_cents: number;
    cost_cents: number;
    qty: number;
    added_at: number
}
/** A line that has been on the order for a while counts as served: taking it away is recorded as a void. */
const settled = (it: { added_at: number }): boolean => now() - it.added_at > VOID_GRACE_MS
type OrderHead = Omit<Order, 'items' | 'payment'> & {
    pMethod: 'CASH' | 'CARD' | null;
    pAt: number | null;
    pBy: string | null
}

// ---------- small caches ----------
// Only presentation data is cached (menu list, top-10). Prices and totals are ALWAYS read from the database
// when an item is added or an order is paid, so a stale cache can never produce a wrong order or payment.
// Every writer of this data calls bumpMenu()/resets topCache, there is no time-based guessing except the daily
// roll-over of the "last 30 days" window.
let menuVersion = 1
let menuCache: { version: number; categories: Category[]; products: Product[] } | null = null
let topCache: { day: string; products: Product[] } | null = null
const bumpMenu = (): void => {
    menuVersion++;
    menuCache = null;
    topCache = null
}

function activeMenu(): { version: number; categories: Category[]; products: Product[] } {
    if (!menuCache) {
        menuCache = {
            version: menuVersion,
            categories: all<Category>('SELECT id, name, active FROM categories WHERE active=1 ORDER BY sort, id'),
            products: all<Product>(`SELECT ${PRODUCT_COLS}
                                    FROM products
                                    WHERE active = 1
                                    ORDER BY sort, name`)
        }
    }
    return menuCache
}

/** Top 10 products of the last 30 days (paid orders), padded from the menu while there is little history. */
function topProducts(): Product[] {
    const day = new Date().toDateString()
    if (topCache && topCache.day === day) return topCache.products
    const top = all<Product>(
        `SELECT p.id, p.category_id AS categoryId, p.name, p.price_cents AS priceCents, p.active
         FROM products p
                  JOIN order_items i ON i.product_id = p.id
                  JOIN orders o ON o.id = i.order_id
         WHERE o.status = 'PAID'
           AND o.closed_at >= ?
           AND p.active = 1
         GROUP BY p.id
         ORDER BY SUM(i.qty) DESC, p.name LIMIT 10`, now() - 30 * 864e5)
    let products = top
    if (top.length < 10) {
        const ids = new Set(top.map((p) => p.id))
        products = [...top, ...activeMenu().products.filter((p) => !ids.has(p.id))].slice(0, 10)
    }
    topCache = {day, products}
    return products
}

const listTables = (): TableRow[] =>
    all<TableRow>(`SELECT t.id,
                          t.name,
                          o.id            AS orderId,
                          o.opened_at     AS openedAt,
                          o.total_cents   AS totalCents,
                          o.employee_name AS employeeName
                   FROM cafe_tables t
                            LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'OPEN'
                   WHERE t.active = 1
                   ORDER BY t.sort, t.id`)

const activeEmployees = (): Employee[] =>
    all<Employee>('SELECT id, name, is_admin AS isAdmin, active, (pin_hash IS NOT NULL) AS hasPin FROM employees WHERE active=1 ORDER BY name')

// ---------- orders ----------
/** Two statements: order header (+ payment, if any) and its lines. */
function loadOrder(id: number): Order | null {
    const h = one<OrderHead>(
        `SELECT ${ORDER_COLS}, p.method AS pMethod, p.paid_at AS pAt, p.employee_name AS pBy
         FROM orders o
                  LEFT JOIN payments p ON p.order_id = o.id
         WHERE o.id = ?`, id)
    if (!h) return null
    const items = all<OrderItem>(
        'SELECT id, product_id AS productId, name, price_cents AS priceCents, qty, added_at AS addedAt FROM order_items WHERE order_id=? ORDER BY id', id)
    const {pMethod, pAt, pBy, ...o} = h
    return {...o, items, payment: pMethod && pAt !== null ? {method: pMethod, paidAt: pAt, employeeName: pBy} : null}
}

const touch = (orderId: number): void => {
    run('UPDATE orders SET total_cents=(SELECT COALESCE(SUM(qty*price_cents),0) FROM order_items WHERE order_id=?) WHERE id=?', orderId, orderId)
}
const empName = (id: number): string | null => one<{
    name: string
}>('SELECT name FROM employees WHERE id=?', id)?.name ?? null

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
    if (one('SELECT 1 FROM order_items WHERE order_id=? LIMIT 1', orderId)) return loadOrder(orderId)
    if (one('SELECT 1 FROM voids WHERE order_id=? LIMIT 1', orderId)) run("UPDATE orders SET status='CANCELLED', closed_at=? WHERE id=?", now(), orderId)
    else run('DELETE FROM orders WHERE id=?', orderId)
    return null
}

function dropItem(it: ItemRow, employeeId: number): Order | null {
    if (settled(it)) logVoid(it.order_id, it, it.qty, employeeId)
    run('DELETE FROM order_items WHERE id=?', it.id)
    return settle(it.order_id)
}

/** The line and its order's status in one statement. */
const getItem = (id: number): ItemRow => {
    const it = one<ItemRow & { status: string }>(
        `SELECT i.id,
                i.order_id,
                i.product_id,
                i.name,
                i.price_cents,
                i.cost_cents,
                i.qty,
                i.added_at,
                o.status
         FROM order_items i
                  JOIN orders o ON o.id = i.order_id
         WHERE i.id = ?`, id)
    if (!it) throw new Error('Item not found')
    if (it.status !== 'OPEN') throw new Error('This order is already closed and cannot be changed')
    return it
}

const start = (d: number): string => {
    const x = new Date(d)
    const p = (n: number): string => String(n).padStart(2, '0')
    return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()};${p(x.getHours())}:${p(x.getMinutes())}`
}

const HISTORY_COLS = `o.id, o.table_name AS tableName, o.employee_name AS employeeName, p.employee_name AS paidBy,
  o.opened_at AS openedAt, o.closed_at AS closedAt, o.total_cents AS totalCents, p.method`
const PROFIT_COL = `o.total_cents - (SELECT COALESCE(SUM(i.qty*i.cost_cents),0) FROM order_items i WHERE i.order_id=o.id)`
const historySql = (admin: boolean): string =>
    `SELECT ${HISTORY_COLS}, ${admin ? PROFIT_COL : 'NULL'} AS profitCents
     FROM orders o
              JOIN payments p ON p.order_id = o.id
     WHERE o.status = 'PAID'
       AND o.closed_at >= ?
       AND o.closed_at < ?
     ORDER BY o.closed_at DESC LIMIT ?`
const HISTORY_PAGE = 300 // rows sent to the screen; the full period is still available through CSV export

function queryOrders(from: number, to: number, admin: boolean, limit = HISTORY_PAGE): HistoryRow[] {
    return all<HistoryRow>(historySql(admin), from, to, limit)
}

const countOrders = (from: number, to: number): number =>
    one<{
        n: number
    }>("SELECT COUNT(*) n FROM orders WHERE status='PAID' AND closed_at>=? AND closed_at<?", from, to)!.n

/** Aggregate statements inside one read transaction, so every number describes the same moment. */
function report(from: number, to: number): Report {
    return tx(() => {
        const W = "o.status='PAID' AND o.closed_at>=? AND o.closed_at<?"
        const pay = all<{ name: string; method: string; n: number; c: number }>(
            `SELECT COALESCE(p.employee_name, '-') name, p.method, COUNT(*) n, SUM(p.amount_cents) c
             FROM orders o
                      JOIN payments p ON p.order_id = o.id
             WHERE ${W}
             GROUP BY 1, 2`, from, to)
        const sold = all<{ name: string; qty: number; cents: number; cost: number; nocost: number }>(
            `SELECT i.name,
                    SUM(i.qty)                                            qty,
                    SUM(i.qty * i.price_cents)                            cents,
                    SUM(i.qty * i.cost_cents)                             cost,
                    SUM(CASE WHEN i.cost_cents = 0 THEN i.qty ELSE 0 END) nocost
             FROM order_items i
                      JOIN orders o ON o.id = i.order_id
             WHERE ${W}
             GROUP BY i.name
             ORDER BY qty DESC, i.name`, from, to)
        const dur = one<{ d: number }>(`SELECT COALESCE(AVG(o.closed_at - o.opened_at), 0) d
                                        FROM orders o
                                        WHERE ${W}`, from, to)!.d
        const v = one<{ n: number; c: number }>(
            'SELECT COALESCE(SUM(qty),0) n, COALESCE(SUM(qty*price_cents),0) c FROM voids WHERE at>=? AND at<?', from, to)!
        // The SQL already grouped everything; these loops only combine a handful of rows.
        let orders = 0, revenue = 0, cash = 0, card = 0
        const byEmp = new Map<string, { orders: number; cents: number }>()
        for (const r of pay) {
            orders += r.n;
            revenue += r.c
            if (r.method === 'CASH') cash += r.c; else card += r.c
            const e = byEmp.get(r.name) ?? {orders: 0, cents: 0}
            e.orders += r.n;
            e.cents += r.c;
            byEmp.set(r.name, e)
        }
        const cost = sold.reduce((a, r) => a + r.cost, 0)
        return {
            orders, revenue, cost, profit: revenue - cost, cash, card,
            itemsSold: sold.reduce((a, r) => a + r.qty, 0), avg: orders ? Math.round(revenue / orders) : 0,
            avgDurationMs: Math.round(dur), uncosted: sold.reduce((a, r) => a + r.nocost, 0),
            top: sold.slice(0, 100).map((r) => ({name: r.name, qty: r.qty, cents: r.cents, profit: r.cents - r.cost})),
            employees: [...byEmp].map(([name, e]) => ({name, ...e})).sort((a, b) => b.cents - a.cents),
            voids: {count: v.n, cents: v.c}
        }
    })
}

/** Staff may only look at today's orders; admins at any period. */
function visibleOrder(id: number): Order | null {
    const o = loadOrder(int(id, 'order'))
    if (o && !me().isAdmin && o.status !== 'OPEN' && (o.closedAt ?? 0) < startOfToday()) throw new Error('Only an admin can open older orders')
    return o
}

const startOfToday = (): number => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

const PRINTER_TARGET = [
    /^\\\\[\w.-]+\\[\w .-]+$/,        // \\host\Share  (a shared printer, nothing deeper)
    /^COM\d{1,3}$/i,                      // serial
    /^[\w.-]+(:\d{1,5})?$/               // host or host:port
]

function cleanSetting(k: SettingKey, raw: unknown): string {
    const v = typeof raw === 'string' ? raw.trim() : ''
    if (v.length > 200) throw new Error('Text is too long')
    switch (k) {
        case 'cafeName':
            if (!v) throw new Error('Café name is required');
            return v
        case 'currency':
            if (!/^[A-Za-z]{3}$/.test(v)) throw new Error('Currency must be a 3-letter code, for example EUR')
            return v.toUpperCase()
        case 'printMode':
            if (!['windows', 'escpos', 'none'].includes(v)) throw new Error('Invalid printer type')
            return v
        case 'silentPrint':
            return v === '1' ? '1' : '0'
        case 'cardEnabled':
            return v === '1' ? '1' : '0'
        case 'language':
            if (!['en', 'sq', 'mk'].includes(v)) throw new Error('Invalid language')
            return v
        case 'layout':
            return v === 'split' ? 'split' : 'classic'
        case 'paperChars':
            return v === '32' ? '32' : '48'
        case 'escposTarget':
            if (v && !PRINTER_TARGET.some((re) => re.test(v))) throw new Error('Printer address looks wrong. Use an IP address, \\\\localhost\\ShareName or COM3.')
            return v
        default:
            return v
    }
}

const csvCell = (v: string | number): string => {
    let s = String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s // stop Excel from running names as formulas
    return `"${s.replace(/"/g, '""')}"`
}

export const api = {
    // ---------- session ----------
    /** Logs in and returns everything the first screen needs, in one round trip. */
    login(id: number, pin: string): LoginResult {
        int(id, 'employee')
        const given = typeof pin === 'string' ? pin : ''
        checkLock(id)
        const e = one<{ id: number; name: string; pin_hash: string | null; is_admin: number; active: number }>(
            'SELECT id, name, pin_hash, is_admin, active FROM employees WHERE id=?', id)
        if (!e || !e.active) throw new Error('Employee not found')
        if (e.pin_hash) {
            const v = verifyPin(e.pin_hash, given)
            if (!v.ok) {
                recordFail(id);
                throw new Error('Wrong PIN')
            }
            if (v.legacy) run('UPDATE employees SET pin_hash=? WHERE id=?', hashPin(given), id)
        }
        clearFails(id)
        const user: User = {id: e.id, name: e.name, isAdmin: e.is_admin}
        setSession(user)
        return {user, tables: listTables()}
    },
    logout(): void {
        setSession(null)
    },

    /** Everything the login screen needs, in one call. */
    getBootData(): BootData {
        return {settings: getSettings(), employees: activeEmployees()}
    },

    // ---------- employees ----------
    listEmployees(includeInactive = false): Employee[] {
        if (includeInactive) adminUser()
        return all<Employee>(`SELECT id, name, is_admin AS isAdmin, active, (pin_hash IS NOT NULL) AS hasPin
                              FROM employees ${includeInactive ? '' : 'WHERE active=1'}
                              ORDER BY name`)
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
    listTables,

    saveTable(t: { id?: number; name: string }): void {
        const name = text(t.name, 'Table name', 40)
        if (t.id !== undefined) run('UPDATE cafe_tables SET name=? WHERE id=?', name, int(t.id, 'table'))
        else run('INSERT INTO cafe_tables(name, sort) VALUES (?, (SELECT COALESCE(MAX(sort),0)+1 FROM cafe_tables))', name)
    },

    moveTable(id: number, dir: -1 | 1): void {
        int(id, 'table');
        int(dir, 'direction', -1, 1)
        tx(() => {
            const rows = all<{ id: number }>('SELECT id FROM cafe_tables WHERE active=1 ORDER BY sort, id')
            const i = rows.findIndex((r) => r.id === id)
            const j = i + dir
            if (i < 0 || j < 0 || j >= rows.length) return
                ;
            [rows[i], rows[j]] = [rows[j], rows[i]]
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
        all<Category>(`SELECT id, name, active
                       FROM categories ${includeInactive ? '' : 'WHERE active=1'}
                       ORDER BY sort, id`),

    saveCategory(c: { id?: number; name: string; active: boolean }): void {
        const name = text(c.name, 'Category name', 40)
        if (c.id !== undefined) run('UPDATE categories SET name=?, active=? WHERE id=?', name, +!!c.active, int(c.id, 'category'))
        else run('INSERT INTO categories(name, sort) VALUES (?, (SELECT COALESCE(MAX(sort),0)+1 FROM categories))', name)
        bumpMenu()
    },

    /** Admin only: includes the buy price. The order screen gets its (price-only) menu from getTableWorkspace. */
    listProducts: (includeInactive = false): AdminProduct[] =>
        all<AdminProduct>(`SELECT ${ADMIN_PRODUCT_COLS}
                           FROM products ${includeInactive ? '' : 'WHERE active=1'}
                           ORDER BY sort, name`),

    saveProduct(p: {
        id?: number;
        categoryId: number;
        name: string;
        priceCents: number;
        costCents: number;
        active: boolean
    }): void {
        const name = text(p.name, 'Product name', 60)
        const cents = int(p.priceCents, 'sell price (enter something like 1.50)', 0, 10_000_000)
        const cost = int(p.costCents, 'buy price (enter something like 0.60)', 0, 10_000_000)
        const cat = int(p.categoryId, 'category')
        if (!one('SELECT 1 FROM categories WHERE id=?', cat)) throw new Error('Category not found')
        if (p.id !== undefined) run('UPDATE products SET category_id=?, name=?, price_cents=?, cost_cents=?, active=? WHERE id=?', cat, name, cents, cost, +!!p.active, int(p.id, 'product'))
        else run('INSERT INTO products(category_id, name, price_cents, cost_cents, active, sort) VALUES (?,?,?,?,?,(SELECT COALESCE(MAX(sort),0)+1 FROM products))', cat, name, cents, cost, +!!p.active)
        bumpMenu()
    },

    /** Past orders and reports keep the name and prices they were sold with. */
    deleteProduct(id: number): void {
        run('DELETE FROM products WHERE id=?', int(id, 'product'))
        bumpMenu()
    },

    /** Deletes the category together with its products. Returns how many products went with it. */
    deleteCategory(id: number): number {
        int(id, 'category')
        const n = tx(() => {
            const c = run('DELETE FROM products WHERE category_id=?', id).changes
            run('DELETE FROM categories WHERE id=?', id)
            return c
        })
        bumpMenu()
        return n
    },

    // ---------- orders (the acting employee always comes from the session) ----------
    getTableOrder(tableId: number): Order | null {
        const r = one<{ id: number }>("SELECT id FROM orders WHERE table_id=? AND status='OPEN'", int(tableId, 'table'))
        return r ? loadOrder(r.id) : null
    },

    /**
     * Everything the order screen needs in ONE call. The menu is only included when the caller's copy is out of date
     * (knownMenuVersion), so opening a table normally transfers the order and the 10 most used items only.
     */
    getTableWorkspace(tableId: number, knownMenuVersion = -1): Workspace {
        int(tableId, 'table')
        const m = activeMenu()
        const r = one<{ id: number }>("SELECT id FROM orders WHERE table_id=? AND status='OPEN'", tableId)
        return {order: r ? loadOrder(r.id) : null, top: topProducts(), menu: m.version === knownMenuVersion ? null : m}
    },

    getOrder(id: number): Order | null {
        const o = visibleOrder(id)
        if (o && me().isAdmin) o.costCents = one<{
            c: number
        }>('SELECT COALESCE(SUM(qty*cost_cents),0) c FROM order_items WHERE order_id=?', o.id)!.c
        return o
    },

    /** Adds one unit. Creates the order (table becomes occupied) on the first product. */
    addItem(tableId: number, productId: number): Order | null {
        const user = me()
        int(tableId, 'table');
        int(productId, 'product')
        return tx(() => {
            let orderId = one<{ id: number }>("SELECT id FROM orders WHERE table_id=? AND status='OPEN'", tableId)?.id
            // product price + the matching line of this order in a single statement
            const p = one<{
                id: number;
                name: string;
                price_cents: number;
                cost_cents: number;
                item_id: number | null
            }>(
                `SELECT p.id,
                        p.name,
                        p.price_cents,
                        p.cost_cents,
                        (SELECT i.id
                         FROM order_items i
                         WHERE i.order_id = ?
                           AND i.product_id = p.id
                           AND i.price_cents = p.price_cents) AS item_id
                 FROM products p
                 WHERE p.id = ?
                   AND p.active = 1`, orderId ?? 0, productId)
            if (!p) throw new Error('Product not available')
            if (!orderId) {
                const t = one<{ name: string }>('SELECT name FROM cafe_tables WHERE id=? AND active=1', tableId)
                if (!t) throw new Error('Table not found')
                orderId = Number(run('INSERT INTO orders(table_id, table_name, employee_id, employee_name, opened_at) VALUES (?,?,?,?,?)',
                    tableId, t.name, user.id, user.name, now()).lastInsertRowid)
            }
            if (p.item_id) run('UPDATE order_items SET qty=qty+1 WHERE id=?', p.item_id)
            else run('INSERT INTO order_items(order_id, product_id, name, price_cents, cost_cents, qty, added_at) VALUES (?,?,?,?,?,1,?)', orderId, p.id, p.name, p.price_cents, p.cost_cents, now())
            touch(orderId)
            return loadOrder(orderId)
        })
    },

    /** Changes quantity by +1 or -1. Reducing below what was already printed is recorded as a void. */
    changeQty(itemId: number, delta: 1 | -1): Order | null {
        const employeeId = me().id
        int(itemId, 'item');
        int(delta, 'amount', -1, 1)
        if ((delta as number) === 0) throw new Error('Invalid amount')
        return tx(() => {
            const it = getItem(itemId)
            const nq = it.qty + delta
            if (nq <= 0) return dropItem(it, employeeId)
            if (delta < 0 && settled(it)) logVoid(it.order_id, it, 1, employeeId)
            run('UPDATE order_items SET qty=? WHERE id=?', nq, itemId)
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
    moveOrder(orderId: number, toTableId: number): MoveResult {
        int(orderId, 'order');
        int(toTableId, 'table')
        return tx(() => {
            assertOpen(orderId)
            const to = one<{
                id: number;
                name: string
            }>('SELECT id, name FROM cafe_tables WHERE id=? AND active=1', toTableId)
            if (!to) throw new Error('Table not found')
            const own = one<{ table_id: number }>('SELECT table_id FROM orders WHERE id=?', orderId)
            if (own?.table_id === toTableId) throw new Error('The order is already on this table')
            const other = one<{ id: number }>("SELECT id FROM orders WHERE table_id=? AND status='OPEN'", toTableId)
            if (!other) {
                run('UPDATE orders SET table_id=?, table_name=? WHERE id=?', to.id, to.name, orderId)
                return {tableId: to.id, tableName: to.name, merged: false}
            }
            for (const it of all<ItemRow>('SELECT * FROM order_items WHERE order_id=?', orderId)) {
                const same = one<{
                    id: number
                }>('SELECT id FROM order_items WHERE order_id=? AND product_id IS ? AND price_cents=?', other.id, it.product_id, it.price_cents)
                if (same) {
                    run('UPDATE order_items SET qty=qty+? WHERE id=?', it.qty, same.id)
                    run('DELETE FROM order_items WHERE id=?', it.id)
                } else run('UPDATE order_items SET order_id=? WHERE id=?', other.id, it.id)
            }
            run('UPDATE voids SET order_id=? WHERE order_id=?', other.id, orderId)
            // the merged order has been at the table since the earlier of the two
            run('UPDATE orders SET opened_at=MIN(opened_at, (SELECT opened_at FROM orders WHERE id=?)) WHERE id=?', orderId, other.id)
            run('DELETE FROM orders WHERE id=?', orderId)
            touch(other.id)
            return {tableId: to.id, tableName: to.name, merged: true}
        })
    },

    /** One atomic step: close the order (total recomputed from its lines) and record the payment. */
    payOrder(orderId: number, method: 'CASH' | 'CARD'): Order {
        const user = me()
        int(orderId, 'order')
        if (method !== 'CASH' && method !== 'CARD') throw new Error('Choose cash or card')
        if (method === 'CARD' && getSettings().cardEnabled !== '1') throw new Error('Card payments are turned off')
        const paid = tx(() => {
            const t = now()
            const r = one<{ c: number }>(
                `UPDATE orders
                 SET status='PAID',
                     closed_at=?,
                     total_cents=(SELECT COALESCE(SUM(qty * price_cents), 0) FROM order_items WHERE order_id = ?)
                 WHERE id = ?
                   AND status = 'OPEN'
                   AND EXISTS (SELECT 1 FROM order_items WHERE order_id = ?) RETURNING total_cents AS c`, t, orderId, orderId, orderId)
            if (!r) {
                assertOpen(orderId);
                throw new Error('The order is empty')
            }
            run('INSERT INTO payments(order_id, method, amount_cents, paid_at, employee_id, employee_name) VALUES (?,?,?,?,?,?)',
                orderId, method, r.c, t, user.id, user.name)
            return loadOrder(orderId)!
        })
        topCache = null // a payment changes the "most used" ranking...
        setImmediate(() => {
            try {
                topProducts()
            } catch { /* database closing */
            }
        }) // ...rebuilt right after this reply is sent, not during the next table open
        return paid
    },

    // ---------- printing ----------
    async printOrder(orderId: number): Promise<{ ok: boolean; error?: string }> {
        try {
            const o = visibleOrder(orderId)
            if (!o) return {ok: false, error: 'Order not found'}
            const s = getSettings()
            await printRows(orderRows(o, s), s)
            return {ok: true}
        } catch (e) {
            return {ok: false, error: (e as Error).message}
        }
    },

    /** The exact rows the printer would get. For an unpaid order, `method` is the payment method chosen so far. */
    previewReceipt(orderId: number, method?: 'CASH' | 'CARD'): PreviewData {
        const o = visibleOrder(orderId)
        if (!o) throw new Error('Order not found')
        const s = getSettings()
        return {rows: orderRows(o, s, method), width: receiptWidth(s)}
    },
    previewSample(): PreviewData {
        const s = getSettings()
        return {rows: orderRows(sampleOrder(s), s), width: receiptWidth(s)}
    },

    async testPrint(): Promise<{ ok: boolean; error?: string }> {
        try {
            const s = getSettings()
            await printRows(testRows(s), s)
            return {ok: true}
        } catch (e) {
            return {ok: false, error: (e as Error).message}
        }
    },

    async listPrinters(): Promise<{ name: string; label: string }[]> {
        const w = win()
        if (!w) return []
        return (await w.webContents.getPrintersAsync()).map((p) => ({name: p.name, label: p.displayName || p.name}))
    },

    // ---------- history & reports ----------
    /** Newest 300 paid orders of the period plus the real total. Staff only see today. */
    listOrders(from: number, to: number): HistoryPage {
        int(from, 'date', 0, 9e15);
        int(to, 'date', 0, 9e15)
        const admin = !!me().isAdmin
        const f = admin ? from : Math.max(from, startOfToday())
        return {rows: queryOrders(f, to, admin), total: countOrders(f, to)}
    },
    report(from: number, to: number): Report {
        return report(int(from, 'date', 0, 9e15), int(to, 'date', 0, 9e15))
    },

    /** Streams every order of the period to the file in batches: times, time at table, buy cost and profit included. */
    async exportCsv(from: number, to: number): Promise<string | null> {
        int(from, 'date', 0, 9e15);
        int(to, 'date', 0, 9e15)
        const r = await saveDlg({
            title: 'Export CSV',
            defaultPath: 'cafe-orders.csv',
            filters: [{name: 'CSV', extensions: ['csv']}]
        })
        if (r.canceled || !r.filePath) return null
        const fd = openSync(r.filePath, 'w')
        const hm = (ms: number): string => start(ms).split(';')[1]
        try {
            writeSync(fd, '\ufeff' + ['Order', 'Date', 'Opened', 'Paid', 'Minutes at table', 'Table', 'Opened by', 'Paid by', 'Method', 'Total', 'Cost', 'Profit'].join(';') + '\r\n')
            let batch: string[] = []
            for (const o of prepared(historySql(true).replace('DESC', 'ASC')).iterate(from, to, -1) as Iterable<HistoryRow>) {
                const profit = o.profitCents ?? 0
                batch.push([
                    o.id, start(o.closedAt).split(';')[0], hm(o.openedAt), hm(o.closedAt), Math.round((o.closedAt - o.openedAt) / 60000),
                    o.tableName, o.employeeName ?? '', o.paidBy ?? '', o.method,
                    (o.totalCents / 100).toFixed(2), ((o.totalCents - profit) / 100).toFixed(2), (profit / 100).toFixed(2)
                ].map(csvCell).join(';'))
                if (batch.length >= 1000) {
                    writeSync(fd, batch.join('\r\n') + '\r\n');
                    batch = []
                }
            }
            if (batch.length) writeSync(fd, batch.join('\r\n') + '\r\n')
        } finally {
            closeSync(fd)
        }
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
        invalidateSettings()
    },

    async backupNow(): Promise<string | null> {
        const d = new Date().toISOString().slice(0, 10)
        const r = await saveDlg({
            title: 'Save backup',
            defaultPath: `cafe-backup-${d}.db`,
            filters: [{name: 'Database', extensions: ['db']}]
        })
        if (r.canceled || !r.filePath) return null
        return makeBackup(r.filePath)
    },

    async restoreBackup(): Promise<boolean> {
        const r = await openDlg({
            title: 'Choose a backup file',
            properties: ['openFile'],
            filters: [{name: 'Database', extensions: ['db']}]
        })
        if (r.canceled || !r.filePaths[0]) return false
        const file = r.filePaths[0]
        try {
            // Only accept a file that looks exactly like our own database: intact, expected tables, no triggers or views.
            const t = new Database(file, {readonly: true, fileMustExist: true})
            const ok = t.pragma('integrity_check', {simple: true}) === 'ok'
            const tables = t.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name IN ('employees','cafe_tables','categories','products','orders','order_items','payments','voids','settings')").get() as {
                c: number
            }
            const extras = t.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type IN ('trigger','view')").get() as {
                c: number
            }
            t.close()
            if (!ok || tables.c !== 9 || extras.c !== 0) throw new Error('invalid')
        } catch {
            throw new Error('This file is not a valid Café Manager backup')
        }
        const c = await msgDlg({
            type: 'warning',
            buttons: ['Cancel', 'Replace all data'],
            defaultId: 0,
            cancelId: 0,
            message: 'Replace ALL current data with this backup?',
            detail: 'A safety copy of the current data is saved first.'
        })
        if (c.response !== 1) return false
        await makeBackup(join(backupDir(), `before-restore-${Date.now()}.db`))
        closeDb()
        copyFileSync(file, dbPath())
        rmSync(dbPath() + '-wal', {force: true})
        rmSync(dbPath() + '-shm', {force: true})
        app.relaunch()
        app.exit(0)
        return true
    }
}
