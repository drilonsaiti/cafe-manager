import {BrowserWindow} from 'electron'
import {connect} from 'node:net'
import {writeFile} from 'node:fs/promises'
import type {Order, Settings} from '../shared/types'

/** One receipt/ticket is described once as rows, then rendered either as HTML (Windows printer) or ESC/POS bytes. */
export type Row = { t: 'title' | 'center' | 'text' | 'row' | 'bold-row' | 'rule' | 'blank'; a?: string; b?: string }

export interface PreviewData {
    rows: Row[];
    width: number
}

const p2 = (n: number): string => String(n).padStart(2, '0')
const money = (cents: number, cur: string): string => {
    const v = (cents / 100).toFixed(2)
    return cur === 'EUR' ? `€${v}` : `${v} ${cur}`
}
const stamp = (ms: number): string => {
    const d = new Date(ms)
    return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

const LABELS = {
    en: {
        receipt: 'RECEIPT',
        staff: 'Staff',
        total: 'TOTAL',
        /*paidBy: 'Paid by',
        cash: 'Cash',
        card: 'Card',*/
        test: 'PRINTER TEST'
    },
    sq: {
        receipt: 'LLOGARIA',
        staff: 'Punonjësi',
        total: 'TOTALI',
        /*paidBy: 'Paguar me',
        cash: 'Para në dorë',
        card: 'Kartë',*/
        test: 'TESTI I PRINTERIT'
    },
    mk: {
        receipt: 'СМЕТКА',
        staff: 'Вработен',
        total: 'ВКУПНО',
        /*paidBy: 'Платено со',
        cash: 'Готовина',
        card: 'Картичка',*/
        test: 'ТЕСТ НА ПЕЧАТАЧ'
    }
}
const labels = (s: Settings) => LABELS[s.language as keyof typeof LABELS] ?? LABELS.en
export const receiptWidth = (s: Settings): number => Number(s.paperChars) || 48

/** The receipt is described once as rows. The printer, the ESC/POS bytes and the on-screen preview all use these rows. */
export function orderRows(o: Order, s: Settings, method?: 'CASH' | 'CARD'): Row[] {
    const L = labels(s)
    const paid = o.payment?.method ?? method
    const staff = o.payment?.employeeName ?? o.employeeName ?? '-'
    const r: Row[] = [{t: 'title', a: s.cafeName}]
    if (s.address) r.push({t: 'center', a: s.address})
    r.push(
        {t: 'rule'},
        {t: 'bold-row', a: L.receipt, b: o.tableName},
        {t: 'row', a: stamp(o.closedAt ?? Date.now()), b: `#${o.id}`},
        {t: 'text', a: `${L.staff}: ${staff}`},
        {t: 'rule'}
    )
    for (const i of o.items) r.push({t: 'row', a: `${i.qty} x ${i.name}`, b: money(i.qty * i.priceCents, s.currency)})
    r.push({t: 'rule'}, {t: 'bold-row', a: L.total, b: money(o.totalCents, s.currency)})
    if (s.footer) r.push({t: 'blank'}, {t: 'center', a: s.footer})
    return r
}

/** A made-up order, to preview the receipt layout in Settings. */
export function sampleOrder(s: Settings): Order {
    const t = Date.now()
    const items = [
        {id: 1, productId: 1, name: 'Espresso', priceCents: 100, qty: 2, addedAt: t},
        {id: 2, productId: 2, name: 'Cappuccino', priceCents: 150, qty: 1, addedAt: t},
        {id: 3, productId: 3, name: 'Coca-Cola', priceCents: 150, qty: 1, addedAt: t}
    ]
    return {
        id: 1042,
        tableId: 5,
        tableName: 'Table 5',
        employeeId: 1,
        employeeName: 'John',
        status: 'PAID',
        openedAt: t - 3600e3,
        closedAt: t,
        totalCents: items.reduce((a, i) => a + i.qty * i.priceCents, 0),
        items,
        payment: {method: 'CASH', paidAt: t, employeeName: 'John'}
    }
}

export function testRows(s: Settings): Row[] {
    return [
        {t: 'title', a: s.cafeName}, {t: 'center', a: labels(s).test}, {t: 'rule'},
        {t: 'row', a: '2 x Espresso', b: money(200, s.currency)},
        {t: 'center', a: 'Ëë Çç € - OK'}, {t: 'blank'}
    ]
}

// ---------- Windows printer (any installed printer, via the normal Windows driver) ----------
const esc = (x: string): string => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function toHtml(rows: Row[], s: Settings): string {
    const width = Number(s.paperChars) <= 32 ? '48mm' : '72mm'
    const body = rows.map((r) => {
        switch (r.t) {
            case 'title':
                return `<div class="c title">${esc(r.a ?? '')}</div>`
            case 'center':
                return `<div class="c">${esc(r.a ?? '')}</div>`
            case 'text':
                return `<div>${esc(r.a ?? '')}</div>`
            case 'row':
                return `<div class="r"><span>${esc(r.a ?? '')}</span><span>${esc(r.b ?? '')}</span></div>`
            case 'bold-row':
                return `<div class="r b"><span>${esc(r.a ?? '')}</span><span>${esc(r.b ?? '')}</span></div>`
            case 'rule':
                return '<hr>'
            default:
                return '<br>'
        }
    }).join('')
    return `<!doctype html><meta charset="utf-8"><style>
    @page{margin:0} body{margin:0 auto;width:${width};font:12px/1.4 Consolas,'Courier New',monospace;color:#000}
    .c{text-align:center}.title{font-size:18px;font-weight:700}.r{display:flex;justify-content:space-between;gap:8px}
    .b{font-weight:700;font-size:14px}hr{border:0;border-top:1px dashed #000;margin:6px 0}
  </style><body>${body}</body>`
}

async function printWindows(html: string, s: Settings): Promise<void> {
    const w = new BrowserWindow({
        show: false,
        webPreferences: {javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false}
    })
    w.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
    try {
        await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
        await new Promise<void>((resolve, reject) => {
            w.webContents.print(
                {silent: s.silentPrint === '1', deviceName: s.printerName || undefined, margins: {marginType: 'none'}},
                (ok, reason) => (ok || reason === 'cancelled' ? resolve() : reject(new Error(reason || 'Printing failed')))
            )
        })
    } finally {
        w.destroy()
    }
}

// ---------- ESC/POS thermal printer (raw bytes) ----------
const CP858: Record<string, number> = {
    '€': 0xd5, ë: 0x89, Ë: 0xd3, ç: 0x87, Ç: 0x80, é: 0x82, É: 0x90, è: 0x8a,
    ü: 0x81, Ü: 0x9a, ö: 0x94, Ö: 0x99, ä: 0x84, Ä: 0x8e
}
const CYR: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    ѓ: 'gj',
    е: 'e',
    ж: 'zh',
    з: 'z',
    ѕ: 'dz',
    и: 'i',
    ј: 'j',
    к: 'k',
    л: 'l',
    љ: 'lj',
    м: 'm',
    н: 'n',
    њ: 'nj',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    ќ: 'kj',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'c',
    ч: 'ch',
    џ: 'dzh',
    ш: 'sh'
}
/** ESC/POS printers use a Latin code page. Macedonian text is printed transliterated (the Windows printer mode prints Cyrillic as is). */
const latinize = (t: string): string =>
    t.replace(/[\u0400-\u04FF]/g, (ch) => {
        const lo = ch.toLowerCase(), r = CYR[lo];
        return r === undefined ? '?' : ch === lo ? r : r.toUpperCase()
    })

function enc(text: string): Buffer {
    const out: number[] = []
    for (const ch of latinize(text)) {
        if (ch in CP858) {
            out.push(CP858[ch]);
            continue
        }
        const plain = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        const code = plain.charCodeAt(0)
        out.push(plain.length === 1 && code < 128 ? code : 0x3f)
    }
    return Buffer.from(out)
}

const pair = (a: string, b: string, w: number): string => {
    const left = a.slice(0, Math.max(0, w - b.length - 1))
    return left + ' '.repeat(Math.max(1, w - left.length - b.length)) + b
}

function toEscPos(rows: Row[], w: number): Buffer {
    const b: Buffer[] = []
    const raw = (...x: number[]): void => {
        b.push(Buffer.from(x))
    }
    const txt = (t: string): void => {
        b.push(enc(t))
    }
    raw(0x1b, 0x40, 0x1b, 0x74, 19) // init + code page 858 (has €, ë, ç)
    for (const r of rows) {
        const a = r.a ?? '', c = r.b ?? ''
        switch (r.t) {
            case 'title':
                raw(0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x11);
                txt(a + '\n');
                raw(0x1d, 0x21, 0, 0x1b, 0x45, 0, 0x1b, 0x61, 0);
                break
            case 'center':
                raw(0x1b, 0x61, 1);
                txt(a + '\n');
                raw(0x1b, 0x61, 0);
                break
            case 'text':
                txt(a + '\n');
                break
            case 'row':
                txt(pair(a, c, w) + '\n');
                break
            case 'bold-row':
                raw(0x1b, 0x45, 1);
                txt(pair(a, c, w) + '\n');
                raw(0x1b, 0x45, 0);
                break
            case 'rule':
                txt('-'.repeat(w) + '\n');
                break
            default:
                txt('\n')
        }
    }
    txt('\n\n\n')
    raw(0x1d, 0x56, 0x42, 0x03) // feed + partial cut
    return Buffer.concat(b)
}

/** target: "192.168.1.50" or "192.168.1.50:9100" (network), "\\\\localhost\\ShareName" (USB printer shared in Windows), or "COM3". */
async function sendRaw(target: string, data: Buffer): Promise<void> {
    const t = target.trim()
    if (!t) throw new Error('ESC/POS printer is not set. Open Settings → Printing.')
    if (t.startsWith('\\\\')) return writeFile(t, data) // validated in Settings: \\\\host\\share only
    if (/^COM\d+$/i.test(t)) return writeFile('\\\\.\\' + t.toUpperCase(), data)
    const [host, port] = t.split(':')
    await new Promise<void>((resolve, reject) => {
        const sock = connect({host, port: Number(port) || 9100}, () => sock.end(data))
        sock.setTimeout(5000, () => {
            sock.destroy();
            reject(new Error('Printer did not answer (timeout)'))
        })
        sock.on('error', (e) => reject(new Error('Cannot reach printer: ' + e.message)))
        sock.on('close', () => resolve())
    })
}

export async function printRows(rows: Row[], s: Settings): Promise<void> {
    if (s.printMode === 'none') throw new Error('Printing is turned off. Open Settings → Printing.')
    if (s.printMode === 'escpos') return sendRaw(s.escposTarget, toEscPos(rows, Number(s.paperChars) || 48))
    return printWindows(toHtml(rows, s), s)
}
