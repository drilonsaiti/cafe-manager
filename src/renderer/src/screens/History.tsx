import { useEffect, useState } from 'react'
import { api } from '../api'
import { useApp } from '../ctx'
import { Modal, RangePicker } from '../ui'
import { bounds, clock, dateStr, money, todayRange } from '../util'
import type { Range } from '../util'
import type { HistoryRow, Order } from '../../../shared/types'

export default function History() {
  const { user, settings, toast } = useApp()
  const [range, setRange] = useState<Range>(todayRange())
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [open, setOpen] = useState<Order | null>(null)
  const cur = settings.currency

  useEffect(() => { const [a, b] = bounds(range); api.listOrders(a, b).then(setRows) }, [range])

  const show = async (id: number): Promise<void> => setOpen(await api.getOrder(id))
  const reprint = async (): Promise<void> => {
    if (!open) return
    const r = await api.printOrder(open.id, 'receipt')
    toast(r.ok ? 'Sent to printer' : r.error ?? 'Printing failed', r.ok ? 'ok' : 'err')
  }

  return (
    <>
      <div className="pagehead">
        <h1>Orders</h1>
        {user.isAdmin ? <RangePicker value={range} onChange={setRange} /> : <span className="mute">Today</span>}
      </div>
      <table className="grid-table">
        <thead><tr><th>Order</th><th>Date</th><th>Time</th><th>Table</th><th>Employee</th><th>Method</th><th className="num">Total</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="click" onClick={() => show(r.id)}>
              <td>#{r.id}</td><td>{dateStr(r.closedAt)}</td><td>{clock(r.closedAt)}</td><td>{r.tableName}</td>
              <td>{r.paidBy ?? r.employeeName}</td><td>{r.method === 'CASH' ? 'Cash' : 'Card'}</td><td className="num">{money(r.totalCents, cur)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="empty">No paid orders in this period.</td></tr>}
        </tbody>
      </table>
      {open && (
        <Modal title={`Order #${open.id} · ${open.tableName}`} onClose={() => setOpen(null)}>
          <p className="mute">{open.closedAt ? `${dateStr(open.closedAt)} ${clock(open.closedAt)}` : ''} · {open.payment?.employeeName ?? open.employeeName} · {open.payment?.method === 'CASH' ? 'Cash' : 'Card'}</p>
          <div className="bill">
            {open.items.map((i) => <div key={i.id}><span>{i.qty} × {i.name}</span><span>{money(i.qty * i.priceCents, cur)}</span></div>)}
            <div className="grand"><span>Total</span><span>{money(open.totalCents, cur)}</span></div>
          </div>
          {settings.printMode !== 'none' && <button className="btn big" onClick={reprint}>Reprint receipt</button>}
        </Modal>
      )}
    </>
  )
}
