import type { IpcMainInvokeEvent } from 'electron'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { User } from '../shared/types'

// ---------- session: who is logged in is decided HERE, never by the UI ----------
let current: User | null = null
export const setSession = (u: User | null): void => { current = u }
export const me = (): User => {
  if (!current) throw new Error('Select an employee first')
  return current
}

export const adminUser = (): User => {
  const u = me()
  if (!u.isAdmin) throw new Error('Only an admin can do this')
  return u
}

/** Callable without logging in (login screen needs these). */
const PUBLIC = new Set(['listEmployees', 'login', 'getSettings'])
/** Callable by admins only. Everything else needs any logged-in employee. */
const ADMIN = new Set([
  'saveEmployee', 'saveTable', 'moveTable', 'deleteTable', 'saveCategory', 'saveProduct',
  'report', 'exportCsv', 'saveSettings', 'backupNow', 'restoreBackup', 'testPrint', 'listPrinters'
])

export function authorize(channel: string): void {
  if (PUBLIC.has(channel)) return
  const u = me()
  if (ADMIN.has(channel) && !u.isAdmin) throw new Error('Only an admin can do this')
}

/** Only our own window may talk to the main process. */
export function isAppUrl(url: string): boolean {
  const dev = process.env['ELECTRON_RENDERER_URL']
  return dev ? url.startsWith(dev) : url.startsWith('file://') && url.includes('/renderer/index.html')
}
export const validSender = (e: IpcMainInvokeEvent): boolean => isAppUrl(e.senderFrame?.url ?? '')

// ---------- PINs: salted scrypt, constant-time compare, lockout after repeated failures ----------
export function hashPin(pin: string): string {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('hex')}$${scryptSync(pin, salt, 32).toString('hex')}`
}

export function verifyPin(stored: string, pin: string): { ok: boolean; legacy: boolean } {
  if (stored.startsWith('scrypt$')) {
    const [, salt, hash] = stored.split('$')
    const ref = Buffer.from(hash, 'hex')
    const calc = scryptSync(pin, Buffer.from(salt, 'hex'), ref.length)
    return { ok: timingSafeEqual(calc, ref), legacy: false }
  }
  // older unsalted hash: accept once, caller upgrades it
  return { ok: createHash('sha256').update('cafe-pin:' + pin).digest('hex') === stored, legacy: true }
}

const fails = new Map<number, { n: number; until: number }>()
export function checkLock(id: number): void {
  const f = fails.get(id)
  if (f && f.until > Date.now()) throw new Error(`Too many wrong PINs. Try again in ${Math.ceil((f.until - Date.now()) / 1000)} seconds.`)
}
export function recordFail(id: number): void {
  const f = fails.get(id) ?? { n: 0, until: 0 }
  f.n++
  if (f.n % 5 === 0) f.until = Date.now() + Math.min(600, 30 * 2 ** (f.n / 5 - 1)) * 1000
  fails.set(id, f)
}
export const clearFails = (id: number): void => { fails.delete(id) }

// ---------- input validation (the UI is not trusted either) ----------
export function int(v: unknown, label: string, min = 0, max = 1_000_000_000): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Error(`Invalid ${label}`)
  return v
}
export function text(v: unknown, label: string, max = 80): string {
  if (typeof v !== 'string') throw new Error(`Invalid ${label}`)
  const s = v.trim()
  if (!s) throw new Error(`${label} is required`)
  if (s.length > max) throw new Error(`${label} is too long (max ${max} characters)`)
  return s
}
