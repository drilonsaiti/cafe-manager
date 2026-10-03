import { useEffect, useState } from 'react'
import { api } from '../api'
import { useApp } from '../ctx'
import { Confirm } from '../ui'
import { msg, toCents } from '../util'
import type { Category, Employee, Product, Settings, TableRow } from '../../../shared/types'

type Tab = 'tables' | 'menu' | 'employees' | 'settings'

export default function Admin() {
  const [tab, setTab] = useState<Tab>('tables')
  const labels: [Tab, string][] = [['tables', 'Tables'], ['menu', 'Menu'], ['employees', 'Employees'], ['settings', 'Café and printing']]
  return (
    <>
      <div className="pagehead">
        <h1>Settings</h1>
        <div className="segmented">
          {labels.map(([k, l]) => <button key={k} className={'seg' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}
        </div>
      </div>
      {tab === 'tables' && <TablesAdmin />}
      {tab === 'menu' && <MenuAdmin />}
      {tab === 'employees' && <EmployeesAdmin />}
      {tab === 'settings' && <SettingsAdmin />}
    </>
  )
}

function useAct(reload: () => unknown) {
  const { toast } = useApp()
  return async (fn: () => Promise<unknown>): Promise<boolean> => {
    try { await fn(); await reload(); return true } catch (e) { toast(msg(e), 'err'); return false }
  }
}

function TablesAdmin() {
  const { reloadTables } = useApp()
  const [rows, setRows] = useState<TableRow[]>([])
  const [name, setName] = useState('')
  const [del, setDel] = useState<TableRow | null>(null)
  const load = async (): Promise<void> => setRows(await api.listTables())
  useEffect(() => { load() }, [])
  const act = useAct(async () => { await load(); await reloadTables() })

  return (
    <div className="card">
      <h3>Tables</h3>
      {rows.map((t, i) => (
        <div className="rowline" key={t.id}>
          <input defaultValue={t.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) act(() => api.saveTable({ id: t.id, name: v })) }} />
          <button className="btn sm" disabled={i === 0} onClick={() => act(() => api.moveTable(t.id, -1))}>↑</button>
          <button className="btn sm" disabled={i === rows.length - 1} onClick={() => act(() => api.moveTable(t.id, 1))}>↓</button>
          <button className="btn sm danger" onClick={() => setDel(t)}>Delete</button>
        </div>
      ))}
      <div className="rowline">
        <input placeholder="New table name, e.g. Table 11" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn sm primary" onClick={async () => { if (await act(() => api.saveTable({ name }))) setName('') }}>Add table</button>
      </div>
      {del && <Confirm title={`Delete ${del.name}?`} text="Past orders keep their table name in the history." yes="Delete"
        onNo={() => setDel(null)} onYes={() => { const d = del; setDel(null); act(() => api.deleteTable(d.id)) }} />}
    </div>
  )
}

function MenuAdmin() {
  const [cats, setCats] = useState<Category[]>([])
  const [prods, setProds] = useState<Product[]>([])
  const [sel, setSel] = useState<number | null>(null)
  const [catName, setCatName] = useState('')
  const [pn, setPn] = useState('')
  const [pp, setPp] = useState('')
  const load = async (): Promise<void> => {
    const [c, p] = await Promise.all([api.listCategories(true), api.listProducts(true)])
    setCats(c); setProds(p)
    setSel((s) => s ?? c[0]?.id ?? null)
  }
  useEffect(() => { load() }, [])
  const act = useAct(load)

  return (
    <div className="cols menu-admin">
      <div className="card">
        <h3>Categories</h3>
        {cats.map((c) => (
          <div key={c.id} className={'rowline' + (sel === c.id ? ' sel' : '')} onClick={() => setSel(c.id)}>
            <input defaultValue={c.name} className={c.active ? '' : 'off'}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) act(() => api.saveCategory({ id: c.id, name: v, active: !!c.active })) }} />
            <label className="check"><input type="checkbox" checked={!!c.active} onChange={(e) => act(() => api.saveCategory({ id: c.id, name: c.name, active: e.target.checked }))} />Visible</label>
          </div>
        ))}
        <div className="rowline">
          <input placeholder="New category" value={catName} onChange={(e) => setCatName(e.target.value)} />
          <button className="btn sm primary" onClick={async () => { if (await act(() => api.saveCategory({ name: catName, active: true }))) setCatName('') }}>Add</button>
        </div>
      </div>
      <div className="card">
        <h3>Products</h3>
        {prods.filter((p) => p.categoryId === sel).map((p) => <ProductRow key={p.id + ':' + p.name + p.priceCents} p={p} cats={cats} act={act} />)}
        {sel !== null && (
          <div className="rowline">
            <input placeholder="New product" value={pn} onChange={(e) => setPn(e.target.value)} />
            <input className="price" placeholder="1.50" value={pp} onChange={(e) => setPp(e.target.value)} />
            <button className="btn sm primary" onClick={async () => {
              if (await act(() => api.saveProduct({ categoryId: sel, name: pn, priceCents: toCents(pp), active: true }))) { setPn(''); setPp('') }
            }}>Add</button>
          </div>
        )}
        <p className="mute">Switching a product off hides it from the order screen but keeps all past orders intact.</p>
      </div>
    </div>
  )
}

function ProductRow({ p, cats, act }: { p: Product; cats: Category[]; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [name, setName] = useState(p.name)
  const [price, setPrice] = useState((p.priceCents / 100).toFixed(2))
  const save = (over: { categoryId?: number; active?: boolean } = {}): void => {
    act(() => api.saveProduct({ id: p.id, categoryId: over.categoryId ?? p.categoryId, name, priceCents: toCents(price), active: over.active ?? !!p.active }))
  }
  const dirty = name.trim() !== p.name || toCents(price) !== p.priceCents
  return (
    <div className="rowline">
      <input className={p.active ? '' : 'off'} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => dirty && save()} />
      <input className="price" value={price} onChange={(e) => setPrice(e.target.value)} onBlur={() => dirty && save()} />
      <select value={p.categoryId} onChange={(e) => save({ categoryId: Number(e.target.value) })}>
        {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <label className="check"><input type="checkbox" checked={!!p.active} onChange={(e) => save({ active: e.target.checked })} />On</label>
    </div>
  )
}

function EmployeesAdmin() {
  const [emps, setEmps] = useState<Employee[]>([])
  const load = async (): Promise<void> => setEmps(await api.listEmployees(true))
  useEffect(() => { load() }, [])
  const act = useAct(load)
  return (
    <div className="card">
      <h3>Employees</h3>
      {emps.map((e) => <EmpRow key={e.id + ':' + e.name + e.hasPin + e.isAdmin + e.active} e={e} act={act} />)}
      <EmpRow key={'new' + emps.length} act={act} />
      <p className="mute">A PIN is only asked when an employee is selected at the start or after "Switch employee". Leave the PIN field empty to keep the current one.</p>
    </div>
  )
}

function EmpRow({ e, act }: { e?: Employee; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [name, setName] = useState(e?.name ?? '')
  const [admin, setAdmin] = useState(!!e?.isAdmin)
  const [active, setActive] = useState(e ? !!e.active : true)
  const [pin, setPin] = useState('')
  const save = (clearPin = false): void => {
    act(() => api.saveEmployee({ id: e?.id, name, isAdmin: admin, active, pin: clearPin ? null : pin || undefined }))
  }
  return (
    <div className="rowline">
      <input placeholder="New employee name" value={name} onChange={(x) => setName(x.target.value)} className={active ? '' : 'off'} />
      <input className="price" inputMode="numeric" placeholder={e?.hasPin ? '••••' : 'PIN'} value={pin} onChange={(x) => setPin(x.target.value.replace(/\D/g, '').slice(0, 8))} />
      {e?.hasPin ? <button className="btn sm" onClick={() => save(true)}>Remove PIN</button> : null}
      <label className="check"><input type="checkbox" checked={admin} onChange={(x) => setAdmin(x.target.checked)} />Admin</label>
      <label className="check"><input type="checkbox" checked={active} onChange={(x) => setActive(x.target.checked)} />Active</label>
      <button className="btn sm primary" onClick={() => save()}>{e ? 'Save' : 'Add'}</button>
    </div>
  )
}

function SettingsAdmin() {
  const { settings, reloadSettings, toast } = useApp()
  const [s, setS] = useState<Settings>(settings)
  const [printers, setPrinters] = useState<{ name: string; label: string }[]>([])
  useEffect(() => { api.listPrinters().then(setPrinters) }, [])
  const set = (k: keyof Settings, v: string): void => setS((x) => ({ ...x, [k]: v }))
  const field = (k: keyof Settings, label: string, ph = '') => (
    <label className="field">{label}<input value={s[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} /></label>
  )
  const save = async (): Promise<boolean> => {
    try { await api.saveSettings(s); await reloadSettings(); return true } catch (e) { toast(msg(e), 'err'); return false }
  }
  const test = async (): Promise<void> => {
    if (!(await save())) return
    const r = await api.testPrint()
    toast(r.ok ? 'Test page sent' : r.error ?? 'Printing failed', r.ok ? 'ok' : 'err')
  }

  return (
    <div className="cols">
      <div className="card">
        <h3>Café</h3>
        {field('cafeName', 'Café name')}
        {field('address', 'Address')}
        {field('currency', 'Currency', 'EUR')}
        {field('footer', 'Receipt footer')}
        <button className="btn primary" onClick={async () => { if (await save()) toast('Settings saved') }}>Save settings</button>
      </div>
      <div className="card">
        <h3>Printing</h3>
        <label className="field">Printer type
          <select value={s.printMode} onChange={(e) => set('printMode', e.target.value)}>
            <option value="windows">Windows printer (any installed printer)</option>
            <option value="escpos">Thermal receipt printer (ESC/POS)</option>
            <option value="none">No printing</option>
          </select>
        </label>
        {s.printMode === 'windows' && (
          <>
            <label className="field">Printer
              <select value={s.printerName} onChange={(e) => set('printerName', e.target.value)}>
                <option value="">Windows default printer</option>
                {printers.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
              </select>
            </label>
            <label className="check"><input type="checkbox" checked={s.silentPrint === '1'} onChange={(e) => set('silentPrint', e.target.checked ? '1' : '0')} />Print without the Windows dialog</label>
          </>
        )}
        {s.printMode === 'escpos' && (
          <>
            {field('escposTarget', 'Printer address', '192.168.1.50  or  \\\\localhost\\PrinterShare  or  COM3')}
            <label className="field">Paper width
              <select value={s.paperChars} onChange={(e) => set('paperChars', e.target.value)}>
                <option value="48">80 mm</option><option value="32">58 mm</option>
              </select>
            </label>
            <p className="mute">Network printer: its IP address. USB printer: share it in Windows (Printer properties → Sharing) and enter \\localhost\ShareName.</p>
          </>
        )}
        <div className="row2"><button className="btn" onClick={test}>Save and print a test page</button></div>
        <h3>Backup</h3>
        <p className="mute">A copy is saved automatically every few hours (last 30 days kept) in the app's data folder.</p>
        <div className="row2">
          <button className="btn" onClick={async () => { try { const p = await api.backupNow(); if (p) toast('Backup saved') } catch (e) { toast(msg(e), 'err') } }}>Back up now</button>
          <button className="btn danger" onClick={async () => { try { await api.restoreBackup() } catch (e) { toast(msg(e), 'err') } }}>Restore from backup</button>
        </div>
      </div>
    </div>
  )
}
