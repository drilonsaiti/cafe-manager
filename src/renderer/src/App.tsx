import {lazy, Suspense, useCallback, useEffect, useMemo, useState} from 'react'
import {api} from './api'
import type {Ctx} from './ctx'
import {AppCtx} from './ctx'
import {IconSwitch} from './icons'
import {errorText, LangCtx, normalizeLang, setLang, translate} from './i18n'
import {initials} from './util'
import {patchTable, setTables} from './tablesStore'
import type {Employee, LoginResult, Settings, TableRef, TableRow, User} from '../../shared/types'
import Login from './screens/Login'
import Tables from './screens/Tables'
import OrderScreen from './screens/Order'
import History from './screens/History'
// Rarely used, admin-only screens are loaded the first time they are opened.
const Reports = lazy(() => import('./screens/Reports'))
const Admin = lazy(() => import('./screens/Admin'))

type Screen = 'tables' | 'order' | 'history' | 'reports' | 'admin'

export default function App() {
    const [user, setUser] = useState<User | null>(null)
    const [settings, setSettings] = useState<Settings | null>(null)
    const [screen, setScreen] = useState<Screen>('tables')
    const [table, setTable] = useState<TableRef | null>(null)
    const [employees, setEmployees] = useState<Employee[]>([])
    const [note, setNote] = useState<{ m: string; kind: string } | null>(null)

    const boot = useCallback(async () => {
        const b = await api.getBootData() // settings + employees: one round trip
        setSettings(b.settings);
        setEmployees(b.employees)
    }, [])
    useEffect(() => {
        boot()
    }, [boot])
    const reloadSettings = useCallback(async () => setSettings(await api.getSettings()), [])
    const reloadTables = useCallback(async () => setTables(await api.listTables()), [])

    const lang = normalizeLang(settings?.language ?? 'en')
    setLang(lang)

    const toast = useCallback((m: string, kind: 'ok' | 'err' = 'ok') => {
        const text = kind === 'err' ? errorText(m) : m
        setNote({m: text, kind})
        setTimeout(() => setNote((n) => (n && n.m === text ? null : n)), kind === 'err' ? 5000 : 2200)
    }, [])

    const ctx = useMemo<Ctx | null>(
        () => (user && settings ? {user, settings, toast, reloadSettings, reloadTables} : null),
        [user, settings, toast, reloadSettings, reloadTables]
    )

    const split = settings?.layout === 'split'
    /** Opening a table: classic layout goes to the order page, the one-page layout just fills its right-hand side. */
    const openTable = useCallback((t: TableRow) => {
        setTable({id: t.id, name: t.name});
        if (!split) setScreen('order')
    }, [split])
    const closeOrder = useCallback(() => {
        if (split) setTable(null); else setScreen('tables')
    }, [split])
    const moved = useCallback((t: TableRef) => {
        reloadTables();
        if (split) setTable(t); else setScreen('tables')
    }, [split, reloadTables])

    if (!settings) return null
    const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>): string => translate(lang, k, v)

    if (!user || !ctx) {
        return (
            <LangCtx.Provider value={lang}>
                <Login cafe={settings.cafeName} emps={employees} onLogin={(r: LoginResult) => {
                    setUser(r.user);
                    setTables(r.tables);
                    setScreen('tables')
                }}/>
            </LangCtx.Provider>
        )
    }

    const logout = async (): Promise<void> => {
        await api.logout()
        await boot() // employees or settings may have been edited during the shift
        setUser(null)
    }
    const tabs: [Screen, string, boolean][] = [
        ['tables', t('tables'), true], ['history', t('orders'), true], ['reports', t('reports'), !!user.isAdmin], ['admin', t('settings'), !!user.isAdmin]
    ]
    const onTables = screen === 'tables' || screen === 'order'
    const active: Screen = onTables ? 'tables' : screen

    return (
        <LangCtx.Provider value={lang}>
            <AppCtx.Provider value={ctx}>
                <div className="shell">
                    <nav className="topbar noprint">
                        <div className="brand">{settings.cafeName}</div>
                        <div className="segmented">
                            {tabs.filter((x) => x[2]).map(([s, label]) => (
                                <button key={s} className={'seg' + (active === s ? ' on' : '')}
                                        onClick={() => setScreen(s)}>{label}</button>
                            ))}
                        </div>
                        <div className="spacer"/>
                        <div className="who"><span className="avatar sm">{initials(user.name)}</span>{user.name}</div>
                        <button className="btn sm" onClick={logout}><IconSwitch size={18}/>{t('switchEmployee')}
                        </button>
                    </nav>
                    <main className={'main' + (onTables && (split || screen === 'order') ? ' fill' : '')}>
                        {onTables && split && (
                            <div className="split">
                                <div className="split-tables"><Tables compact selectedId={table?.id ?? null}
                                                                      onOpen={openTable}/></div>
                                <div className="split-order">
                                    {table
                                        ? <OrderScreen key={table.id} table={table} mode="pane" onBack={closeOrder}
                                                       onMoved={moved} onOrder={patchTable}/>
                                        : <div className="placeholder">{t('selectTable')}</div>}
                                </div>
                            </div>
                        )}
                        {onTables && !split && screen === 'tables' && <Tables onOpen={openTable}/>}
                        {onTables && !split && screen === 'order' && table &&
                            <OrderScreen key={table.id} table={table} mode="page" onBack={closeOrder} onMoved={moved}
                                         onOrder={patchTable}/>}
                        {screen === 'history' && <History/>}
                        <Suspense fallback={null}>
                            {screen === 'reports' && user.isAdmin ? <Reports/> : null}
                            {screen === 'admin' && user.isAdmin ? <Admin/> : null}
                        </Suspense>
                    </main>
                    {note && <div className={'toast ' + note.kind} role="status">{note.m}</div>}
                </div>
            </AppCtx.Provider>
        </LangCtx.Provider>
    )
}
