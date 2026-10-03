import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { AppCtx } from './ctx'
import type { Ctx } from './ctx'
import { IconSwitch } from './icons'
import { initials } from './util'
import type { Settings, TableRow, User } from '../../shared/types'
import Login from './screens/Login'
import Tables from './screens/Tables'
import OrderScreen from './screens/Order'
import History from './screens/History'
import Reports from './screens/Reports'
import Admin from './screens/Admin'

type Screen = 'tables' | 'order' | 'history' | 'reports' | 'admin'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [screen, setScreen] = useState<Screen>('tables')
  const [table, setTable] = useState<TableRow | null>(null)
  const [note, setNote] = useState<{ m: string; kind: string } | null>(null)

  const reloadSettings = useCallback(async () => setSettings(await api.getSettings()), [])
  useEffect(() => { reloadSettings() }, [reloadSettings])

  const toast = useCallback((m: string, kind: 'ok' | 'err' = 'ok') => {
    setNote({ m, kind })
    setTimeout(() => setNote((n) => (n && n.m === m ? null : n)), kind === 'err' ? 5000 : 2200)
  }, [])

  const ctx = useMemo<Ctx | null>(
    () => (user && settings ? { user, settings, toast, reloadSettings } : null),
    [user, settings, toast, reloadSettings]
  )

  if (!settings) return null
  if (!user || !ctx) return <Login cafe={settings.cafeName} onLogin={(u) => { setUser(u); setScreen('tables') }} />

  const logout = (): void => { api.logout().finally(() => setUser(null)) }
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
          {screen === 'tables' && <Tables onOpen={(t) => { setTable(t); setScreen('order') }} />}
          {screen === 'order' && table && <OrderScreen table={table} onBack={() => setScreen('tables')} />}
          {screen === 'history' && <History />}
          {screen === 'reports' && user.isAdmin ? <Reports /> : null}
          {screen === 'admin' && user.isAdmin ? <Admin /> : null}
        </main>
        {note && <div className={'toast ' + note.kind} role="status">{note.m}</div>}
      </div>
    </AppCtx.Provider>
  )
}
