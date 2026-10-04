import {useSyncExternalStore} from 'react'
import type {Order, TableRow} from '../../shared/types'

/**
 * The table board lives outside React state so that changing one table (every tap on the order screen)
 * does not re-render App. Only components that call useTables() are notified, and only when something changed.
 */
let tables: TableRow[] = []
const subs = new Set<() => void>()
const emit = (): void => subs.forEach((f) => f())

export function setTables(t: TableRow[]): void {
    tables = t;
    emit()
}

/** Replace only the affected row; every other tile keeps its object identity. */
export function patchTable(id: number, o: Order | null): void {
    const i = tables.findIndex((t) => t.id === id)
    if (i < 0) return
    const t = tables[i]
    const orderId = o ? o.id : null, openedAt = o ? o.openedAt : null, totalCents = o ? o.totalCents : null,
        employeeName = o ? o.employeeName : null
    if (t.orderId === orderId && t.totalCents === totalCents && t.employeeName === employeeName) return
    tables = tables.slice()
    tables[i] = {...t, orderId, openedAt, totalCents, employeeName}
    emit()
}

export const useTables = (): TableRow[] =>
    useSyncExternalStore((cb) => {
        subs.add(cb);
        return () => {
            subs.delete(cb)
        }
    }, () => tables)
