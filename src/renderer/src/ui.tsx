import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { IconClose } from './icons'
import type { Range, RangeKind } from './util'

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <header><h3>{title}</h3><button className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button></header>
        {children}
      </div>
    </div>
  )
}

export function Confirm({ title, text, yes, onYes, onNo }: { title: string; text: string; yes: string; onYes: () => void; onNo: () => void }) {
  return (
    <Modal title={title} onClose={onNo}>
      <p className="mute para">{text}</p>
      <div className="row2"><button className="btn big" onClick={onNo}>Cancel</button><button className="btn big danger" onClick={onYes}>{yes}</button></div>
    </Modal>
  )
}

const KINDS: [RangeKind, string][] = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']]

export function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="range noprint">
      <div className="segmented">
        {KINDS.map(([k, label]) => (
          <button key={k} className={'seg' + (value.kind === k ? ' on' : '')} onClick={() => onChange({ ...value, kind: k })}>{label}</button>
        ))}
      </div>
      {value.kind === 'custom' && (
        <>
          <label>From <input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} /></label>
          <label>To <input type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} /></label>
        </>
      )}
    </div>
  )
}
