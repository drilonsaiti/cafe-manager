import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron'
import { join } from 'node:path'
import { backupDir, idleMaintenance, openDb, scheduleBackups, shutdownDb } from './db'
import { api } from './api'
import { authorize, isAppUrl, setSession, validSender } from './security'

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    show: false, // shown on ready-to-show: no white flash, no half-painted window
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
  win.once('ready-to-show', () => { win?.maximize(); win?.show() })

  // The UI never opens other windows or navigates away from itself.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => { if (!isAppUrl(url)) e.preventDefault() })
  // A reload always lands on the login screen, so it must also end the session.
  win.webContents.on('did-finish-load', () => setSession(null))

  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  for (const [name, fn] of Object.entries(api)) {
    ipcMain.handle(name, (e, ...args: unknown[]) => {
      if (!validSender(e)) throw new Error('Blocked request')
      authorize(name)
      return (fn as (...a: unknown[]) => unknown)(...args)
    })
  }
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

    registerIpc()
    // Start the renderer process first so it boots while the database opens. This is safe: openDb() is
    // synchronous, so no IPC request can be handled before it has finished.
    createWindow()
    try {
      openDb()
    } catch (e) {
      dialog.showErrorBox(
        'Café Manager cannot open its data file',
        `${(e as Error).message}\n\nYour automatic backups are in:\n${backupDir()}\nRestore one of them, or contact support. Nothing was changed.`
      )
      app.exit(1)
      return
    }
    // Non-critical work waits until the first screen is long since usable.
    setTimeout(idleMaintenance, 20_000)
    scheduleBackups()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', shutdownDb)
}
