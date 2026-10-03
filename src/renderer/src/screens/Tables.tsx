import { memo } from 'react'
import { useApp } from '../ctx'
import { elapsed, useClock } from '../clock'
import { money } from '../util'
import { useTables } from '../tablesStore'
import type { TableRow } from '../../../shared/types'

/** Only this small component re-renders when the clock ticks, not the tiles around it. */
function Elapsed({ since }: { since: number }) {
  return <span className="timer">{elapsed(useClock() - since)}</span>
}

const Tile = memo(function Tile({ t, cur, onOpen }: { t: TableRow; cur: string; onOpen: (t: TableRow) => void }) {
  const busy = !!t.orderId
  return (
    <button className={'tile ' + (busy ? 'busy' : 'free')} onClick={() => onOpen(t)}>
      <span className="tile-row"><span className="tname">{t.name}</span><i className={'dot ' + (busy ? 'busy' : 'free')} /></span>
      {busy ? (
        <>
          <span className="by">{t.employeeName}</span>
          <span className="tile-row"><b className="sum">{money(t.totalCents ?? 0, cur)}</b><Elapsed since={t.openedAt ?? Date.now()} /></span>
        </>
      ) : <span className="state">Free</span>}
    </button>
  )
})

export default function Tables({ onOpen }: { onOpen: (t: TableRow) => void }) {
  const { settings } = useApp()
  const tables = useTables()
  const busy = tables.filter((r) => r.orderId).length
  return (
    <>
      <div className="pagehead">
        <h1>Tables</h1>
        <div className="legend">
          <span><i className="dot free" />{tables.length - busy} free</span>
          <span><i className="dot busy" />{busy} occupied</span>
        </div>
      </div>
      <div className="tables">
        {tables.map((t) => <Tile key={t.id} t={t} cur={settings.currency} onOpen={onOpen} />)}
      </div>
    </>
  )
}
