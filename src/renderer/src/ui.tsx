import type {ReactNode} from 'react'
import {useEffect} from 'react'
import {IconClose, IconPrinter} from './icons'
import {useT} from './i18n'
import type {Row} from '../../main/print'
import type {Range, RangeKind} from './util'

export function Modal({title, onClose, children, wide}: {
    title: string;
    onClose: () => void;
    children: ReactNode;
    wide?: boolean
}) {
    const t = useT()
    useEffect(() => {
        const h = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', h)
        return () => window.removeEventListener('keydown', h)
    }, [onClose])
    return (
        <div className="overlay" onMouseDown={onClose}>
            <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title}
                 onMouseDown={(e) => e.stopPropagation()}>
                <header><h3>{title}</h3>
                    <button className="icon-btn" aria-label={t('close')} onClick={onClose}><IconClose/></button>
                </header>
                {children}
            </div>
        </div>
    )
}

export function Confirm({title, text, yes, onYes, onNo}: {
    title: string;
    text: string;
    yes: string;
    onYes: () => void;
    onNo: () => void
}) {
    const t = useT()
    return (
        <Modal title={title} onClose={onNo}>
            <p className="mute para">{text}</p>
            <div className="row2">
                <button className="btn big" onClick={onNo}>{t('cancel')}</button>
                <button className="btn big danger" onClick={onYes}>{yes}</button>
            </div>
        </Modal>
    )
}

const KINDS: [RangeKind, 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'custom'][] =
    [['today', 'today'], ['yesterday', 'yesterday'], ['week', 'thisWeek'], ['month', 'thisMonth'], ['custom', 'custom']]

export function RangePicker({value, onChange}: { value: Range; onChange: (r: Range) => void }) {
    const t = useT()
    return (
        <div className="range noprint">
            <div className="segmented">
                {KINDS.map(([k, label]) => (
                    <button key={k} className={'seg' + (value.kind === k ? ' on' : '')}
                            onClick={() => onChange({...value, kind: k})}>{t(label)}</button>
                ))}
            </div>
            {value.kind === 'custom' && (
                <>
                    <label>{t('from')} <input type="date" value={value.from}
                                              onChange={(e) => onChange({...value, from: e.target.value})}/></label>
                    <label>{t('to')} <input type="date" value={value.to}
                                            onChange={(e) => onChange({...value, to: e.target.value})}/></label>
                </>
            )}
        </div>
    )
}

/** Shows the receipt exactly as the printer gets it (same rows), on a paper-width strip. */
export function ReceiptPreview({rows, width, onClose, onPrint}: {
    rows: Row[];
    width: number;
    onClose: () => void;
    onPrint?: () => void
}) {
    const t = useT()
    return (
        <Modal title={t('previewTitle')} onClose={onClose}>
            <div className="paper-wrap">
                <div className="paper" style={{width: `${width}ch`}}>
                    {rows.map((r, i) => {
                        switch (r.t) {
                            case 'title':
                                return <div key={i} className="c title">{r.a}</div>
                            case 'center':
                                return <div key={i} className="c">{r.a}</div>
                            case 'text':
                                return <div key={i}>{r.a}</div>
                            case 'row':
                                return <div key={i} className="r"><span>{r.a}</span><span>{r.b}</span></div>
                            case 'bold-row':
                                return <div key={i} className="r b"><span>{r.a}</span><span>{r.b}</span></div>
                            case 'rule':
                                return <hr key={i}/>
                            default:
                                return <br key={i}/>
                        }
                    })}
                </div>
            </div>
            <div className="row2">
                <button className="btn big" onClick={onClose}>{t('close')}</button>
                {onPrint &&
                    <button className="btn big primary" onClick={onPrint}><IconPrinter/>{t('printBtn')}</button>}
            </div>
        </Modal>
    )
}
