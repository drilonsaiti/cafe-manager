import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useApp } from '../ctx'
import { IconBack, IconCard, IconCash, IconCheck, IconClose, IconMinus, IconPlus, IconPrinter, IconSwap } from '../icons'
import { firstCategory, getMenu, menuVersion, setMenu } from '../menuCache'
import type { MenuView } from '../menuCache'
import { Confirm, Modal } from '../ui'
import { money, msg } from '../util'
import type { Order, OrderItem, Product, TableRow } from '../../../shared/types'

type VoidAsk = { item: OrderItem; mode: 'dec' | 'remove' }

const sameItem = (a: OrderItem, b: OrderItem): boolean =>
  a.id === b.id && a.qty === b.qty && a.printedQty === b.printedQty && a.priceCents === b.priceCents && a.name === b.name

/** Keeps object identity for everything that did not change, so unchanged lines are not re-rendered and an
 *  identical database answer produces no update at all. */
function reconcile(prev: Order | null, next: Order | null): Order | null {
  if (!prev || !next) return next
  const items = next.items.map((n) => prev.items.find((p) => sameItem(p, n)) ?? n)
  const same = items.length === prev.items.length && items.every((it, i) => it === prev.items[i]) &&
    prev.id === next.id && prev.totalCents === next.totalCents && prev.status === next.status && prev.employeeName === next.employeeName
  return same ? prev : { ...next, items }
}

const Line = memo(function Line({ it, cur, isNew, onInc, onDec, onRemove }: {
  it: OrderItem; cur: string; isNew: boolean
  onInc: (it: OrderItem) => void; onDec: (it: OrderItem) => void; onRemove: (it: OrderItem) => void
}) {
  return (
    <div className="line">
      <div className="nm">
        <span>{it.name}{isNew && <em className="new">New</em>}</span>
        <small>{money(it.priceCents, cur)}</small>
      </div>
      <div className="stepper">
        <button aria-label={`One less ${it.name}`} disabled={it.id < 0} onClick={() => onDec(it)}><IconMinus size={18} /></button>
        <b>{it.qty}</b>
        <button aria-label={`One more ${it.name}`} disabled={it.id < 0} onClick={() => onInc(it)}><IconPlus size={18} /></button>
      </div>
      <div className="amt">{money(it.qty * it.priceCents, cur)}</div>
      <button className="icon-btn" aria-label={`Remove ${it.name}`} disabled={it.id < 0} onClick={() => onRemove(it)}><IconClose size={18} /></button>
    </div>
  )
})

/** Re-renders only when the visible products change (category switch / menu edit), not on every order tap. */
const ProductGrid = memo(function ProductGrid({ products, cur, hot, onAdd }: { products: Product[]; cur: string; hot?: boolean; onAdd: (p: Product) => void }) {
  return (
    <div className={'grid' + (hot ? ' top' : '')}>
      {products.map((p) => (
        <button key={p.id} className={'prod' + (hot ? ' hot' : '')} onClick={() => onAdd(p)}>
          <span>{p.name}</span><small>{money(p.priceCents, cur)}</small>
        </button>
      ))}
    </div>
  )
})

export default function OrderScreen({ table, onBack, onOrder }: {
  table: TableRow
  onBack: (reloadTables?: boolean) => void
  onOrder: (tableId: number, order: Order | null) => void
}) {
  const { user, settings, toast } = useApp()
  const cur = settings.currency
  const printOn = settings.printMode !== 'none'
  const [order, setOrderState] = useState<Order | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [menu, setMenuState] = useState<MenuView | null>(getMenu) // cached menu: first products are visible immediately
  const [top, setTop] = useState<Product[]>([])
  const [cat, setCat] = useState<number | null>(() => firstCategory(getMenu()))
  const [modal, setModal] = useState<null | 'pay' | 'move'>(null)
  const [ask, setAsk] = useState<VoidAsk | null>(null)
  const orderRef = useRef<Order | null>(null) // the latest order, readable synchronously by optimistic updates
  const pending = useRef(0)
  const waiters = useRef<(() => void)[]>([])
  const tempId = useRef(0)
  const end = useRef<HTMLDivElement>(null)

  const apply = useCallback((o: Order | null): void => {
    const next = reconcile(orderRef.current, o)
    if (next === orderRef.current) return // the database confirmed exactly what is already on screen
    orderRef.current = next
    setOrderState(next)
    onOrder(table.id, next) // patch just this table's tile
  }, [table.id, onOrder])

  useEffect(() => {
    let live = true
    api.getTableWorkspace(table.id, menuVersion()).then((ws) => {
      if (!live) return
      if (ws.menu) { const m = setMenu(ws.menu); setMenuState(m); setCat((c) => c ?? firstCategory(m)) }
      setTop(ws.top)
      setLoaded(true)
      if (pending.current === 0) apply(ws.order) // a tap made before this arrived brings its own, newer, answer
    }).catch((e) => toast(msg(e), 'err'))
    return () => { live = false }
  }, [table.id, apply, toast])

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [order?.items.length])

  /**
   * Runs one change. `optimistic` (only used for add / +1) paints the result immediately; the database answer then
   * replaces it. While several changes are in flight only the LAST answer is applied, so the screen never flickers
   * back. If anything fails the screen is re-read from the database. Payment never goes through this path.
   */
  /** Resolves once every change made so far has been answered by the database. Money actions wait for this
   *  instead of showing a disabled button, so nothing re-renders just to toggle a flag. */
  const settled = useCallback((): Promise<void> =>
    pending.current === 0 ? Promise.resolve() : new Promise<void>((r) => { waiters.current.push(r) }), [])
  const release = useCallback((): void => { if (pending.current === 0) { const w = waiters.current; waiters.current = []; w.forEach((r) => r()) } }, [])

  const mutate = useCallback(async (optimistic: ((o: Order | null) => Order | null) | null, call: () => Promise<Order | null>): Promise<void> => {
    pending.current++
    if (optimistic) apply(optimistic(orderRef.current))
    try {
      const o = await call()
      pending.current--
      if (pending.current === 0) apply(o)
    } catch (e) {
      pending.current--
      toast(msg(e), 'err')
      if (pending.current === 0) { try { apply(await api.getTableOrder(table.id)) } catch { /* the next action re-reads */ } }
    }
    release()
  }, [apply, release, table.id, toast])

  const add = useCallback((p: Product): void => {
    void mutate((o) => {
      const base: Order = o ?? {
        id: -1, tableId: table.id, tableName: table.name, employeeId: user.id, employeeName: user.name,
        status: 'OPEN', openedAt: Date.now(), closedAt: null, totalCents: 0, items: [], payment: null
      }
      const i = base.items.findIndex((x) => x.productId === p.id && x.priceCents === p.priceCents)
      const items = i >= 0
        ? base.items.map((x, k) => (k === i ? { ...x, qty: x.qty + 1 } : x))
        : [...base.items, { id: --tempId.current - 1, productId: p.id, name: p.name, priceCents: p.priceCents, qty: 1, printedQty: 0 }]
      return { ...base, items, totalCents: base.totalCents + p.priceCents }
    }, () => api.addItem(table.id, p.id))
  }, [mutate, table.id, table.name, user.id, user.name])

  const inc = useCallback((it: OrderItem): void => {
    void mutate((o) => o && { ...o, items: o.items.map((x) => (x.id === it.id ? { ...x, qty: x.qty + 1 } : x)), totalCents: o.totalCents + it.priceCents },
      () => api.changeQty(it.id, 1))
  }, [mutate])
  const dec = useCallback((it: OrderItem): void => {
    if (it.qty - 1 < it.printedQty) setAsk({ item: it, mode: 'dec' })
    else void mutate(null, () => api.changeQty(it.id, -1))
  }, [mutate])
  const remove = useCallback((it: OrderItem): void => {
    if (it.printedQty > 0) setAsk({ item: it, mode: 'remove' })
    else void mutate(null, () => api.removeItem(it.id))
  }, [mutate])
  const confirmVoid = (): void => {
    const a = ask
    setAsk(null)
    if (a) void mutate(null, () => (a.mode === 'dec' ? api.changeQty(a.item.id, -1) : api.removeItem(a.item.id)))
  }

  const saveAndPrint = async (): Promise<void> => {
    await settled()
    const o = orderRef.current
    if (!o) return
    const r = await api.printOrder(o.id, 'ticket')
    if (r.ok) onBack(); else toast(r.error ?? 'Printing failed', 'err')
  }

  const anySent = !!order?.items.some((i) => i.printedQty > 0)
  /** Money actions only ever run on a state the database has confirmed. */
  const openModal = async (m: 'pay' | 'move'): Promise<void> => { await settled(); if (orderRef.current) setModal(m) }

  return (
    <div className="order">
      <section className="ticket">
        <header>
          <button className="icon-btn" aria-label="Back to tables" onClick={() => onBack()}><IconBack /></button>
          <h2>{table.name}</h2>
          <span className="saved grow"><IconCheck size={16} />Saved</span>
          <button className="btn sm" disabled={!order} onClick={() => openModal('move')}><IconSwap size={18} />Move</button>
        </header>
        <div className="lines">
          {loaded && !order && <div className="empty">Tap a product to start this order</div>}
          {order?.items.map((it) => (
            <Line key={it.id} it={it} cur={cur} isNew={anySent && it.printedQty < it.qty} onInc={inc} onDec={dec} onRemove={remove} />
          ))}
          <div ref={end} />
        </div>
        <footer>
          <div className="total"><span>Total</span><b>{money(order?.totalCents ?? 0, cur)}</b></div>
          <div className="row2">
            <button className="btn" onClick={() => onBack()}>Save</button>
            {printOn && <button className="btn" disabled={!order} onClick={saveAndPrint}><IconPrinter size={18} />Save &amp; print</button>}
          </div>
          <button className="btn primary big" disabled={!order} onClick={() => openModal('pay')}>Request payment</button>
        </footer>
      </section>

      <section className="menu">
        <h4>Most used</h4>
        <ProductGrid products={top} cur={cur} hot onAdd={add} />
        <div className="segmented wrap">
          {menu?.categories.map((c) => <button key={c.id} className={'seg' + (cat === c.id ? ' on' : '')} onClick={() => setCat(c.id)}>{c.name}</button>)}
        </div>
        <ProductGrid products={(cat !== null && menu?.byCat.get(cat)) || EMPTY} cur={cur} onAdd={add} />
      </section>

      {modal === 'pay' && order && <PayModal order={order} onClose={() => setModal(null)} onDone={() => { apply(null); onBack() }} />}
      {modal === 'move' && order && <MoveModal order={order} onClose={() => setModal(null)} onDone={() => onBack(true)} />}
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

const EMPTY: Product[] = []

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
