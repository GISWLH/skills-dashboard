import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getDashboardSnapshot,
  installRemoteSkill,
  syncLocalSkills,
  updateSelectedSource,
} from './skills'
import type {
  DashboardSnapshot,
  LocalSourceFilter,
  RemoteInstallRequest,
} from '../src/shared/contracts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let snapshotCache: DashboardSnapshot | null = null

app.whenReady().then(async () => {
  registerIpcHandlers()
  await createMainWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

async function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1160,
    minHeight: 760,
    backgroundColor: '#efe6d6',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function registerIpcHandlers() {
  ipcMain.handle('dashboard:get-snapshot', async () => {
    if (snapshotCache) {
      return snapshotCache
    }

    snapshotCache = await getDashboardSnapshot()
    return snapshotCache
  })

  ipcMain.handle('dashboard:refresh', async () => {
    snapshotCache = await getDashboardSnapshot()
    return snapshotCache
  })

  ipcMain.handle(
    'dashboard:update-selected-source',
    async (_event, selectedSource: LocalSourceFilter) => {
      const settings = await updateSelectedSource(selectedSource)
      if (snapshotCache) {
        snapshotCache = {
          ...snapshotCache,
          settings,
        }
      }

      return settings
    },
  )

  ipcMain.handle(
    'dashboard:install-remote-skill',
    async (_event, request: RemoteInstallRequest) => {
      const result = await installRemoteSkill(request)
      snapshotCache = await getDashboardSnapshot()
      return result
    },
  )

  ipcMain.handle('dashboard:sync-local-skills', async () => {
    const result = await syncLocalSkills()
    snapshotCache = await getDashboardSnapshot()
    return result
  })
}
