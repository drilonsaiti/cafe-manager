import {useEffect, useState} from 'react'

// One shared interval for every running timer (it only exists while a timer is on screen).
const TICK_MS = 20_000
const subs = new Set<(t: number) => void>()
let timer: number | undefined

export function useClock(): number {
    const [now, setNow] = useState(Date.now)
    useEffect(() => {
        subs.add(setNow)
        if (subs.size === 1) timer = window.setInterval(() => {
            const t = Date.now();
            subs.forEach((f) => f(t))
        }, TICK_MS)
        return () => {
            subs.delete(setNow);
            if (subs.size === 0) {
                clearInterval(timer);
                timer = undefined
            }
        }
    }, [])
    return now
}

export function elapsed(ms: number): string {
    const m = Math.max(0, Math.floor(ms / 60000))
    const h = Math.floor(m / 60)
    return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`
}
