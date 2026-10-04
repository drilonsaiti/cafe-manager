import type {Category, MenuData, Product} from '../../shared/types'

/** The menu lives here once, for the whole session. The main process only resends it when its version changes. */
export interface MenuView extends MenuData {
    byCat: Map<number, Product[]>
}

let cache: MenuView | null = null
export const getMenu = (): MenuView | null => cache
export const menuVersion = (): number => cache?.version ?? -1

export function setMenu(m: MenuData): MenuView {
    const byCat = new Map<number, Product[]>()
    for (const p of m.products) (byCat.get(p.categoryId) ?? byCat.set(p.categoryId, []).get(p.categoryId)!).push(p)
    cache = {...m, byCat}
    return cache
}

export const firstCategory = (m: MenuView | null): number | null =>
    m ? (m.categories.find((c: Category) => m.byCat.has(c.id))?.id ?? m.categories[0]?.id ?? null) : null
