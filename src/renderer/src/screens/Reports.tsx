import { useEffect, useState } from 'react'
import { api } from '../api'
import { useApp } from '../ctx'
import { RangePicker } from '../ui'
import { bounds, dateStr, money, msg, todayRange } from '../util'
import type { Range } from '../util'
import type { Report } from '../../../shared/types'

export default function Reports() {
  const { settings, toast } = useApp()
  const [range, setRange] = useState<Range>(todayRange())
  const [r, setR] = useState<Report | null>(null)
  const cur = settings.currency
  const [from, to] = bounds(range)

  useEffect(() => { api.report(from, to).then(setR) }, [from, to])

  const csv = async (): Promise<void> => {
    try {
      const path = await api.exportCsv(from, to)
      if (path) toast('Saved ' + path)
    } catch (e) { toast(msg(e), 'err') }
  }

  const cards: [string, string][] = r ? [
    ['Orders', String(r.orders)], ['Revenue', money(r.revenue, cur)], ['Cash', money(r.cash, cur)],
    ['Card', money(r.card, cur)], ['Products sold', String(r.itemsSold)], ['Average order', money(r.avg, cur)]
  ] : []

  return (
    <>
      <div className="pagehead">
        <h1>Reports</h1>
        <div className="toolbar noprint">
          <button className="btn sm" onClick={() => window.print()}>Print</button>
          <button className="btn sm" onClick={csv}>Export CSV</button>
        </div>
      </div>
      <RangePicker value={range} onChange={setRange} />
      <h2 className="printonly">{settings.cafeName} · {dateStr(from)} – {dateStr(to - 1)}</h2>
      {r && (
        <>
          <div className="stats">
            {cards.map(([k, v]) => <div key={k} className="stat"><span>{k}</span><b>{v}</b></div>)}
          </div>
          <div className="cols">
            <div>
              <h4>Top products</h4>
              <table className="grid-table">
                <thead><tr><th>Product</th><th className="num">Sold</th><th className="num">Revenue</th></tr></thead>
                <tbody>
                  {r.top.map((t) => <tr key={t.name}><td>{t.name}</td><td className="num">{t.qty}</td><td className="num">{money(t.cents, cur)}</td></tr>)}
                  {r.top.length === 0 && <tr><td colSpan={3} className="empty">No sales yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div>
              <h4>Employees</h4>
              <table className="grid-table">
                <thead><tr><th>Employee</th><th className="num">Orders</th><th className="num">Revenue</th></tr></thead>
                <tbody>
                  {r.employees.map((e) => <tr key={e.name}><td>{e.name}</td><td className="num">{e.orders}</td><td className="num">{money(e.cents, cur)}</td></tr>)}
                  {r.employees.length === 0 && <tr><td colSpan={3} className="empty">No sales yet.</td></tr>}
                </tbody>
              </table>
              <p className="mute">Voided after printing: {r.voids.count} items · {money(r.voids.cents, cur)}</p>
            </div>
          </div>
        </>
      )}
    </>
  )
}
