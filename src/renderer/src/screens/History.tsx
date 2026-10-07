import {useEffect, useState} from 'react'
import {api} from '../api'
import {useApp} from '../ctx'
import {elapsed} from '../clock'
import {useT} from '../i18n'
import {Modal, RangePicker, ReceiptPreview} from '../ui'
import type {Range} from '../util'
import {bounds, clock, dateStr, money, msg, todayRange} from '../util'
import type {HistoryPage, Order} from '../../../shared/types'
import type {PreviewData} from '../../../main/print'

export default function History() {
    const {user, settings, toast, reloadTables} = useApp()
    const t = useT()
    const [range, setRange] = useState<Range>(todayRange())
    const [page, setPage] = useState<HistoryPage>({rows: [], total: 0})
    const [open, setOpen] = useState<Order | null>(null)
    const [preview, setPreview] = useState<PreviewData | null>(null)
    const [deleteOrder, setDeleteOrder] = useState<Order | null>(null)
    const [deleteText, setDeleteText] = useState('')
    const cur = settings.currency
    const admin = !!user.isAdmin

    useEffect(() => {
        const [a, b] = bounds(range);
        api.listOrders(a, b).then(setPage)
    }, [range])

    const show = async (id: number): Promise<void> => {
        try {
            setOpen(await api.getOrder(id))
        } catch (e) {
            toast(msg(e), 'err')
        }
    }
    const reprint = async (): Promise<void> => {
        if (!open) return
        const r = await api.printOrder(open.id)
        toast(r.ok ? t('sentToPrinter') : r.error ?? t('printFailed'), r.ok ? 'ok' : 'err')
    }
    const showPreview = async (): Promise<void> => {
        if (!open) return
        try {
            setPreview(await api.previewReceipt(open.id))
        } catch (e) {
            toast(msg(e), 'err')
        }
    }
    const cols = admin ? 10 : 9

    return (
        <>
            <div className="pagehead">
                <h1>{t('orders')}</h1>
                {admin ? <RangePicker value={range} onChange={setRange}/> : <span className="mute">{t('today')}</span>}
            </div>
            <table className="grid-table">
                <thead>
                <tr>
                    <th>{t('colOrder')}</th>
                    <th>{t('colDate')}</th>
                    <th>{t('colOpened')}</th>
                    <th>{t('colPaid')}</th>
                    <th>{t('colDuration')}</th>
                    <th>{t('colTable')}</th>
                    <th>{t('colEmployee')}</th>
                    <th>{t('colMethod')}</th>
                    <th className="num">{t('colTotal')}</th>
                    {admin && <th className="num">{t('colProfit')}</th>}
                </tr>
                </thead>
                <tbody>
                {page.rows.map((r) => (
                    <tr key={r.id} className="click" onClick={() => show(r.id)}>
                        <td>#{r.id}</td>
                        <td>{dateStr(r.closedAt)}</td>
                        <td>{clock(r.openedAt)}</td>
                        <td>{clock(r.closedAt)}</td>
                        <td>{elapsed(r.closedAt - r.openedAt)}</td>
                        <td>{r.tableName}</td>
                        <td>{r.paidBy ?? r.employeeName}</td>
                        <td>{r.method === 'CASH' ? t('cash') : t('card')}</td>
                        <td className="num">{money(r.totalCents, cur)}</td>
                        {admin && <td className="num">{r.profitCents === null ? '' : money(r.profitCents, cur)}</td>}
                    </tr>
                ))}
                {page.rows.length === 0 && <tr>
                    <td colSpan={cols} className="empty">{t('noOrders')}</td>
                </tr>}
                </tbody>
            </table>
            {page.total > page.rows.length &&
                <p className="mute more">{t('showingLatest', {shown: page.rows.length, total: page.total})}</p>}
            {open && (
                <>
                    <Modal title={`#${open.id} · ${open.tableName}`} onClose={() => setOpen(null)}>
                        <div className="timeline">
                            <div><span>{t('openedAt')}</span><b>{dateStr(open.openedAt)} {clock(open.openedAt)}</b>
                            </div>
                            <div><span>{t('paidAt')}</span><b>{open.closedAt ? clock(open.closedAt) : ''}</b></div>
                            <div>
                                <span>{t('timeAtTable')}</span><b>{open.closedAt ? elapsed(open.closedAt - open.openedAt) : ''}</b>
                            </div>
                        </div>
                        <p className="mute">{open.payment?.employeeName ?? open.employeeName} · {open.payment?.method === 'CASH' ? t('cash') : t('card')}</p>
                        <div className="bill">
                            {open.items.map((i) => (
                                <div key={i.id}>
                                    <span>{i.qty} × {i.name}{i.addedAt > 0 &&
                                        <small className="mute"> · {clock(i.addedAt)}</small>}</span>
                                    <span>{money(i.qty * i.priceCents, cur)}</span>
                                </div>
                            ))}
                            <div className="grand"><span>{t('total')}</span><span>{money(open.totalCents, cur)}</span>
                            </div>
                            {/*{admin && open.costCents !== undefined && (
              <>
                <div className="sub"><span>{t('cost')}</span><span>{money(open.costCents, cur)}</span></div>
                <div className="sub"><span>{t('profit')}</span><b>{money(open.totalCents - open.costCents, cur)}</b></div>
              </>
            )}*/}
                        </div>
                        <div className="row2">
                            <button className="btn big" onClick={showPreview}>{t('previewReceipt')}</button>
                            {settings.printMode !== 'none' &&
                                <button className="btn big" onClick={reprint}>{t('reprint')}</button>}
                        </div>
                        {admin && <button className="btn danger" onClick={() => { setDeleteOrder(open); setDeleteText('') }}>{t('deleteOrder')}</button>}
                    </Modal>
                    {preview &&
                        <ReceiptPreview rows={preview.rows} width={preview.width} onClose={() => setPreview(null)}
                                        onPrint={settings.printMode !== 'none' ? reprint : undefined}/>}
                </>
            )}
            {deleteOrder && <Modal title={t('deleteOrder')} onClose={() => setDeleteOrder(null)}>
                <p className="mute">{t('deleteOrderWarning', {id: deleteOrder.id})}</p>
                <label className="field">{t('typeDelete')}<input value={deleteText} onChange={(e) => setDeleteText(e.target.value)}/></label>
                <button className="btn danger" disabled={deleteText !== 'DELETE'} onClick={async () => {
                    try {
                        await api.deleteOrder(deleteOrder.id)
                        setDeleteOrder(null); setOpen(null)
                        const [from, to] = bounds(range); setPage(await api.listOrders(from, to))
                        await reloadTables()
                        toast(t('orderDeleted'))
                    } catch (e) { toast(msg(e), 'err') }
                }}>{t('deleteOrder')}</button>
            </Modal>}
        </>
    )
}
