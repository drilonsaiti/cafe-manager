/** An item that was added more than this long ago counts as served: removing it is recorded as a void. */
export const VOID_GRACE_MS = 120_000

export interface User {
    id: number;
    name: string;
    isAdmin: number
}

export interface Employee {
    id: number;
    name: string;
    isAdmin: number;
    active: number;
    hasPin: number
}

export interface Category {
    id: number;
    name: string;
    active: number
}

/** What the order screen sees. Never contains the buy price. */
export interface Product {
    id: number;
    categoryId: number;
    name: string;
    priceCents: number;
    active: number
}

/** Admin only (Settings -> Menu). */
export interface AdminProduct extends Product {
    costCents: number
}

export interface TableRow {
    id: number;
    name: string
    orderId: number | null;
    openedAt: number | null;
    totalCents: number | null;
    employeeName: string | null
}

export type TableRef = Pick<TableRow, 'id' | 'name'>

export interface OrderItem {
    id: number;
    productId: number | null;
    name: string;
    priceCents: number;
    qty: number;
    addedAt: number
}

export interface Order {
    id: number;
    tableId: number;
    tableName: string
    employeeId: number | null;
    employeeName: string | null
    status: 'OPEN' | 'PAID' | 'CANCELLED'
    openedAt: number;
    closedAt: number | null;
    totalCents: number
    items: OrderItem[]
    payment: { method: 'CASH' | 'CARD'; paidAt: number; employeeName: string | null } | null
    /** Buy-price total of the lines. Only filled in for admins. */
    costCents?: number
}

export interface HistoryRow {
    id: number;
    tableName: string;
    employeeName: string | null;
    paidBy: string | null
    openedAt: number;
    closedAt: number;
    totalCents: number;
    method: 'CASH' | 'CARD'
    /** null for staff */
    profitCents: number | null
}

export type SettingKey =
    | 'cafeName' | 'address' | 'currency' | 'footer' | 'language' | 'layout' | 'cardEnabled'
    | 'printMode' | 'printerName' | 'silentPrint' | 'escposTarget' | 'paperChars'
export type Settings = Record<SettingKey, string>

export interface Report {
    orders: number;
    revenue: number;
    cost: number;
    profit: number;
    cash: number;
    card: number
    itemsSold: number;
    avg: number;
    avgDurationMs: number
    /** units sold that have no buy price set (their profit is overstated) */
    uncosted: number
    top: { name: string; qty: number; cents: number; profit: number }[]
    employees: { name: string; orders: number; cents: number }[]
    voids: { count: number; cents: number }
}

export interface MenuData {
    version: number;
    categories: Category[];
    products: Product[]
}

export interface Workspace {
    order: Order | null;
    top: Product[];
    menu: MenuData | null
}

export interface LoginResult {
    user: User;
    tables: TableRow[]
}

export interface HistoryPage {
    rows: HistoryRow[];
    total: number
}

export interface BootData {
    settings: Settings;
    employees: Employee[]
}

export interface MoveResult {
    tableId: number;
    tableName: string;
    merged: boolean
}
