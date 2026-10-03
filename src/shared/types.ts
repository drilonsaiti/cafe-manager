export interface User { id: number; name: string; isAdmin: number }
export interface Employee { id: number; name: string; isAdmin: number; active: number; hasPin: number }
export interface Category { id: number; name: string; active: number }
export interface Product { id: number; categoryId: number; name: string; priceCents: number; active: number }
export interface TableRow {
  id: number; name: string
  orderId: number | null; openedAt: number | null; totalCents: number | null; employeeName: string | null
}
export interface OrderItem { id: number; productId: number | null; name: string; priceCents: number; qty: number; printedQty: number }
export interface Order {
  id: number; tableId: number; tableName: string
  employeeId: number | null; employeeName: string | null
  status: 'OPEN' | 'PAID' | 'CANCELLED'
  openedAt: number; closedAt: number | null; totalCents: number
  items: OrderItem[]
  payment: { method: 'CASH' | 'CARD'; paidAt: number; employeeName: string | null } | null
}
export interface HistoryRow {
  id: number; tableName: string; employeeName: string | null; paidBy: string | null
  closedAt: number; totalCents: number; method: 'CASH' | 'CARD'
}
export type SettingKey =
  | 'cafeName' | 'address' | 'currency' | 'footer'
  | 'printMode' | 'printerName' | 'silentPrint' | 'escposTarget' | 'paperChars'
export type Settings = Record<SettingKey, string>
export interface Report {
  orders: number; revenue: number; cash: number; card: number; itemsSold: number; avg: number
  top: { name: string; qty: number; cents: number }[]
  employees: { name: string; orders: number; cents: number }[]
  voids: { count: number; cents: number }
}
