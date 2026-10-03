import { useEffect, useState } from 'react'
import { api } from '../api'
import { useApp } from '../ctx'
import { duration, money, useNow } from '../util'
import type { TableRow } from '../../../shared/types'

export default function Tables({ onOpen }: { onOpen: (t: TableRow) => void }) {
  const { settings } = useApp()
  const [rows, setRows] = useState<TableRow[]>([])
  const now = useNow()

  useEffect(() => {
    let on = true
    const load = (): void => { api.listTables().then((r) => on && setRows(r)) }
    load()
    const i = setInterval(load, 4000)
    return () => { on = false; clearInterval(i) }
  }, [])

  const busy = rows.filter((r) => r.orderId).length
  return (
    <>
      <div className="pagehead">
        <h1>Tables</h1>
        <div className="legend">
          <span><i className="dot free" />{rows.length - busy} free</span>
          <span><i className="dot busy" />{busy} occupied</span>
        </div>
      </div>
      <div className="tables">
        {rows.map((t) => (
          <button key={t.id} className={'tile ' + (t.orderId ? 'busy' : 'free')} onClick={() => onOpen(t)}>
            <span className="tile-row"><span className="tname">{t.name}</span><i className={'dot ' + (t.orderId ? 'busy' : 'free')} /></span>
            {t.orderId ? (
              <>
                <span className="by">{t.employeeName}</span>
                <span className="tile-row"><b className="sum">{money(t.totalCents ?? 0, settings.currency)}</b><span className="timer">{duration(now - (t.openedAt ?? now))}</span></span>
              </>
            ) : <span className="state">Free</span>}
          </button>
        ))}
      </div>
    </>
  )
}
