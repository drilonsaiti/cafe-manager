import {memo} from 'react'
import {useApp} from '../ctx'
import {elapsed, useClock} from '../clock'
import {useT} from '../i18n'
import {money} from '../util'
import {useTables} from '../tablesStore'
import type {TableRow} from '../../../shared/types'

/** Only this small component re-renders when the clock ticks, not the tiles around it. */
function Elapsed({since}: { since: number }) {
    return <span className="timer">{elapsed(useClock() - since)}</span>
}

const Tile = memo(function Tile({t, cur, free, selected, onOpen}: {
    t: TableRow;
    cur: string;
    free: string;
    selected: boolean;
    onOpen: (t: TableRow) => void
}) {
    const busy = !!t.orderId
    return (
        <button className={'tile ' + (busy ? 'busy' : 'free') + (selected ? ' sel' : '')} onClick={() => onOpen(t)}>
            <span className="tile-row"><span className="tname">{t.name}</span><i
                className={'dot ' + (busy ? 'busy' : 'free')}/></span>
            {busy ? (
                <>
                    <span className="by">{t.employeeName}</span>
                    <span className="tile-row"><b className="sum">{money(t.totalCents ?? 0, cur)}</b><Elapsed
                        since={t.openedAt ?? Date.now()}/></span>
                </>
            ) : <span className="state">{free}</span>}
        </button>
    )
})

export default function Tables({onOpen, selectedId = null, compact = false}: {
    onOpen: (t: TableRow) => void;
    selectedId?: number | null;
    compact?: boolean
}) {
    const {settings} = useApp()
    const t = useT()
    const tables = useTables()
    const busy = tables.filter((r) => r.orderId).length
    return (
        <>
            <div className="pagehead">
                {!compact && <h1>{t('tables')}</h1>}
                <div className="legend">
                    <span><i className="dot free"/>{t('nFree', {n: tables.length - busy})}</span>
                    <span><i className="dot busy"/>{t('nOccupied', {n: busy})}</span>
                </div>
            </div>
            <div className={'tables' + (compact ? ' compact' : '')}>
                {tables.map((r) => <Tile key={r.id} t={r} cur={settings.currency} free={t('free')}
                                         selected={r.id === selectedId} onOpen={onOpen}/>)}
            </div>
        </>
    )
}
