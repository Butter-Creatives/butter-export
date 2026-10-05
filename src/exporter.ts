import puppeteer, { Browser, CDPSession, Page } from 'puppeteer'
import * as path from 'path'
import * as fs from 'fs'
import { randomUUID } from 'crypto'

const DEBUG = false

interface ExportOptions {
  outputDir: string
  chromePath?: string
  stallTimeoutMs?: number
}

interface ButterExportProgress {
  state: string
  progress: number
  error?: string
}

export async function exportFromUrl(url: string, options: ExportOptions): Promise<string> {
  const { outputDir, chromePath, stallTimeoutMs = 2 * 60 * 1000 } = options

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // isolated temp dir so the file poller only sees Chrome's download, nothing else
  const downloadDir = path.join(outputDir, `.butter-export-${randomUUID()}`)
  fs.mkdirSync(downloadDir, { recursive: true })

  const browser: Browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-frame-rate-limit', // rAF runs at full speed instead of being throttled in background
      '--disable-dev-shm-usage',    // prevents crashes when /dev/shm is small (CI, Docker, etc.)
      '--disable-crash-reporter',   // prevents Crashpad from trying to write to disk
      '--no-first-run',             // skips first-run setup that can fail in restricted environments
    ],
    ...(chromePath ? { executablePath: chromePath } : {}),
  })

  try {
    const page: Page = await browser.newPage()
    const client: CDPSession = await page.createCDPSession()
    // client is kept in scope; Page.setDownloadBehavior requires it even though
    // we detect download completion via filesystem polling rather than CDP events

    if (DEBUG) {
      page.on('console', (msg) => process.stderr.write(`[${msg.type()}] ${msg.text()}\n`))
      page.on('pageerror', (err) => process.stderr.write(`[pageerror] ${err.message}\n`))
    }

    // avoids blob serialization overhead vs. intercepting network responses
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir,
    })

    // magic link redeems the token, sets auth cookies, then redirects to /studio/[id]
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 })

    // goto resolves on networkidle2, but the redirect to /studio/[id] may be a
    // client-side Next.js navigation that fires after network quiets; wait for it
    await page.waitForFunction(
      () => window.location.pathname.startsWith('/studio/'),
      { timeout: 30_000 },
    ).catch(() => {
      const landed = page.url()
      if (landed.includes('/magic/') || landed.includes('/login')) {
        throw new Error('Magic link expired or invalid. Generate a new one from Butter.')
      }
      throw new Error(`Timed out waiting for studio redirect (landed on: ${landed})`)
    })

    // exportInBrowser is set by ExportProvider once the creative and export config are loaded
    await page.waitForFunction(
      () => typeof (window as any).exportInBrowser === 'function',
      { timeout: 5 * 60 * 1000 },
    ).catch(() => {
      throw new Error('Waiting for export engine timed out: the studio may not have loaded correctly.')
    })

    await page.evaluate(() => {
      ;(window as any).exportInBrowser()
    })

    const filePath = await new Promise<string>((resolve, reject) => {
      let settled = false

      // Stall detection: track when the progress signature last changed.
      // Initialized to now so we time out if exportInBrowser() never produces any progress.
      let lastProgressSignature: string | null = null
      let lastProgressTime = Date.now()

      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearInterval(progressPoll)
        clearInterval(stallCheck)
        clearInterval(filePoller)
        fn()
      }

      // Single evaluate per tick to avoid redundant CDP roundtrips
      const progressPoll = setInterval(async () => {
        try {
          const { exportProgress, exportError } = await page.evaluate(() => ({
            exportProgress: (window as any).butterExportProgress as ButterExportProgress | undefined,
            exportError: (window as any).__butterExportError as string | undefined,
          }))

          if (exportProgress) {
            const { state, progress, error } = exportProgress

            if (state === 'error') {
              process.stdout.write('\n')
              settle(() => reject(new Error(error ?? 'No detailed error message was provided.')))
              return
            }

            process.stdout.write(`\r${state}: ${progress.toFixed(1)}%   `)

            const sig = `${state}:${progress}`
            if (sig !== lastProgressSignature) {
              lastProgressSignature = sig
              lastProgressTime = Date.now()
            }
          }

          // Butter surfaces export failures via window.__butterExportError rather than throwing
          if (exportError) {
            settle(() => reject(new Error(`Export error from Butter: ${exportError}`)))
          }
        } catch {
          // page may have already been closed
        }
      }, 100)

      const stallCheck = setInterval(() => {
        if (Date.now() - lastProgressTime > stallTimeoutMs) {
          settle(() =>
            reject(new Error(`Export stalled: no progress for ${stallTimeoutMs / 60000} minutes`)),
          )
        }
      }, 5_000)

      // Page.downloadProgress is experimental and unreliable; watch the filesystem instead.
      // Chrome writes a .crdownload temp file during download then renames to the final name.
      const filePoller = setInterval(() => {
        const completed = fs.readdirSync(downloadDir).find((f) => !f.endsWith('.crdownload'))
        if (completed) {
          const ext = path.extname(completed)
          const base = path.basename(completed, ext)
          const ts = new Date().toISOString().replace(/[:.]/g, '-')
          const renamed = path.join(outputDir, `${base}-${ts}${ext}`)
          fs.renameSync(path.join(downloadDir, completed), renamed)
          fs.rmdirSync(downloadDir)
          process.stdout.write('\n')
          settle(() => resolve(renamed))
        }
      }, 500)
    })

    return filePath
  } finally {
    await browser.close()
    if (fs.existsSync(downloadDir)) fs.rmSync(downloadDir, { recursive: true })
  }
}
