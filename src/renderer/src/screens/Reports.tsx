import {useEffect, useState} from 'react'
import {api} from '../api'
import {useApp} from '../ctx'
import {elapsed} from '../clock'
import {useT} from '../i18n'
import {RangePicker} from '../ui'
import type {Range} from '../util'
import {bounds, dateStr, money, msg, todayRange} from '../util'
import type {Report} from '../../../shared/types'

export default function Reports() {
    const {settings, toast} = useApp()
    const t = useT()
    const [range, setRange] = useState<Range>(todayRange())
    const [r, setR] = useState<Report | null>(null)
    const [sort, setSort] = useState<'qty' | 'profit'>('qty')
    const [productPage, setProductPage] = useState(0)
    const [inventoryPage, setInventoryPage] = useState(0)
    const cur = settings.currency
    const [from, to] = bounds(range)

    useEffect(() => {
        setProductPage(0)
        setInventoryPage(0)
        api.report(from, to).then(setR)
    }, [from, to])

    const csv = async (): Promise<void> => {
        try {
            const path = await api.exportCsv(from, to)
            if (path) toast(t('savedPath', {path}))
        } catch (e) {
            toast(msg(e), 'err')
        }
    }

    const cards: [string, string, boolean?][] = r ? [
        [t('revenue'), money(r.revenue, cur)],
        [t('cost'), money(r.cost, cur)],
        [t('profit'), money(r.profit, cur), true],
        [t('margin'), r.revenue ? `${((r.profit / r.revenue) * 100).toFixed(1)}%` : '–'],
        [t('orders'), String(r.orders)],
        [t('averageOrder'), money(r.avg, cur)],
        [t('avgTime'), r.orders ? elapsed(r.avgDurationMs) : '–'],
        [t('productsSold'), String(r.itemsSold)],
        [t('cash'), money(r.cash, cur)],
        ...(settings.cardEnabled === '1' || r.card > 0 ? [[t('card'), money(r.card, cur)] as [string, string]] : [])
    ] : []
    const pageSize = 20
    const sortedTop = r ? [...r.top].sort((a, b) => (sort === 'qty' ? b.qty - a.qty : b.profit - a.profit)) : []
    const top = sortedTop.slice(productPage * pageSize, (productPage + 1) * pageSize)
    const inventory = r?.inventory.slice(inventoryPage * pageSize, (inventoryPage + 1) * pageSize) ?? []

    return (
        <>
            <div className="pagehead">
                <h1>{t('reports')}</h1>
                <div className="toolbar noprint">
                    <button className="btn sm" onClick={() => window.print()}>{t('print')}</button>
                    <button className="btn sm" onClick={csv}>{t('exportCsv')}</button>
                </div>
            </div>
            <RangePicker value={range} onChange={setRange}/>
            <h2 className="printonly">{settings.cafeName} · {dateStr(from)} – {dateStr(to - 1)}</h2>
            {r && (
                <>
                    <div className="stats">
                        {cards.map(([k, v, hero]) => <div key={k} className={'stat' + (hero ? ' hero' : '')}>
                            <span>{k}</span><b>{v}</b></div>)}
                    </div>
                    {r.uncosted > 0 && <p className="notice">{t('noBuyPrice', {n: r.uncosted})}</p>}
                    <div className="cols">
                        <div>
                            <div className="sectionhead">
                                <h4>{t('topProducts')}</h4>
                                <div className="segmented noprint">
                                    <button className={'seg' + (sort === 'qty' ? ' on' : '')}
                                            onClick={() => { setSort('qty'); setProductPage(0) }}>{t('sortSold')}</button>
                                    <button className={'seg' + (sort === 'profit' ? ' on' : '')}
                                            onClick={() => { setSort('profit'); setProductPage(0) }}>{t('sortProfit')}</button>
                                </div>
                            </div>
                            <table className="grid-table">
                                <thead>
                                <tr>
                                    <th>{t('product')}</th>
                                    <th className="num">{t('sold')}</th>
                                    <th className="num">{t('revenue')}</th>
                                    <th className="num">{t('profit')}</th>
                                </tr>
                                </thead>
                                <tbody>
                                {top.map((p) => <tr key={p.name}>
                                    <td>{p.name}</td>
                                    <td className="num">{p.qty}</td>
                                    <td className="num">{money(p.cents, cur)}</td>
                                    <td className="num">{money(p.profit, cur)}</td>
                                </tr>)}
                                {sortedTop.length === 0 && <tr>
                                    <td colSpan={4} className="empty">{t('noSales')}</td>
                                </tr>}
                                </tbody>
                            </table>
                            <Pager page={productPage} total={sortedTop.length} pageSize={pageSize} onChange={setProductPage}/>
                        </div>
                        <div>
                            <h4>{t('employees')}</h4>
                            <table className="grid-table">
                                <thead>
                                <tr>
                                    <th>{t('employee')}</th>
                                    <th className="num">{t('orders')}</th>
                                    <th className="num">{t('revenue')}</th>
                                </tr>
                                </thead>
                                <tbody>
                                {r.employees.map((e) => <tr key={e.name}>
                                    <td>{e.name}</td>
                                    <td className="num">{e.orders}</td>
                                    <td className="num">{money(e.cents, cur)}</td>
                                </tr>)}
                                {r.employees.length === 0 && <tr>
                                    <td colSpan={3} className="empty">{t('noSales')}</td>
                                </tr>}
                                </tbody>
                            </table>
                            <p className="mute more">{t('voidedLine', {
                                n: r.voids.count,
                                amount: money(r.voids.cents, cur)
                            })}</p>
                        </div>
                    </div>
                    <section>
                        <h4>{t('inventory')}</h4>
                        <table className="grid-table">
                            <thead><tr><th>{t('product')}</th><th className="num">{t('quantity')}</th></tr></thead>
                            <tbody>{inventory.map((p) => <tr key={p.name}><td>{p.name}</td><td className="num">{p.quantity}</td></tr>)}
                            {r.inventory.length === 0 && <tr><td colSpan={2} className="empty">{t('noProducts')}</td></tr>}</tbody>
                        </table>
                        <Pager page={inventoryPage} total={r.inventory.length} pageSize={pageSize} onChange={setInventoryPage}/>
                    </section>
                </>
            )}
        </>
    )
}

function Pager({page, total, pageSize, onChange}: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
    const t = useT()
    const pages = Math.ceil(total / pageSize)
    if (pages <= 1) return null
    const first = page * pageSize + 1
    const last = Math.min((page + 1) * pageSize, total)
    return <div className="toolbar noprint" style={{justifyContent: 'space-between', marginTop: 8}}>
        <span className="mute">{t('pageRange', {first, last, total})}</span>
        <div className="toolbar">
            <button className="btn sm" disabled={page === 0} onClick={() => onChange(page - 1)}>{t('previous')}</button>
            <span className="mute">{t('pageOf', {page: page + 1, pages})}</span>
            <button className="btn sm" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>{t('next')}</button>
        </div>
    </div>
}
