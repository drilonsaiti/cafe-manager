import type {ReactNode} from 'react'

const svg = (d: ReactNode, size = 20) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)
type P = { size?: number }
export const IconBack = ({size}: P) => svg(<path d="M15 18l-6-6 6-6"/>, size)
export const IconClose = ({size}: P) => svg(<path d="M6 6l12 12M18 6L6 18"/>, size)
export const IconPlus = ({size}: P) => svg(<path d="M12 5v14M5 12h14"/>, size)
export const IconMinus = ({size}: P) => svg(<path d="M5 12h14"/>, size)
export const IconCheck = ({size}: P) => svg(<path d="M5 13l4 4L19 7"/>, size)
export const IconSwap = ({size}: P) => svg(<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>, size)
export const IconPrinter = ({size}: P) => svg(<path
    d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z"/>, size)
export const IconCash = ({size}: P) => svg(<>
    <rect x="2" y="6" width="20" height="12" rx="2"/>
    <circle cx="12" cy="12" r="2.5"/>
</>, size)
export const IconCard = ({size}: P) => svg(<>
    <rect x="2" y="5" width="20" height="14" rx="2"/>
    <path d="M2 10h20"/>
</>, size)
export const IconLock = ({size}: P) => svg(<>
    <rect x="5" y="11" width="14" height="10" rx="2"/>
    <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
</>, size)
export const IconEye = ({size}: P) => svg(<>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/>
    <circle cx="12" cy="12" r="3"/>
</>, size)
export const IconTrash = ({size}: P) => svg(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>, size)
export const IconSwitch = ({size}: P) => svg(<path
    d="M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>, size)
