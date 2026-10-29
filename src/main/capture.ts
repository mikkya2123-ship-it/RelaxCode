import { BrowserWindow } from 'electron'

/**
 * One-off page capture for the agent timelapse: a hidden window loads the
 * URL, settles briefly and hands back a small JPEG data URL. Failures return
 * null — a timelapse may miss frames, it must never break a run.
 */
export async function captureJpeg(url: string, width = 640, height = 400): Promise<string | null> {
  let win: BrowserWindow | null = null
  try {
    win = new BrowserWindow({
      show: false,
      width,
      height,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    })
    await win.webContents.loadURL(url)
    await new Promise((resolve) => setTimeout(resolve, 400))
    const image = await win.webContents.capturePage()
    if (image.isEmpty()) return null
    const buffer = image.toJPEG(60)
    return `data:image/jpeg;base64,${buffer.toString('base64')}`
  } catch {
    return null
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
  }
}
