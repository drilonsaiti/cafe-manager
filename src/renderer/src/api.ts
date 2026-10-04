import type {api as MainApi} from '../../main/api'

type Async<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never }

declare global {
    interface Window {
        api: { call: (name: string, ...args: unknown[]) => Promise<unknown> }
    }
}

const clean = (e: unknown): Error =>
    new Error(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))

/** Typed bridge to the main process: api.addItem(...) etc. */
export const api = new Proxy({} as Async<typeof MainApi>, {
    get: (_t, name: string) => (...args: unknown[]) => window.api.call(name, ...args).catch((e) => {
        throw clean(e)
    })
})
