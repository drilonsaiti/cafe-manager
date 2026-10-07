import {useEffect, useState} from 'react'
import {api} from '../api'
import {useApp} from '../ctx'
import {IconTrash} from '../icons'
import {LANGS, useT} from '../i18n'
import {Confirm, Modal, ReceiptPreview} from '../ui'
import {msg, toCents} from '../util'
import type {AdminProduct, Category, Employee, Settings, TableRow} from '../../../shared/types'
import type {PreviewData} from '../../../main/print'

type Tab = 'tables' | 'menu' | 'employees' | 'settings'
type Act = (fn: () => Promise<unknown>) => Promise<boolean>
/** An empty buy price means "not set" (0). A sell price must be a real number. */
const centsOrZero = (s: string): number => (s.trim() === '' ? 0 : toCents(s))

export default function Admin() {
    const t = useT()
    const [tab, setTab] = useState<Tab>('tables')
    const labels: [Tab, string][] = [['tables', t('tabTables')], ['menu', t('tabMenu')], ['employees', t('tabEmployees')], ['settings', t('tabGeneral')]]
    return (
        <>
            <div className="pagehead">
                <h1>{t('settings')}</h1>
                <div className="segmented">
                    {labels.map(([k, l]) => <button key={k} className={'seg' + (tab === k ? ' on' : '')}
                                                    onClick={() => setTab(k)}>{l}</button>)}
                </div>
            </div>
            {tab === 'tables' && <TablesAdmin/>}
            {tab === 'menu' && <MenuAdmin/>}
            {tab === 'employees' && <EmployeesAdmin/>}
            {tab === 'settings' && <SettingsAdmin/>}
        </>
    )
}

function useAct(reload: () => unknown): Act {
    const {toast} = useApp()
    return async (fn) => {
        try {
            await fn();
            await reload();
            return true
        } catch (e) {
            toast(msg(e), 'err');
            return false
        }
    }
}

function TablesAdmin() {
    const {reloadTables} = useApp()
    const t = useT()
    const [rows, setRows] = useState<TableRow[]>([])
    const [name, setName] = useState('')
    const [del, setDel] = useState<TableRow | null>(null)
    const load = async (): Promise<void> => setRows(await api.listTables())
    useEffect(() => {
        load()
    }, [])
    const act = useAct(async () => {
        await load();
        await reloadTables()
    })

    return (
        <div className="card">
            <h3>{t('tabTables')}</h3>
            {rows.map((r, i) => (
                <div className="rowline" key={r.id}>
                    <input defaultValue={r.name} onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== r.name) act(() => api.saveTable({id: r.id, name: v}))
                    }}/>
                    <button className="btn sm" disabled={i === 0} onClick={() => act(() => api.moveTable(r.id, -1))}>↑
                    </button>
                    <button className="btn sm" disabled={i === rows.length - 1}
                            onClick={() => act(() => api.moveTable(r.id, 1))}>↓
                    </button>
                    <button className="btn sm danger" onClick={() => setDel(r)}>{t('delete')}</button>
                </div>
            ))}
            <div className="rowline">
                <input placeholder={t('newTable')} value={name} onChange={(e) => setName(e.target.value)}/>
                <button className="btn sm primary" onClick={async () => {
                    if (await act(() => api.saveTable({name}))) setName('')
                }}>{t('addTable')}</button>
            </div>
            {del && <Confirm title={t('deleteTitle', {name: del.name})} text={t('deleteTableText')} yes={t('delete')}
                             onNo={() => setDel(null)} onYes={() => {
                const d = del;
                setDel(null);
                act(() => api.deleteTable(d.id))
            }}/>}
        </div>
    )
}

function MenuAdmin() {
    const t = useT()
    const [cats, setCats] = useState<Category[]>([])
    const [prods, setProds] = useState<AdminProduct[]>([])
    const [sel, setSel] = useState<number | null>(null)
    const [catName, setCatName] = useState('')
    const [pn, setPn] = useState('')
    const [pb, setPb] = useState('')
    const [pp, setPp] = useState('')
    const [pq, setPq] = useState('10')
    const [delCat, setDelCat] = useState<Category | null>(null)
    const [delProd, setDelProd] = useState<AdminProduct | null>(null)
    const load = async (): Promise<void> => {
        const [c, p] = await Promise.all([api.listCategories(true), api.listProducts(true)])
        setCats(c);
        setProds(p)
        setSel((s) => (s !== null && c.some((x) => x.id === s) ? s : c[0]?.id ?? null))
    }
    useEffect(() => {
        load()
    }, [])
    const act = useAct(load)

    return (
        <div className="cols menu-admin">
            <div className="card">
                <h3>{t('categories')}</h3>
                {cats.map((c) => (
                    <div key={c.id} className={'rowline' + (sel === c.id ? ' sel' : '')} onClick={() => setSel(c.id)}>
                        <input defaultValue={c.name} className={c.active ? '' : 'off'}
                               onBlur={(e) => {
                                   const v = e.target.value.trim();
                                   if (v && v !== c.name) act(() => api.saveCategory({
                                       id: c.id,
                                       name: v,
                                       active: !!c.active
                                   }))
                               }}/>
                        <label className="check"><input type="checkbox" checked={!!c.active}
                                                        onChange={(e) => act(() => api.saveCategory({
                                                            id: c.id,
                                                            name: c.name,
                                                            active: e.target.checked
                                                        }))}/>{t('visible')}</label>
                        <button className="icon-btn" aria-label={t('delete')} onClick={(e) => {
                            e.stopPropagation();
                            setDelCat(c)
                        }}><IconTrash size={18}/></button>
                    </div>
                ))}
                <div className="rowline">
                    <input placeholder={t('newCategory')} value={catName} onChange={(e) => setCatName(e.target.value)}/>
                    <button className="btn sm primary" onClick={async () => {
                        if (await act(() => api.saveCategory({name: catName, active: true}))) setCatName('')
                    }}>{t('add')}</button>
                </div>
            </div>
            <div className="card">
                <h3>{t('products')}</h3>
                <div className="rowline headrow">
                    <span className="grow"/><span className="price">{t('buyPrice')}</span><span
                    className="price">{t('sellPrice')}</span><span className="price">{t('quantity')}</span><span className="catcol">{t('categoryCol')}</span><span
                    className="oncol">{t('onCol')}</span><span className="iconcol"/>
                </div>
                {prods.filter((p) => p.categoryId === sel).map((p) => (
                    <ProductRow key={p.id + ':' + p.name + p.priceCents + p.costCents} p={p} cats={cats} act={act}
                                onDelete={setDelProd}/>
                ))}
                {sel !== null && (
                    <div className="rowline">
                        <input placeholder={t('newProduct')} value={pn} onChange={(e) => setPn(e.target.value)}/>
                        <input className="price" placeholder="0.60" value={pb} onChange={(e) => setPb(e.target.value)}/>
                        <input className="price" placeholder="1.50" value={pp} onChange={(e) => setPp(e.target.value)}/>
                        <input className="price" aria-label={t('quantity')} type="number" value={pq} onChange={(e) => setPq(e.target.value)}/>
                        <button className="btn sm primary" onClick={async () => {
                            if (await act(() => api.saveProduct({
                                categoryId: sel,
                                name: pn,
                                priceCents: toCents(pp),
                                costCents: centsOrZero(pb),
                                quantity: Number(pq),
                                active: true
                            }))) {
                                setPn('');
                                setPb('');
                                setPp('');
                                setPq('10')
                            }
                        }}>{t('add')}</button>
                    </div>
                )}
                <p className="mute">{t('menuHint')}</p>
            </div>
            {delCat && <Confirm title={t('deleteCategoryTitle', {name: delCat.name})}
                                text={t('deleteCategoryText', {n: prods.filter((p) => p.categoryId === delCat.id).length})}
                                yes={t('delete')}
                                onNo={() => setDelCat(null)} onYes={() => {
                const d = delCat;
                setDelCat(null);
                act(() => api.deleteCategory(d.id))
            }}/>}
            {delProd &&
                <Confirm title={t('deleteTitle', {name: delProd.name})} text={t('deleteProductText')} yes={t('delete')}
                         onNo={() => setDelProd(null)} onYes={() => {
                    const d = delProd;
                    setDelProd(null);
                    act(() => api.deleteProduct(d.id))
                }}/>}
        </div>
    )
}

function ProductRow({p, cats, act, onDelete}: {
    p: AdminProduct;
    cats: Category[];
    act: Act;
    onDelete: (p: AdminProduct) => void
}) {
    const t = useT()
    const [name, setName] = useState(p.name)
    const [cost, setCost] = useState((p.costCents / 100).toFixed(2))
    const [price, setPrice] = useState((p.priceCents / 100).toFixed(2))
    const [quantity, setQuantity] = useState(String(p.quantity))
    const save = (over: { categoryId?: number; active?: boolean } = {}): void => {
        act(() => api.saveProduct({
            id: p.id,
            categoryId: over.categoryId ?? p.categoryId,
            name,
            priceCents: toCents(price),
            costCents: centsOrZero(cost),
            quantity: Number(quantity),
            active: over.active ?? !!p.active
        }))
    }
    const dirty = name.trim() !== p.name || toCents(price) !== p.priceCents || centsOrZero(cost) !== p.costCents || Number(quantity) !== p.quantity
    return (
        <div className="rowline">
            <input className={p.active ? '' : 'off'} value={name} onChange={(e) => setName(e.target.value)}
                   onBlur={() => dirty && save()}/>
            <input className="price" aria-label={t('buyPrice')} value={cost} onChange={(e) => setCost(e.target.value)}
                   onBlur={() => dirty && save()}/>
            <input className="price" aria-label={t('sellPrice')} value={price}
                   onChange={(e) => setPrice(e.target.value)} onBlur={() => dirty && save()}/>
            <input className="price" aria-label={t('quantity')} type="number" step="1" value={quantity}
                   onChange={(e) => setQuantity(e.target.value)} onBlur={() => dirty && save()}/>
            <select className="catcol" value={p.categoryId}
                    onChange={(e) => save({categoryId: Number(e.target.value)})}>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className="check oncol"><input type="checkbox" checked={!!p.active}
                                                  onChange={(e) => save({active: e.target.checked})}/></label>
            <button className="icon-btn iconcol" aria-label={t('delete')} onClick={() => onDelete(p)}><IconTrash
                size={18}/></button>
        </div>
    )
}

function EmployeesAdmin() {
    const t = useT()
    const [emps, setEmps] = useState<Employee[]>([])
    const load = async (): Promise<void> => setEmps(await api.listEmployees(true))
    useEffect(() => {
        load()
    }, [])
    const act = useAct(load)
    return (
        <div className="card">
            <h3>{t('tabEmployees')}</h3>
            {emps.map((e) => <EmpRow key={e.id + ':' + e.name + e.hasPin + e.isAdmin + e.active} e={e} act={act}/>)}
            <EmpRow key={'new' + emps.length} act={act}/>
            <p className="mute">{t('employeesHint')}</p>
        </div>
    )
}

function EmpRow({e, act}: { e?: Employee; act: Act }) {
    const t = useT()
    const [name, setName] = useState(e?.name ?? '')
    const [admin, setAdmin] = useState(!!e?.isAdmin)
    const [active, setActive] = useState(e ? !!e.active : true)
    const [pin, setPin] = useState('')
    const save = (clearPin = false): void => {
        act(() => api.saveEmployee({id: e?.id, name, isAdmin: admin, active, pin: clearPin ? null : pin || undefined}))
    }
    return (
        <div className="rowline">
            <input placeholder={t('newEmployee')} value={name} onChange={(x) => setName(x.target.value)}
                   className={active ? '' : 'off'}/>
            <input className="price" inputMode="numeric" placeholder={e?.hasPin ? '••••' : t('pinPlaceholder')}
                   value={pin} onChange={(x) => setPin(x.target.value.replace(/\D/g, '').slice(0, 8))}/>
            {e?.hasPin ? <button className="btn sm" onClick={() => save(true)}>{t('removePin')}</button> : null}
            <label className="check"><input type="checkbox" checked={admin}
                                            onChange={(x) => setAdmin(x.target.checked)}/>{t('admin')}</label>
            <label className="check"><input type="checkbox" checked={active}
                                            onChange={(x) => setActive(x.target.checked)}/>{t('active')}</label>
            <button className="btn sm primary" onClick={() => save()}>{e ? t('save') : t('add')}</button>
        </div>
    )
}

function SettingsAdmin() {
    const {settings, reloadSettings, reloadTables, toast} = useApp()
    const t = useT()
    const [s, setS] = useState<Settings>(settings)
    const [printers, setPrinters] = useState<{ name: string; label: string }[]>([])
    const [preview, setPreview] = useState<PreviewData | null>(null)
    const [showReset, setShowReset] = useState(false)
    const [resetText, setResetText] = useState('')
    useEffect(() => {
        api.listPrinters().then(setPrinters)
    }, [])
    const set = (k: keyof Settings, v: string): void => setS((x) => ({...x, [k]: v}))
    const field = (k: keyof Settings, label: string, ph = '') => (
        <label className="field">{label}<input value={s[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)}/></label>
    )
    const save = async (): Promise<boolean> => {
        try {
            await api.saveSettings(s);
            await reloadSettings();
            return true
        } catch (e) {
            toast(msg(e), 'err');
            return false
        }
    }
    const test = async (): Promise<void> => {
        if (!(await save())) return
        const r = await api.testPrint()
        toast(r.ok ? t('testSent') : r.error ?? t('printFailed'), r.ok ? 'ok' : 'err')
    }
    const showSample = async (): Promise<void> => {
        if (!(await save())) return
        try {
            setPreview(await api.previewSample())
        } catch (e) {
            toast(msg(e), 'err')
        }
    }

    return (
        <div className="cols">
            <div className="card">
                <h3>{t('cafe')}</h3>
                {field('cafeName', t('cafeName'))}
                {field('address', t('address'))}
                {field('currency', t('currency'), 'EUR')}
                {field('footer', t('receiptFooter'))}
                <label className="field">{t('language')}
                    <select value={s.language} onChange={(e) => set('language', e.target.value)}>
                        {LANGS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </select>
                </label>
                <label className="field">{t('layout')}
                    <select value={s.layout} onChange={(e) => set('layout', e.target.value)}>
                        <option value="classic">{t('layoutClassic')}</option>
                        <option value="split">{t('layoutSplit')}</option>
                    </select>
                </label>
                <label className="check"><input type="checkbox" checked={s.cardEnabled === '1'}
                                                onChange={(e) => set('cardEnabled', e.target.checked ? '1' : '0')}/>{t('acceptCard')}
                </label>
                <label className="check"><input type="checkbox" checked={s.keyboardShortcuts === '1'}
                                                onChange={(e) => set('keyboardShortcuts', e.target.checked ? '1' : '0')}/>{t('keyboardShortcuts')}</label>
                <p className="mute">{t('keyboardShortcutsHelp')}</p>
                <button className="btn primary" onClick={async () => {
                    if (await save()) toast(t('settingsSaved'))
                }}>{t('saveSettings')}</button>
            </div>
            <div className="card">
                <h3>{t('printing')}</h3>
                <label className="field">{t('printerType')}
                    <select value={s.printMode} onChange={(e) => set('printMode', e.target.value)}>
                        <option value="windows">{t('ptWindows')}</option>
                        <option value="escpos">{t('ptEscpos')}</option>
                        <option value="none">{t('ptNone')}</option>
                    </select>
                </label>
                {s.printMode === 'windows' && (
                    <>
                        <label className="field">{t('printer')}
                            <select value={s.printerName} onChange={(e) => set('printerName', e.target.value)}>
                                <option value="">{t('defaultPrinter')}</option>
                                {printers.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
                            </select>
                        </label>
                        <label className="check"><input type="checkbox" checked={s.silentPrint === '1'}
                                                        onChange={(e) => set('silentPrint', e.target.checked ? '1' : '0')}/>{t('silent')}
                        </label>
                    </>
                )}
                {s.printMode === 'escpos' && (
                    <>
                        {field('escposTarget', t('printerAddress'), '192.168.1.50  or  \\\\localhost\\PrinterShare  or  COM3')}
                        <label className="field">{t('paperWidth')}
                            <select value={s.paperChars} onChange={(e) => set('paperChars', e.target.value)}>
                                <option value="48">80 mm</option>
                                <option value="32">58 mm</option>
                            </select>
                        </label>
                        <p className="mute">{t('escposHelp')}</p>
                    </>
                )}
                <div className="row2">
                    <button className="btn" onClick={showSample}>{t('previewSample')}</button>
                    <button className="btn" onClick={test} disabled={s.printMode === 'none'}>{t('testPrint')}</button>
                </div>
                <h3>{t('backup')}</h3>
                <p className="mute">{t('backupHelp')}</p>
                <div className="row2">
                    <button className="btn" onClick={async () => {
                        try {
                            const p = await api.backupNow();
                            if (p) toast(t('backupSaved'))
                        } catch (e) {
                            toast(msg(e), 'err')
                        }
                    }}>{t('backupNow')}</button>
                    <button className="btn danger" onClick={async () => {
                        try {
                            await api.restoreBackup()
                        } catch (e) {
                            toast(msg(e), 'err')
                        }
                    }}>{t('restore')}</button>
                </div>
                <h3>{t('dangerZone')}</h3>
                <p className="mute">{t('resetBusinessDataHelp')}</p>
                <button className="btn danger" onClick={() => { setResetText(''); setShowReset(true) }}>{t('resetBusinessData')}</button>
            </div>
            {preview && <ReceiptPreview rows={preview.rows} width={preview.width} onClose={() => setPreview(null)}/>}
            {showReset && <Modal title={t('resetBusinessData')} onClose={() => setShowReset(false)}>
                <p className="mute">{t('resetBusinessDataWarning')}</p>
                <label className="field">{t('typeConfirmation')}<input value={resetText} onChange={(e) => setResetText(e.target.value)}/></label>
                <button className="btn danger" disabled={resetText !== 'DELETE ALL DATA'} onClick={async () => {
                    try {
                        await api.resetBusinessData(resetText)
                        await reloadTables()
                        setShowReset(false)
                        toast(t('businessDataDeleted'))
                    } catch (e) { toast(msg(e), 'err') }
                }}>{t('resetBusinessData')}</button>
            </Modal>}
        </div>
    )
}
