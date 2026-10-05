#!/usr/bin/env node
import * as path from 'path'
import { exportFromUrl } from './exporter'

async function main() {
  const args = process.argv.slice(2)
  const urlArg = args.find(a => !a.startsWith('--'))
  const outputArg = args.find(a => a.startsWith('--output='))?.split('=')[1]
  const chromePathArg = args.find(a => a.startsWith('--chrome-path='))?.split('=')[1]

  if (!urlArg) {
    console.error('Usage: butter-export <url> [--output=<dir>] [--chrome-path=<path>]')
    process.exit(1)
  }

  const outputDir = outputArg ? path.resolve(outputArg) : process.cwd()

  try {
    const filePath = await exportFromUrl(urlArg, { outputDir, chromePath: chromePathArg })
    console.log('Exported to:', filePath)
  } catch (err: any) {
    console.error('Export failed:', err.message)
    process.exit(1)
  }
}

main()
