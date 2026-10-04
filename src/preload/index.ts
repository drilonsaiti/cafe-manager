import {contextBridge, ipcRenderer} from 'electron'

contextBridge.exposeInMainWorld('api', {
    call: (name: string, ...args: unknown[]) => ipcRenderer.invoke(name, ...args)
})
