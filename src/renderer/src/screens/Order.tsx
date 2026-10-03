import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useApp } from '../ctx'
import { IconBack, IconCard, IconCash, IconCheck, IconClose, IconMinus, IconPlus, IconPrinter, IconSwap } from '../icons'
import { Confirm, Modal } from '../ui'
import { money, msg } from '../util'
import type { Category, Order, OrderItem, Product, TableRow } from '../../../shared/types'

type VoidAsk = { item: OrderItem; mode: 'dec' | 'remove' }

export default function OrderScreen({ table, onBack }: { table: TableRow; onBack: () => void }) {
  const { user, settings, toast } = useApp()
  const cur = settings.currency
  const printOn = settings.printMode !== 'none'
  const [order, setOrder] = useState<Order | null>(null)
  const [cats, setCats] = useState<Category[]>([])
  const [prods, setProds] = useState<Product[]>([])
  const [top, setTop] = useState<Product[]>([])
  const [cat, setCat] = useState<number | null>(null)
  const [modal, setModal] = useState<null | 'pay' | 'move'>(null)
  const [ask, setAsk] = useState<VoidAsk | null>(null)
  const end = useRef<HTMLDivElement>(null)

  const attempt = async (fn: () => Promise<unknown>): Promise<void> => {
    try { await fn() } catch (e) { toast(msg(e), 'err') }
  }

  useEffect(() => {
    attempt(async () => {
      const [o, c, p, t] = await Promise.all([api.getTableOrder(table.id), api.listCategories(), api.listProducts(), api.mostUsed()])
      setOrder(o); setCats(c); setProds(p); setTop(t)
      setCat(c.find((x) => p.some((y) => y.categoryId === x.id))?.id ?? c[0]?.id ?? null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.id])

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [order?.items.length])

  const add = (p: Product): Promise<void> => attempt(async () => setOrder(await api.addItem(table.id, p.id)))
  const inc = (it: OrderItem): Promise<void> => attempt(async () => setOrder(await api.changeQty(it.id, 1)))
  const dec = (it: OrderItem): void => {
    if (it.qty - 1 < it.printedQty) setAsk({ item: it, mode: 'dec' })
    else attempt(async () => setOrder(await api.changeQty(it.id, -1)))
  }
  const remove = (it: OrderItem): void => {
    if (it.printedQty > 0) setAsk({ item: it, mode: 'remove' })
    else attempt(async () => setOrder(await api.removeItem(it.id)))
  }
  const confirmVoid = (): void => {
    const a = ask
    setAsk(null)
    if (!a) return
    attempt(async () => setOrder(a.mode === 'dec' ? await api.changeQty(a.item.id, -1) : await api.removeItem(a.item.id)))
  }

  const saveAndPrint = async (): Promise<void> => {
    if (!order) return
    const r = await api.printOrder(order.id, 'ticket')
    if (r.ok) onBack(); else toast(r.error ?? 'Printing failed', 'err')
  }

  const anySent = !!order?.items.some((i) => i.printedQty > 0)
  const btn = (p: Product, hot = false) => (
    <button key={p.id} className={'prod' + (hot ? ' hot' : '')} onClick={() => add(p)}>
      <span>{p.name}</span><small>{money(p.priceCents, cur)}</small>
    </button>
  )

  return (
    <div className="order">
      <section className="ticket">
        <header>
          <button className="icon-btn" aria-label="Back to tables" onClick={onBack}><IconBack /></button>
          <h2>{table.name}</h2>
          <span className="saved grow"><IconCheck size={16} />Saved</span>
          <button className="btn sm" disabled={!order} onClick={() => setModal('move')}><IconSwap size={18} />Move</button>
        </header>
        <div className="lines">
          {!order && <div className="empty">Tap a product to start this order</div>}
          {order?.items.map((it) => (
            <div className="line" key={it.id}>
              <div className="nm">
                <span>{it.name}{anySent && it.printedQty < it.qty && <em className="new">New</em>}</span>
                <small>{money(it.priceCents, cur)}</small>
              </div>
              <div className="stepper">
                <button aria-label={`One less ${it.name}`} onClick={() => dec(it)}><IconMinus size={18} /></button>
                <b>{it.qty}</b>
                <button aria-label={`One more ${it.name}`} onClick={() => inc(it)}><IconPlus size={18} /></button>
              </div>
              <div className="amt">{money(it.qty * it.priceCents, cur)}</div>
              <button className="icon-btn" aria-label={`Remove ${it.name}`} onClick={() => remove(it)}><IconClose size={18} /></button>
            </div>
          ))}
          <div ref={end} />
        </div>
        <footer>
          <div className="total"><span>Total</span><b>{money(order?.totalCents ?? 0, cur)}</b></div>
          <div className="row2">
            <button className="btn" onClick={onBack}>Save</button>
            {printOn && <button className="btn" disabled={!order} onClick={saveAndPrint}><IconPrinter size={18} />Save &amp; print</button>}
          </div>
          <button className="btn primary big" disabled={!order} onClick={() => setModal('pay')}>Request payment</button>
        </footer>
      </section>

      <section className="menu">
        <h4>Most used</h4>
        <div className="grid top">{top.map((p) => btn(p, true))}</div>
        <div className="segmented wrap">
          {cats.map((c) => <button key={c.id} className={'seg' + (cat === c.id ? ' on' : '')} onClick={() => setCat(c.id)}>{c.name}</button>)}
        </div>
        <div className="grid">{prods.filter((p) => p.categoryId === cat).map((p) => btn(p))}</div>
      </section>

      {modal === 'pay' && order && <PayModal order={order} onClose={() => setModal(null)} onDone={onBack} />}
      {modal === 'move' && order && <MoveModal order={order} onClose={() => setModal(null)} onDone={onBack} />}
      {ask && (
        <Confirm
          title="Void printed item?"
          text={`${ask.item.name} was already printed. Removing it is recorded under ${user.name}.`}
          yes="Void item" onYes={confirmVoid} onNo={() => setAsk(null)}
        />
      )}
    </div>
  )
}

function PayModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const { settings, toast } = useApp()
  const [method, setMethod] = useState<'CASH' | 'CARD'>('CASH')
  const [busy, setBusy] = useState(false)
  const cur = settings.currency
  const printOn = settings.printMode !== 'none'

  const pay = async (print: boolean): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const paid = await api.payOrder(order.id, method)
      toast(`Paid ${money(paid.totalCents, cur)}`)
      if (print) {
        const r = await api.printOrder(paid.id, 'receipt')
        if (!r.ok) toast('Paid, but the receipt did not print: ' + r.error, 'err')
      }
      onDone()
    } catch (e) {
      toast(msg(e), 'err')
      setBusy(false)
    }
  }

  return (
    <Modal title={order.tableName} onClose={onClose}>
      <div className="paytotal"><span>Total</span><b>{money(order.totalCents, cur)}</b></div>
      <div className="bill">
        {order.items.map((i) => <div key={i.id}><span>{i.qty} × {i.name}</span><span>{money(i.qty * i.priceCents, cur)}</span></div>)}
      </div>
      <div className="segmented full">
        <button className={'seg big' + (method === 'CASH' ? ' on' : '')} onClick={() => setMethod('CASH')}><IconCash />Cash</button>
        <button className={'seg big' + (method === 'CARD' ? ' on' : '')} onClick={() => setMethod('CARD')}><IconCard />Card</button>
      </div>
      <div className="row2">
        <button className={'btn big' + (printOn ? '' : ' primary')} disabled={busy} onClick={() => pay(false)}>Pay</button>
        {printOn && <button className="btn big primary" disabled={busy} onClick={() => pay(true)}><IconPrinter />Pay &amp; print</button>}
      </div>
    </Modal>
  )
}

function MoveModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp()
  const [rows, setRows] = useState<TableRow[]>([])
  useEffect(() => { api.listTables().then(setRows) }, [])

  const move = async (t: TableRow): Promise<void> => {
    try {
      const r = await api.moveOrder(order.id, t.id)
      toast(r.merged ? `Merged into ${r.tableName}` : `Moved to ${r.tableName}`)
      onDone()
    } catch (e) { toast(msg(e), 'err') }
  }

  return (
    <Modal title={`Move ${order.tableName} to`} onClose={onClose} wide>
      <div className="tables small">
        {rows.filter((t) => t.id !== order.tableId).map((t) => (
          <button key={t.id} className={'tile ' + (t.orderId ? 'busy' : 'free')} onClick={() => move(t)}>
            <span className="tile-row"><span className="tname">{t.name}</span><i className={'dot ' + (t.orderId ? 'busy' : 'free')} /></span>
            <span className="state">{t.orderId ? 'Merge orders' : 'Free'}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
