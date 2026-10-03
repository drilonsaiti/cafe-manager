import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { IconLock } from '../icons'
import { initials, msg } from '../util'
import type { Employee, LoginResult } from '../../../shared/types'

export default function Login({ cafe, emps, onLogin }: { cafe: string; emps: Employee[]; onLogin: (r: LoginResult) => void }) {
  const [pick, setPick] = useState<Employee | null>(null)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const go = useRef<() => void>(() => {})

  const submit = async (e: Employee, p: string): Promise<void> => {
    try { onLogin(await api.login(e.id, p)) } catch (x) { setErr(msg(x)); setPin('') }
  }
  go.current = () => { if (pick && pin) submit(pick, pin) }

  useEffect(() => {
    if (!pick) return
    const h = (ev: KeyboardEvent): void => {
      if (/^\d$/.test(ev.key)) setPin((p) => (p.length < 8 ? p + ev.key : p))
      else if (ev.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (ev.key === 'Escape') setPick(null)
      else if (ev.key === 'Enter') go.current()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [pick])

  const choose = (e: Employee): void => {
    setErr(''); setPin('')
    if (e.hasPin) setPick(e); else submit(e, '')
  }

  return (
    <div className="login">
      <h1>{cafe}</h1>
      <p className="mute">Choose your name to start</p>
      {err && !pick && <div className="err">{err}</div>}
      <div className="people">
        {emps.map((e) => (
          <button key={e.id} className="person" onClick={() => choose(e)}>
            <span className="avatar">{initials(e.name)}</span>
            <span className="pname">{e.name}</span>
            {e.hasPin ? <span className="lock"><IconLock size={16} /></span> : null}
          </button>
        ))}
      </div>
      {pick && (
        <div className="overlay" onMouseDown={() => setPick(null)}>
          <div className="modal pin" role="dialog" aria-label="Enter PIN" onMouseDown={(e) => e.stopPropagation()}>
            <span className="avatar mid">{initials(pick.name)}</span>
            <h3>{pick.name}</h3>
            <div className="dots">{Array.from({ length: Math.max(4, pin.length) }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
            <div className="err">{err}</div>
            <div className="keys">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map((k) => (
                <button key={k} className={'btn' + (k === 'OK' ? ' primary' : '')} aria-label={k === '⌫' ? 'Delete' : k} onClick={() => {
                  if (k === '⌫') setPin((p) => p.slice(0, -1))
                  else if (k === 'OK') go.current()
                  else setPin((p) => (p.length < 8 ? p + k : p))
                }}>{k}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
