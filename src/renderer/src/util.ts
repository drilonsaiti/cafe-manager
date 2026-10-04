export const money = (cents: number, cur = 'EUR'): string => {
    const v = (cents / 100).toFixed(2)
    return cur === 'EUR' ? `€${v}` : `${v} ${cur}`
}
export const toCents = (s: string): number => Math.round(parseFloat(s.replace(',', '.')) * 100)
export const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const p2 = (n: number): string => String(n).padStart(2, '0')
export const clock = (ms: number): string => {
    const d = new Date(ms);
    return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}
export const dateStr = (ms: number): string => {
    const d = new Date(ms);
    return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`
}

// ----- date ranges (weeks start on Monday) -----
export type RangeKind = 'today' | 'yesterday' | 'week' | 'month' | 'custom'

export interface Range {
    kind: RangeKind;
    from: string;
    to: string
}

export const ymd = (d: Date): string => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
export const todayRange = (): Range => ({kind: 'today', from: ymd(new Date()), to: ymd(new Date())})

export function bounds(r: Range): [number, number] {
    const n = new Date()
    const t = new Date(n.getFullYear(), n.getMonth(), n.getDate())
    const add = (d: Date, k: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + k)
    const parse = (s: string): Date => {
        const [y, m, d] = s.split('-').map(Number);
        return y ? new Date(y, m - 1, d) : t
    }
    let a: Date, b: Date
    switch (r.kind) {
        case 'today':
            a = t;
            b = add(t, 1);
            break
        case 'yesterday':
            a = add(t, -1);
            b = t;
            break
        case 'week':
            a = add(t, -((t.getDay() + 6) % 7));
            b = add(a, 7);
            break
        case 'month':
            a = new Date(t.getFullYear(), t.getMonth(), 1);
            b = new Date(t.getFullYear(), t.getMonth() + 1, 1);
            break
        default:
            a = parse(r.from);
            b = add(parse(r.to), 1)
    }
    return [a.getTime(), b.getTime()]
}

export const initials = (name: string): string =>
    name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')

export const hhmm = clock
