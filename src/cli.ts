#!/usr/bin/env node
import * as path from 'path'
import * as fs from 'fs'
import { exportFromUrl } from './exporter'

async function main() {
  const args = process.argv.slice(2)
  const urlArg = args.find(a => !a.startsWith('--'))
  const outputArg = args.find(a => a.startsWith('--output='))?.split('=')[1]
  const chromePathArg = args.find(a => a.startsWith('--chrome-path='))?.split('=')[1]

  if (!urlArg) {
    console.error('Usage: butter-export <url> [--output=<path>] [--chrome-path=<path>]')
    process.exit(1)
  }

  const resolvedOutput = outputArg ? path.resolve(outputArg) : undefined
  const hasExtension = resolvedOutput ? path.extname(resolvedOutput) !== '' : false
  const outputDir = resolvedOutput
    ? (hasExtension ? path.dirname(resolvedOutput) : resolvedOutput)
    : process.cwd()
  const desiredPath = hasExtension ? resolvedOutput : undefined

  try {
    const downloadedPath = await exportFromUrl(urlArg, { outputDir, chromePath: chromePathArg })

    const filePath = desiredPath
      ? (fs.renameSync(downloadedPath, desiredPath), desiredPath)
      : downloadedPath

    console.log('Exported to:', filePath)
  } catch (err: any) {
    console.error('Export failed:', err.message)
    process.exit(1)
  }
}

main()
