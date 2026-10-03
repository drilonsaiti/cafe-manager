import { createContext, useContext } from 'react'
import type { Settings, User } from '../../shared/types'

export interface Ctx {
  user: User
  settings: Settings
  toast: (message: string, kind?: 'ok' | 'err') => void
  reloadSettings: () => Promise<void>
  reloadTables: () => Promise<void>
}
export const AppCtx = createContext<Ctx>(null as unknown as Ctx)
export const useApp = (): Ctx => useContext(AppCtx)
