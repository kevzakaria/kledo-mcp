#!/usr/bin/env node

import { loadKledoProcessConfig } from '../config.js'
import { createKledoHttpGateway } from '../kledo/http-gateway.js'

try {
  const config = loadKledoProcessConfig()
  createKledoHttpGateway(config)
  process.stdout.write('Kledo MCP configuration is valid. No API request was made.\n')
} catch {
  process.stderr.write('Kledo MCP configuration is invalid. Check the base URL and token.\n')
  process.exitCode = 1
}
