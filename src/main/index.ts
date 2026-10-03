import { app, BrowserWindow, ipcMain, Menu, session } from 'electron'
import { join } from 'node:path'
import { openDb, scheduleBackups } from './db'
import { api } from './api'
import { authorize, isAppUrl, setSession, validSender } from './security'

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#eef1f4',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })
  win.maximize()

  // The UI never opens other windows or navigates away from itself.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => { if (!isAppUrl(url)) e.preventDefault() })
  // A reload always lands on the login screen, so it must also end the session.
  win.webContents.on('did-finish-load', () => setSession(null))

  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    if (app.isPackaged) Menu.setApplicationMenu(null) // no View > Reload / DevTools in production
    openDb()
    scheduleBackups()
    for (const [name, fn] of Object.entries(api)) {
      ipcMain.handle(name, (e, ...args: unknown[]) => {
        if (!validSender(e)) throw new Error('Blocked request')
        authorize(name)
        return (fn as (...a: unknown[]) => unknown)(...args)
      })
    }
    createWindow()
  })
  app.on('window-all-closed', () => app.quit())
}
