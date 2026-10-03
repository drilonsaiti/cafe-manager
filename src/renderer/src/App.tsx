import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { AppCtx } from './ctx'
import type { Ctx } from './ctx'
import { IconSwitch } from './icons'
import { initials } from './util'
import { patchTable, setTables } from './tablesStore'
import type { Employee, LoginResult, Settings, TableRow, User } from '../../shared/types'
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
  const [table, setTable] = useState<TableRow | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [note, setNote] = useState<{ m: string; kind: string } | null>(null)

  const boot = useCallback(async () => {
    const b = await api.getBootData() // settings + employees: one round trip
    setSettings(b.settings); setEmployees(b.employees)
  }, [])
  useEffect(() => { boot() }, [boot])
  const reloadSettings = useCallback(async () => setSettings(await api.getSettings()), [])
  const reloadTables = useCallback(async () => setTables(await api.listTables()), [])

  const openTable = useCallback((t: TableRow) => { setTable(t); setScreen('order') }, [])
  const backToTables = useCallback((reload?: boolean) => { setScreen('tables'); if (reload) reloadTables() }, [reloadTables])

  const toast = useCallback((m: string, kind: 'ok' | 'err' = 'ok') => {
    setNote({ m, kind })
    setTimeout(() => setNote((n) => (n && n.m === m ? null : n)), kind === 'err' ? 5000 : 2200)
  }, [])

  const ctx = useMemo<Ctx | null>(
    () => (user && settings ? { user, settings, toast, reloadSettings, reloadTables } : null),
    [user, settings, toast, reloadSettings, reloadTables]
  )

  if (!settings) return null
  if (!user || !ctx) return <Login cafe={settings.cafeName} emps={employees} onLogin={(r: LoginResult) => { setUser(r.user); setTables(r.tables); setScreen('tables') }} />

  const logout = async (): Promise<void> => {
    await api.logout()
    await boot() // employees or settings may have been edited during the shift
    setUser(null)
  }
  const tabs: [Screen, string, boolean][] = [
    ['tables', 'Tables', true], ['history', 'Orders', true], ['reports', 'Reports', !!user.isAdmin], ['admin', 'Settings', !!user.isAdmin]
  ]
  const active: Screen = screen === 'order' ? 'tables' : screen

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <nav className="topbar noprint">
          <div className="brand">{settings.cafeName}</div>
          <div className="segmented">
            {tabs.filter((t) => t[2]).map(([s, label]) => (
              <button key={s} className={'seg' + (active === s ? ' on' : '')} onClick={() => setScreen(s)}>{label}</button>
            ))}
          </div>
          <div className="spacer" />
          <div className="who"><span className="avatar sm">{initials(user.name)}</span>{user.name}</div>
          <button className="btn sm" onClick={logout}><IconSwitch size={18} />Switch employee</button>
        </nav>
        <main className={'main' + (screen === 'order' ? ' fill' : '')}>
          {screen === 'tables' && <Tables onOpen={openTable} />}
          {screen === 'order' && table && <OrderScreen table={table} onBack={backToTables} onOrder={patchTable} />}
          {screen === 'history' && <History />}
          <Suspense fallback={null}>
            {screen === 'reports' && user.isAdmin ? <Reports /> : null}
            {screen === 'admin' && user.isAdmin ? <Admin /> : null}
          </Suspense>
        </main>
        {note && <div className={'toast ' + note.kind} role="status">{note.m}</div>}
      </div>
    </AppCtx.Provider>
  )
}
